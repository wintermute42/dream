// #253: the performers' profiles (static/flowprofile.js) on synthetic performers – invented people with a way of moving
// of their own (flow-sim.mjs), no camera, no model, nobody real. What is measured: a profile is learned from one
// performance and used on ANOTHER one of the same person (another day: another place in the picture, another size,
// other noise) – the effect must fit that person better than without it.
// Run: node --test tests/js/flowprofile.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { perform, session } from './flow-sim.mjs';

const require = createRequire(import.meta.url);
const D = require('../../static/dance.js'), P = require('../../static/flowprofile.js'), M = require('../../static/dancemap.js');
const Move = require('../../static/movement.js'), MV = require('../../static/dancemoves.js');

const row = (id, src, dst, lo = 0, hi = 1, smooth = 0.2) => ({ id, on: true, src, dst, curve: 'lin', in: [lo, hi], out: [0, 1], smooth, origin: 'fixed' });
// rows as Flowtrack's table has them: the energy drives an effect; a figure and the roundness of the path each another
const TABLE = [row('e', 'energy', 'fx.trails', 0.1, 0.8), row('f', 'figure', 'fx.mandala', 0, 1, 0.15), row('r', 'round', 'fx.kaleido', 0, 1, 0.15)];
const repeat = (plan, n) => Array.from({ length: n }, () => plan).flat();
// a profile learned from a performance, as the page keeps and the stage uses it
function learned(plan, opts, name = 'Person A') {
  const got = P.learn(session(perform(plan, opts)));
  assert.equal(got.why, null, 'a profile could be learned');
  const profile = P.profile(name, got.prop, got), c = P.compile(profile, 'p0a1b2c3d');
  assert.ok(P.usable(profile) && c, 'the profile is usable');
  return { got, profile, c };
}
// A performance through the stream, the fitter and the table – as the stage does it. → per frame {label, since (seconds
// into its stretch), out: what each target is at}
function play(frames, c) {
  const det = D.create(), fit = P.create(), map = M.create();
  fit.set(c); if (c) det.setMoves(c.figures);
  let was = frames[0].t, label = null, from = 0;
  return frames.map(f => {
    if (f.label !== label) { label = f.label; from = f.t; }
    const out = map.apply(P.rows(c, TABLE), fit.fit(det.step(f)), Math.max(1e-3, f.t - was)); was = f.t;
    return { label, since: f.t - from, out };
  });
}
// the share of the frames of a stretch (after it has settled) in which the target is where it should be
const share = (outs, label, test, settle = 2) => { const a = outs.filter(o => o.label === label && o.since >= settle); return a.filter(o => test(o.out)).length / Math.max(1, a.length); };
// "the effect follows the person": calm movement shows a little of it, wild movement nearly all – not the same for both
const follows = outs => (share(outs, 'calm', o => (o['fx.trails'] || 0) <= 0.55) + share(outs, 'wild', o => (o['fx.trails'] || 0) >= 0.65)) / 2;

// two invented people: one with large, fast circles of both arms (fans), one with small, flowing hands
const BIG = [{ secs: 8, way: 'fans', f: 0.9, k: 0.9, label: 'calm' }, { secs: 8, way: 'fans', f: 1.8, k: 1.1, label: 'wild' }, { secs: 3, way: 'rest' }];
const GENTLE = [{ secs: 8, way: 'gentle', f: 0.45, k: 0.8, label: 'calm' }, { secs: 8, way: 'gentle', f: 1.1, k: 1.8, label: 'wild' }, { secs: 3, way: 'rest' }];
const OTHER_DAY = { seed: 9, at: [0.44, 0.5], S: 0.12 };

test('the effect follows each person with their profile – without it, a large mover saturates it and a gentle one hardly reaches it', () => {
  for (const [name, plan] of [['large and fast', BIG], ['small and gentle', GENTLE]]) {
    const { c } = learned(repeat(plan, 3), { seed: 3 });
    const show = perform(repeat(plan, 2), OTHER_DAY), without = follows(play(show, null)), fitted = follows(play(show, c));
    assert.ok(fitted >= 0.9, `${name}: with the profile the effect is right in ${(fitted * 100).toFixed(0)} % of the frames`);
    assert.ok(without <= 0.6 && fitted - without >= 0.3, `${name}: without it only in ${(without * 100).toFixed(0)} %`);
  }
});

