// #236: teaching a move of one's own (static/moveteach.js, the parts without a page) – a take in the making, its
// repetitions as frames, the file Dream keeps, and the row of the table that says what the move steers. A simulated
// dancer (dance-sim.mjs) is taken as the page would take the stage's live dance; what is kept is then recognised.
// Run: node --test tests/js/moveteach.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { frames, play, verdict } from './dance-sim.mjs';

const require = createRequire(import.meta.url);
const D = require('../../static/dance.js'), M = require('../../static/dancemap.js'), MV = require('../../static/dancemoves.js'), R = require('../../static/dancerec.js'),
  P = require('../../static/dancepanel.js'), T = require('../../static/moveteach.js'), MOVE = require('../../static/movement.js');
const KEYS = D.SOURCES;
const landmarks = f => Array.from({ length: 33 }, (_, i) => ({ x: f.body.x + (i === 15 ? f.hands.l.x - f.body.x : i === 16 ? f.hands.r.x - f.body.x : 0.01 * (i % 5)),
  y: f.body.y + (i === 15 ? f.hands.l.y - f.body.y : i === 16 ? f.hands.r.y - f.body.y : 0.02 * (i % 7)), visibility: 0.9 }));
// the stage's live dance, frame by frame, as the lab's `live` hands it over
function taken(move, o = {}, clutch = false) {
  const d = D.create(), tk = T.take(KEYS);
  for (const f of frames(move, { seconds: 6, jitter: 0.003, wobble: 0.03, seed: 4, fps: 60, ...o })) {
    const input = { ...f, aspect: 16 / 9 }, rec = d.step(input);
    tk.add({ rec, input, landmarks: landmarks(f), out: {} }, clutch);
  }
  return tk;
}

test('a take keeps session frames with the hands in body units and the clutch – at most thirty a second, and it has an end', () => {
  const tk = taken('drum', {}, true), fr = tk.frames;
  assert.ok(fr.length > 170 && fr.length <= 181, `${fr.length} frames of six seconds at 60 a second`);
  assert.ok(R.good({ format: R.FORMAT, version: R.VERSION, frames: fr, keys: KEYS, marks: [] }), 'the frames of a session (#243)');
  const f = fr[100];
  assert.equal(f.u.length, 4); assert.ok(f.u.every(Number.isFinite)); assert.equal(f.k, 1);
  assert.ok(Math.abs(f.u[0] - 0.7) < 0.15 && Math.abs(f.u[2] + 0.7) < 0.15, 'shoulder widths from the middle of the shoulders');
  assert.equal(f.p.b.length, 26, 'the skeleton’s points');
  assert.ok(!JSON.stringify(fr).includes('data:'), 'numbers, no picture');
  const long = T.take(KEYS), d = D.create(); let room = true, n = 0;
  for (const x of frames('drum', { seconds: T.MAX_TAKE + 2 })) { room = long.add({ rec: d.step(x), input: x, landmarks: null, out: {} }, false); if (room) n++; }
  assert.equal(room, false); assert.ok(long.seconds <= T.MAX_TAKE);
  assert.equal(T.take(KEYS).add(null, false), true, 'nothing detected: nothing joins, the take goes on');
});

test('the repetitions of a take are frames of their own, and the kept move is recognised afterwards', () => {
  const tk = taken('eight'), { g, seg } = tk.look();
  assert.equal(seg.why, null); assert.equal(seg.reps.length, MV.MAX_REPS);
  const reps = T.spans(tk.frames, seg.reps);
  for (const r of reps) { assert.ok(r.length >= 16 && r.length <= 19, `${r.length} frames in 0.6 s`); assert.equal(r[0].t < 0.04, true); assert.ok(r[r.length - 1].t < seg.period); }
  // one repetition thrown away
  const left = seg.reps.filter((_, i) => i !== 1), tpl = MV.template(g, left, seg.hands);
  const file = T.moveFile('Lasso', 'fire', tpl, T.spans(tk.frames, left), KEYS);
  assert.deepEqual(Object.keys(file), ['format', 'version', 'name', 'piece', 'rate', 'aspect', 'keys', 'tpl', 'reps']);
  assert.equal(file.format, 'dream-dance-move'); assert.equal(file.reps.length, 4); assert.equal(file.tpl.pts.length, MV.M);
  assert.ok(JSON.stringify(file).length < 400000, 'a move is small');
  const back = JSON.parse(JSON.stringify(file)), d = D.create(); d.setMoves([MV.compile(back.tpl, 'm0a1b2c3d')]);
  assert.ok(verdict(play(d, frames('eight', { seconds: 6, size: 1.15, bpm: 108, seed: 9, jitter: 0.003 })), 'm0a1b2c3d', 4).hit);
  assert.ok(T.bounds(reps[0], 16 / 9).side > 0);
});

test('a take that is no move says why, in words', () => {
  assert.match(T.why(taken('stand').look().seg), /Hardly any movement/);
  assert.match(T.why(taken('reach').look().seg), /No repetition found/);
  assert.match(T.why(taken('drum', { seconds: 0.4 }).look().seg), /too short/);
  assert.match(T.why({ why: 'few', count: 2 }), /Only 2 repetitions/);
  assert.match(T.why({ why: 'nohands' }), /hands were not seen/);
});

