// A synthetic dancer for the dance tests (#235): trajectories of the two hands and the body in the camera picture,
// with variation in size, tempo, place, body size and jitter – and the things that are no dance (walking, waving,
// talking hands). No camera, no model: the numbers the detection would hand to static/dance.js.
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const gauss = r => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
const ASPECT = 16 / 9;

// each: (t, {f: repetitions a second, k: size}, rnd-free) → {l: [u, v], r: [u, v]} in shoulder widths, v up
export const MOVES = {
  throw: (t, { f, k }) => { const s = Math.sin(2 * Math.PI * f * t); return { l: [0.7, 0.3 + 0.9 * k * s], r: [-0.7, 0.3 + 0.9 * k * s] }; },
  accordion: (t, { f, k }) => { const s = Math.sin(2 * Math.PI * f * t); return { l: [1.0 + 0.6 * k * s, -0.2], r: [-1.0 - 0.6 * k * s, -0.2] }; },
  push: (t, { f, k }) => { const s = Math.sin(2 * Math.PI * f * t); return { l: [0.6 + 0.8 * k * s, 0.1], r: [-0.6 + 0.8 * k * s, 0.1] }; },
  circle: (t, { f, k }) => { const a = 2 * Math.PI * f * t; return { l: [0.7, -1.3], r: [-0.8 + 0.6 * k * Math.cos(a), 0.2 + 0.6 * k * Math.sin(a)] }; },
  wave: (t, { f, k }) => { const s = Math.sin(2 * Math.PI * f * t); return { l: [0.9, 0.9 * k * s], r: [-0.9, -0.9 * k * s] }; },
};
export const NOT_MOVES = {
  stand: () => ({ l: [0.6, -1.4], r: [-0.6, -1.4] }),
  // arms swing a little against each other; the body crosses the picture and bobs
  walk: (t) => { const s = Math.sin(2 * Math.PI * 0.9 * t); return { l: [0.6 + 0.14 * s, -1.4 + 0.04 * Math.abs(s)], r: [-0.6 + 0.14 * s, -1.4 + 0.04 * Math.abs(s)],
    body: [0.2 * Math.sin(2 * Math.PI * t / 8), 0.01 * Math.sin(2 * Math.PI * 1.8 * t)] }; },
  hello: (t) => ({ l: [0.6, -1.4], r: [-0.9 + 0.35 * Math.sin(2 * Math.PI * 2.5 * t), 1.0] }),
  // talking hands: small, never the same twice
  talk: (t, _, ph) => ({ l: [0.5 + 0.18 * Math.sin(1.9 * t + ph) + 0.1 * Math.sin(4.7 * t), -0.4 + 0.15 * Math.sin(2.7 * t + 2 * ph) + 0.08 * Math.sin(6.1 * t)],
    r: [-0.5 + 0.16 * Math.sin(2.3 * t + 3 * ph) + 0.09 * Math.sin(5.3 * t), -0.4 + 0.17 * Math.sin(3.1 * t + ph) + 0.07 * Math.sin(7.3 * t + ph)] }),
  // one arm goes up once and stays
  reach: (t) => ({ l: [0.6, -1.4], r: [-0.7, -1.4 + 2.6 / (1 + Math.exp(-(t - 3) * 6))] }),
  // the whole body sways, the arms hang
  sway: (t) => ({ l: [0.6, -1.4], r: [-0.6, -1.4], body: [0.05 * Math.sin(2 * Math.PI * 1.0 * t), 0] }),
  // both arms up and held (cheering once)
  cheer: (t) => { const up = 2.4 / (1 + Math.exp(-(t - 2) * 5)); return { l: [0.7, -1.3 + up], r: [-0.7, -1.3 + up] }; },
};

// frames for dance.js: {t, hands, body}. opts: bpm, size, fps, seconds, S (shoulder width in picture heights),
// at ([x, y] of the body), jitter (picture heights), src, only ('l' | 'r': the other hand is not seen), noBody
export function frames(move, opts = {}) {
  const { bpm = 110, size = 1, fps = 30, seconds = 6, S = 0.1, at = [0.5, 0.4], jitter = 0, src = 'pose', only = null, noBody = false, seed = 1, wobble = 0, from = 0 } = opts;
  const rnd = rng(seed), fn = MOVES[move] || NOT_MOVES[move], out = [], ph = rnd() * 6;
  let warp = 0;
  for (let i = 0; i < seconds * fps; i++) {
    const t = from + i / fps;
    warp += wobble * gauss(rnd) / fps;                 // the tempo wanders a little
    const m = fn(i / fps + warp, { f: bpm / 60, k: size }, ph), b = m.body || [0, 0];
    const bx = at[0] + b[0], by = at[1] + b[1];
    const pt = ([u, v]) => ({ x: bx + (u * S) / ASPECT + jitter * gauss(rnd), y: by - v * S + jitter * gauss(rnd), c: 0.9, src });
    const hands = { l: only === 'r' ? null : pt(m.l), r: only === 'l' ? null : pt(m.r) };
    out.push({ t, hands, body: noBody ? null : { x: bx + jitter * 0.3 * gauss(rnd), y: by + jitter * 0.3 * gauss(rnd), s: S, c: 0.9 } });
  }
  return out;
}

// plays frames through a detector; returns per frame what it said
export function play(dance, list) { return list.map(f => dance.step(f)); }
// did the gesture come and stay? (on within `within` seconds, then the leading one for most of the rest, no other)
export function verdict(outs, want, within = 3.5) {
  const t0 = outs[0].t, late = outs.filter(o => o.t - t0 >= within);
  const first = outs.find(o => o.gesture === want), share = late.filter(o => o.gesture === want).length / Math.max(1, late.length);
  const other = outs.find(o => o.gesture && o.gesture !== want);
  return { hit: !!first && first.t - t0 <= within && share >= 0.8 && !other, at: first ? first.t - t0 : null, share, other: other ? other.gesture : null };
}

// a hand of 21 points: curl (0 straight … 1 fist) per finger, spread (radians between neighbours), pinch, size, turn
export function hand({ curl = 0, spread = 0.12, pinch = false, size = 1, turn = 0, at = [0.5, 0.5] } = {}) {
  const pts = [[0, 0]], curls = Array.isArray(curl) ? curl : [curl, curl, curl, curl];
  const thumb = pinch ? [[-0.25, 0.3], [-0.3, 0.6], [-0.2, 0.85], [-0.08, 1.02]] : [[-0.3, 0.25], [-0.55, 0.45], [-0.72, 0.62], [-0.85, 0.78]];
  pts.push(...thumb);
  for (let f = 0; f < 4; f++) {
    const base = (1.5 - f) * -0.22, dir = (f - 1.5) * spread + Math.PI / 2, c = curls[f];
    let x = base * -1, y = 1.0 - 0.04 * Math.abs(f - 1), a = dir;
    if (f === 0 && pinch) { pts.push([x, y], [x - 0.08, y + 0.2], [x - 0.2, y + 0.12], [-0.1, 1.04]); continue; }
    pts.push([x, y]);
    for (const len of [0.42, 0.26, 0.2]) { a += c * 1.5; x += len * Math.cos(a); y += len * Math.sin(a); pts.push([x, y]); }
  }
  const co = Math.cos(turn), si = Math.sin(turn);
  return pts.map(([x, y]) => [at[0] + size * 0.08 * (x * co - y * si), at[1] - size * 0.08 * (x * si + y * co)]);
}
