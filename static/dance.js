// #235: dance steers the dream – the feature stream. Pure computation, no DOM, no camera, no model: the stage feeds it
// what its sources see (hands from the pose model, LED markers, the 21 points of the hand model, a motion sensor on
// the arm) frame by frame and reads one record back; the Node tests feed it synthetic trajectories the same way
// (tests/js/dance.test.mjs).
//
// Two layers come out of it, in one record per frame:
// - continuous features, always on, normalised to the body (its place and size in the picture do not matter):
//   energy, tempo, phase, pulse, open, turn, height, still – and per hand palm (fist 0 … 1 open hand), spread, pinch
//   and snap. Every value has a confidence (0 = not known right now) and the source it came from.
// - gestures as accents: repeated, rhythmic movements (throw, accordion, push, circle, wave) with a confidence that
//   needs two to three repetitions to rise and falls with hysteresis – walking, waving and talking hands stay below it.
// Beside them the movement clock: tempo and phase of the dancer's own repetition, next to the music's beat clock.
//
// A record: {t, v: {name: value}, c: {name: confidence}, src: {name: source}, bpm, gesture, gc, size, g: {gesture:
// confidence}, hands: {l: [u, v] | null, r: …} (body units), events: [...]}. Whatever steers something reads `v`
// through the mapping table (dancemap.js) – a gesture is the source "g.<name>" there, nothing else knows the names.
(function (root) {
  'use strict';
  // #236: moves of one's own are matched by dancemoves.js (a page that has none of them does not load it)
  const MV = typeof module === 'object' && module.exports ? require('./dancemoves.js') : root.DreamMoves;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const gate = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
  const wrap = x => x - Math.round(x);                 // a phase difference in −0.5 … 0.5
  const HANDS = ['l', 'r'];
  // #252: 'spin' and 'force' are the arm's own (a wristband, a phone on the arm): its rotation, and the pull on it
  const FEATURES = ['energy', 'tempo', 'phase', 'pulse', 'open', 'turn', 'height', 'still', 'impulse', 'spin', 'force'];
  const FINGERS = ['palm', 'spread', 'pinch', 'snap'];
  const GESTURES = ['throw', 'accordion', 'push', 'circle', 'wave'];
  // everything a mapping row can take as its source (learned gestures and glove sensors add names of the same kind)
  const SOURCES = [...FEATURES, ...GESTURES.map(g => 'g.' + g), ...HANDS.flatMap(h => FINGERS.map(f => h + '.' + f))];

  const RATE = 30;                                     // the grid the trajectories are kept on (samples a second)
  const N = Math.round(2.5 * RATE);                    // 2.5 s of them
  const LAG_MIN = Math.round(0.3 * RATE), LAG_MAX = Math.round(1.25 * RATE);   // a repetition: 0.3 … 1.25 s (200 … 48 a minute)
  const ON = 0.6, OFF = 0.35, HOLD = 0.4;              // a gesture's hysteresis: on, off, and seconds it outlasts a dip
  // #265: an accent's tolerance – how sure the detection must be before the gesture counts (tight: fewer false alarms,
  // loose: more is taken for it); "off" stays the same distance below "on"
  const TOL = { tight: 0.75, normal: ON, loose: 0.45 };
  const onOf = level => TOL[level] || ON;
  // how large a movement must be (half its swing, in shoulder widths) to count at all … and to count fully
  const MAX_MOVES = 24;                                // #236: taught moves looked for at a time
  const SIZE = { throw: [0.3, 0.6], accordion: [0.35, 0.7], push: [0.3, 0.6], wave: [0.4, 0.8], circle: [0.15, 0.3] };

  // ---------- the body: where it is and how big, from the pose model's 33 points ----------
  // {x, y, s, c}: the middle of the shoulders and the shoulder width in picture heights; a dancer who turns sideways
  // keeps their size through the length of the torso
  function bodyFrom(lm, aspect = 16 / 9) {
    if (!lm || lm.length < 25) return null;
    const p = i => [lm[i].x * aspect, lm[i].y], vis = i => (lm[i].visibility == null ? 1 : lm[i].visibility);
    const c = Math.min(vis(11), vis(12));
    if (c < 0.3) return null;
    const [ls, rs, lh, rh] = [11, 12, 23, 24].map(p), mx = (ls[0] + rs[0]) / 2, my = (ls[1] + rs[1]) / 2;
    const torso = Math.min(vis(23), vis(24)) > 0.3 ? Math.hypot((lh[0] + rh[0]) / 2 - mx, (lh[1] + rh[1]) / 2 - my) : 0;
    return { x: mx / aspect, y: my, s: Math.max(Math.hypot(ls[0] - rs[0], ls[1] - rs[1]), 0.75 * torso), c };
  }

  // ---------- LED markers: one bright spot per colour, found without a model ----------
  // No red, orange or yellow: those are fire (dreamfire.js, the light mode).
  const MARKER_HUES = { cyan: [165, 200], magenta: [285, 335], green: [90, 150], blue: [210, 260] };
  // data: RGBA pixels of a w × h picture; colours: {name: colour}. Returns {name: {x, y, c, len, ang} | null} in the
  // picture's 0…1 – the largest spot of each colour. A marker smeared by a fast move is a streak: its length (in
  // picture widths) and direction say how fast and which way the hand went while the shutter was open.
  function findMarkers(data, w, h, colours) {
    const names = Object.keys(colours).filter(k => MARKER_HUES[colours[k]]), n = w * h, cls = new Uint8Array(n);
    const bands = names.map(k => MARKER_HUES[colours[k]]);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (mx < 110 || d < 0.35 * mx) continue;         // dark, or white and grey: lamps, windows, walls
      const hue = ((mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
      for (let k = 0; k < bands.length; k++) if (hue >= bands[k][0] && hue <= bands[k][1]) { cls[i] = k + 1; break; }
    }
    for (let i = 0; i < n; i++) {                      // an LED's core clips to white: it belongs to the colour around it
      if (cls[i] || Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 235) continue;
      const x = i % w, near = (x > 0 && cls[i - 1]) || (x < w - 1 && cls[i + 1]) || (i >= w && cls[i - w]) || (i + w < n && cls[i + w]) || 0;
      if (near && near < 128) cls[i] = near + 128;
    }
    const out = Object.fromEntries(Object.keys(colours).map(k => [k, null]));
    const seen = new Uint8Array(n), q = new Int32Array(n), best = names.map(() => null), total = names.map(() => 0);
    for (let i = 0; i < n; i++) {
      if (seen[i] || !cls[i]) continue;
      const k = cls[i] & 127;
      let head = 0, tail = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0; q[tail++] = i; seen[i] = 1;
      while (head < tail) {
        const p = q[head++], x = p % w, y = (p / w) | 0; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        for (const o of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
          if (o >= 0 && o < n && !seen[o] && (cls[o] & 127) === k) { seen[o] = 1; q[tail++] = o; }
        }
      }
      const a = tail; total[k - 1] += a;
      if (a < 3 || a > n * 0.2 || (best[k - 1] && best[k - 1].a >= a)) continue;
      const cx = sx / a, cy = sy / a, vx = sxx / a - cx * cx, vy = syy / a - cy * cy, vxy = sxy / a - cx * cy;
      const tr = vx + vy, det = Math.sqrt(Math.max(0, (vx - vy) * (vx - vy) / 4 + vxy * vxy));
      const major = Math.sqrt(Math.max(0, tr / 2 + det)), minor = Math.sqrt(Math.max(0, tr / 2 - det));
      const streak = major > 2 * minor + 1;
      best[k - 1] = { a, x: (cx + 0.5) / w, y: (cy + 0.5) / h, len: streak ? 4 * major / w : 0, ang: streak ? 0.5 * Math.atan2(2 * vxy, vx - vy) : 0 };
    }
    names.forEach((name, k) => {
      const b = best[k];
      // sure when it is more than a few pixels and the only spot of its colour (a second one: a reflection, a lamp)
      if (b) out[name] = { x: b.x, y: b.y, len: b.len, ang: b.ang, c: +(clamp(b.a / 10, 0.4, 1) * clamp(b.a / total[k], 0.3, 1)).toFixed(3) };
    });
    return out;
  }

  // ---------- one hand from several sources ----------
  // cands: [{x, y, c, src ('pose' | 'marker' | 'light'), len, ang}] in the picture; fast: the hand moved fast a moment
  // ago; dark: the room is dark. In the dark and on fast moves the marker leads (the model smears and guesses); when
  // both see the hand in the same place they confirm each other.
  // A candidate may say when it was measured (`at`, seconds): a model that runs on every second camera frame hands
  // the same point in twice, and the stream must not read that as "stood still, then jumped" (see `step`).
  function fuseHand(cands, { fast = false, dark = false } = {}) {
    const ok = (cands || []).filter(c => c && c.c > 0.05 && Number.isFinite(c.x) && Number.isFinite(c.y));
    if (!ok.length) return null;
    const marker = ok.find(c => c.src === 'marker'), pose = ok.find(c => c.src === 'pose');
    if (marker && pose) {
      if (Math.hypot(marker.x - pose.x, marker.y - pose.y) < 0.12 && !fast && !dark) {
        const w = marker.c + pose.c;
        return { x: (marker.x * marker.c + pose.x * pose.c) / w, y: (marker.y * marker.c + pose.y * pose.c) / w,
          c: 1 - (1 - marker.c) * (1 - pose.c), src: 'pose+marker', len: marker.len || 0, ang: marker.ang || 0 };
      }
      return marker.c >= 0.4 && (fast || dark || pose.c < 0.7 || marker.c >= pose.c) ? marker : pose;
    }
    return ok.reduce((a, b) => (b.c > a.c ? b : a));
  }

  // ---------- #237: a glowing phone is its hand's marker, and feels that hand move ----------
  // The spot of light the camera takes for a hand's marker and the motion of the phone in that hand must tell the same
  // story. cands: that hand's candidates; arm: {g: [x, y, z] (rad/s), age (s)} | null – the phone's gyroscope; memo:
  // what was kept of the spot ({x, y, t, sp, odd} | null); t: seconds. Returns {cands, fast, memo}: both move or both
  // rest – they confirm each other; the spot wanders while the phone lies still – another light of that colour, not
  // the phone: it is doubted; the phone swings fast – the marker leads (the camera sees that a moment later).
  const ARM_REST = 0.15, ARM_FAST = 4;                 // rad/s: the phone lies still below, swings fast above
  function armMarker(cands, arm, memo, t, aspect) {
    const swing = arm && Array.isArray(arm.g) && (arm.age == null || arm.age < 0.3) ? Math.hypot(arm.g[0] || 0, arm.g[1] || 0, arm.g[2] || 0) : null;
    const i = cands.findIndex(c => c && c.src === 'marker' && Number.isFinite(c.x) && Number.isFinite(c.y));
    if (i < 0) return { cands, fast: swing != null && swing > ARM_FAST, memo: memo && t - memo.t < 0.3 ? memo : null };
    const mk = cands[i], since = memo ? t - memo.t : 0, known = memo && since > 0 && since < 0.3;
    // how fast the spot moves, in picture heights a second, over about a tenth of a second
    const sp = known ? memo.sp + (Math.hypot((mk.x - memo.x) * aspect, mk.y - memo.y) / since - memo.sp) * Math.min(1, since / 0.1) : 0;
    let odd = 0, c = mk.c;
    if (swing != null && known) odd = swing < ARM_REST && sp > 0.5 ? memo.odd + since : Math.max(0, memo.odd - 2 * since);
    if (swing != null) {
      if (odd > 0.3) c *= 0.3;
      else if (known && ((swing > 1 && sp > 0.15) || (swing < ARM_REST && sp < 0.05))) c = 1 - (1 - c) * 0.5;
    }
    return { cands: cands.map((x, k) => (k === i ? { ...x, c } : x)), fast: swing != null && swing > ARM_FAST, memo: { x: mk.x, y: mk.y, t, sp, odd } };
  }

  // ---------- fingers: the hand model's 21 points → fist ↔ open hand, spread, how close thumb and index are ----------
  // pts: [[x, y], …] (wrist, thumb 1–4, index 5–8, middle 9–12, ring 13–16, little finger 17–20), any size, any turn
  const FINGER = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  function fingerValues(pts) {
    if (!pts || pts.length < 21) return null;
    const d = (a, b) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]), palm = d(0, 9);
    if (!(palm > 1e-6)) return null;
    // a straight finger is as long from knuckle to tip as its bones together; a curled one a third of it
    let ext = 0;
    for (const [a, b, c, e] of FINGER) ext += d(a, e) / Math.max(1e-6, d(a, b) + d(b, c) + d(c, e));
    const open = gate(ext / 4, 0.45, 0.92) ** 2;       // squared: a half-curled finger still reaches far, it reads as half
    let ang = 0;
    for (let i = 0; i < 3; i++) {
      const [a, , , e] = FINGER[i], [a2, , , e2] = FINGER[i + 1];
      const u = [pts[e][0] - pts[a][0], pts[e][1] - pts[a][1]], v = [pts[e2][0] - pts[a2][0], pts[e2][1] - pts[a2][1]];
      ang += Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
    }
    // fingers of a fist point anywhere: spread counts with the open hand only
    return { palm: open, spread: gate(ang / 3, 0.07, 0.38) * open, near: 1 - gate(d(4, 8) / palm, 0.18, 0.7) };
  }

  // ---------- small numerics on a trajectory ----------
  function meanStd(a, from = 0) {
    let s = 0, n = a.length - from;
    for (let i = from; i < a.length; i++) s += a[i];
    const m = s / n; let q = 0;
    for (let i = from; i < a.length; i++) q += (a[i] - m) * (a[i] - m);
    return [m, Math.sqrt(q / n)];
  }
  function corr(a, b, from = 0) {
    const [ma, sa] = meanStd(a, from), [mb, sb] = meanStd(b, from);
    if (sa < 1e-4 || sb < 1e-4) return 0;
    let s = 0;
    for (let i = from; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
    return s / (a.length - from) / (sa * sb);
  }
  const acAt = (a, lag, from) => {                     // how alike the trajectory and itself one lag later are (−1 … 1)
    const [m] = meanStd(a, from); let s = 0, q = 0;
    for (let i = from; i < a.length; i++) q += (a[i] - m) * (a[i] - m);
    for (let i = from; i + lag < a.length; i++) s += (a[i] - m) * (a[i + lag] - m);
    const n = a.length - from;
    return q > 1e-9 ? (s / q) * (n / Math.max(1, n - lag)) : 0;
  };
  // Is the trajectory a repetition? {period (s), r (how alike one repetition and the next are), amp (half the swing)}.
  // The period is searched in the whole window; how alike and how large are read from the last two and a bit
  // repetitions only – so two clean repetitions are enough, and a movement that stopped is gone at once.
  function osc(a) {
    // without a repetition: no period, but still how far it swung in the last second
    const none = () => ({ period: 0, r: 0, amp: Math.SQRT2 * meanStd(a, Math.max(0, a.length - RATE))[1] });
    if (a.length < LAG_MIN * 3) return none();
    const rs = []; let top = -1;
    for (let l = LAG_MIN; l <= Math.min(LAG_MAX, (a.length / 2) | 0); l++) { rs[l] = acAt(a, l, 0); top = Math.max(top, rs[l]); }
    let lag = 0;
    for (let l = LAG_MIN + 1; l < rs.length - 1 && !lag; l++) if (rs[l] >= 0.85 * top && rs[l] >= rs[l - 1] && rs[l] >= rs[l + 1]) lag = l;   // the shortest clear one, not its double
    if (!lag || top < 0.2) return none();
    const d = rs[lag - 1] - 2 * rs[lag] + rs[lag + 1], frac = Math.abs(d) > 1e-9 ? clamp(0.5 * (rs[lag - 1] - rs[lag + 1]) / d, -0.5, 0.5) : 0;
    const from = Math.max(0, a.length - Math.max(Math.round(2.2 * lag), Math.round(0.8 * RATE)));
    return { period: (lag + frac) / RATE, r: clamp(acAt(a, lag, from), 0, 1), amp: Math.SQRT2 * meanStd(a, from)[1] };
  }
  // where in its repetition the trajectory is right now (0 = at its top, counting up to 1)
  function phaseOf(a, period) {
    const span = Math.min(a.length, Math.round(2 * period * RATE)), from = a.length - span, [m] = meanStd(a, from);
    let c = 0, s = 0;
    for (let i = from; i < a.length; i++) { const w = 2 * Math.PI * (i - (a.length - 1)) / (period * RATE); c += (a[i] - m) * Math.cos(w); s += (a[i] - m) * Math.sin(w); }
    return ((-Math.atan2(s, c) / (2 * Math.PI)) % 1 + 1) % 1;
  }

  function create({ aspect = 16 / 9 } = {}) {
    let st, moves = [], tol = {};                      // #265: tol – gesture name → tolerance (none: normal)                                // #236: the taught moves (compiled templates), gestures like the built-in ones
    const names = () => (moves.length ? [...GESTURES, ...moves.map(m => m.id)] : GESTURES);
    const buf = () => ({ ul: [], vl: [], ur: [], vr: [], sg: [], wl: [], wr: [] });
    function reset() {
      st = { t: null, grid: null, tick: 0, centre: null, S: 0, reach: 0, hand: { l: null, r: null }, b: buf(),
        seen: { l: [], r: [] }, ok: { l: 0, r: 0 }, rad: { l: 0, r: 0 }, bodyAt: -1e9, still: 0, eCam: 0, eSens: 0,
        clock: { period: 0, phase: 0, c: 0, agree: 0, beatAt: -1e9, lost: 0 }, g: Object.fromEntries(names().map(g => [g, 0])),
        active: null, below: 0, size: 0, turn: 0, impulse: 0, spin: 0, force: 0, sens: { at: -1e9, axis: 0, level: [0, 0, 0] },
        arm: { l: null, r: null },
        fing: Object.fromEntries(HANDS.map(h => [h, { palm: 0, spread: 0, pinch: 0, snap: 0, on: false, was: [], snapAt: -1e9, c: 0 }])) };
    }
    reset();
    const push = (a, v) => { a.push(v); if (a.length > N) a.shift(); };

    // body units: u to the picture's right, v up, measured from the middle of the shoulders in shoulder widths
    function units(body, hands, dt, t) {
      if (body && body.c >= 0.3 && body.s > 0.01 && Number.isFinite(body.x + body.y + body.s)) {
        // the middle follows the body almost at once: hands that only go along with a swaying body do not move
        const k = st.centre ? Math.min(1, dt / 0.04) : 1, ks = st.S ? Math.min(1, dt / 1.0) : 1;
        st.centre = st.centre ? [st.centre[0] + (body.x * aspect - st.centre[0]) * k, st.centre[1] + (body.y - st.centre[1]) * k] : [body.x * aspect, body.y];
        st.S += (body.s - st.S) * ks; st.bodyAt = t;
        return;
      }
      // the skeleton drops out for a moment (a slow model, a blurred frame): the body is where it was
      if (st.centre && t - st.bodyAt < 0.5) return;
      // no skeleton (markers, light): the middle is where the hands are on average, the size what they reached lately –
      // both glide there, so losing the skeleton never looks like a movement
      const pts = HANDS.map(h => hands[h]).filter(p => p && Number.isFinite(p.x + p.y));
      if (!pts.length) return;
      const mx = pts.reduce((a, p) => a + p.x * aspect, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      if (!st.centre) { st.centre = [mx, my]; if (!st.S) st.S = 0.12; return; }
      const k = Math.min(1, dt / 2.5); st.centre = [st.centre[0] + (mx - st.centre[0]) * k, st.centre[1] + (my - st.centre[1]) * k];
      const far = Math.max(...pts.map(p => Math.hypot(p.x * aspect - st.centre[0], p.y - st.centre[1])));
      st.reach = Math.max(far, st.reach * Math.exp(-dt / 20));
      st.S += (Math.max(0.06, st.reach / 1.6) - st.S) * Math.min(1, dt / 1.5);
    }

    // the clock's phase moves on by d (a step of time, or a correction): coming round is a beat – one per repetition,
    // also when a correction carries it over the line or sets it back just behind it
    function tick(d, t, out, locked) {
      const ck = st.clock, p = ck.phase + d;
      ck.phase = ((p % 1) + 1) % 1;
      if (p >= 1 && locked && t - ck.beatAt > 0.5 * ck.period) { ck.beatAt = t; out.events.push('beat'); }
    }

    function analyse(t, out) {
      const b = st.b, long = st.seen.l.length >= N * 0.4, both = long && st.ok.l > 0.8 && st.ok.r > 0.8;
      // one hand alone counts only while the other is really out of sight – not while it is just coming into view
      const one = long && !both && (st.ok.l > 0.8 && st.ok.r < 0.2 ? 'l' : st.ok.r > 0.8 && st.ok.l < 0.2 ? 'r' : null), n = b.ul.length;
      const sig = {};
      if (both) {
        sig.h = b.vl.map((v, i) => (v + b.vr[i]) / 2); sig.x = b.ul.map((u, i) => (u + b.ur[i]) / 2);
        sig.o = b.ul.map((u, i) => Math.hypot(u - b.ur[i], b.vl[i] - b.vr[i])); sig.d = b.vl.map((v, i) => v - b.vr[i]);
      } else if (one) { sig.h = b['v' + one]; sig.x = b['u' + one]; }
      const o = {}; for (const k of Object.keys(sig)) o[k] = osc(sig[k]);
      const sens = t - st.sens.at < 0.4 && b.sg.length >= LAG_MIN * 3 ? osc(b.sg) : null;
      const from = k => Math.max(0, n - Math.max(Math.round(2.2 * (o[k].period || 1) * RATE), Math.round(0.8 * RATE)));

      // ---- the gestures: what each one looks like, as a score 0 … 1 ----
      const score = Object.fromEntries(GESTURES.map(g => [g, 0])), size = {};
      const amp = k => (o[k] ? o[k].amp : 0), rr = k => (o[k] ? o[k].r : 0), sz = (g, a) => { size[g] = clamp(a / (2 * SIZE[g][1]), 0, 1); return gate(a, ...SIZE[g]); };
      // circle: the hand runs round the middle of its own path, one way, at least most of a turn
      let rev = 0, cons = 0, rad = 0;
      for (const h of both ? HANDS : one ? [one] : []) {
        const w = b['w' + h].slice(-Math.round(1.5 * RATE)); let s = 0, q = 0;
        for (const x of w) { s += x; q += Math.abs(x); }
        if (Math.abs(s) > Math.abs(rev) * RATE * 2 * Math.PI) { rev = s / RATE / (2 * Math.PI); cons = q > 1e-6 ? Math.abs(s) / q : 0; rad = st.rad[h]; }
      }
      score.circle = gate(Math.abs(rev), 0.6, 1.1) * gate(cons, 0.6, 0.9) * sz('circle', rad);
      const round = 1 - score.circle;                  // a circle swings up and sideways too: it is no throw and no push
      if (o.h) {
        const top = Math.max(...sig.h.slice(from('h')));
        const together = both ? gate(corr(b.vl, b.vr, from('h')), 0.2, 0.6) : 1;
        score.throw = sz('throw', amp('h')) * rr('h') * gate(top, 0, 0.4) * together * (both ? gate(amp('h') / Math.max(1e-6, amp('o')), 0.5, 0.8) : 1) * round;
      }
      if (both) {
        const lateral = corr(b.ul, b.ur, from('o'));
        score.accordion = sz('accordion', amp('o')) * rr('o') * gate(-lateral, 0.2, 0.6) * gate(amp('o') / Math.max(1e-6, Math.max(amp('h'), amp('d'))), 1.2, 1.8) * round;
        score.push = sz('push', amp('x')) * rr('x') * gate(corr(b.ul, b.ur, from('x')), 0.2, 0.6) * gate(amp('x') / Math.max(1e-6, Math.max(amp('o'), amp('h'))), 1.0, 1.5) * round;
        score.wave = sz('wave', amp('d')) * rr('d') * gate(-corr(b.vl, b.vr, from('d')), 0.2, 0.6) * gate(amp('d') / Math.max(1e-6, 2 * amp('h')), 1.0, 1.5) * round;
      }
      // the sensor on the arm confirms a rhythm the camera sees (same tempo) and doubts a gesture while the arm rests
      // #236: the taught moves – the last two repetitions of the hands against each template. One that is clear goes
      // before a built-in gesture that looks alike: it is the more special one, and the dancer taught it on purpose.
      const all = names(), tempo = {};
      let own = null;
      for (const m of moves) {
        const r = long ? MV.match(m, b, st.ok) : { score: 0, size: 0, tempo: 0 };
        score[m.id] = r.score; size[m.id] = r.size; tempo[m.id] = r.tempo > 0 ? m.period / r.tempo : 0;
        if (r.score >= 0.5 && (!own || r.score > score[own])) own = m.id;
      }
      let best = own || all.reduce((a, g) => (score[g] > score[a] ? g : a));
      const per = best in tempo ? tempo[best] : best === 'circle' ? (Math.abs(rev) > 0.1 ? 1.5 / Math.abs(rev) : 0) : (o[{ throw: 'h', accordion: 'o', push: 'x', wave: 'd' }[best]] || {}).period || 0;
      if (sens && score[best] > 0) {
        if (sens.r > 0.5 && per && Math.abs(sens.period - per) / per < 0.15) score[best] = Math.min(1, score[best] + 0.2);
        else if (st.eSens < 0.04) score[best] *= 0.6;
      }
      for (const g of all) {
        const s = g === best ? score[g] : 0;           // one gesture at a time: the clearest
        st.g[g] += (s - st.g[g]) * (s > st.g[g] ? 0.3 : 0.15);
      }
      const lead = all.reduce((a, g) => (st.g[g] > st.g[a] ? g : a));
      const on = g => onOf(tol[g]), off = g => on(g) - (ON - OFF);
      if (st.active && st.g[st.active] < off(st.active)) { st.below += 2 / RATE; if (st.below > HOLD) { out.events.push('end:' + st.active); st.active = null; } } else st.below = 0;
      if (st.g[lead] >= on(lead) && st.active !== lead) { if (st.active) out.events.push('end:' + st.active); st.active = lead; st.below = 0; out.events.push('gesture:' + lead); }
      if (st.active && size[st.active] != null) st.size += (size[st.active] - st.size) * 0.3;
      if (!st.active) st.size = 0;

      // ---- the movement clock: the clearest repetition of all trajectories ----
      let pick = null;
      for (const k of Object.keys(o)) { const w = o[k].r * gate(o[k].amp, 0.12, 0.4); if (o[k].period && (!pick || w > pick.w)) pick = { w, k, ...o[k], a: sig[k] }; }
      if (sens && sens.period) { const w = sens.r * gate(sens.amp, 0.5, 2) * 0.9; if (!pick || w > pick.w) pick = { w, k: 'sg', ...sens, a: b.sg }; }
      const ck = st.clock;
      if (pick && pick.w > 0.3) {
        ck.lost = 0;
        if (!ck.period || ck.c < 0.3) { ck.period = pick.period; ck.agree = 0; }
        else if (Math.abs(pick.period - ck.period) / ck.period < 0.12) { ck.period += (pick.period - ck.period) * 0.3; ck.agree = 0; }
        else if (++ck.agree >= 4) { ck.period = pick.period; ck.agree = 0; }
        if (!ck.agree) {
          const err = wrap(phaseOf(pick.a, ck.period) - ck.phase);
          tick(ck.c < 0.3 || ck.src !== pick.k ? err : 0.35 * err, t, out, ck.c >= 0.3);   // a new lead: set, then follow
        }
        ck.c += (pick.w - ck.c) * 0.4; ck.src = pick.k;
      } else {
        ck.lost += 2 / RATE; ck.c *= 0.8;
        if (ck.lost > 1.5) { ck.period = 0; ck.c = 0; }
      }
    }

    // input: {t (s), hands: {l: [candidates] | candidate | null, r: …}, body: {x, y, s, c} | null,
    //   fingers: {l: {pts, c} | null, r: …}, sensor: {g: [x, y, z] (rad/s), age (s)} | null, dark, aspect (the
    //   picture's width / height, when it is not the one given at the start), arms: {l: {g, age} | null, r: …} | null
    //   (#237: the gyroscope of a phone that glows as that hand's marker)}
    function step(input) {
      if (input.aspect > 0) aspect = input.aspect;
      const t = input.t, out = { t, v: {}, c: {}, src: {}, bpm: 0, gesture: null, gc: 0, size: 0, g: {}, hands: { l: null, r: null }, events: [] };
      if (st.t != null && (t < st.t || t - st.t > 1)) reset();   // a jump in time (a new session, a long break): start anew
      const dt = st.t == null ? 1 / RATE : Math.max(1e-3, t - st.t); st.t = t;
      const fused = {};
      for (const h of HANDS) {
        const c = input.hands && input.hands[h];
        const arm = armMarker(Array.isArray(c) ? c : c ? [c] : [], input.arms && input.arms[h], st.arm[h], t, aspect);
        st.arm[h] = arm.memo;
        fused[h] = fuseHand(arm.cands, { fast: arm.fast || !!(st.hand[h] && st.hand[h].sp > 4), dark: !!input.dark });
      }
      units(input.body, fused, dt, t);
      let e2 = 0, ec = 0, eN = 0;
      for (const h of HANDS) {
        const f = fused[h], was = st.hand[h];
        if (f && st.centre && st.S > 0) {
          const u = (f.x * aspect - st.centre[0]) / st.S, v = (st.centre[1] - f.y) / st.S;
          // The same measurement again (the model ran on an earlier camera frame): the hand is where it was and as
          // fast as it was – its speed is the way between two measurements over the time between THEM. Without this a
          // model on every second frame reads as "still, jump, still, jump": the energy flickers and comes out too high.
          const at = Number.isFinite(f.at) ? f.at : null, again = at != null && was && was.at != null && Math.abs(at - was.at) < 1e-3 && t - was.t < 0.3;
          if (again) { st.hand[h] = { ...was, t, c: f.c }; e2 += was.sp * was.sp; ec += f.c; eN++; out.hands[h] = [+was.u.toFixed(3), +was.v.toFixed(3)]; continue; }
          let sp = 0, vu = 0, vv = 0;
          const since = was ? Math.max(dt, at != null && was.at != null ? at - was.at : t - was.m) : dt;
          if (was && t - was.t < 0.3) { vu = (u - was.u) / since; vv = (v - was.v) / since; sp = Math.hypot(vu, vv); }
          // a streak is the way the hand went during one exposure: at least that fast it was
          if (f.len) sp = Math.max(sp, 0.5 * f.len * aspect / st.S * RATE);
          sp = was ? was.sp + (Math.min(sp, 40) - was.sp) * Math.min(1, since / 0.08) : 0;
          st.hand[h] = { u, v, t, m: t, at, sp, c: f.c, src: f.src };
          e2 += sp * sp; ec += f.c; eN++;
          out.hands[h] = [+u.toFixed(3), +v.toFixed(3)];
        } else if (was && t - was.t > 0.3) st.hand[h] = null;
      }
      // ---- the motion sensor: the gyroscope's swing, and its liveliest axis as a trajectory of its own ----
      const sn = input.sensor;
      let sensFresh = false;
      if (sn && Array.isArray(sn.g) && (sn.age == null || sn.age < 0.3)) {
        sensFresh = true; st.sens.at = t;
        const mag = Math.hypot(sn.g[0] || 0, sn.g[1] || 0, sn.g[2] || 0);
        st.eSens += (clamp(mag / 8, 0, 1) - st.eSens) * Math.min(1, dt / 0.12);
        for (let i = 0; i < 3; i++) st.sens.level[i] += (Math.abs(sn.g[i] || 0) - st.sens.level[i]) * Math.min(1, dt / 1.5);
        const top = st.sens.level.indexOf(Math.max(...st.sens.level));
        if (st.sens.level[top] > 1.3 * st.sens.level[st.sens.axis]) st.sens.axis = top;
        st.sens.now = sn.g[st.sens.axis] || 0;
        // #252: the arm's rotation about its liveliest axis (−1 … 1 for 8 rad/s either way) and the pull on it (20 m/s²: all)
        st.spin += (clamp(st.sens.now / 8, -1, 1) - st.spin) * Math.min(1, dt / 0.12);
        st.force += (clamp((Number.isFinite(sn.a) ? sn.a : 0) / 20, 0, 1) - st.force) * Math.min(1, dt / 0.15);
        st.sens.force = Number.isFinite(sn.a);
      } else if (t - st.sens.at > 0.4) { st.eSens *= Math.exp(-dt / 0.2); st.spin *= Math.exp(-dt / 0.2); st.force *= Math.exp(-dt / 0.2); }

      // ---- the grid: trajectories at a fixed rate, whatever the camera's ----
      if (st.grid == null) st.grid = t;
      while (st.grid + 1 / RATE <= t + 1e-4) {         // a tenth of a millisecond of slack: a clock kept in decimals ticks the same
        st.grid += 1 / RATE; st.tick++;
        for (const h of HANDS) {
          const hd = st.hand[h], bu = st.b['u' + h], bv = st.b['v' + h], bw = st.b['w' + h], seen = st.seen[h];
          push(seen, hd && t - hd.t < 0.15 ? 1 : 0);
          const u = hd ? hd.u : bu.length ? bu[bu.length - 1] : 0, v = hd ? hd.v : bv.length ? bv[bv.length - 1] : 0;
          // how fast it runs round the middle of its own last one and a half seconds (rad/s, + = against the clock)
          const span = Math.min(bu.length, Math.round(1.5 * RATE));
          let w = 0;
          if (span >= 8 && hd) {
            let cu = 0, cv = 0; for (let i = bu.length - span; i < bu.length; i++) { cu += bu[i]; cv += bv[i]; }
            cu /= span; cv /= span;
            const ru = u - cu, rv = v - cv, r2 = ru * ru + rv * rv, du = (u - bu[bu.length - 1]) * RATE, dv = (v - bv[bv.length - 1]) * RATE;
            if (r2 > 0.01) w = clamp((ru * dv - rv * du) / r2, -40, 40);
            st.rad[h] += (Math.sqrt(r2) - st.rad[h]) * 0.1;
          }
          push(bu, u); push(bv, v); push(bw, w);
        }
        push(st.b.sg, sensFresh ? st.sens.now : 0);
        for (const h of HANDS) st.ok[h] = st.seen[h].reduce((a, x) => a + x, 0) / Math.max(1, st.seen[h].length);   // the share of the window the hand was seen
        if (st.tick % 2 === 0 && st.b.ul.length >= LAG_MIN * 3) analyse(t, out);
      }

      // ---- the continuous features ----
      const set = (k, v, c, src) => { out.v[k] = +v.toFixed(4); out.c[k] = +clamp(c, 0, 1).toFixed(3); out.src[k] = src; };
      const camC = eN ? ec / eN : 0, camSrc = eN ? [...new Set(HANDS.map(h => st.hand[h] && fused[h] && fused[h].src).filter(Boolean))].join('+') : '';
      const eCam = eN ? clamp(Math.sqrt(e2 / eN) / 8, 0, 1) : 0;
      st.eCam += (eCam - st.eCam) * Math.min(1, dt / (eCam > st.eCam ? 0.1 : 0.4));
      const sC = sensFresh ? 0.9 : 0;
      let energy = 0, eC = 0, eSrc = '';
      if (camC > 0 && sC > 0) { energy = (st.eCam * camC + st.eSens * sC) / (camC + sC); eC = 1 - (1 - camC) * (1 - sC); eSrc = camSrc + '+sensor'; }
      else if (camC > 0) { energy = st.eCam; eC = camC; eSrc = camSrc; }
      else if (sC > 0) { energy = st.eSens; eC = sC; eSrc = 'sensor'; }
      else st.eCam *= Math.exp(-dt / 0.3);
      set('energy', energy, eC, eSrc);
      const calm = 1 - gate(energy, 0.03, 0.12);       // still: grows in half a second of rest, gone at the first move
      st.still += (calm - st.still) * Math.min(1, dt / (calm > st.still ? 0.5 : 0.08));
      set('still', eC > 0 ? st.still : 0, eC, eSrc);
      const L = st.hand.l, R = st.hand.r, pair = L && R ? Math.min(L.c, R.c) : 0, any = L || R;
      set('open', L && R ? clamp(Math.hypot(L.u - R.u, L.v - R.v) / 3.5, 0, 1) : 0, pair, pair ? camSrc : '');
      set('height', any ? clamp(0.5 + (L && R ? (L.v + R.v) / 2 : any.v) / 3.2, 0, 1) : 0, any ? camC : 0, any ? camSrc : '');
      // turn: revolutions a second of the hand that circles more, −1 … 1 for two a second either way
      let turn = 0;
      for (const h of HANDS) {
        const w = st.b['w' + h].slice(-Math.round(0.5 * RATE)); if (!st.hand[h] || !w.length) continue;
        const m = w.reduce((a, x) => a + x, 0) / w.length / (2 * Math.PI);
        if (Math.abs(m) > Math.abs(turn)) turn = m;
      }
      st.turn += (clamp(turn / 2, -1, 1) - st.turn) * Math.min(1, dt / 0.15);
      set('turn', any ? st.turn : 0, any ? camC : 0, any ? camSrc : '');
      // the movement clock runs on between two looks at the trajectories; a beat is its phase coming round
      const ck = st.clock, locked = ck.period > 0 && ck.c >= 0.3;
      if (ck.period > 0) tick(dt / ck.period, t, out, locked);
      const clockSrc = ck.src === 'sg' ? 'sensor' : camSrc || 'sensor';
      out.bpm = locked ? +(60 / ck.period).toFixed(1) : 0;
      set('tempo', locked ? gate(60 / ck.period, 40, 200) : 0, ck.c, locked ? clockSrc : '');
      set('phase', locked ? ck.phase : 0, ck.c, locked ? clockSrc : '');
      set('pulse', locked ? Math.exp(-ck.phase * 4) * gate(ck.c, 0.3, 0.6) : 0, ck.c, locked ? clockSrc : '');   // a beat's envelope
      st.impulse *= Math.exp(-dt / 0.2);
      set('impulse', st.impulse, sensFresh ? 0.9 : 0, sensFresh ? 'sensor' : '');
      set('spin', sensFresh ? st.spin : 0, sensFresh ? 0.9 : 0, sensFresh ? 'sensor' : '');
      set('force', sensFresh && st.sens.force ? st.force : 0, sensFresh && st.sens.force ? 0.9 : 0, sensFresh && st.sens.force ? 'sensor' : '');
      for (const g of names()) { out.g[g] = +st.g[g].toFixed(3); set('g.' + g, st.active === g ? st.size : 0, st.g[g], camSrc); }
      out.gesture = st.active; out.gc = st.active ? out.g[st.active] : 0; out.size = +st.size.toFixed(3);

      // ---- fingers, per hand ----
      for (const h of HANDS) {
        const f = st.fing[h], in_ = input.fingers && input.fingers[h], val = in_ && in_.c > 0.3 ? fingerValues(in_.pts) : null;
        f.snap *= Math.exp(-dt / 0.25);
        if (val) {
          const k = Math.min(1, dt / 0.05);
          f.palm += (val.palm - f.palm) * k; f.spread += (val.spread - f.spread) * k;
          // pinch: thumb on index holds until they are clearly apart again
          if (!f.on && val.near > 0.8) { f.on = true; out.events.push(h + '.pinch'); } else if (f.on && val.near < 0.45) { f.on = false; out.events.push(h + '.release'); }
          f.pinch += ((f.on ? 1 : 0) - f.pinch) * Math.min(1, dt / 0.04);
          // snap: the hand flies open – from mostly closed to mostly open within a sixth of a second
          f.was.push([t, val.palm]); while (f.was.length && t - f.was[0][0] > 0.17) f.was.shift();
          if (val.palm - Math.min(...f.was.map(w => w[1])) > 0.5 && t - f.snapAt > 0.4 && f.c > 0) { f.snapAt = t; f.snap = 1; out.events.push(h + '.snap'); }
          f.c = in_.c;
        } else { f.c = 0; f.was = []; f.on = false; f.pinch = 0; }   // the hand is lost: no value, and it says so
        for (const k of FINGERS) set(h + '.' + k, f.c ? f[k] : 0, f.c, f.c ? 'hand' : '');
      }
      return out;
    }
    // #236: the taught moves to recognise from now on: [compiled template] (DreamMoves.compile). The stream goes on –
    // what a move that stays was at stays, one that is gone ends without a word.
    function setMoves(list) {
      moves = MV ? (Array.isArray(list) ? list : []).filter(m => m && typeof m.id === 'string' && !GESTURES.includes(m.id) && Array.isArray(m.pts)).slice(0, MAX_MOVES) : [];
      const keep = names();
      for (const k of Object.keys(st.g)) if (!keep.includes(k)) delete st.g[k];
      for (const k of keep) if (!(k in st.g)) st.g[k] = 0;
      if (st.active && !keep.includes(st.active)) { st.active = null; st.size = 0; }
    }
    // #265: how sure the detection must be of each gesture: {name: 'tight' | 'normal' | 'loose'} (what is not named: normal)
    function setTolerance(map) { tol = {}; for (const [g, v] of Object.entries(map && typeof map === 'object' ? map : {})) if (v in TOL) tol[g] = v; }
    return { step, reset, setMoves, setTolerance, threshold: g => onOf(tol[g]), kick(strength = 1) { st.impulse = Math.max(st.impulse, clamp(+strength || 0, 0, 1)); },
      get clock() { return { period: st.clock.period, phase: st.clock.phase, c: st.clock.c }; } };
  }

  const api = { create, bodyFrom, findMarkers, fuseHand, armMarker, fingerValues, osc, phaseOf, FEATURES, FINGERS, GESTURES, SOURCES, HANDS, MARKER_HUES, RATE, MAX_MOVES, TOL };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamDance = api;
})(typeof window !== 'undefined' ? window : globalThis);