test('what is learned of a person: speed, turning, planes, tempo, the energy over the session, the view – and a guess at the prop', () => {
  const poi = learned(repeat([{ secs: 8, way: 'poi', f: 0.8, k: 0.8 }, { secs: 8, way: 'poi', f: 1.8, k: 1.1 }, { secs: 3, way: 'rest' }], 3), { src: 'light', seed: 3 });
  let s = poi.got.stats;
  assert.equal(poi.got.prop, 'poi'); assert.equal(s.view.kind, 'on');
  assert.ok(s.turn.share > 0.7 && s.turn.dir > 0.9 && s.turn.hi > 1.2, 'poi turn, one way round');
  assert.ok(s.planes.wall > 0.9 && s.round > 0.7, 'circles seen face-on: the wall plane');
  assert.ok(s.speed.lo < s.speed.mid && s.speed.mid < s.speed.hi && s.seconds > 50);
  assert.ok(s.tempo && s.tempo.lo < 60 && s.tempo.hi > 100, 'the slow and the fast turning are both in the tempo range');
  assert.equal(s.curve.length, P.BINS);
  assert.ok(Math.max(...s.curve) > 0.85 && Math.min(...s.curve) < 0.4, 'the energy over the session rises and falls with the performance');
  assert.ok(s.view.reach > 0.05 && s.view.reach < 0.3 && s.view.gap === 0);
  const staff = learned(repeat([{ secs: 8, way: 'staff', f: 0.6, k: 0.9 }, { secs: 8, way: 'staff', f: 1.4, k: 1 }, { secs: 3, way: 'rest' }], 3), { src: 'light', seed: 4 });
  assert.equal(staff.got.prop, 'staff', 'two lights that turn and keep their distance are the ends of a staff');
  assert.ok(staff.c.axis && !poi.c.axis);
  const hands = learned(repeat(GENTLE, 3), { seed: 5 });
  s = hands.got.stats;
  assert.equal(hands.got.prop, 'hands'); assert.equal(s.view.kind, 'hand');
  assert.ok(s.speed.hi < 0.6 * poi.got.stats.speed.hi, 'a gentle person is known as one');
  // lines up and down are no circles
  const line = learned(repeat([{ secs: 10, way: 'line', f: 1.2, k: 1 }, { secs: 2, way: 'rest' }], 3), { seed: 6 });
  assert.ok(line.got.stats.planes.wheel > 0.8 && line.got.stats.round < 0.2 && line.got.stats.turn.share < 0.3);
  // a performer who is out of sight now and then: the profile knows for how long
  const hides = learned(repeat([{ secs: 9, way: 'poi', f: 1.2, k: 1 }, { secs: 3, way: 'rest', gone: true }], 4), { src: 'light', seed: 7 });
  assert.ok(Math.abs(hides.got.stats.view.gap - 3) < 0.2, `out of sight for ${hides.got.stats.view.gap} s at a time`);
  assert.ok(hides.c.auto.hold > 6 && hides.c.auto.hold <= 8 && poi.c.auto.hold === 3.75 && hands.c.auto.hold === 2.5, 'the automatic waits as long as this person needs');
});

test('a profile is numbers and the name the user chose – nothing of a picture, and small', () => {
  const { profile } = learned(repeat(GENTLE, 3), { seed: 5 }, 'Anna – Poi');
  assert.deepEqual(Object.keys(profile).sort(), ['figures', 'format', 'name', 'prop', 'stats', 'version']);
  const texts = [];
  (function walk(x) { if (typeof x === 'string') texts.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); else assert.ok(x === null || Number.isFinite(x), 'a number'); })(profile);
  assert.ok(texts.every(t => t.length <= 32), 'no long text');
  assert.deepEqual([...new Set(texts)].sort(), ['Anna – Poi', P.FORMAT, 'hand', 'hands', ...new Set(profile.figures.map(f => f.tpl.hands))].sort());
  assert.ok(JSON.stringify(profile).length < 8000);
});

test('too little to learn from says so: no session, nobody in it, too short', () => {
  assert.equal(P.learn(null).why, 'nosession'); assert.equal(P.learn({ format: 'dream-dance', version: 1, frames: 'x' }).why, 'nosession');
  assert.equal(P.learn(session(perform([{ secs: 20, way: 'rest', gone: true }]))).why, 'nobody');
  const brief = P.learn(session(perform([{ secs: 8, way: 'fans', f: 1, k: 1 }])));
  assert.equal(brief.why, 'short'); assert.ok(brief.seconds > 6 && brief.seconds < P.MIN_SECONDS);
  assert.equal(P.learn(session(perform([{ secs: 40, way: 'rest' }], { jitter: 0 }))).why, 'short', 'standing is no movement');
});

