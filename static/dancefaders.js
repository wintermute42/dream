// #267: base movements of one's own – a fader learned by showing two or more states of the body ("upright" ↔ "deep in
// the knees", "leaning left" ↔ "leaning right"). Pure computation, no DOM, no camera, no model: the page of Dream
// Dance teaches with it (faderteach.js), the feature stream reads it (dance.js: the source "f.<its id>", a continuous
// value 0 … 1 like the built-in base movements), the Node tests use it the same way (tests/js/dancefaders.test.mjs).
//
// What the body shows is a handful of numbers, normalised to the body as the moves of one's own are (#236): every
// point of the skeleton in shoulder widths from the middle of the shoulders – where the dancer stands in the picture
// and how near does not matter –, how far one shoulder is above the other, and the hands as the stream has them (so a
// base movement can also be taught with LED markers, without a skeleton). Never a picture.
//
// Learning is a small regression, as Wekinator does it, kept so small that it can be explained:
// - each body value's slope: how far it goes from one state to the next (values that hardly change are left out);
// - its weight: the slope over how much it wavered while a state was held (a steady value counts more, a jittery one
//   less – that keeps the fader still while the dancer holds still);
// - the fader is the weighted sum of the body values, fitted so that every state comes out at its own value (0, 1 and
//   the steps between), held to 0 … 1.
// What Dream reads a fader from is the share of each body value in it (`explain`). A fader that cannot tell the states
// apart is not made (`fit` says why).
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const VERSION = 1;
  // the pose model's points a fader reads (MediaPipe's numbers), by the name of the body value they give
  const POINTS = [['head', 0], ['elbow_l', 13], ['elbow_r', 14], ['wrist_l', 15], ['wrist_r', 16], ['hip_l', 23], ['hip_r', 24],
    ['knee_l', 25], ['knee_r', 26], ['ankle_l', 27], ['ankle_r', 28]];
  // every body value: "<point>.u" (to the picture's right), "<point>.v" (up), "tilt" (the left shoulder above the right),
  // and the stream's hands
  const KEYS = [...POINTS.flatMap(([p]) => [p + '.u', p + '.v']), 'tilt', 'hand_l.u', 'hand_l.v', 'hand_r.u', 'hand_r.v'];
  const INDEX = Object.fromEntries(KEYS.map((k, i) => [k, i]));
  // the parts of the body a person names: what `explain` tells
  const PART = { head: 'head', elbow_l: 'elbows', elbow_r: 'elbows', wrist_l: 'hands', wrist_r: 'hands', hand_l: 'hands', hand_r: 'hands',
    hip_l: 'hips', hip_r: 'hips', knee_l: 'knees', knee_r: 'knees', ankle_l: 'feet', ankle_r: 'feet', tilt: 'shoulders' };
  const SEEN = 0.5;                                    // a point the model is less sure of is not seen
  const MIN_STATES = 2, MAX_STATES = 5;                // 0 and 1, and up to three steps between them
  const MIN_SAMPLES = 12;                              // frames a state needs (a little under half a second)
  const MIN_SLOPE = 0.1;                               // shoulder widths from 0 to 1: a value that moves less is no part of it
  const MIN_CHANGE = 0.3;                              // … and at least one body value must move this far
  const FLOOR = 0.05;                                  // shoulder widths: the pose model's own jitter, never trusted below it
  const MAX_ERR = 0.12;                                // how far the states may come out from their value, on average
  const MAX_KEYS = KEYS.length, MAX_W = 1e4;
  const r5 = x => Math.round(x * 1e5) / 1e5;

  // ---------- what the body shows, as numbers ----------
  // pose: the pose model's 33 points [{x, y, visibility}] in the picture's 0 … 1 (or null); hands: the stream's hands
  // {l: [u, v] | null, r: …} (body units, dance.js); aspect: the picture's width / height. → {x: [value per KEYS],
  // seen: [true | false per KEYS]}
  function features(pose, hands, aspect = 16 / 9) {
    const x = new Array(KEYS.length).fill(0), seen = new Array(KEYS.length).fill(false);
    const at = i => (pose && pose[i] && Number.isFinite(pose[i].x) && Number.isFinite(pose[i].y) ? pose[i] : null);
    const vis = p => (p.visibility == null ? 1 : p.visibility);
    const ls = at(11), rs = at(12);
    if (ls && rs && Math.min(vis(ls), vis(rs)) >= SEEN) {
      const P = p => [p.x * aspect, p.y], [lx, ly] = P(ls), [rx, ry] = P(rs), cx = (lx + rx) / 2, cy = (ly + ry) / 2;
      const lh = at(23), rh = at(24), hips = lh && rh && Math.min(vis(lh), vis(rh)) >= SEEN;
      // the body's size: the shoulder width – or, turned sideways, three quarters of the torso (dance.js bodyFrom)
      const torso = hips ? Math.hypot((lh.x + rh.x) / 2 * aspect - cx, (lh.y + rh.y) / 2 - cy) : 0, S = Math.max(Math.hypot(lx - rx, ly - ry), 0.75 * torso);
      if (S > 1e-3) {
        POINTS.forEach(([name, i]) => {
          const p = at(i); if (!p || vis(p) < SEEN) return;
          const k = INDEX[name + '.u'];
          x[k] = (p.x * aspect - cx) / S; x[k + 1] = (cy - p.y) / S; seen[k] = seen[k + 1] = true;
        });
        x[INDEX.tilt] = (ry - ly) / S; seen[INDEX.tilt] = true;
      }
    }
    for (const h of ['l', 'r']) {
      const p = hands && hands[h];
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) { const k = INDEX['hand_' + h + '.u']; x[k] = p[0]; x[k + 1] = p[1]; seen[k] = seen[k + 1] = true; }
    }
    return { x, seen };
  }

  // ---------- learning: the states shown → a fader ----------
  // samples: [{x, seen, y}] – what `features` said, frame by frame, while the dancer held a state, with that state's
  // value (0 … 1). → a model {v, keys, m, w, b, share, states: [{y, at}]} or {why: 'states' | 'few' | 'nobody' |
  // 'same' | 'unsteady', y?}: fewer than two states, a state with too few frames (y: which), no body value seen through
  // all of them, the states look alike, the states overlap (one was not held, or they are too near to each other).
  function fit(samples) {
    const ok = (samples || []).filter(s => s && Array.isArray(s.x) && s.x.length === KEYS.length && Array.isArray(s.seen) && Number.isFinite(s.y) && s.y >= 0 && s.y <= 1);
    const ys = [...new Set(ok.map(s => s.y))].sort((a, b) => a - b);
    if (ys.length < MIN_STATES || ys.length > MAX_STATES || ys[0] !== 0 || ys[ys.length - 1] !== 1) return { why: 'states' };
    const of = y => ok.filter(s => s.y === y);
    for (const y of ys) if (of(y).length < MIN_SAMPLES) return { why: 'few', y };
    // the body values seen through (nearly) every frame of every state – a value that comes and goes is no use live
    const use = KEYS.map((_, k) => k).filter(k => ys.every(y => { const g = of(y); return g.filter(s => s.seen[k]).length >= 0.9 * g.length; }));
    if (!use.length) return { why: 'nobody' };
    const rows = ok.filter(s => use.every(k => s.seen[k]));
    for (const y of ys) if (rows.filter(s => s.y === y).length < MIN_SAMPLES) return { why: 'few', y };
    // every state counts alike, however many frames it has: means over the states' means
    const st = ys.map(y => { const g = rows.filter(s => s.y === y); return { y, n: g.length, mu: use.map(k => g.reduce((a, s) => a + s.x[k], 0) / g.length) }; });
    const yBar = ys.reduce((a, y) => a + y, 0) / ys.length, vy = ys.reduce((a, y) => a + (y - yBar) ** 2, 0) / ys.length;
    const m = use.map((_, j) => st.reduce((a, s) => a + s.mu[j], 0) / st.length);
    const slope = use.map((_, j) => st.reduce((a, s) => a + (s.y - yBar) * (s.mu[j] - m[j]), 0) / st.length / vy);
    // how much each value wavered while a state was held (the mean over the states)
    const wav = use.map((k, j) => st.reduce((a, s) => { const g = rows.filter(r => r.y === s.y); return a + g.reduce((q, r) => q + (r.x[k] - s.mu[j]) ** 2, 0) / g.length; }, 0) / st.length);
    const keep = use.map((k, j) => j).filter(j => Math.abs(slope[j]) >= MIN_SLOPE);
    if (!keep.length || Math.max(...keep.map(j => Math.abs(slope[j]))) < MIN_CHANGE) return { why: 'same' };
    const w0 = keep.map(j => slope[j] / (wav[j] + FLOOR * FLOOR));
    const proj = x => keep.reduce((a, j, n) => a + w0[n] * (x[use[j]] - m[j]), 0);
    // the scale: every frame of every state onto its value (least squares, each state alike)
    const ps = st.map(s => { const g = rows.filter(r => r.y === s.y); return g.map(r => proj(r.x)); });
    const pBar = ps.map(p => p.reduce((a, x) => a + x, 0) / p.length), pm = pBar.reduce((a, x) => a + x, 0) / st.length;
    const cov = st.reduce((a, s, i) => a + (s.y - yBar) * (pBar[i] - pm), 0), vp = st.reduce((a, s, i) => a + (pBar[i] - pm) ** 2, 0);
    if (!(vp > 1e-12) || !(cov > 0)) return { why: 'same' };
    const a = cov / vp, b = yBar - a * pm;
    const model = { v: VERSION, keys: keep.map(j => KEYS[use[j]]), m: keep.map(j => r5(m[j])), w: keep.map((j, n) => r5(a * w0[n])), b: r5(b), share: [], states: [] };
    if (model.w.some(w => !(Math.abs(w) < MAX_W))) return { why: 'unsteady' };
    // what each body value brings to the way from 0 to 1
    const part = keep.map((j, n) => Math.abs(model.w[n] * slope[j])), sum = part.reduce((q, x) => q + x, 0) || 1;
    model.share = part.map(x => r5(x / sum));
    // how the states come out: their mean, and how far their frames are from their value
    let err = 0, cnt = 0;
    st.forEach((s, i) => {
      const vals = ps[i].map(p => clamp(a * p + b, 0, 1));
      model.states.push({ y: s.y, at: r5(vals.reduce((q, x) => q + x, 0) / vals.length) });
      for (const v of vals) { err += (v - s.y) ** 2; cnt++; }
    });
    const rmse = Math.sqrt(err / Math.max(1, cnt));
    for (let i = 1; i < model.states.length; i++) if (model.states[i].at - model.states[i - 1].at < 0.5 / (ys.length - 1)) return { why: 'unsteady' };
    if (rmse > MAX_ERR) return { why: 'unsteady' };
    return model;
  }

  // Is this a model? (what comes from a file is looked at before it is used: fail closed)
  function usable(md) {
    if (!md || md.v !== VERSION || !Array.isArray(md.keys) || !md.keys.length || md.keys.length > MAX_KEYS) return false;
    const n = md.keys.length, nums = (a, lo, hi) => Array.isArray(a) && a.length === n && a.every(x => Number.isFinite(x) && x >= lo && x <= hi);
    return md.keys.every(k => k in INDEX) && new Set(md.keys).size === n && nums(md.m, -50, 50) && nums(md.w, -MAX_W, MAX_W) && nums(md.share, 0, 1)
      && Number.isFinite(md.b) && Math.abs(md.b) < MAX_W && Array.isArray(md.states) && md.states.length >= MIN_STATES && md.states.length <= MAX_STATES
      && md.states.every(s => s && Number.isFinite(s.y) && s.y >= 0 && s.y <= 1 && Number.isFinite(s.at));
  }
  // A model made ready to be read every frame: {id, idx, m, w, b, share} or null
  function compile(md, id) {
    if (!usable(md) || typeof id !== 'string' || !id) return null;
    return { id, idx: md.keys.map(k => INDEX[k]), m: md.m.slice(), w: md.w.slice(), b: md.b, share: md.share.slice() };
  }
  // The fader right now: f – what `features` said; c – a compiled model. → {value (0 … 1), c (how much of what it is
  // read from is seen: 0 … 1)}. A body value not seen counts as its middle; with less than 60 % of the fader seen it
  // is not known (c = 0).
  function read(c, f) {
    if (!c || !f) return { value: 0, c: 0 };
    let v = c.b, seen = 0;
    c.idx.forEach((k, n) => { if (f.seen[k]) { v += c.w[n] * (f.x[k] - c.m[n]); seen += c.share[n]; } });
    if (seen < 0.6) return { value: 0, c: 0 };
    return { value: clamp(v, 0, 1), c: clamp(seen, 0, 1) };
  }
  // What a fader is read from, in words a person knows: [{part, axis ('↕' up and down, '↔' sideways), share}], the
  // largest first, those with at least `min` of it
  function explain(md, min = 0.12) {
    if (!usable(md)) return [];
    const by = new Map();
    md.keys.forEach((k, n) => {
      const [p, ax] = k.split('.'), key = PART[p] + (ax === 'u' ? '↔' : '↕');
      by.set(key, (by.get(key) || 0) + md.share[n]);
    });
    return [...by].map(([key, share]) => ({ part: key.slice(0, -1), axis: key.slice(-1), share })).filter(x => x.share >= min).sort((a, b) => b.share - a.share);
  }

  const api = { VERSION, KEYS, POINTS, PART, MIN_STATES, MAX_STATES, MIN_SAMPLES, features, fit, usable, compile, read, explain };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamFaders = api;
})(typeof window !== 'undefined' ? window : globalThis);
