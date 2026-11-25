// #235: the dance mapping (static/dancemap.js) and what the dance card makes of a hand on a row (dancepanel.js) –
// no browser. Run: node --test tests/js/dancemap.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const M = require('../../static/dancemap.js'), P = require('../../static/dancepanel.js'), D = require('../../static/dance.js');
const FX = ['mirror', 'kaleido', 'mandala', 'tunnel', 'waves', 'glitch', 'pixel', 'raster', 'rgb', 'feedback', 'trails', 'hue', 'invert'];
const row = (o = {}) => ({ id: 'a', on: true, src: 'energy', dst: 'fx.trails', curve: 'lin', in: [0, 1], out: [0, 1], smooth: 0, origin: 'fixed', ...o });
const frame = (v, c = {}) => ({ v, c: Object.fromEntries(Object.keys(v).map(k => [k, k in c ? c[k] : 1])) });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('a row shapes its source: input range, curve, output range', () => {
  near(M.shape(row(), 0.5, 1), 0.5);
  near(M.shape(row({ in: [0.2, 0.6] }), 0.1, 1), 0); near(M.shape(row({ in: [0.2, 0.6] }), 0.4, 1), 0.5); near(M.shape(row({ in: [0.2, 0.6] }), 0.9, 1), 1);
  near(M.shape(row({ out: [0.1, 0.6] }), 1, 1), 0.6); near(M.shape(row({ out: [0.1, 0.6] }), 0, 1), 0.1);
  near(M.shape(row({ curve: 'soft' }), 0.25, 1), 0.5); near(M.shape(row({ curve: 'hard' }), 0.5, 1), 0.25); near(M.shape(row({ curve: 's' }), 0.5, 1), 0.5);
  near(M.shape(row({ curve: 'no-such' }), 0.3, 1), 0.3);
  // a source that goes both ways steers both ways around rest
  const turn = row({ src: 'turn', dst: 'fx.spin', in: [-1, 1], out: [-1, 1] });
  near(M.shape(turn, 0, 1), 0); near(M.shape(turn, -0.5, 1), -0.5); near(M.shape(turn, 1, 1), 1);
  near(M.shape(row({ in: [0.5, 0.5] }), 0.6, 1), 1); near(M.shape(row({ in: [0.5, 0.5] }), 0.4, 1), 0);   // a threshold
});

test('a source that is not known lets its target go (fail safe): low confidence, no value, no frame', () => {
  near(M.shape(row(), 0.9, 0.1), 0); near(M.shape(row(), NaN, 1), 0); near(M.shape(row(), undefined, undefined), 0);
  const m = M.create();
  assert.deepEqual(m.apply([row()], frame({ energy: 0.8 }), 0.016), { 'fx.trails': 0.8 });
  assert.deepEqual(m.apply([row()], frame({ energy: 0.8 }, { energy: 0.1 }), 0.016), {});
  assert.deepEqual(m.apply([row()], null, 0.016), {});
  assert.deepEqual(m.apply([row({ src: 'own.never_heard_of' })], frame({ energy: 1 }), 0.016), {});
});

test('smoothing glides, a switched-off row lets go, and a slow target never jumps', () => {
  const m = M.create(), r = row({ smooth: 0.2 });
  let v = 0; for (let i = 0; i < 12; i++) v = m.apply([r], frame({ energy: 1 }), 1 / 60)['fx.trails'];
  near(v, 1 - Math.exp(-0.2 / 0.2), 0.01);             // after one smoothing time: 63 %
  for (let i = 0; i < 120; i++) v = m.apply([{ ...r, on: false }], frame({ energy: 1 }), 1 / 60)['fx.trails'];
  assert.equal(v, undefined, 'gone');
  // the AI sliders are slow whatever the row says
  const ai = M.create(), a = row({ dst: 'ai.strength', smooth: 0 });
  const first = ai.apply([a], frame({ energy: 1 }), 1 / 60)['ai.strength'];
  assert.ok(first < 0.05, `first frame ${first}`);
  for (let i = 0; i < 60 * 3; i++) v = ai.apply([a], frame({ energy: 1 }), 1 / 60)['ai.strength'];
  assert.ok(v > 0.99);
  assert.equal(M.kind('ai.rot'), 'slow'); assert.equal(M.kind('fx.waves'), 'instant');
});

test('several rows on one target: the one that asks for most; a removed row is forgotten', () => {
  const m = M.create(), rows = [row({ id: 'a', out: [0, 0.4] }), row({ id: 'b', src: 'open', out: [0, 0.9] }), row({ id: 'c', src: 'turn', dst: 'fx.spin', in: [-1, 1], out: [-1, 1] })];
  assert.deepEqual(m.apply(rows, frame({ energy: 1, open: 0.5, turn: -0.6 }), 0.016), { 'fx.trails': 0.45, 'fx.spin': -0.6 });
  near(m.of('b'), 0.45); m.apply(rows.slice(0, 1), frame({ energy: 1 }), 0.016); assert.equal(m.of('b'), 0);
});