test('a figure the person comes back to is known again – larger, elsewhere, on another day – and nothing else is taken for it', () => {
  const plan = [{ secs: 7, way: 'gentle', f: 0.45, k: 0.8, label: 'calm' }, { secs: 8, way: 'eight', f: 1.5, k: 1, label: 'eight' }, { secs: 3, way: 'rest' }];
  const { profile, c } = learned(repeat(plan, 3), { seed: 11 });
  assert.ok(profile.figures.length >= 1 && profile.figures.length <= P.MAX_FIGURES && profile.figures.every(f => MV.usable(f.tpl) && f.share > 0));
  assert.deepEqual(c.figures.map(f => f.id), profile.figures.map((_, i) => 'fig' + (i + 1)));
  const show = perform(repeat([{ secs: 7, way: 'gentle', f: 0.45, k: 0.8, label: 'calm' }, { secs: 8, way: 'eight', f: 1.4, k: 1.15, label: 'eight' }, { secs: 6, way: 'line', f: 1.2, k: 1, label: 'line' }], 2), OTHER_DAY);
  const fitted = play(show, c), without = play(show, null);
  const hit = share(fitted, 'eight', o => (o['fx.mandala'] || 0) >= 0.5, 3), calm = share(fitted, 'calm', o => (o['fx.mandala'] || 0) < 0.2, 1.5), line = share(fitted, 'line', o => (o['fx.mandala'] || 0) < 0.2, 1.5);
  assert.ok(hit >= 0.9, `the figure is answered in ${(hit * 100).toFixed(0)} % of its frames`);
  assert.ok(calm >= 0.98 && line >= 0.98, `other movement is not taken for it (calm ${(calm * 100).toFixed(0)} %, lines ${(line * 100).toFixed(0)} %)`);
  assert.equal(share(without, 'eight', o => (o['fx.mandala'] || 0) > 0, 0), 0, 'without a profile there is no such source');
});

test('how round the prop’s path is: a circle seen face-on, a line – and a staff is read from the line between its ends', () => {
  const plan = [{ secs: 8, way: 'poi', f: 1.2, k: 1, label: 'circle' }, { secs: 8, way: 'line', f: 1.2, k: 1, label: 'line' }];
  const { c } = learned(repeat(plan, 3), { src: 'light', seed: 3 });
  const outs = play(perform(repeat(plan, 2), { ...OTHER_DAY, src: 'light' }), c);
  assert.ok(share(outs, 'circle', o => (o['fx.kaleido'] || 0) >= 0.6) >= 0.9 && share(outs, 'line', o => (o['fx.kaleido'] || 0) <= 0.25) >= 0.9);
  assert.equal(P.roundness([[0, 0], [1, 1]]).round, 0, 'too few points say nothing');
  const circle = Array.from({ length: 30 }, (_, i) => [Math.cos(i / 30 * 6.283), Math.sin(i / 30 * 6.283)]), up = Array.from({ length: 30 }, (_, i) => [0.01 * Math.sin(i), Math.sin(i / 30 * 6.283)]);
  assert.ok(P.roundness(circle).round > 0.95 && Math.abs(P.roundness(circle).size - 1) < 0.05);
  assert.ok(P.roundness(up).round < 0.05 && Math.abs(Math.abs(P.roundness(up).ang) - Math.PI / 2) < 0.05);
});

test('the fitter: without a profile the record passes untouched; with one it is a new record in the person’s ranges', () => {
  const { c } = learned(repeat(BIG, 3), { seed: 3 }), det = D.create(), fit = P.create();
  let rec; for (const f of perform([{ secs: 4, way: 'fans', f: 0.9, k: 0.9 }], OTHER_DAY)) rec = det.step(f);
  assert.equal(fit.fit(rec), rec); assert.equal(fit.fit(null), null);
  fit.set(c);
  const before = JSON.stringify(rec), out = fit.fit(rec);
  assert.equal(JSON.stringify(rec), before, 'the stream’s record is not changed');
  assert.equal(out.fit, 'p0a1b2c3d'); assert.equal(out.t, rec.t); assert.equal(out.hands, rec.hands);
  assert.ok(rec.v.energy > 0.8 && out.v.energy < 0.6 && out.v.energy > 0.2, `calm for this person: ${rec.v.energy} → ${out.v.energy}`);
  for (const k of ['energy', 'open', 'height', 'tempo', 'round', 'figure']) assert.ok(out.v[k] >= 0 && out.v[k] <= 1, k);
  assert.ok(out.v.turn >= -1 && out.v.turn <= 1);
  assert.equal(out.c.energy, rec.c.energy, 'how sure a value is stays what the stream said');
  // a value the stream does not know stays unknown
  const blind = fit.fit({ ...rec, c: { ...rec.c, energy: 0, open: 0, height: 0, turn: 0 }, hands: { l: null, r: null } });
  assert.equal(blind.v.energy, rec.v.energy); assert.equal(blind.v.open, rec.v.open);
  fit.set(null); assert.equal(fit.fit(rec), rec);
  // a session played back has no uncut speed: the energy is scaled by what the person's energy reached
  fit.set({ ...c, energy: 0.5 });
  assert.equal(fit.fit({ ...rec, raw: undefined, v: { ...rec.v, energy: 0.25 } }).v.energy, 0.5);
});

