// #266: measuring a dancer – the bounds from a recording of the simulated dancer, the fallback to the standard measures,
// and the engine reading the dance through the profile in use (the rules stay).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { frames } from './dance-sim.mjs';

const require = createRequire(import.meta.url);
const D = require('../../static/dance.js');
const Map_ = require('../../static/dancemap.js');
const M = require('../../static/movement.js');
const C = require('../../static/dancecal.js');

const STD = { energy: [0.1, 0.8], open: [0.45, 0.95], turn: [0, 1], height: [0.55, 1] };   // danceprofiles.py STANDARD
// the row of the base movement "When I move a lot → the afterglow lasts longer" as dance.py compiles it (Standard)
const BASE_ROW = { id: 'base0', on: true, src: 'energy', dst: 'fx.trails', curve: 'soft', in: [0.1, 0.8], out: [0, 0.675], smooth: 0.25, origin: 'slot' };

// a recording of the measuring: each step a move of the simulated dancer, the stream's records as the page reads them
function record(wild = { bpm: 140, size: 1 }) {
  const moves = { calm: ['stand', {}], wild: ['throw', wild], closed: ['closed', {}], open: ['wide', {}], up: ['up', {}], turn: ['circle', { bpm: 70 }] };
  const tk = C.take();
  for (const s of C.STEPS) {
    const d = D.create(), [m, o] = moves[s.k];
    frames(m, { seconds: s.secs, jitter: 0.002, seed: 3, ...o }).forEach((f, i) => {
      const r = d.step(f);
      tk.add(s.k, i / 30, { v: r.v, c: r.c, seen: true });
    });
  }
  return tk.samples;
}

test('the bounds come from what the dancer showed: calm below, wild above, for every base movement', () => {
  const got = C.bounds(record(), STD);
  assert.equal(got.ok, true);
  for (const f of C.FEATURES) {
    assert.equal(got.why[f], null, f);
    const [lo, hi] = got.bounds[f];
    assert.ok(lo >= 0 && hi <= 1 && hi - lo >= 0.08, `${f}: ${lo} … ${hi}`);
  }
  // the detector's own unrest while standing still is the dancer's calm – it does not set anything off any more
  assert.ok(got.bounds.energy[0] > 0.1 && got.bounds.energy[0] < 0.4 && got.bounds.energy[1] > 0.8, String(got.bounds.energy));
  assert.ok(got.bounds.open[0] < 0.2 && got.bounds.open[1] > 0.9 && got.bounds.height[1] > 0.9 && got.bounds.turn[1] > 0.4);
  // a gentler dancer: their wild is lower – and that is their 100 %
  const soft = C.bounds(record({ bpm: 90, size: 0.5 }), STD);
  assert.ok(soft.bounds.energy[1] < 0.6 && soft.bounds.energy[1] > 0.3, String(soft.bounds.energy));
});

test('a step counts only after its first moments, at most thirty a second, and only what the stream is sure of', () => {
  const tk = C.take();
  assert.equal(tk.add('calm', 0.5, { v: { energy: 0.1 }, c: { energy: 1 } }), false);          // getting there
  assert.equal(tk.add('calm', C.SETTLE, { v: { energy: 0.1, open: 0.5 }, c: { energy: 1, open: 0.1 } }), true);
  assert.equal(tk.add('calm', C.SETTLE + 0.01, { v: { energy: 0.2 }, c: { energy: 1 } }), false);   // too soon
  assert.equal(tk.add('nowhere', 3, { v: {}, c: {} }), false);
  assert.deepEqual(tk.samples.calm, [{ energy: 0.1, open: null, turn: null, height: null }]);   // the unsure opening does not count
});

test('what is not measured well keeps the standard measures', () => {
  const none = C.bounds(C.take().samples, STD);
  assert.equal(none.ok, false);
  assert.deepEqual(none.bounds, STD);
  assert.deepEqual(Object.values(none.why), ['unseen', 'unseen', 'unseen', 'unseen']);
  // calm and wild alike: too narrow to act – the standard stays for that one, the rest is measured
  const s = record();
  s.wild = s.calm.map(x => ({ ...x }));
  const got = C.bounds(s, STD);
  assert.equal(got.why.energy, 'narrow');
  assert.deepEqual(got.bounds.energy, STD.energy);
  assert.equal(got.why.open, null);
  assert.equal(C.quantile([3, 1, 2], 0.5), 2);
  assert.ok(Math.abs(C.percent(0.45, [0.1, 0.8], 'energy') - 0.5) < 1e-9);
  assert.equal(C.percent(-0.6, [0.2, 0.6], 'turn'), 1);
  assert.equal(C.nameProblem('Kim'), null);
  assert.equal(C.nameProblem('../x'), 'chars');
});

