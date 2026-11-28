// #253: a performer's profile – what Flowtrack learned of ONE person's way of moving, so the dream answers that person
// more directly. Pure computation, no DOM, no camera, no model: the page of Flowtrack learns with it (from a session
// of the lab's format, dancerec.js – recorded before or taken live), the stage fits the feature stream with it, the
// Node tests use it the same way with synthetic performers (tests/js/flowprofile.test.mjs).
//
// A profile is numbers and a name the user chose, never a picture:
//   {format: "dream-flow-profile", version: 1, name, prop, stats: {seconds, speed: {lo, mid, hi}, energy: {hi},
//    turn: {hi, dir, share}, open: {lo, hi} | null, height: {lo, hi} | null, tempo: {lo, mid, hi, share} | null,
//    planes: {wall, wheel, floor}, round, pair: {rigid, share} | null, arm: {spin, force} | null, curve: [24 × 0 … 1],
//    view: {reach, gap, kind}}, figures: [{tpl (a template of dancemoves.js), share}]}
// - `learn` plays a session's inputs through a fresh detector (dance.js) and measures the person: how fast the hands
//   or the props go (the stream's uncut speed), how they turn, how wide and how high, the tempo of their repetition,
//   in which plane they circle, the energy over the session, how far they reach in the camera picture, how long they
//   drop out of sight – and the figures they come back to (found and matched with the code of the taught moves).
// - `compile` makes a profile ready for use; the fitter (`create`) lays the person's own ranges over the stream's
//   record before the mapping table reads it: full energy is THIS person's fast, "open" THEIR widest. It adds two
//   sources: "figure" (one of the person's figures is being made, and how large) and "round" (how round the path of
//   the prop is: 1 – a circle seen face-on, 0 – a line). What a movement does stays a row of the table (dancemap.js).
// - `rows` tunes a table's smoothing to the person's tempo, `auto` is what the automatic (flowauto.js) takes of it:
//   how far the performer reaches, how long they may be out of sight, the kind of detection they were learned with.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const D = node ? require('./dance.js') : root.DreamDance, MV = node ? require('./dancemoves.js') : root.DreamMoves;
  // (the stage does not load dancerec.js: it never learns – only `learn` needs the session format)
  const R = node ? require('./dancerec.js') : root.DreamDanceRec, M = node ? require('./dancemap.js') : root.DreamDanceMap;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const r3 = x => Math.round(x * 1000) / 1000, r4 = x => Math.round(x * 10000) / 10000;
  const FORMAT = 'dream-flow-profile', VERSION = 1;
  // what the performer plays with. `axis`: the two lights are the two ends of one thing – its turning is read from
  // the line between them; `hides`: the prop is often behind the body – the automatic waits longer for it.
  const PROPS = { poi: { hides: true }, staff: { axis: true }, hoop: { hides: true }, fans: {}, hands: {}, other: {} };
  // a prop's name as the pages show it (whatever is asked for: a known name, or "something else")
  function propName(prop) {
    switch (prop) {
      case 'poi': return T('poi');
      case 'staff': return T('staff');
      case 'hoop': return T('hoop');
      case 'fans': return T('fans');
      case 'hands': return T('hands');
      default: return T('something else');
    }
  }
  const SOURCES = ['figure', 'round'];                 // what a profile adds to the sources of the mapping table
  const MIN_SECONDS = 15;                              // seconds of movement a profile is learned from, at least
  const MAX_FIGURES = 3, BINS = 24, WINDOW = 6;        // figures kept; points of the energy curve; seconds looked at for a figure
  const MOVING = 0.4;                                  // shoulder widths a second: below, the person stands
  const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_ .+\-–]{0,31}$/u;   // a person's name: flowprofiles.py NAME (settings.SET_NAME, as a movement set's)

  const pct = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), i = clamp(q, 0, 1) * (s.length - 1), lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };
  const share = (a, test) => (a.length ? a.filter(test).length / a.length : 0);

  // How round a path is: pts [[u, v], …] → {round (0 a line … 1 a circle seen face-on), ang (the long axis' angle,
  // 0 = lying, ±π/2 = upright), size (half its long side)} – from the path's own two main directions.
  function roundness(pts) {
    const n = pts.length; if (n < 8) return { round: 0, ang: 0, size: 0 };
    let mu = 0, mv = 0; for (const p of pts) { mu += p[0] / n; mv += p[1] / n; }
    let a = 0, b = 0, c = 0; for (const p of pts) { const u = p[0] - mu, v = p[1] - mv; a += u * u / n; b += v * v / n; c += u * v / n; }
    const tr = a + b, det = Math.sqrt(Math.max(0, (a - b) * (a - b) / 4 + c * c)), major = Math.sqrt(Math.max(0, tr / 2 + det)), minor = Math.sqrt(Math.max(0, tr / 2 - det));
    return { round: major > 1e-6 ? clamp(minor / major, 0, 1) : 0, ang: 0.5 * Math.atan2(2 * c, a - b), size: Math.SQRT2 * major };
  }
  // the path the roundness is read from: the hand that moves more – or, for a prop with two ends, half the line between them
  function pathOf(samples, axis) {
    if (axis) return samples.filter(s => s.l && s.r).map(s => [(s.l[0] - s.r[0]) / 2, (s.l[1] - s.r[1]) / 2]);
    const l = samples.filter(s => s.l).map(s => s.l), r = samples.filter(s => s.r).map(s => s.r);
    return roundness(l).size >= roundness(r).size ? l : r;
  }

  // ---------- the figures a person comes back to ----------
  // a template as the live hands would show it: 2.5 s of it, run round and round
  function shown(tpl) {
    const n = Math.round(2.5 * MV.RATE), buf = { ul: [], vl: [], ur: [], vr: [] }, per = tpl.period * MV.RATE;
    for (let i = 0; i < n; i++) {
      const x = ((i / per) % 1) * MV.M, j = Math.floor(x) % MV.M, k = (j + 1) % MV.M, w = x - Math.floor(x);
      ['ul', 'vl', 'ur', 'vr'].forEach((ch, c) => buf[ch].push(tpl.pts[j][c] + (tpl.pts[k][c] - tpl.pts[j][c]) * w));
    }
    return buf;
  }
  const alike = (c, tpl) => c.hands.join('') === tpl.hands && MV.match(c, shown(tpl), { l: 1, r: 1 }).score >= 0.5;
  // samples: [{t, l, r}] (the stream's hands, body units). Every stretch of WINDOW seconds is looked at for a
  // repetition (dancemoves.js: `segment`, `template`); stretches that show the same figure count together, and the
  // ones seen at least twice are the person's figures: [{tpl, share (of the stretches)}], the most frequent first.
  function figures(samples) {
    const found = []; let n = 0, from = 0;
    if (samples.length < 2) return [];
    const end = samples[samples.length - 1].t;
    for (let a = samples[0].t; a + WINDOW <= end + 1e-6; a += WINDOW / 2) {
      n++;
      while (from < samples.length && samples[from].t < a) from++;
      let to = from; while (to < samples.length && samples[to].t < a + WINDOW) to++;
      const g = MV.grid(samples.slice(from, to)), seg = MV.segment(g);
      if (seg.why) continue;
      const tpl = MV.template(g, seg.reps, seg.hands), c = tpl && MV.compile(tpl, 'x');
      if (!c) continue;
      const same = found.find(f => alike(f.c, tpl));
      if (same) same.n++; else found.push({ tpl, c, n: 1 });
    }
    return found.filter(f => f.n >= 2).sort((a, b) => b.n - a.n).slice(0, MAX_FIGURES).map(f => ({ tpl: f.tpl, share: r3(f.n / n) }));
  }

  // ---------- learning ----------
  // s: a session (dancerec.js). → {why: null, stats, figures, prop (a guess – the user says what it really is)} or
  // {why: 'nosession' | 'nobody' | 'short', seconds}: no session, nobody found in it, too little movement.
  function learn(s) {
    const fail = (why, seconds = 0) => ({ why, seconds: r3(seconds), stats: null, figures: [], prop: 'other' });
    if (!R.good(s) || s.frames.length < 2) return fail('nosession');
    const det = D.create({ aspect: s.aspect || 16 / 9 });
    const speed = [], energy = [], rev = [], open = [], height = [], bpm = [], spin = [], force = [], far = [], gaps = [], rounds = [], gapsPair = [], samples = [];
    const kinds = { hand: 0, marker: 0, on: 0 }, planes = { wall: 0, wheel: 0, floor: 0 }, bins = Array.from({ length: BINS }, () => [0, 0]);
    const total = Math.max(1e-6, s.frames[s.frames.length - 1].t - s.frames[0].t);
    let was = null, seen = 0, moved = 0, lostAt = null, centre = null, both = 0;
    for (const f of s.frames) {
      const input = R.input(f), rec = det.step(input), dt = was == null ? 0 : clamp(f.t - was, 0, 0.2); was = f.t;
      const here = rec.c.energy > 0 && !!(rec.hands.l || rec.hands.r), bin = bins[clamp(Math.floor((f.t - s.frames[0].t) / total * BINS), 0, BINS - 1)];
      bin[1]++;
      if (!here) { if (lostAt == null && seen > 0) lostAt = f.t; continue; }
      if (lostAt != null) { if (f.t - lostAt < 10) gaps.push(f.t - lostAt); lostAt = null; }   // longer: a break, no dropout
      seen += dt; bin[0] += rec.raw.speed;
      samples.push({ t: f.t, l: rec.hands.l, r: rec.hands.r });
      // where in the camera picture: how far from their own (slow) middle the hands or lights are
      const pts = ['l', 'r'].map(h => input.hands[h][0]).filter(Boolean);
      for (const p of pts) kinds[p.src === 'light' ? 'on' : p.src === 'pose' ? 'hand' : 'marker']++;
      if (pts.length) {
        const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        centre = centre ? [centre[0] + (mx - centre[0]) * 0.05, centre[1] + (my - centre[1]) * 0.05] : [mx, my];
        far.push(Math.max(...pts.map(p => Math.hypot(p.x - centre[0], p.y - centre[1]))));
      }
      if (rec.c.spin > 0) spin.push(Math.abs(rec.v.spin));
      if (rec.c.force > 0) force.push(rec.v.force);
      if (rec.raw.speed < MOVING) continue;
      moved += dt; speed.push(rec.raw.speed); energy.push(rec.v.energy); rev.push(rec.raw.turn);
      if (rec.c.open > 0) open.push(rec.v.open);
      if (rec.c.height > 0) height.push(rec.v.height);
      if (rec.bpm > 0) bpm.push(rec.bpm);
      // two lights that keep their distance in the picture are the two ends of one thing
      if (pts.length === 2) { both++; gapsPair.push(Math.hypot((pts[0].x - pts[1].x) * (input.aspect || 16 / 9), pts[0].y - pts[1].y)); }
    }
    if (!samples.length) return fail('nobody');
    if (moved < MIN_SECONDS) return fail('short', moved);
    // the planes: every second of the path – round (a circle face-on: the wall plane), or a line upright (the wheel
    // plane, seen edge-on) or lying (the floor plane)
    for (let i = 0, j = 0; i < samples.length; i = j) {
      while (j < samples.length && samples[j].t < samples[i].t + 1) j++;
      const q = roundness(pathOf(samples.slice(i, j), false));
      if (q.size < 0.25) continue;
      rounds.push(q.round);
      planes[q.round > 0.45 ? 'wall' : Math.abs(q.ang) > Math.PI / 4 ? 'wheel' : 'floor']++;
    }
    const hi = Math.max(pct(speed, 0.95), 1e-3), range = a => (a.length >= 30 ? { lo: r3(pct(a, 0.05)), hi: r3(pct(a, 0.95)) } : null);
    const turning = rev.filter(x => Math.abs(x) > 0.3), mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const kind = Object.keys(kinds).reduce((a, k) => (kinds[k] > kinds[a] ? k : a));
    const stats = {
      seconds: r3(moved), total: r3(total),
      speed: { lo: r3(pct(speed, 0.2)), mid: r3(pct(speed, 0.5)), hi: r3(hi) },
      energy: { hi: r3(pct(energy, 0.95)) },
      turn: { hi: r3(pct(rev.map(Math.abs), 0.95)), dir: r3(turning.length ? mean(turning.map(Math.sign)) : 0), share: r3(turning.length / rev.length) },
      open: range(open), height: range(height),
      tempo: bpm.length >= 0.15 * speed.length ? { lo: r3(pct(bpm, 0.1)), mid: r3(pct(bpm, 0.5)), hi: r3(pct(bpm, 0.9)), share: r3(bpm.length / speed.length) } : null,
      planes: Object.fromEntries(Object.keys(planes).map(k => [k, r3(planes[k] / Math.max(1, rounds.length))])), round: r3(pct(rounds, 0.5)),
      pair: both >= 30 ? { rigid: r3(clamp(1 - Math.sqrt(mean(gapsPair.map(x => (x - mean(gapsPair)) ** 2))) / Math.max(1e-6, mean(gapsPair)), 0, 1)), share: r3(both / speed.length) } : null,
      arm: spin.length >= 30 ? { spin: r3(pct(spin, 0.95)), force: r3(pct(force, 0.95)) } : null,
      curve: bins.map(([sum, n]) => r3(clamp(n ? sum / n / hi : 0, 0, 1))),
      view: { reach: r3(pct(far, 0.95)), gap: r3(pct(gaps, 0.95)), kind },
    };
    return { why: null, seconds: stats.seconds, stats, figures: figures(samples), prop: guess(stats) };
  }
  // What the person probably plays with – a proposal for the page's choice, nothing more: two lights that turn and
  // keep their distance are the ends of a staff, lights that turn are poi, hands found by the AI are hands.
  function guess(stats) {
    if (stats.turn.share > 0.4 && stats.view.kind !== 'hand') return stats.pair && stats.pair.share > 0.6 && stats.pair.rigid > 0.75 ? 'staff' : 'poi';
    return stats.view.kind === 'hand' ? 'hands' : 'other';
  }
  // the profile as it is kept: the user's name for it, what the person plays with, and what was learned
  const profile = (name, prop, learned) => ({ format: FORMAT, version: VERSION, name: String(name || '').trim().replace(/\s+/g, ' '),
    prop: Object.prototype.hasOwnProperty.call(PROPS, prop) ? prop : 'other', stats: learned.stats, figures: learned.figures });

  // ---------- a profile made ready ----------
  const num = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
  const pair = (o, lo, hi) => o === null || (!!o && num(o.lo, lo, hi) && num(o.hi, lo, hi));
  // Is this a profile? (what comes from a file is looked at before it is used: fail closed)
  function usable(p) {
    const s = p && p.stats;
    return !!s && p.format === FORMAT && p.version === VERSION && typeof p.name === 'string' && NAME.test(p.name) && Object.prototype.hasOwnProperty.call(PROPS, p.prop)
      && !!s.speed && num(s.speed.hi, 0, 100) && num(s.speed.mid, 0, 100) && !!s.energy && num(s.energy.hi, 0, 1)
      && !!s.turn && num(s.turn.hi, 0, 50) && pair(s.open, 0, 1) && pair(s.height, 0, 1)
      && (s.tempo === null || (pair(s.tempo, 20, 400) && num(s.tempo.mid, 20, 400)))
      && (s.arm === null || (!!s.arm && num(s.arm.spin, 0, 1) && num(s.arm.force, 0, 1)))
      && Array.isArray(s.curve) && s.curve.length === BINS && s.curve.every(x => num(x, 0, 1))
      && !!s.view && num(s.view.reach, 0, 2) && num(s.view.gap, 0, 60) && ['hand', 'marker', 'on'].includes(s.view.kind)
      && Array.isArray(p.figures) && p.figures.length <= MAX_FIGURES && p.figures.every(f => f && MV.usable(f.tpl));
  }
  const span = (o, least) => (o && o.hi - o.lo >= least ? [o.lo, o.hi] : null);
  // → what the fitter, the tables and the automatic read, or null when it is no profile
  function compile(p, id) {
    if (!usable(p) || typeof id !== 'string' || !id) return null;
    const s = p.stats, prop = PROPS[p.prop];
    let tempo = null;
    if (s.tempo) { const mid = (s.tempo.lo + s.tempo.hi) / 2, half = Math.max(10, (s.tempo.hi - s.tempo.lo) / 2); tempo = [mid - half, mid + half]; }
    return { id, name: p.name, prop: p.prop, axis: !!prop.axis,
      speed: clamp(s.speed.hi, 1.5, 40), energy: clamp(s.energy.hi, 0.1, 1), turn: s.turn.hi >= 0.3 ? clamp(s.turn.hi, 0.3, 6) : 0,
      open: span(s.open, 0.1), height: span(s.height, 0.1), tempo,
      spin: s.arm && s.arm.spin >= 0.1 ? s.arm.spin : 0, force: s.arm && s.arm.force >= 0.1 ? s.arm.force : 0,
      // a quick person gets a quick answer: the rows' smoothing follows the tempo of their repetition (110 a minute: as
      // it is) – down to 0.6 of it, and only a little up: nobody's effects are made to lag
      smooth: s.tempo && s.tempo.share >= 0.2 ? clamp(60 / s.tempo.mid / 0.55, 0.6, 1.25) : 1,
      figures: p.figures.map((f, i) => MV.compile(f.tpl, 'fig' + (i + 1))).filter(Boolean),
      auto: { name: p.name, kind: s.view.kind, reach: s.view.reach > 0 ? clamp(s.view.reach * 1.3, 0.2, 0.5) : null,
        hold: clamp(Math.max(2.5, s.view.gap * 1.5) * (prop.hides ? 1.5 : 1), 2.5, 8) } };
  }
  const auto = c => (c ? c.auto : null);
  // a table for this person: the instant rows' smoothing in the person's tempo (the table itself stays as it is kept)
  const rows = (c, table) => (!c || c.smooth === 1 ? table : table.map(r => (r.smooth > 0 && M.kind(r.dst) === 'instant' ? { ...r, smooth: r4(r.smooth * c.smooth) } : r)));

  // ---------- the fitter: the stream's record in the person's own ranges ----------
  function create() {
    let c = null; const path = [];
    function fit(rec) {
      if (!c || !rec || !rec.v) return rec;
      const v = { ...rec.v }, cf = { ...rec.c }, src = { ...rec.src }, raw = rec.raw;
      if (cf.energy > 0) v.energy = r4(raw && !String(src.energy).includes('sensor') ? clamp(raw.speed / c.speed, 0, 1) : clamp(v.energy / c.energy, 0, 1));
      if (raw && c.turn && cf.turn > 0) v.turn = r4(clamp(raw.turn / c.turn, -1, 1));
      for (const k of ['open', 'height']) if (c[k] && cf[k] > 0) v[k] = r4(clamp((v[k] - c[k][0]) / (c[k][1] - c[k][0]), 0, 1));
      if (c.tempo && rec.bpm > 0) v.tempo = r4(clamp((rec.bpm - c.tempo[0]) / (c.tempo[1] - c.tempo[0]), 0, 1));
      for (const k of ['spin', 'force']) if (c[k] && cf[k] > 0) v[k] = r4(clamp(v[k] / c[k], -1, 1));
      // one of the person's figures: how large it is made right now, and how sure the stream is of it
      let fv = 0, fc = 0;
      for (const f of c.figures) { fv = Math.max(fv, v['g.' + f.id] || 0); fc = Math.max(fc, cf['g.' + f.id] || 0); }
      v.figure = fv; cf.figure = fc; src.figure = fc ? src.energy : '';
      // how round the prop's path was in the last second
      const h = rec.hands || {};
      if (path.length && (rec.t < path[path.length - 1].t || rec.t - path[path.length - 1].t > 1)) path.length = 0;
      if (h.l || h.r) path.push({ t: rec.t, l: h.l, r: h.r });
      while (path.length && rec.t - path[0].t > 1) path.shift();
      const q = roundness(pathOf(path, c.axis)), known = path.length >= 12 && q.size >= 0.25;
      v.round = known ? r4(q.round) : 0; cf.round = known ? cf.energy || 0 : 0; src.round = known ? src.energy : '';
      return { ...rec, v, c: cf, src, fit: c.id };
    }
    return { fit, set(compiled) { c = compiled || null; path.length = 0; }, get profile() { return c; } };
  }

  const api = { FORMAT, VERSION, PROPS, propName, SOURCES, MIN_SECONDS, MAX_FIGURES, BINS, NAME, learn, guess, profile, usable, compile, auto, rows, create, roundness, figures };
  if (node) module.exports = api;
  else root.DreamFlowProfile = api;
})(typeof window !== 'undefined' ? window : globalThis);