test('what a move steers is a row of the table: given, changed, taken away – other rows are left alone', () => {
  const rows = [{ id: 'energy', on: true, src: 'energy', dst: 'fx.trails', curve: 'soft', in: [0.1, 0.8], out: [0, 0.7], smooth: 0.2, origin: 'fixed' }];
  assert.equal(T.targetOf(rows, 'm0a1b2c3d'), '');
  const one = T.assign(rows, 'm0a1b2c3d', 'fx.tunnel');
  assert.deepEqual(one[1], { id: 'm0a1b2c3d', on: true, src: 'g.m0a1b2c3d', dst: 'fx.tunnel', curve: 'lin', in: [0, 1], out: [0, 1], smooth: 0.15, origin: 'taught' });
  assert.equal(one[0], rows[0]); assert.equal(T.targetOf(one, 'm0a1b2c3d'), 'fx.tunnel');
  const two = T.assign(one.map(r => (r.src === 'g.m0a1b2c3d' ? { ...r, on: false, out: [0, 0.4] } : r)), 'm0a1b2c3d', 'ai.piece');
  assert.equal(two.length, 2); assert.equal(two[1].dst, 'ai.piece'); assert.equal(two[1].on, true); assert.deepEqual(two[1].out, [0, 0.4], 'its strength stays');
  assert.deepEqual(T.assign(two, 'm0a1b2c3d', ''), rows);
  // the id is taken by another row: the new row gets one of its own
  assert.equal(T.assign([{ ...rows[0], id: 'm0a1b2c3d' }], 'm0a1b2c3d', 'fx.rgb')[1].id, 'm0a1b2c3d-2');
  // the row is one the table takes (dance.py: ids, sources, targets) and the mapping knows the target
  assert.match(one[1].id, /^[a-z0-9_-]{1,24}$/); assert.match(one[1].src, /^[a-z][a-z0-9_]{0,23}(\.[a-z0-9_]{1,24})?$/);
  assert.equal(M.targets([])['ai.piece'], 'slow');
});

test('the taught row acts through the table like a gesture’s – and only with the clutch engaged', () => {
  const tk = taken('drum'), { g, seg } = tk.look(), c = MV.compile(MV.template(g, seg.reps, seg.hands), 'm0a1b2c3d');
  const rows = T.assign([], 'm0a1b2c3d', 'fx.tunnel'), d = D.create(); d.setMoves([c]);
  const run = clutch => { const mover = MOVE.create({ maps: M }); let out = {}; d.reset(); for (const f of frames('drum', { seconds: 6, seed: 2 })) out = mover.step({ mode: 'dance', tables: { dance: rows }, rec: d.step(f), clutch, dt: 1 / 30 }); return out; };
  assert.ok(run(true)['fx.tunnel'] > 0.8, 'engaged: the move steers its effect');
  assert.equal(run(false)['fx.tunnel'] || 0, 0, 'released: nothing');
});

test('a taught move reads as the name the dancer gave it; a session played back steers with it too', () => {
  assert.equal(P.label('g.m0a1b2c3d'), 'g.m0a1b2c3d');
  P.setNames([{ id: 'm0a1b2c3d', name: 'Lasso' }, null, { id: 7 }]);
  assert.equal(P.label('g.m0a1b2c3d'), 'Lasso'); assert.equal(P.label('g.throw'), 'Throwing up'); assert.equal(P.label('ai.piece'), 'Prompt piece of the move');
  P.setNames([]);
  assert.equal(P.label('g.m0a1b2c3d'), 'g.m0a1b2c3d');
  const frame = { t: 1, v: KEYS.map(() => 0), c: KEYS.map(() => 0), g: 'm0a1b2c3d', gc: 0.8, s: 0.9 }, rec = R.unpack(frame, KEYS);
  assert.equal(rec.v['g.m0a1b2c3d'], 0.9); assert.equal(rec.c['g.m0a1b2c3d'], 0.8);
  assert.ok(M.create().apply(T.assign([], 'm0a1b2c3d', 'fx.tunnel'), rec, 10) ['fx.tunnel'] > 0.8);
  assert.equal(R.unpack({ ...frame, g: 'throw' }, KEYS).v['g.throw'], 0, 'a built-in gesture keeps its own value');
});

test('the page loads what the card needs, in an order that works, and the stage the matcher before the stream', () => {
  const page = readFileSync(new URL('../../static/dance.html', import.meta.url), 'utf8'), stage = readFileSync(new URL('../../static/index.html', import.meta.url), 'utf8');
  const at = (html, name) => html.indexOf(`<script src="/static/${name}"></script>`);
  for (const dep of ['dancerec.js', 'dancemoves.js', 'dancepanel.js']) assert.ok(at(page, dep) >= 0 && at(page, dep) < at(page, 'moveteach.js'), dep);
  assert.ok(at(stage, 'dancemoves.js') >= 0 && at(stage, 'dancemoves.js') < at(stage, 'dance.js'));
  assert.ok(page.includes('href="/static/moveteach.css"'));
  // only transform and opacity move
  const css = readFileSync(new URL('../../static/moveteach.css', import.meta.url), 'utf8');
  for (const m of css.matchAll(/transition:([^;}]+)/g)) for (const part of m[1].split(',')) assert.match(part.trim(), /^(transform|opacity)\b/);
  for (const m of css.matchAll(/@keyframes[^{]+\{((?:[^{}]*\{[^{}]*\})+)/g)) for (const p of m[1].matchAll(/([a-z-]+)\s*:/g)) assert.ok(['opacity', 'transform'].includes(p[1]), p[1]);
});
