// #236: dance moves of one's own – taught by showing them a few times, recognised with tolerance. Pure computation, no
// DOM, no camera, no model: the page of Dream Dance teaches with it (moveteach.js), the feature stream recognises with
// it (dance.js: a taught move is a gesture like the built-in ones – the same confidence, the same hysteresis, the same
// "two to three repetitions"), the Node tests use it the same way (tests/js/dancemoves.test.mjs).
//
// A move is a repeated, rhythmic movement of the hands, like the built-in gestures: one repetition lasts 0.3 … 1.25 s.
// What is kept of it is the way of the hands in body units (shoulder widths from the middle of the shoulders – where
// the dancer stands in the picture and how near does not matter), never a picture:
// - teaching: a take of the hands ([{t, l: [u, v] | null, r: …}], the stream's `hands`) is put on a fixed grid
//   (`grid`), its repetitions are found (`segment`: the period from the take's likeness to itself, then the three to
//   five repetitions that are most alike), and their mean is the template (`template`: M points of one repetition,
//   which hands it is made with, and how far the repetitions were apart – its tolerance).
// - recognising: the last two repetitions of the live hands are laid over the template by dynamic time warping
//   (`match`): the template runs round and round, so it does not matter where in the repetition the dancer is; a
//   faster, slower, larger or smaller variant still fits, another way of the hands does not. Two repetitions must fit –
//   one swing that looks like a part of the move is not the move.
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const gate = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
  const VERSION = 1, RATE = 30, M = 24;                // the grid (samples a second), and the points of one repetition
  const MIN_REPS = 3, MAX_REPS = 5;
  const P_MIN = 0.3, P_MAX = 1.25;                     // a repetition: 0.3 … 1.25 s, as the built-in gestures'
  const SMALL = 0.12;                                  // shoulder widths: a movement smaller than this is no move
  const HANDS = ['l', 'r'], CH = ['ul', 'vl', 'ur', 'vr'];
  const chans = hands => HANDS.filter(h => hands.includes(h)).flatMap(h => (h === 'l' ? [0, 1] : [2, 3]));
  const r4 = x => Math.round(x * 10000) / 10000;

  // ---------- a take on the grid ----------
  // samples: [{t (s), l: [u, v] | null, r: [u, v] | null}], in the order they came. → {t0, n, ch: [ul, vl, ur, vr],
  // seen: {l, r}}: the hands every 1/RATE s (between two measurements: on the line between them; where a hand was not
  // seen for a quarter of a second: where it was last) and the share of the take each hand was seen.
  function grid(samples) {
    const ok = (samples || []).filter(s => s && Number.isFinite(s.t)), out = { t0: ok.length ? ok[0].t : 0, n: 0, ch: [[], [], [], []], seen: { l: 0, r: 0 } };
    if (ok.length < 2) return out;
    const n = out.n = Math.floor((ok[ok.length - 1].t - out.t0) * RATE + 1e-6) + 1;
    HANDS.forEach((h, k) => {
      const pts = ok.filter(s => Array.isArray(s[h]) && Number.isFinite(s[h][0] + s[h][1])), U = out.ch[2 * k], V = out.ch[2 * k + 1];
      let j = 0, seen = 0;
      for (let i = 0; i < n; i++) {
        const t = out.t0 + i / RATE;
        while (j + 1 < pts.length && pts[j + 1].t <= t) j++;
        const a = pts[j], b = pts[j + 1];
        if (a && b && a.t <= t && t <= b.t && b.t - a.t <= 0.25) { const w = (t - a.t) / Math.max(1e-6, b.t - a.t); U.push(a[h][0] + (b[h][0] - a[h][0]) * w); V.push(a[h][1] + (b[h][1] - a[h][1]) * w); seen++; continue; }
        const near = a && b && Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a;
        U.push(near ? near[h][0] : 0); V.push(near ? near[h][1] : 0);
        if (near && Math.abs(near.t - t) <= 0.05) seen++;
      }
      out.seen[h] = seen / n;
    });
    return out;
  }
  // the grid's value at a place between two of its samples
  const lerp = (a, x) => { const i = clamp(Math.floor(x), 0, a.length - 1), j = Math.min(a.length - 1, i + 1); return a[i] + (a[j] - a[i]) * clamp(x - i, 0, 1); };
  // … and the same a little smoothed (each sample with half of its two neighbours): a camera's jitter is not movement
  const soft = (a, x) => { const i = clamp(Math.floor(x), 0, a.length - 1), at = k => { const j = clamp(k, 0, a.length - 1); return (a[Math.max(0, j - 1)] + 2 * a[j] + a[Math.min(a.length - 1, j + 1)]) / 4; }; return at(i) + (at(i + 1) - at(i)) * clamp(x - i, 0, 1); };
  // one stretch of the grid as M points: [[ul, vl, ur, vr], …] from sample x0 (may lie between two) over `len` samples
  const cut = (g, x0, len) => Array.from({ length: M }, (_, i) => g.ch.map(a => lerp(a, x0 + i * len / M)));
  const dist2 = (p, q, cs) => { let s = 0; for (const k of cs) s += (p[k] - q[k]) * (p[k] - q[k]); return s; };

  // ---------- the repetitions of a take ----------
  // → {why: null, period (s), hands ('lr' | 'l' | 'r'), count (repetitions found), reps: [{t0, t1}] (the take's clock)}
  // or {why: 'short' | 'nohands' | 'small' | 'norhythm' | 'few', …}: too short a take, no hand seen through it, hardly
  // any movement, no repetition in it, fewer than three repetitions.
  function segment(g) {
    const fail = (why, more) => ({ why, period: 0, hands: '', count: 0, reps: [], ...more });
    if (!g || g.n < 3 * P_MIN * RATE) return fail('short');
    const hands = HANDS.filter(h => g.seen[h] >= 0.85).join('');
    if (!hands) return fail('nohands');
    const cs = chans(hands), n = g.n;
    // where the movement is: the stretch in which the hands move, without the standing before and after it
    const sp = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { let s = 0; const i0 = Math.max(0, i - 2), i1 = Math.min(n - 1, i + 2); for (const k of cs) s += (g.ch[k][i1] - g.ch[k][i0]) ** 2; sp[i] = Math.sqrt(s) * RATE / Math.max(1, i1 - i0); }   // over five samples: a camera's jitter is no speed
    const half = Math.round(0.3 * RATE), sm = sp.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) { s += sp[j]; c++; } return s / c; });
    const sorted = sm.slice().sort((a, b) => a - b), lively = sorted[Math.floor(0.8 * (n - 1))];
    if (lively < 4 * SMALL) return fail('small', { hands });
    let a = 0, b = -1, from = null;
    for (let i = 0; i <= n; i++) {
      const on = i < n && sm[i] > 0.3 * lively;
      if (on && from == null) from = i;
      if (!on && from != null) { if (i - 1 - from > b - a) { a = from; b = i - 1; } from = null; }
    }
    if (b >= a) { a = Math.max(0, a - half); b = Math.min(n - 1, b + half); }   // generous: where it really repeats is looked at below
    const len = b - a + 1;
    if (len < 3 * P_MIN * RATE) return fail('short', { hands });
    // the period: the shortest time after which the hands are where they were. Asked of the middle of the stretch (the
    // median over it), so lifting the arms into the move and letting them sink after it do not count.
    const mean = cs.map(k => { let s = 0; for (let i = a; i <= b; i++) s += g.ch[k][i]; return s / len; });
    let q = 0; cs.forEach((k, c) => { for (let i = a; i <= b; i++) q += (g.ch[k][i] - mean[c]) ** 2; });
    if (Math.sqrt(q / len) < SMALL) return fail('small', { hands });
    const apart = lag => { const d = []; for (let i = a; i + lag <= b; i++) { let e = 0; for (const k of cs) e += (g.ch[k][i] - g.ch[k][i + lag]) ** 2; d.push(e); } d.sort((x, y) => x - y); return d[d.length >> 1]; };
    const lo = Math.round(P_MIN * RATE), hi = Math.min(Math.round(P_MAX * RATE), Math.floor(len / 2)), ds = [];
    let sum = 0, low = Infinity;
    for (let l = lo - 1; l <= hi + 1; l++) { ds[l] = apart(l); if (l >= lo && l <= hi) { sum += ds[l]; low = Math.min(low, ds[l]); } }
    const mid = sum / Math.max(1, hi - lo + 1), amp = Math.sqrt(mid / 2);   // two points of a movement are, on average, √2 of its size apart
    if (amp < SMALL) return fail(Math.sqrt(q / len) >= 2 * SMALL ? 'norhythm' : 'small', { hands });   // it went somewhere, but did not come back
    let lag = 0;
    for (let l = lo; l <= hi && !lag; l++) if (ds[l] <= low + 0.08 * mid && ds[l] <= ds[l - 1] && ds[l] <= ds[l + 1]) lag = l;   // the shortest clear one, not its double
    if (!lag || low > 0.3 * mid) return fail('norhythm', { hands });
    const d = ds[lag - 1] - 2 * ds[lag] + ds[lag + 1], L = lag + (Math.abs(d) > 1e-9 ? clamp(0.5 * (ds[lag - 1] - ds[lag + 1]) / d, -0.5, 0.5) : 0);
    // where it really repeats: the stretch in which the hands are, one period later, where they are now – lifting the
    // arms into the move and letting them sink after it are no repetitions
    const far = [], w = Math.max(1, Math.round(L / 10));
    for (let i = a; i + L <= b; i++) { let e = 0; for (const k of cs) e += (g.ch[k][i] - lerp(g.ch[k], i + L)) ** 2; far.push(Math.sqrt(e) / amp); }
    let pa = 0, pb = -1; from = null;
    for (let i = 0; i <= far.length; i++) {
      let e = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(far.length - 1, i + w); j++) { e += far[j]; c++; }
      const on = i < far.length && e / c < 0.7;
      if (on && from == null) from = i;
      if (!on && from != null) { if (i - 1 - from > pb - pa) { pa = from; pb = i - 1; } from = null; }
    }
    // (a tenth of a repetition is forgiven: the first and the last one begin and end in the lift)
    const span = pb >= pa ? pb - pa + L : 0, count = Math.floor(span / L + 0.12);
    if (count < MIN_REPS) return fail('few', { hands, period: L / RATE, count });
    // of all repetitions in the stretch: the run of up to five that are most alike, one after the other
    const start = a + pa, take = Math.min(count, MAX_REPS), slack = Math.max(0, span - take * L);
    let best = start, cost = Infinity;
    for (let s = 0; s <= slack + 1e-6; s++) {
      let c = 0, was = cut(g, start + s, L);
      for (let r = 1; r < take; r++) { const now = cut(g, start + s + r * L, L); for (let i = 0; i < M; i++) c += dist2(was[i], now[i], cs); was = now; }
      if (c < cost - 1e-9) { cost = c; best = start + s; }
    }
    const at = x => g.t0 + x / RATE;
    return { why: null, period: L / RATE, hands, count, reps: Array.from({ length: take }, (_, r) => ({ t0: at(best + r * L), t1: at(best + (r + 1) * L) })) };
  }

  // ---------- the template: the mean of the repetitions ----------
  // reps: [{t0, t1}] of the take (some may have been thrown away – at least one is left). → {v, period, hands, pts: M ×
  // [ul, vl, ur, vr] (a hand the move is not made with: zeros), tol: how far the repetitions are from their mean, in
  // parts of the move's own size}, or null.
  function template(g, reps, hands) {
    const cs = chans(hands || '');
    if (!g || !cs.length || !Array.isArray(reps) || !reps.length) return null;
    const cuts = reps.map(r => cut(g, (r.t0 - g.t0) * RATE, (r.t1 - r.t0) * RATE));
    const pts = Array.from({ length: M }, (_, i) => [0, 1, 2, 3].map(k => (cs.includes(k) ? cuts.reduce((s, c) => s + c[i][k], 0) / cuts.length : 0)));
    const c = centred(pts, cs);
    if (!(c.amp >= SMALL)) return null;
    let off = 0;
    for (const one of cuts) { let s = 0; for (let i = 0; i < M; i++) s += dist2(one[i], pts[i], cs); off += Math.sqrt(s / M) / c.amp; }
    return { v: VERSION, period: r4(reps.reduce((s, r) => s + (r.t1 - r.t0), 0) / reps.length), hands: HANDS.filter(h => hands.includes(h)).join(''),
      pts: pts.map(p => p.map(r4)), tol: r4(clamp(off / cuts.length, 0, 1)) };
  }
  // points around their own middle: {mean (per channel), pts, amp (how far they are from it, all channels together)}
  function centred(pts, cs) {
    const mean = [0, 0, 0, 0]; let q = 0;
    for (const k of cs) { for (const p of pts) mean[k] += p[k]; mean[k] /= pts.length; }
    const out = pts.map(p => p.map((x, k) => (cs.includes(k) ? x - mean[k] : 0)));
    for (const p of out) for (const k of cs) q += p[k] * p[k];
    return { mean, pts: out, amp: Math.sqrt(q / pts.length) };
  }

  // Is this a template? (what comes from a file is looked at before it is used: fail closed)
  function usable(t) {
    return !!t && t.v === VERSION && typeof t.hands === 'string' && ['lr', 'l', 'r'].includes(t.hands) && Number.isFinite(t.period) && t.period >= P_MIN * 0.8 && t.period <= P_MAX * 1.2
      && Number.isFinite(t.tol) && Array.isArray(t.pts) && t.pts.length === M && t.pts.every(p => Array.isArray(p) && p.length === 4 && p.every(x => Number.isFinite(x) && Math.abs(x) < 50));
  }
  // A template made ready to be matched: {id, period, hands: ['l', 'r'], cs, mean, pts (around their middle), amp, thr}
  // or null when it is none (or too small to tell from standing).
  function compile(t, id) {
    if (!usable(t) || typeof id !== 'string' || !id) return null;
    const cs = chans(t.hands), c = centred(t.pts, cs);
    if (!(c.amp >= SMALL * 0.8)) return null;
    // the tolerance: what the dancer's own repetitions were apart, and a share for another day, another place
    return { id, period: t.period, hands: HANDS.filter(h => t.hands.includes(h)), cs, mean: c.mean, pts: c.pts, amp: c.amp, thr: clamp(0.2 + t.tol, 0.26, 0.42) };
  }

  // ---------- recognising ----------
  // c: a compiled template; buf: {ul, vl, ur, vr} – the live hands on the grid, the newest last (dance.js keeps 2.5 s of
  // them); ok: {l, r} – the share of that time each hand was seen. → {score (0 … 1), size (0 … 1: as large as taught =
  // 1), tempo (the live tempo over the taught one), d (how far the live hands are from the template, in parts of its
  // size)}. The last TWO repetitions are compared: a move is a repetition, as the built-in gestures are.
  const Q = 2 * M, T = 4 * M;                          // the query's points, and the template run round four times
  const NONE = { score: 0, size: 0, tempo: 0, d: Infinity };
  const D0 = new Float64Array(T), D1 = new Float64Array(T), S0 = new Int16Array(T), S1 = new Int16Array(T);
  function match(c, buf, ok) {
    if (!c || !buf || c.hands.some(h => !(ok && ok[h] > 0.8))) return NONE;
    const n = buf.ul.length, step = c.period * RATE / M, back = (Q - 1) * step;
    if (back > n - 1) return NONE;                     // not two repetitions of it in the buffer yet
    const cs = c.cs, q = [], mean = [0, 0, 0, 0];
    for (let i = 0; i < Q; i++) { const x = n - 1 - (Q - 1 - i) * step, p = [0, 0, 0, 0]; for (const k of cs) { p[k] = soft(buf[CH[k]], x); mean[k] += p[k] / Q; } q.push(p); }
    let amp = 0;
    for (const p of q) for (const k of cs) { p[k] -= mean[k]; amp += p[k] * p[k]; }
    amp = Math.sqrt(amp / Q);
    const size = amp / c.amp;
    if (size < 0.4) return NONE;                       // far smaller than taught (or standing): not this move
    // where it is made: the same way of the hands a shoulder width higher is another move
    let off = 0;
    for (const h of c.hands) { const k = h === 'l' ? 0 : 2; off = Math.max(off, Math.hypot(mean[k] - c.mean[k], mean[k + 1] - c.mean[k + 1])); }
    const place = 1 - gate(off, 0.6, 1.2);
    if (place <= 0) return NONE;
    // dynamic time warping, the template's start and end free: every live point is laid on a template point; from
    // one live point to the next the template stays, goes one on or skips one (a slower or a faster dancer)
    // the shape is compared at the template's size: how large the dancer makes it today is `size`, not a difference
    const k = c.amp / amp;
    for (const p of q) for (const ch of cs) p[ch] *= k;
    let a = D0, b = D1, sa = S0, sb = S1;
    for (let j = 0; j < T; j++) { a[j] = dist2(q[0], c.pts[j % M], cs); sa[j] = j; }
    for (let i = 1; i < Q; i++) {
      for (let j = 0; j < T; j++) {
        let best = a[j], from = sa[j];
        if (j > 0 && a[j - 1] <= best) { best = a[j - 1]; from = sa[j - 1]; }
        if (j > 1 && a[j - 2] < best) { best = a[j - 2]; from = sa[j - 2]; }
        b[j] = best + dist2(q[i], c.pts[j % M], cs); sb[j] = from;
      }
      [a, b, sa, sb] = [b, a, sb, sa];
    }
    let end = 0;
    for (let j = 1; j < T; j++) if (a[j] < a[end]) end = j;
    const d = Math.sqrt(a[end] / Q) / c.amp, tempo = (end - sa[end]) / (Q - 1);
    const score = (1 - gate(d, c.thr, c.thr + 0.22)) * gate(size, 0.4, 0.65) * place * gate(tempo, 0.55, 0.72) * (1 - gate(tempo, 1.4, 1.7));
    return { score, size: clamp(size, 0, 1), tempo, d };
  }

  const api = { VERSION, RATE, M, MIN_REPS, MAX_REPS, P_MIN, P_MAX, SMALL, grid, segment, template, usable, compile, match };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamMoves = api;
})(typeof window !== 'undefined' ? window : globalThis);
