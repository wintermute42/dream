// #218: the hypnotic pupils of the shared eye (static/dreameye.js) take turns – in Dreamy Eyes by chance, in the dream
// windows by Dream's clock – and never show the same shape twice in a row.
// Run: node --test tests/js/eye.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { rng } from './fire-frames.mjs';

const require = createRequire(import.meta.url);
require('../../static/dreamlife.js'); require('../../static/dreameye.js');   // browser scripts: they hang themselves on the global object
const { HYPNO, nextHypno, hypnoAt } = globalThis.DreamEye;

test('five hypnotic pupils, the spiral among them', () => {
  assert.deepEqual([...HYPNO].sort(), ['mandala', 'sparkle', 'spiral', 'swirl', 'tunnel']);
});

test('Dreamy Eyes: a shape by chance each time, never the same twice in a row, every one in its turn', () => {
  for (const seed of [1, 2, 3]) {
    const rnd = rng(seed), count = {}; let last = null;
    for (let i = 0; i < 400; i++) {
      const next = nextHypno(last, rnd);
      assert.ok(HYPNO.includes(next)); assert.notEqual(next, last);
      count[next] = (count[next] || 0) + 1; last = next;
    }
    for (const k of HYPNO) assert.ok(count[k] > 50, `${k}: ${count[k]} of 400`);
  }
  assert.ok(HYPNO.includes(nextHypno(null, () => 0)) && HYPNO.includes(nextHypno('spiral', () => 0.999999)), 'at the ends of chance too');
  assert.notEqual(nextHypno('swirl', () => 0.999999), 'swirl');
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
