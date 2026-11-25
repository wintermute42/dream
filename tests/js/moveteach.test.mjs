// #236, #265: teaching a movement (static/moveteach.js, the parts without a page) – a take in the making, its
// repetitions as frames, the file Dream keeps, how exactly a movement is taken (its tolerance) and a move as an accent. A simulated
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

test('how exactly a movement is taken: the peaks of each time, and the tolerance chosen from them', () => {
  assert.deepEqual(T.episodes([0, 0.1, 0.35, 0.7, 0.5, 0.1, 0, 0.32, 0.31, 0.15, 0.9]), [0.7, 0.32, 0.9], 'one peak a time, the last one open');
  assert.deepEqual(T.episodes([0.25, 0.29, 0.1, NaN]), [], 'never sure enough: no time at all');
  const L = D.TOL;
  assert.deepEqual(Object.keys(L), ['tight', 'normal', 'loose']); assert.ok(L.tight > L.normal && L.normal > L.loose);
  // clear hits, nothing wrong: as loose as can be
  assert.deepEqual(T.pickTolerance([0.8, 0.7, 0.5], [0.3], L), { tol: 'loose', hits: 3, misses: 0, alarms: 0 });
  // something else was taken for it at 0.5: loose would let it through – normal does not
  assert.deepEqual(T.pickTolerance([0.8, 0.7, 0.65], [0.5], L), { tol: 'normal', hits: 3, misses: 0, alarms: 0 });
  assert.equal(T.pickTolerance([0.9, 0.8], [0.7, 0.62], L).tol, 'tight');
  // false alarms at every tolerance: the one with the fewest
  assert.deepEqual(T.pickTolerance([0.9], [0.95, 0.7, 0.5], L), { tol: 'tight', hits: 1, misses: 0, alarms: 1 });
  assert.equal(T.pickTolerance([], [], L).tol, 'loose');
});

test('the tolerance is the detection’s: tight takes less for the gesture, loose more', () => {
  const run = tol => { const d = D.create(); if (tol) d.setTolerance({ throw: tol }); let n = 0, was = null; for (const f of frames('drum', { seconds: 6, size: 0.5, seed: 3 })) { const r = d.step(f); if (r.gesture === 'throw' && was !== 'throw') n++; was = r.gesture; } return { n, thr: d.threshold('throw') }; };
  const tight = run('tight'), normal = run(null), loose = run('loose');
  assert.deepEqual([tight.thr, normal.thr, loose.thr], [D.TOL.tight, D.TOL.normal, D.TOL.loose]);
  assert.ok(D.create().threshold('wave') === D.TOL.normal, 'what is not named: normal');
  const d = D.create(); d.setTolerance({ throw: 'sloppy', push: 'tight' }); assert.equal(d.threshold('throw'), D.TOL.normal); assert.equal(d.threshold('push'), D.TOL.tight);
  assert.ok(tight.n <= normal.n && normal.n <= loose.n, `tight ${tight.n} ≤ normal ${normal.n} ≤ loose ${loose.n}`);
});

test('a taught move as an accent acts through the dance table like a gesture’s – and only with the clutch engaged', () => {
  const tk = taken('drum'), { g, seg } = tk.look(), c = MV.compile(MV.template(g, seg.reps, seg.hands), 'm0a1b2c3d');
  // the row the slots make of an accent "When I dance “…” → a tunnel tears open" (dance.py compile_slots)
  const rows = [{ id: 'accent0', on: true, src: 'g.m0a1b2c3d', dst: 'fx.tunnel', curve: 'lin', in: [0, 1], out: [0, 1], smooth: 0.15, origin: 'slot' }], d = D.create(); d.setMoves([c]);
  const run = clutch => { const mover = MOVE.create({ maps: M }); let out = {}; d.reset(); for (const f of frames('drum', { seconds: 6, seed: 2 })) out = mover.step({ mode: 'dance', tables: { dance: rows }, rec: d.step(f), clutch, rules: { dance: true }, dt: 1 / 30 }); return out; };
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
  assert.ok(M.create().apply([{ id: 'accent0', on: true, src: 'g.m0a1b2c3d', dst: 'fx.tunnel', curve: 'lin', in: [0, 1], out: [0, 1], smooth: 0.15, origin: 'slot' }], rec, 10)['fx.tunnel'] > 0.8);
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
