// #221: the brushes the style worlds share (static/dreambrush.js) – the numbers behind them, in Node: random numbers
// and noise from a seed, smooth lines and swelling bands, how bright the dream is where, the lids of an eye and the
// skeleton of a face (which has no nose).
// Run: node --test tests/js/brush.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const B = require('../../static/dreambrush.js');
const V = require('../../static/dreamvis.js');

test('random numbers from a seed: the same every time, spread over 0–1', () => {
  const a = B.rng(42), b = B.rng(42), c = B.rng(43), xs = Array.from({ length: 2000 }, () => a());
  assert.deepEqual(xs.slice(0, 50), Array.from({ length: 50 }, () => b()));
  assert.notEqual(xs[0], c());
  assert.ok(xs.every(x => x >= 0 && x < 1));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `mean ${mean}`);
  assert.equal(B.hash(7, 3), B.hash(7, 3));
  assert.notEqual(B.hash(7, 3), B.hash(7, 4));
  assert.equal(V.hash, B.hash, 'the face rule takes its random numbers from here');
});

test('noise: soft, the same for the same place, another for another seed', () => {
  let jump = 0, lo = 1, hi = 0;
  for (let i = 0; i < 400; i++) {
    const x = i * 0.05, v = B.noise2(x, 1.3), w = B.noise2(x + 0.05, 1.3), f = B.fbm(x, 2.1, 4);
    assert.equal(v, B.noise2(x, 1.3));
    assert.ok(v >= 0 && v <= 1 && f >= 0 && f <= 1);
    jump = Math.max(jump, Math.abs(v - w)); lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  assert.ok(jump < 0.15, `no jump from one place to the next (${jump})`);
  assert.ok(hi - lo > 0.5, 'it is not flat');
  assert.notEqual(B.noise2(3.3, 4.4, 1), B.noise2(3.3, 4.4, 2));
});

test('a square of noise repeats at its edges', () => {
  const N = 64, t = B.noiseTile(N, 11);
  assert.equal(t.length, N * N);
  assert.deepEqual(Array.from(t.slice(0, 20)), Array.from(B.noiseTile(N, 11).slice(0, 20)));
  let seam = 0, inside = 0;
  for (let y = 0; y < N; y++) { seam += Math.abs(t[y * N] - t[y * N + N - 1]); inside += Math.abs(t[y * N + 31] - t[y * N + 32]); }
  assert.ok(seam < inside * 3 + 1, `the left edge continues the right one (${seam} against ${inside} inside)`);
});

test('a smooth line through points, and a band along it that swells', () => {
  const P = [[0, 0], [10, 0], [20, 10], [30, 10]], line = B.curve(P, 8);
  assert.equal(line.length, 3 * 8 + 1);
  for (const p of P) assert.ok(line.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9), 'it runs through every point');
  for (let i = 1; i < line.length; i++) assert.ok(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) < 3, 'no gaps');
  const straight = B.curve([[0, 0], [100, 0]], 10), wide = u => 1 + 4 * Math.sin(Math.PI * u), band = B.band(straight, wide);
  assert.equal(band.length, 2 * straight.length);
  const ys = band.map(p => Math.abs(p[1]));
  assert.ok(Math.abs(ys[0] - 1) < 1e-9 && Math.abs(ys[5] - 5) < 1e-9, 'half as wide as asked, thin at its ends, thick in the middle');
  const half = B.band(straight, wide, 0.5), end = Math.max(...half.map(p => p[0]));
  assert.ok(end >= 49 && end <= 61, `drawn half way in (${end})`);
  assert.equal(B.band(straight, wide, 0).length, 4, 'never less than a first stroke');
});

