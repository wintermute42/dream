// #240: "Hands (AI)" (static/motion.js) – which detected hand is followed. No
// browser, no model: the pose results are played in as numbers.
// Run: node --test tests/js/motion.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const M = createRequire(import.meta.url)('../../static/motion.js');

// what analyse() does with the picked hand: the point it follows, frame by frame (30 fps)
function follow(frames) {
  let prev = null, vel = [0, 0], pend = null;
  const out = [];
  frames.forEach((blobs, i) => {
    const t = i / 30;
    ({ blobs, pend } = M.pickHand(blobs, prev ? [prev[0], prev[1], prev[2], vel[0], vel[1]] : null, t, pend));
    if (blobs.length) {
      const [x, y] = blobs[0];
      if (prev) vel = [(x - prev[0]) / (t - prev[2]), (y - prev[1]) / (t - prev[2])];
      prev = [x, y, t];
    }
    out.push(prev ? [prev[0], prev[1]] : null);
  });
  return out;
}
const R = x => [x, 0.5, 2], L = [0.15, 0.6, 1];        // the right hand moving slowly, the left one resting

test('the point stays with its hand when the model loses that hand for a frame', () => {
  // the pose model lists the right hand first; every fourth frame it misses it and only the left one is there
  const frames = Array.from({ length: 60 }, (_, i) => (i % 4 === 3 ? [L] : [R(0.7 + 0.002 * i), L]));
  const pts = follow(frames);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 0.05, `jump at frame ${i}: ${pts[i - 1]} → ${pts[i]}`);
  }
});

test('a single guessed point far away is not followed, a hand that really is there is', () => {
  const frames = [...Array(10).fill([R(0.7)]), [[0.1, 0.1, 2]], ...Array(5).fill([R(0.7)])];
  assert.deepEqual(follow(frames)[10], [0.7, 0.5]);       // one frame somewhere else: ignored
  const moved = [...Array(10).fill([R(0.7)]), ...Array(5).fill([[0.2, 0.4, 2]])];
  assert.deepEqual(follow(moved).at(-1), [0.2, 0.4]);    // there twice in a row: followed
});
