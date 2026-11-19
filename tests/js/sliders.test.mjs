// #216: the sliders of the panel and of Dream Control (static/sliders.js) – the rules in Node, the drawing and the
// gestures in a headless Chrome (tests/js/sliders.html).
// Run: node --test tests/js/sliders.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { findChrome, runPage } from './browser.mjs';

const { rules } = createRequire(import.meta.url)('../../static/sliders.js');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const rot = { d: 0.2, lo: -3, hi: 3, zero: true, w: 1 }, hue = { d: 2, lo: 0, hi: 20, w: 0.8 }, master = { d: 1, lo: 0, hi: 1 };

test('influence: the distance from the default, by the room on that side, times the weight', () => {
  assert.equal(rules.influence(rot, 0.2), 0);
  near(rules.influence(rot, 3), 1); near(rules.influence(rot, -3), 1);
  near(rules.influence(rot, 1.6), 0.5); near(rules.influence(rot, -1.4), 0.5);
  near(rules.influence(hue, 20), 0.8); near(rules.influence(hue, 0), 0.8); near(rules.influence(hue, 11), 0.4);
  assert.equal(rules.influence(master, 0), 0, 'no weight: never coloured');
  assert.equal(rules.influence(null, 5), 0, 'not a setting');
  near(rules.influence({ d: 1, lo: 0, hi: 1, w: 0.5 }, 0), 0.5);
  assert.equal(rules.influence({ d: 1, lo: 0, hi: 1, w: 0.5 }, 1), 0, 'a default at the end of its range');
});

test('fill: from the left end, or from the zero mark', () => {
  assert.deepEqual(rules.fill(5, 0, 20, false), { from: 0, to: 0.25, zero: 0 });
  assert.deepEqual(rules.fill(1.5, -3, 3, true), { from: 0.5, to: 0.75, zero: 0.5 });
  assert.deepEqual(rules.fill(-3, -3, 3, true), { from: 0, to: 0.5, zero: 0.5 });
  const zoom = rules.fill(0, -0.04, 0.06, true);
  near(zoom.zero, 0.4); near(zoom.from, 0.4); near(zoom.to, 0.4);
});

test('home and snap', () => {
  assert.equal(rules.home(rot), 0); assert.equal(rules.home(hue), 2);
  assert.equal(rules.snap(rot, 0.1), 0); assert.equal(rules.snap(rot, -0.1), 0); assert.equal(rules.snap(rot, 0.2), 0.2);
  assert.equal(rules.snap(hue, 0.1), 0.1, 'only a slider with a zero mark snaps');
  assert.equal(rules.snap({ d: 0.008, lo: -0.04, hi: 0.06, zero: true }, 0.002), 0.002, 'the smallest step stays reachable');
});

test('colour: cool, orange in the middle, red', () => {
  assert.equal(rules.colour(0), 'rgb(199, 139, 255)');
  assert.equal(rules.colour(0.5), 'rgb(255, 157, 66)');
  assert.equal(rules.colour(1), 'rgb(255, 77, 94)');
  assert.equal(rules.colour(0, [255, 90, 54]), 'rgb(255, 90, 54)', 'the cool end is the page\'s accent');
});

test('the three strongest shimmer, weak ones never', () => {
  assert.deepEqual(rules.strongest({ a: 0.9, b: 0.2, c: 0.5, d: 0.7, e: 0.1 }), ['a', 'd', 'c']);
  assert.deepEqual(rules.strongest({ a: 0.1, b: 0.16 }), ['b']);
  assert.deepEqual(rules.strongest({}), []);
});