test('how bright the dream is: its colour, its brightness, and where it is light', () => {
  const w = 4, h = 2, d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(i < 4 ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4);   // light above, dark below
  const b = B.brightness(d, w, h);
  assert.deepEqual(b.col, [127.5, 127.5, 127.5]);
  assert.ok(Math.abs(b.lum - 0.5) < 1e-9);
  assert.ok(Math.abs(b.L(0.1, 0.1) - 1) < 1e-6 && b.L(0.9, 0.9) === 0);
  assert.equal(b.L(-3, 7), 0, 'outside the picture: its edge');
  assert.equal(Math.round(B.hueOf([255, 0, 0])), 0);
  assert.equal(Math.round(B.hueOf([0, 255, 0])), 120);
  assert.equal(Math.round(B.hueOf([0, 0, 255])), 240);
});

test('the lids of an eye: the same opening for every world', () => {
  const l = B.lids(100, 50, 40, 20, false, 1, 0.9), r = B.lids(300, 50, 40, 20, true, 1, 0.9);
  assert.deepEqual([l.upper(0)[0], l.upper(1)[0]], [140, 60], 'the left eye: its inner corner towards the middle');
  assert.deepEqual([r.upper(0)[0], r.upper(1)[0]], [260, 340]);
  assert.ok(l.upper(1)[1] < l.upper(0)[1] && r.upper(1)[1] < r.upper(0)[1], 'the outer corner a little lifted');
  for (const u of [0.2, 0.5, 0.8]) assert.ok(l.upper(u)[1] < 50 && l.lower(u)[1] > 50, 'the upper lid above, the lower below');
  const shut = B.lids(100, 50, 40, 20, false, 0.02, 0.9);
  assert.ok(shut.upper(0.5)[1] > l.upper(0.5)[1] + 15, 'a closing lid comes down');
  const calls = [];
  l.path({ beginPath() { calls.push('b'); }, moveTo() { calls.push('m'); }, bezierCurveTo() { calls.push('c'); }, closePath() { calls.push('z'); } });
  assert.equal(calls.join(''), 'bmccz');
});

test('the skeleton of a face: every curve belongs to a part of the face rule – and there is no nose', () => {
  const S = B.skeleton(400, 300, 100, 0);
  assert.ok(S.length > 10);
  for (const c of S) {
    assert.ok(c.part in V.PARTS && V.PARTS[c.part] > 0, `${c.name} belongs to a part that is not always there (${c.part})`);
    assert.ok(!/nose|nostril|grin|teeth/i.test(c.name + c.part));
    assert.ok(c.pts.length >= 1 && c.pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  }
  assert.deepEqual([...new Set(S.map(c => c.part))].sort(), ['brows', 'hair', 'mark', 'mouth', 'outline']);
  // nothing of it lies where a nose would be: between the eyes, from their height down to above the mouth
  const u = 100 / 1.95;
  for (const c of S) for (const [x, y] of c.pts) assert.ok(!(Math.abs(x - 400) < 0.9 * u && y > 300 - 0.5 * u && y < 300 + 3.3 * u), `${c.name} at (${x | 0}, ${y | 0}) is in the middle of the face`);
  // … and nothing lies on the eyes
  for (const c of S) for (const [x, y] of c.pts) for (const ex of [300, 500]) assert.ok(Math.hypot((x - ex) / (1.4 * u), (y - 300) / (0.9 * u)) > 1, `${c.name} lies on an eye`);
  const brows = S.filter(c => c.part === 'brows'), mouth = S.filter(c => c.part === 'mouth');
  assert.equal(brows.length, 2);
  assert.ok(brows.every(c => c.pts.every(p => p[1] < 300)) && mouth.every(c => c.pts.every(p => p[1] > 300 + 3 * u)));
  const xs = S.flatMap(c => c.pts.map(p => p[0] - 400));
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-6, 'the same on both sides at rest');
  assert.notDeepEqual(B.skeleton(400, 300, 100, 3000).find(c => c.part === 'hair').pts, S.find(c => c.part === 'hair').pts, 'hair sways');
  const small = B.skeleton(0, 0, 50, 0);
  S.forEach((c, i) => c.pts.forEach((p, j) => assert.ok(Math.hypot(small[i].pts[j][0] * 2 + 400 - p[0], small[i].pts[j][1] * 2 + 300 - p[1]) < 1e-6, 'it scales with the eyes')));
});