test('the profile reads the frame before the rows: the dancer\'s calm is 0 %, their wild 100 % – turning either way', () => {
  const cal = Map_.calOf({ energy: [0.05, 0.4], open: [0.45, 0.95], turn: [0.1, 0.5], height: [0.2, 0.8] }, STD);
  assert.deepEqual(Object.keys(cal).sort(), ['energy', 'height', 'turn']);            // measured as the standard: not read anew
  assert.equal(Map_.calOf(null, STD), null);
  const f = { v: { energy: 0.4, turn: -0.5, height: 0.2, open: 0.7, 'g.throw': 0.9 }, c: {} };
  const g = Map_.calibrate(f, cal);
  assert.equal(g.v.energy, 0.8);                                               // their wild is the standard's wild
  assert.equal(g.v.turn, -1);                                                  // the way it turns stays
  assert.equal(g.v.height, 0.55);                                              // their calm is the standard's calm
  assert.equal(g.v.open, 0.7);
  assert.equal(g.v['g.throw'], 0.9);                                           // gestures as the stream says
  assert.equal(Map_.calibrate(f, null), f);
  assert.ok(Map_.calibrate({ v: { energy: 0.01 } }, cal).v.energy < STD.energy[0]);   // below their calm: below the standard calm …
  assert.equal(Map_.shape(BASE_ROW, Map_.calibrate({ v: { energy: 0.01 } }, cal).v.energy, 1), 0);   // … the sentence rests
  assert.equal(Map_.calibrate({ v: { energy: 0 } }, { energy: { from: [0.3, 0.5], to: [0.1, 0.8] } }).v.energy, 0);   // held inside the feature's range
  assert.equal(f.v.energy, 0.4);                                               // the stream's record is not changed
});

test('in the engine: a gentle dancer reaches the full effect with their measures – only in the dance, the rules stay', () => {
  const measured = C.bounds(record({ bpm: 90, size: 0.5 }), STD).bounds, cal = Map_.calOf(measured, STD);
  const d = D.create(), recs = frames('throw', { bpm: 90, size: 0.5, seconds: 6, jitter: 0.002, seed: 4 }).map(f => d.step(f));
  const run = (c, mode = 'dance') => {
    const eng = M.create({ maps: Map_ });
    let out = {};
    for (const rec of recs) out = eng.step({ mode, tables: { dance: [BASE_ROW], mood: [BASE_ROW] }, rec, cal: c, dt: 1 / 30 });
    return out['fx.trails'] || 0;
  };
  const plain = run(null), mine = run(cal);
  assert.ok(mine > 0.8 * BASE_ROW.out[1] && mine > plain + 0.1, `standard ${plain.toFixed(3)} → measured ${mine.toFixed(3)}`);
  assert.equal(run(cal, 'mood'), run(null, 'mood'));                           // the mood reads the frame as it is
  // the groups still apply: of two symmetries only one acts strongly, with the profile as without it
  const two = [{ ...BASE_ROW, dst: 'fx.kaleido' }, { ...BASE_ROW, id: 'base1', dst: 'fx.mandala' }];
  const eng = M.create({ maps: Map_ });
  let out = {};
  for (const rec of recs) out = eng.step({ mode: 'dance', tables: { dance: two }, rec, cal, dt: 1 / 30 });
  assert.ok(Math.min(out['fx.kaleido'], out['fx.mandala']) <= Map_.RULES.WEAK + 1e-6, JSON.stringify(out));
});

test('the demo figure: a skeleton for every step, with both arms in two parts; nothing for anything else', () => {
  for (const s of C.STEPS) {
    const svg = C.figure(s.k);
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/, s.k);
    assert.equal((svg.match(/class="dcf-up"/g) || []).length, 2, s.k);
    assert.equal((svg.match(/class="dcf-fore"/g) || []).length, 2, s.k);
    assert.match(svg, /class="dcf-r" transform="translate\(6 -10\) scale\(-1 1\)"/, s.k);   // the right arm: the left mirrored
  }
  assert.doesNotMatch(C.figure('calm'), /dcf-sign/);   // standing still needs no sign
  for (const k of ['wild', 'closed', 'open', 'up', 'turn']) assert.match(C.figure(k), /class="dcf-sign"/, k);
  assert.equal(C.figure('result'), '');
  assert.equal(C.figure(''), '');
});