test('one target interface: every effect of the instant layer and the AI sliders, each fast or slow', () => {
  const t = M.targets(FX);
  for (const e of FX.filter(e => e !== 'invert')) assert.equal(t['fx.' + e], 'instant', e);
  assert.ok(!('fx.invert' in t), 'no flashing negative as a target');
  for (const k of ['amt', 'pulse', 'spin']) assert.equal(t['fx.' + k], 'instant');
  for (const k of ['strength', 'mix', 'zoom', 'rot', 'hue']) assert.equal(t['ai.' + k], 'slow');
  // the effects named here are the ones the stage draws (fx.js) and Dream's table allows (dance.py reads playlists.FX)
  const fxjs = readFileSync(new URL('../../static/fx.js', import.meta.url), 'utf8');
  const order = /const ORDER = \[([^\]]+)\]/.exec(fxjs)[1].match(/\w+/g), filters = /const FILTERS = \[([^\]]+)\]/.exec(fxjs)[1].match(/\w+/g);
  assert.deepEqual([...order, ...filters].sort(), FX.slice().sort());
});

test('the feature stream drives the table end to end: a dancer opening the arms makes the mapped effect grow', () => {
  const d = D.create(), m = M.create(), rows = [row({ id: 'o', src: 'open', dst: 'fx.kaleido', in: [0.3, 0.9], smooth: 0.1 })];
  const at = open => ({ hands: { l: { x: 0.5 + 0.1 * open, y: 0.4, c: 0.9, src: 'pose' }, r: { x: 0.5 - 0.1 * open, y: 0.4, c: 0.9, src: 'pose' } }, body: { x: 0.5, y: 0.4, s: 0.1, c: 0.9 } });
  let out;
  for (let i = 0; i < 60; i++) out = m.apply(rows, d.step({ t: i / 60, ...at(0.2) }), 1 / 60);
  assert.equal(out['fx.kaleido'], undefined, 'arms closed: nothing');
  for (let i = 60; i < 150; i++) out = m.apply(rows, d.step({ t: i / 60, ...at(1.7) }), 1 / 60);
  assert.ok(out['fx.kaleido'] > 0.8, `arms wide: ${out['fx.kaleido']}`);
});

// ---------- the card: what a hand on a row makes of the table ----------
test('a hand on a row: switch, source, target, strength, remove – and a new row', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b', src: 'g.throw', dst: 'fx.feedback' })];
  assert.equal(P.edit(rows, 'a', { on: false })[0].on, false);
  assert.equal(P.edit(rows, 'a', { on: false })[0].origin, 'fixed', 'switching a built-in row off leaves it built-in');
  const dst = P.edit(rows, 'b', { dst: 'ai.hue' })[1];
  assert.equal(dst.dst, 'ai.hue'); assert.equal(dst.origin, 'own'); assert.equal(rows[1].dst, 'fx.feedback', 'the table handed in is not changed');
  assert.deepEqual(P.edit(rows, 'a', { amount: 0.3 })[0].out, [0, 0.3]);
  assert.deepEqual(P.edit(rows, 'a', { amount: 7 })[0].out, [0, 1]);
  // a source that goes both ways takes the whole range, both ways; back to a one-way source: one way again
  const turn = P.edit(rows, 'a', { src: 'turn' })[0];
  assert.deepEqual(turn.in, [-1, 1]); assert.deepEqual(turn.out, [-1, 1]);
  assert.deepEqual(P.edit([turn], 'a', { amount: 0.5 })[0].out, [-0.5, 0.5]);
  const back = P.edit([turn], 'a', { src: 'open' })[0];
  assert.deepEqual(back.in, [0, 1]); assert.deepEqual(back.out, [0, 1]);
  assert.deepEqual(P.edit(rows, 'a', { remove: true }).map(r => r.id), ['b']);
  const more = P.add(P.add(rows, 'energy', 'fx.waves'), 'turn', 'fx.spin');
  assert.deepEqual(more.map(r => r.id), ['a', 'b', 'own1', 'own2']); assert.deepEqual(more[3].out, [-0.7, 0.7]); assert.equal(more[2].origin, 'own');
});

test('every source and target has a name a person reads', () => {
  const fxNames = { waves: 'Waves' };
  for (const s of D.SOURCES) assert.notEqual(P.label(s), s, s);
  for (const t of Object.keys(M.targets(['waves']))) assert.notEqual(P.label(t, fxNames), t, t);
  assert.equal(P.label('fx.waves', fxNames), 'Waves'); assert.equal(P.label('l.palm'), 'Left hand: fist ↔ open hand');
  assert.equal(P.label('own.my_move'), 'own.my_move');     // one nobody named yet shows as it is
});
