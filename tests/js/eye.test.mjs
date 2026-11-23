// #218: the hypnotic pupils of the shared eye (static/dreameye.js) – in Dreamy Eyes nearly always the spiral and now and
// then another shape, in the dream windows by Dream's clock – never the same other shape twice in a row.
// Run: node --test tests/js/eye.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { rng } from './fire-frames.mjs';

const require = createRequire(import.meta.url);
require('../../static/dreambrush.js'); require('../../static/dreamlife.js'); require('../../static/dreameye.js');   // browser scripts: they hang themselves on the global object
const { HYPNO, nextHypno, hypnoAt } = globalThis.DreamEye;

test('five hypnotic pupils, the spiral among them', () => {
  assert.deepEqual([...HYPNO].sort(), ['mandala', 'sparkle', 'spiral', 'swirl', 'tunnel']);
});

test('Dreamy Eyes: nearly always the spiral, one time in four another shape – and of those never the same twice in a row', () => {
  for (const seed of [1, 2, 3]) {
    const rnd = rng(seed), count = {}; let other = null;
    for (let i = 0; i < 2000; i++) {
      const next = nextHypno(other, rnd);
      assert.ok(HYPNO.includes(next));
      if (next !== 'spiral') { assert.notEqual(next, other); other = next; }
      count[next] = (count[next] || 0) + 1;
    }
    assert.ok(count.spiral > 1400 && count.spiral < 1600, `the spiral ${count.spiral} of 2000 times`);
    for (const k of HYPNO.filter(x => x !== 'spiral')) assert.ok(count[k] > 80 && count[k] < 180, `${k}: ${count[k]} of 2000`);
  }
  assert.equal(nextHypno(null, () => 0.25), 'spiral');
  assert.notEqual(nextHypno('swirl', () => 0.2499), 'swirl');
  assert.notEqual(nextHypno('mandala', () => 0), 'mandala');
});

test('dream windows: the shape follows from the clock and the seed alone – the same in both windows of a pair, no repeats', () => {
  for (const seed of [0, 7, 123456789, 4294967295]) {
    const seen = new Set();
    for (let n = 0; n < 200; n++) {
      assert.equal(hypnoAt(n, seed), hypnoAt(n, seed));
      assert.notEqual(hypnoAt(n, seed), hypnoAt(n + 1, seed), `${n} and the next`);
      seen.add(hypnoAt(n, seed));
    }
    assert.equal(seen.size, HYPNO.length);
  }
});
