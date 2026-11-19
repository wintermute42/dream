// #217: the moving signs of the sliders and the shape of the picture's character (static/signs.js) – the rules in Node,
// the drawing in a headless Chrome (tests/js/signs.html).
// Run: node --test tests/js/signs.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { findChrome, runPage } from './browser.mjs';

const { rules } = createRequire(import.meta.url)('../../static/signs.js');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const S = { rot: { d: 0.2, lo: -3, hi: 3, zero: true, w: 1 }, zoom: { d: 0.008, lo: -0.04, hi: 0.06, zero: true, w: 1 }, hue: { d: 2, lo: 0, hi: 20, w: 0.8 },
  smooth: { d: 0.3, lo: 0, hi: 1, w: 0.5 }, strength: { d: 0.45, lo: 0, hi: 0.95, w: 1 }, sens: { d: 1, lo: 0, hi: 2, w: 0.5, needs: 'music' },
  drift: { d: 0.5, lo: 0, hi: 1, w: 0.6 } };
const sign = (key, v, opts) => rules.sign(key, S[key], v, opts);

test('which slider has which sign', () => {
  assert.deepEqual(rules.SIGNS, { rot: 'turn', zoom: 'rings', hue: 'wheel', smooth: 'trail', strength: 'grow', sens: 'bars' });
  assert.equal(sign('drift', 0.5), null, 'a slider without a sign');
  assert.equal(rules.sign('rot', null, 1), null, 'not a setting');
});

test('amount: the way from zero to that end of the range', () => {
  near(rules.amount(S.rot, 1.5), 0.5); near(rules.amount(S.rot, -3), 1);
  near(rules.amount(S.zoom, 0.03), 0.5); near(rules.amount(S.zoom, -0.02), 0.5, 1e-9);
  assert.equal(rules.amount(S.hue, 0), 0); assert.equal(rules.amount(S.hue, 40), 1);
  assert.equal(rules.amount({ lo: 0.2, hi: 1.5 }, -1), 0, 'no room on that side');
  assert.equal(rules.amount(null, 1), 0);
});

test('at 0, and while its switch is off, a sign stands still', () => {
  for (const key of Object.keys(rules.SIGNS)) {
    const sg = sign(key, 0);
    assert.deepEqual([sg.still, sg.amount, sg.period], [true, 0, Infinity], key);
    assert.equal(sign(key, S[key].hi).still, false, key);
  }
  const off = sign('sens', 1.5, { acts: false });
  assert.deepEqual([off.still, off.amount, off.period], [true, 0, Infinity], 'music reaction without music');
});

test('the tempo is the real one', () => {
  near(sign('rot', 3, { pics: 4 }).period, 30);             // 3° a picture, 4 pictures a second: a turn in 30 s
  near(sign('rot', -3, { pics: 4 }).period, 30); assert.equal(sign('rot', -3).dir, -1); assert.equal(sign('rot', 3).dir, 1);
  near(sign('rot', 3, { pics: 8 }).period, 15, 1e-9);
  near(sign('hue', 20, { pics: 4 }).period, 4.5);           // 20° of the colour wheel a picture
  near(sign('hue', 2, { pics: 4 }).period, 45);
  // the zoom rings: a ring has grown threefold when the picture has
  const z = sign('zoom', 0.06, { pics: 4 }); near(Math.pow(1.06, z.period * 4), 3, 1e-9);
  const back = sign('zoom', -0.04, { pics: 4 }); assert.equal(back.dir, -1); near(Math.pow(1.04, back.period * 4), 3, 1e-9);
  // the form is full when a twentieth of the old picture is left
  const g = sign('strength', 0.45, { pics: 4 }); near(Math.pow(1 - 0.45, g.period * 4), 0.05, 1e-9);
  assert.ok(sign('strength', 0.1).period > sign('strength', 0.45).period);
  assert.equal(sign('strength', 0.95).period, 0.4, 'never faster than that');
  // the bars: one bounce a beat, as high as the reaction
  near(sign('sens', 1, { bpm: 100 }).period, 0.6); near(sign('sens', 1).period, 0.5); near(sign('sens', 1).amount, 0.5);
  // the trail: a steady round, as long behind the dot as the smoothing glows
  const t = sign('smooth', 0.6); assert.equal(t.period, rules.ORBIT); near(t.tail, rules.smoothTau(0.6));
  near(rules.smoothTau(1), 1.6); assert.equal(rules.smoothTau(0), 0);
});

test('the trail: followers behind the dot, none without smoothing', () => {
  const none = rules.tailLags(0);
  assert.deepEqual(none.map(x => x.opacity), [1, 0, 0, 0, 0]);
  const some = rules.tailLags(0.6), most = rules.tailLags(5);
  near(some[4].lag, 0.6 / rules.ORBIT); assert.equal(some[0].lag, 0); assert.ok(some[1].opacity > some[4].opacity && some[4].opacity > 0);
  near(most[4].lag, 0.7, 1e-9);                                // never a whole round
});

test('standing still, a sign shows the strength', () => {
  near(rules.pose(sign('rot', 1.5)), 0.25); near(rules.pose(sign('strength', 0.95)), 0.8); assert.equal(rules.pose(sign('strength', 0)), 0);
  for (const key of Object.keys(rules.SIGNS)) { const p = rules.pose(sign(key, S[key].hi)); assert.ok(p >= 0 && p < 1, key); }
});

