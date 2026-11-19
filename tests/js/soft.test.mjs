// #211: the soft switches (static/soft.js) – the shares of the old input picture and of the two prompts.
// Run: node --test tests/js/soft.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { SECS, oldShare, promptShare, promptSwitch } = require('../../static/soft.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
// what the renderer blends: the share of every prompt in a fade towards `to`
const mix = (f, to, now) => {
  const p = promptShare(f, now), m = {};
  if (p < 1) m[f.from] = 1 - p;
  m[to] = (m[to] || 0) + p;
  return m;
};

test('the old input picture leaves within three seconds, without a jump at either end', () => {
  assert.equal(SECS, 3);
  assert.equal(oldShare(0), 1);
  near(oldShare(1500), 0.5);
  assert.equal(oldShare(3000), 0);
  assert.equal(oldShare(60000), 0);
  assert.equal(oldShare(-5), 1);
  let last = 1;
  for (let ms = 0; ms <= 3000; ms += 33) {                    // one input picture every 33 ms: small steps only
    const s = oldShare(ms);
    assert.ok(s <= last && last - s < 0.02, `step at ${ms} ms`);
    last = s;
  }
  assert.equal(oldShare(100, 0), 0);                          // no time: a hard cut
});

test('a prompt change fades from the old prompt to the new one in three seconds', () => {
  const f = promptSwitch({ from: '', start: 0, dur: 0 }, 'forest', 'ocean', 1000);
  assert.deepEqual(f, { from: 'forest', start: 1000, dur: 3, p0: 0 });
  assert.equal(promptShare(f, 1000), 0);
  near(promptShare(f, 2500), 0.5);
  assert.equal(promptShare(f, 4000), 1);
  assert.equal(promptShare(f, 9000), 1);
});

test('no fade: the current prompt alone', () => {
  assert.equal(promptShare({ from: '', start: 0, dur: 0 }, 5), 1);
  assert.equal(promptShare({ from: 'forest', start: 0, dur: 0 }, 5), 1);
  assert.equal(promptShare(undefined, 5), 1);
});

test('a playlist scene keeps its own fade time; a time of 0 cuts', () => {
  const f = promptSwitch({ from: '', start: 0, dur: 0 }, 'forest', 'ocean', 0, 8);
  near(promptShare(f, 4000), 0.5);
  assert.equal(promptShare(promptSwitch(f, 'ocean', 'desert', 2000, 0), 2000), 1);
});

test('the same prompt again starts nothing', () => {
  assert.equal(promptShare(promptSwitch({ from: '', start: 0, dur: 0 }, 'forest', 'forest', 0), 1), 1);
  assert.equal(promptShare(promptSwitch({ from: '', start: 0, dur: 0 }, '', 'forest', 0), 1), 1);
});

test('a change early in a running fade keeps the old prompt at its share', () => {
  const a = promptSwitch({ from: '', start: 0, dur: 0 }, 'forest', 'ocean', 0);
  const before = mix(a, 'ocean', 900), b = promptSwitch(a, 'ocean', 'desert', 900), after = mix(b, 'desert', 900);
  assert.ok(before.forest > 0.5);
  near(after.forest, before.forest);                          // the stronger one does not move
  near(after.desert, before.ocean);                           // the weaker one is swapped
  assert.equal(promptShare(b, 3900), 1);                      // and three seconds later the new prompt stands alone
  assert.ok(promptShare(b, 1000) >= promptShare(b, 900));
});

test('a change late in a running fade keeps the prompt it was heading for at its share', () => {
  const a = promptSwitch({ from: '', start: 0, dur: 0 }, 'forest', 'ocean', 0);
  const before = mix(a, 'ocean', 2400), b = promptSwitch(a, 'ocean', 'desert', 2400), after = mix(b, 'desert', 2400);
  assert.ok(before.ocean > 0.5);
  near(after.ocean, before.ocean);
  near(after.desert, before.forest);
  assert.equal(b.from, 'ocean');
});

test('back to the old prompt during a fade: exactly the mix it stands at', () => {
  for (const at of [600, 2400]) {
    const a = promptSwitch({ from: '', start: 0, dur: 0 }, 'forest', 'ocean', 0);
    const before = mix(a, 'ocean', at), after = mix(promptSwitch(a, 'ocean', 'forest', at), 'forest', at);
    near(after.forest, before.forest);
    near(after.ocean, before.ocean);
  }
});

test('typing: every key continues from where the fade stands, never back', () => {
  let f = { from: '', start: 0, dur: 0 }, was = 'forest', share = 1, now = 0;
  for (const to of ['forest ', 'forest a', 'forest at', 'forest at n', 'forest at night']) {
    f = promptSwitch(f, was, to, now); was = to;
    const old = mix(f, to, now).forest || 0;
    assert.ok(old <= share + 1e-9, 'the old prompt never comes back');
    share = old; now += 400;
  }
  assert.equal(promptShare(f, now + 3000), 1);
});