const chrome = findChrome();
test('the sliders in a browser', { skip: !chrome && !process.env.CI ? 'no Chrome or Chromium found (set CHROME_BIN)' : false }, async t => {
  assert.ok(chrome, 'no Chrome or Chromium found (set CHROME_BIN)');
  const r = await runPage(chrome, 'sliders.html');
  assert.equal(r.error, '', r.error);
  await t.test('every slider is wrapped, named and gets its range from the schema', () => {
    assert.equal(r.wrapped, 6);
    assert.deepEqual(r.range, ['-3', '3', '0.2']);
    assert.equal(r.named[0], 'Rotation'); assert.equal(r.named[1], null, 'a label with for= already names its slider');
    assert.equal(r.named[2], 'Rotation: set to 0');
    assert.deepEqual(r.moved, ['4px', '', 'control'], 'its place in the row and its rights go to the box');
  });
  await t.test('at the defaults everything is cool and thin', () => {
    assert.equal(r.calm.rot.classes, 'sl sl-bipolar'); assert.equal(r.calm.strength.classes, 'sl');
    assert.equal(r.calm.rot.colour, 'rgb(199, 139, 255)'); assert.equal(r.calm.rot.thick, 6);
    near(r.calm.rot.mark, 0.5, 1e-3); near(r.calm.rot.from, 0.5, 1e-3); assert.ok(r.calm.rot.to > 0.5 && r.calm.rot.zero);
    assert.deepEqual([r.calm.card.wide, r.calm.card.colour, r.calm.card.said], [0, 'transparent', '']);
    assert.ok(r.markShown, 'only a slider with a zero in its range shows the mark');
    assert.deepEqual([r.calm.other.classes, r.calm.other.from, r.calm.other.to], ['sl', 0, 0.5], 'a slider that is no setting still fills');
  });
  await t.test('a changed setting: colour, thickness, shimmer, the words for a screen reader', () => {
    const c = r.changed;
    assert.match(c.rot.classes, /sl-strong/); assert.match(c.rot.classes, /sl-top/);
    assert.ok(c.rot.thick > 9 && c.rot.colour !== r.calm.rot.colour && c.rot.said === 'strongly changed');
    near(c.rot.from, 0.1, 1e-3); near(c.rot.to, 0.5, 1e-3);
    assert.match(c.strength.classes, /sl-top/); assert.match(c.hue.classes, /sl-top/);
    assert.doesNotMatch(c.drift.classes, /sl-top/, 'the fourth strongest does not shimmer');
    assert.ok(c.drift.thick > 6 && c.drift.said === null);
    assert.equal(r.shimmers, 'sl-shimmer'); assert.equal(r.still, 'none');
    assert.ok(c.card.wide > 6 && c.card.said.includes('strongly changed') && c.card.colour === c.strength.colour, 'the card shows its strongest slider');
    assert.equal(c.fx.thick, 6, 'effect strength without an effect shapes nothing'); assert.equal(c.cardB.wide, 0);
    assert.ok(r.fxOn.fx.thick > 6 && r.fxOn.cardB.wide > 3, 'with an effect on it counts');
  });
  await t.test('zero button, snap, double tap', () => {
    assert.deepEqual(r.zeroed, ['0', false]);
    assert.deepEqual([r.snapped, r.past, r.byKey], ['0', '0.4', '0.1']);
    assert.deepEqual(r.home, ['0', '0.45', '9'], 'zero, the default – and a slider that is no setting stays');
    assert.ok(r.inputsSeen && r.painted);
    assert.equal(r.back.card.wide, 0); assert.equal(r.back.strength.said, null);
  });
  await t.test('the reset button offers the undo for the server\'s seconds', () => {
    assert.deepEqual(r.reset.idle, ['↺ Reset', false]);
    assert.deepEqual(r.reset.undo, ['Reset · ↶ Undo', true]);
    assert.deepEqual(r.reset.sent, [{ reset: true }, { reset: 'undo' }]);
    assert.deepEqual(r.reset.undone, ['↺ Reset', false]); assert.deepEqual(r.reset.over, ['↺ Reset', false]);
    assert.deepEqual(r.reset.said, ['Reset – the picture glides to its defaults.', 'Everything back as it was.', 'Reset – the picture glides to its defaults.', 'Already at the defaults.']);
  });
});