test('only transform and opacity move', () => {
  for (const [kind, part] of Object.entries(rules.PARTS)) {
    assert.ok(Object.values(rules.SIGNS).includes(kind), kind);
    for (const frame of part.frames) assert.ok(Object.keys(frame).every(k => ['transform', 'opacity', 'offset'].includes(k)), kind);
    assert.ok(part.lags.every(l => l >= 0 && l < 1), kind);
  }
});

test('the axes: change, motion, colour, music – each as long as its strongest slider', () => {
  const val = (key, v, more = {}) => ({ s: S[key], v, acts: true, u: 0, ...more });
  assert.deepEqual(rules.AXES.map(a => [a.name, a.mark]), [['change', 'grow'], ['motion', 'turn'], ['colour', 'wheel'], ['music', 'bars']]);
  const at = rules.axes({ strength: val('strength', 0.45), drift: val('drift', 0.5), zoom: val('zoom', 0.008), rot: val('rot', 0.2), hue: val('hue', 2), sens: val('sens', 1, { acts: false }) });
  near(at[0].amount, 0.5); near(at[1].amount, 0.008 / 0.06); near(at[2].amount, 0.1); assert.equal(at[3].amount, 0, 'no music: no music axis');
  const wild = rules.axes({ strength: val('strength', 0.95, { u: 1 }), drift: val('drift', 0), zoom: val('zoom', 0), rot: val('rot', -3, { u: 0.9 }), hue: val('hue', 10, { u: 0.3 }), sens: val('sens', 2, { u: 0.5 }) });
  assert.deepEqual(wild.map(a => a.amount), [1, 1, 0.5, 1]);
  assert.deepEqual(wild.map(a => a.u), [1, 0.9, 0.3, 0.5], 'the corner takes the influence of its slider');
  assert.deepEqual(rules.axes({}).map(a => a.amount), [0, 0, 0, 0], 'a page without these sliders');
  // the corners: top, right, bottom, left of a square on its corner
  assert.deepEqual(rules.corners(wild), [[0, -30], [30, 0], [0, 17.5], [-30, 0]]);
  assert.deepEqual(rules.corners(rules.axes({})), [[0, -5], [5, 0], [0, 5], [-5, 0]]);
});

const chrome = findChrome();
test('the signs in a browser', { skip: !chrome && !process.env.CI ? 'no Chrome or Chromium found (set CHROME_BIN)' : false }, async t => {
  assert.ok(chrome, 'no Chrome or Chromium found (set CHROME_BIN)');
  const r = await runPage(chrome, 'signs.html');
  assert.equal(r.error, '', r.error);
  await t.test('every slider with a sign gets it beside its name, hidden from screen readers', () => {
    assert.deepEqual(r.kinds, { rot: 'sg-turn', zoom: 'sg-rings', hue: 'sg-wheel', smooth: 'sg-trail', strength: 'sg-grow', sens: 'sg-bars', drift: null });
    assert.ok(r.hidden && r.beforeValue, 'aria-hidden, and before the value in the label');
    assert.equal(r.name, 'Rotation', 'the name of the slider stays its name');
  });
  await t.test('they move at their tempo and stand still at 0 and with the switch off', () => {
    if (r.calmMotion) { assert.ok(Object.values(r.moving).every(m => !m.runs), 'with reduced motion nothing moves'); return; }
    for (const key of ['rot', 'zoom', 'hue', 'smooth', 'strength']) assert.ok(r.moving[key].runs && !r.moving[key].still, key);
    near(r.moving.rot.rate, 1 / 30, 1e-4); near(r.moving.hue.rate, 1 / 4.5, 1e-3); assert.equal(r.moving.rot.back, true);
    assert.equal(r.moving.sens.runs, false, 'music reaction without music stands');
    assert.ok(r.music.runs && Math.abs(r.music.rate - 2) < 1e-3, 'with music the bars bounce on the beat');
    assert.ok(r.faster.rot > r.moving.rot.rate && Math.abs(r.faster.sens - 100 / 60) < 1e-3, 'the page tells the real tempo');
    for (const key of ['rot', 'zoom', 'hue', 'smooth', 'strength', 'sens']) assert.ok(!r.zero[key].runs && r.zero[key].still && r.zero[key].amt === 0, key + ' at 0');
  });
  await t.test('a hidden panel pauses them, and they go on when it is back', () => {
    assert.ok(Object.values(r.hiddenPanel).every(m => !m.runs));
    if (!r.calmMotion) assert.ok(r.shownAgain.rot.runs && r.shownAgain.strength.runs);
  });
  await t.test('the shape follows the sliders at once', () => {
    assert.equal(r.shape.role, 'img');
    assert.equal(r.shape.marks.join(' '), 'sg-grow sg-turn sg-wheel sg-bars');
    assert.equal(r.shape.said, 'Character of the picture: change 100 %, motion 100 %, colour 50 %, music 0 %');
    assert.equal(r.shape.points, '0,-30 30,0 0,17.5 -5,0');
    assert.equal(r.shape.dots[0], r.shape.heat, 'a corner takes the colour of its slider');
    assert.equal(r.shape.dots[3], '', 'an axis nothing changed keeps the cool colour of the page');
    assert.equal(r.shapeZero, '0,-5 5,0 0,5 -5,0');
    assert.equal(r.text, '', 'no words on the page');
  });
});