test('the engine works the room’s stillness out of a fitted record: a gentle person who moves is not "still"', () => {
  const { c } = learned(repeat(GENTLE, 3), { seed: 5 });
  const still = fitted => {
    const det = D.create(), fit = P.create(), mover = Move.create({ maps: M }); fit.set(fitted);
    let sum = 0, n = 0, was = 0;
    for (const f of perform([{ secs: 10, way: 'gentle', f: 0.45, k: 0.5 }], { ...OTHER_DAY, jitter: 0.0005 })) {
      mover.step({ mode: 'flowtrack', tables: { flowtrack: TABLE }, rec: fit.fit(det.step(f)), dt: Math.max(1e-3, f.t - was) }); was = f.t;
      if (f.t > 3) { sum += mover.frame.v.still; n++; }
    }
    return sum / n;
  };
  const without = still(null), fitted = still(c);
  assert.ok(without > 0.25 && fitted < 0.5 * without, `stillness while moving a little: ${without.toFixed(2)} without, ${fitted.toFixed(2)} with the profile`);
});

test('a table for the person: the instant rows’ smoothing follows their tempo, the kept table stays', () => {
  const slow = { smooth: 1.25 }, table = [row('a', 'energy', 'fx.trails', 0, 1, 0.2), row('b', 'energy', 'ai.strength', 0, 1, 1.5), row('c', 'pulse', 'fx.pulse', 0, 1, 0)];
  const out = P.rows(slow, table);
  assert.deepEqual(out.map(r => r.smooth), [0.25, 1.5, 0]); assert.equal(table[0].smooth, 0.2);
  assert.equal(P.rows(null, table), table); assert.equal(P.rows({ smooth: 1 }, table), table);
  const quick = learned(repeat([{ secs: 10, way: 'line', f: 2.6, k: 0.8 }, { secs: 2, way: 'rest' }], 3), { seed: 2 }).c, calm = learned(repeat([{ secs: 10, way: 'line', f: 0.95, k: 1 }, { secs: 2, way: 'rest' }], 3), { seed: 2 }).c;
  assert.ok(quick.smooth < 0.75 && quick.smooth >= 0.6 && calm.smooth > 1.05 && calm.smooth <= 1.25, `quick ${quick.smooth}, calm ${calm.smooth}`);
});

test('what is no profile is refused (fail closed)', () => {
  const { profile } = learned(repeat(GENTLE, 3), { seed: 5 });
  const spoil = ch => { const p = JSON.parse(JSON.stringify(profile)); ch(p); return p; };
  assert.ok(P.usable(profile) && P.compile(profile, 'p1'));
  for (const bad of [null, {}, spoil(p => { p.format = 'dream-dance'; }), spoil(p => { p.version = 2; }), spoil(p => { p.name = '<img src=x>'; }), spoil(p => { p.name = ''; }),
    spoil(p => { p.name = 'x'.repeat(33); }), spoil(p => { p.prop = 'sword'; }), spoil(p => { p.prop = 'constructor'; }), spoil(p => { p.stats.speed.hi = 'fast'; }), spoil(p => { p.stats.speed.hi = null; }),
    spoil(p => { p.stats.curve = [1, 2]; }), spoil(p => { p.stats.curve[3] = 'data:image/png;base64,AAAA'; }), spoil(p => { p.stats.view.kind = 'x'; }), spoil(p => { p.stats.open = { lo: 0, hi: 7 }; }),
    spoil(p => { p.figures = [{ tpl: { v: 1 } }]; }), spoil(p => { p.figures = Array(4).fill(p.figures[0] || { tpl: null }); }), spoil(p => { delete p.stats; }), spoil(p => { p.stats.tempo = { lo: 1, mid: 60, hi: 90 }; })]) {
    assert.equal(P.usable(bad), false); assert.equal(P.compile(bad, 'p1'), null);
  }
  assert.equal(P.compile(profile, ''), null);
  assert.equal(P.profile('  Ben   –  Stab ', 'sword', { stats: profile.stats, figures: [] }).name, 'Ben – Stab');
  assert.equal(P.profile('x', 'sword', { stats: profile.stats, figures: [] }).prop, 'other');
  for (const name of ['Anna – Poi', 'Ben - Stab', 'Zoë O\'Neil 2']) assert.ok(P.NAME.test(name), name);
});
