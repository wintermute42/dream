// #267: base movements of one's own (static/dancefaders.js, read by static/dance.js) on synthetic bodies – no camera,
// no model, no browser. Run: node --test tests/js/dancefaders.test.mjs   (the CI runs it too)
// A simulated dancer (dance-sim.mjs) shows the states of a fader – upright ↔ deep in the knees, leaning left ↔ right
// with a step between – swaying a little and with the pose model's jitter, and then moves between them in other
// places and sizes in the picture: the fader must follow, stay still while the dancer holds still, and stay out of
// what it was not taught.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pose, poseFrames, rng } from './dance-sim.mjs';

const require = createRequire(import.meta.url);
const F = require('../../static/dancefaders.js'), D = require('../../static/dance.js'), R = require('../../static/dancerec.js');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

// what the page takes while the dancer holds each state: two seconds of frames, swaying a little
function show(states, { jitter = 0.003, seed = 1, S = 0.1, at = [0.5, 0.35], hands = false, noPose = false } = {}) {
  const rnd = rng(seed), out = [];
  states.forEach(([y, p], k) => {
    for (let i = 0; i < 60; i++) {
      const sway = { squat: 0.04 * Math.sin(i / 6 + k), lean: 0.06 * Math.sin(i / 9 + 2 * k), arms: 0.03 * Math.sin(i / 5) };
      const lm = pose({ squat: (p.squat || 0) + sway.squat, lean: (p.lean || 0) + sway.lean, arms: (p.arms || 0) + sway.arms }, { jitter, rnd, S, at });
      const h = hands ? { l: [(lm[15].x - 0.5) * 16 / 9 / S, (0.35 - lm[15].y) / S], r: [(lm[16].x - 0.5) * 16 / 9 / S, (0.35 - lm[16].y) / S] } : null;
      out.push({ ...F.features(noPose ? null : lm, h), y });
    }
  });
  return out;
}
const KNEES = [[0, { squat: 0 }], [1, { squat: 1 }]];
const LEAN = [[0, { lean: -1 }], [0.5, { lean: 0 }], [1, { lean: 1 }]];
// a detector that reads these faders
function reader(models) { const d = D.create(); d.setFaders(Object.entries(models).map(([id, m]) => F.compile(m, id))); return d; }
// the fader's value while the body holds a pose, after it settled (the stream's own smoothing): [values]
function holding(d, id, p, o = {}) {
  const outs = poseFrames(() => p, { seconds: 2, jitter: 0.004, seed: 7, ...o }).map(f => d.step(f));
  return outs.slice(20).map(r => r.v['f.' + id]);
}

test('a fader is learned from two shown states: the body values that change, weighted by how steady they were', () => {
  const md = F.fit(show(KNEES));
  assert.equal(md.why, undefined, md.why);
  assert.ok(F.usable(md));
  // the legs tell it, not the arms or the head
  assert.ok(md.keys.every(k => /^(knee|ankle)_/.test(k)), md.keys.join());
  const from = F.explain(md).map(x => x.part + x.axis);
  assert.ok(from.includes('feet↕') && from.includes('knees↕'), from.join());
  assert.ok(Math.abs(md.states[0].at) < 0.05 && Math.abs(md.states[1].at - 1) < 0.05, JSON.stringify(md.states));
  assert.ok(Math.abs(F.explain(md).reduce((a, x) => a + x.share, 0) - 1) < 0.02);
});

test('between the states the fader goes evenly – also further away, nearer, elsewhere in the picture', () => {
  const md = F.fit(show(KNEES)), c = F.compile(md, 'k'), rnd = rng(4);
  for (const [S, at] of [[0.1, [0.5, 0.35]], [0.06, [0.3, 0.3]], [0.13, [0.62, 0.25]]]) {
    let was = -1;
    for (const squat of [0, 0.25, 0.5, 0.75, 1]) {
      const v = mean(Array.from({ length: 30 }, () => F.read(c, F.features(pose({ squat }, { S, at, jitter: 0.002, rnd }), null)).value));
      assert.ok(Math.abs(v - squat) < 0.12, `S ${S}: squat ${squat} → ${v.toFixed(3)}`);
      assert.ok(v > was, 'rising'); was = v;
    }
  }
});

test('stable under noise: holding a state, the stream keeps the fader still – the jitter of the pose model does not show', () => {
  const md = F.fit(show(KNEES, { jitter: 0.004, seed: 3 })), d = reader({ fknees001: md });
  for (const [squat, jitter] of [[0, 0.004], [1, 0.004], [0.5, 0.004], [0, 0.008], [1, 0.008]]) {
    const vs = holding(d, 'fknees001', { squat }, { jitter, seed: 11 + jitter * 1e3 });
    const m = mean(vs), sd = Math.sqrt(mean(vs.map(v => (v - m) ** 2)));
    assert.ok(Math.abs(m - squat) < 0.1, `squat ${squat}, jitter ${jitter}: mean ${m.toFixed(3)}`);
    assert.ok(sd < 0.04 && Math.max(...vs) - Math.min(...vs) < 0.16, `squat ${squat}, jitter ${jitter}: sd ${sd.toFixed(3)}, range ${(Math.max(...vs) - Math.min(...vs)).toFixed(3)}`);
  }
});

test('steps between the states: a three-state fader for leaning, and two faders that keep out of each other', () => {
  const lean = F.fit(show(LEAN)), knees = F.fit(show(KNEES));
  assert.equal(lean.why, undefined, lean.why);
  assert.deepEqual(lean.states.map(s => s.y), [0, 0.5, 1]);
  assert.ok(lean.states.every(s => Math.abs(s.at - s.y) < 0.06), JSON.stringify(lean.states));
  const d = reader({ flean0001: lean, fknees001: knees });
  for (const [p, wantLean, wantKnees] of [[{ lean: -1 }, 0, 0], [{ lean: 0.5 }, 0.75, 0], [{ squat: 1 }, 0.5, 1], [{ squat: 1, lean: 1 }, 1, 1], [{ arms: 1 }, 0.5, 0]]) {
    const outs = poseFrames(() => p, { seconds: 2, jitter: 0.003, seed: 2 }).map(f => d.step(f)).slice(30);
    const l = mean(outs.map(r => r.v['f.flean0001'])), k = mean(outs.map(r => r.v['f.fknees001']));
    assert.ok(Math.abs(l - wantLean) < 0.15, `${JSON.stringify(p)}: lean ${l.toFixed(3)} (want ${wantLean})`);
    assert.ok(Math.abs(k - wantKnees) < 0.15, `${JSON.stringify(p)}: knees ${k.toFixed(3)} (want ${wantKnees})`);
  }
});

test('a fader that cannot tell its states apart is not made – and says why', () => {
  assert.equal(F.fit([]).why, 'states');
  assert.equal(F.fit(show([[0, {}]])).why, 'states');
  assert.equal(F.fit(show([[0, {}], [0.6, { squat: 1 }]])).why, 'states');          // 0 and 1 are the ends
  assert.equal(F.fit(show(KNEES).filter((s, i) => s.y === 0 || i % 10 === 0)).why, 'few');
  assert.equal(F.fit(show(KNEES, { noPose: true })).why, 'nobody');
  assert.equal(F.fit(show([[0, {}], [1, {}]])).why, 'same');                         // the same state twice
  assert.equal(F.fit(show([[0, {}], [1, { squat: 0.08 }]])).why, 'same');            // hardly any difference
  // the states overlap: half of each was really the other one
  const mixed = show(KNEES).map((s, i) => (i % 2 ? { ...s, y: 1 - s.y } : s));
  assert.ok(['unsteady', 'same'].includes(F.fit(mixed).why), F.fit(mixed).why);
});

test('with LED markers alone (no skeleton) a fader is read from the hands', () => {
  const ARMS = [[0, { arms: 0 }], [1, { arms: 1 }]];
  const md = F.fit(show(ARMS, { hands: true, noPose: true }));
  assert.equal(md.why, undefined, md.why);
  assert.ok(md.keys.every(k => k.startsWith('hand_')), md.keys.join());
  assert.deepEqual(F.explain(md).map(x => x.part + x.axis), ['hands↕']);
});

test('the stream: a fader is the continuous value "f.<id>" with its confidence – not known while nobody is seen', () => {
  const md = F.fit(show(KNEES)), d = reader({ fa1b2c3d4: md });
  const outs = poseFrames(t => ({ squat: t < 1 ? 0 : 1 }), { seconds: 2.5, jitter: 0.002 }).map(f => d.step(f));
  assert.ok(outs[20].v['f.fa1b2c3d4'] < 0.1 && outs[74].v['f.fa1b2c3d4'] > 0.9);
  assert.ok(outs[74].c['f.fa1b2c3d4'] > 0.9 && outs[74].src['f.fa1b2c3d4'] === 'pose');
  // the skeleton drops out for a moment: the value holds; for longer: not known (the sentence rests)
  const gone = { t: 2.6, hands: { l: null, r: null }, body: null, pose: null };
  assert.ok(d.step(gone).c['f.fa1b2c3d4'] > 0.9);
  assert.equal(d.step({ ...gone, t: 3.2 }).c['f.fa1b2c3d4'], 0);
  // the feet out of the picture (the model is not sure of them): the knees alone cannot carry it
  const noFeet = pose({ squat: 1 }, { hidden: [25, 26, 27, 28] });
  assert.deepEqual(F.read(F.compile(md, 'x'), F.features(noFeet, null)), { value: 0, c: 0 });
  // a fader that is gone is no longer in the record
  d.setFaders([]);
  assert.ok(!('f.fa1b2c3d4' in d.step({ ...gone, t: 3.25 }).v));
});

test('a session plays a fader back as it was danced: the skeleton kept for the stick figure is what it is read from', () => {
  const md = F.fit(show(KNEES)), live = reader({ fa1b2c3d4: md }), again = reader({ fa1b2c3d4: md });
  const keys = D.SOURCES;
  for (const f of poseFrames(t => ({ squat: Math.min(1, t / 2) }), { seconds: 2.5 })) {
    const rec = live.step(f), frame = R.pack(f.t, keys, rec, f, f.pose, {});
    const back = again.step(R.input(frame));
    assert.ok(Math.abs(back.v['f.fa1b2c3d4'] - rec.v['f.fa1b2c3d4']) < 0.03, `${f.t}: ${back.v['f.fa1b2c3d4']} ≠ ${rec.v['f.fa1b2c3d4']}`);
  }
});

test('what comes from a file is looked at before it is used (fail closed)', () => {
  const md = F.fit(show(KNEES));
  assert.ok(F.compile(md, 'fa'));
  for (const spoil of [m => { m.v = 2; }, m => { m.keys = ['knee_l.z']; m.m = [0]; m.w = [1]; m.share = [1]; }, m => { m.keys.push(m.keys[0]); m.m.push(0); m.w.push(0); m.share.push(0); },
    m => { m.w[0] = NaN; }, m => { m.w[0] = 1e9; }, m => { m.m.pop(); }, m => { m.share[0] = 2; }, m => { m.states = [m.states[0]]; }, m => { m.b = 'x'; },
    m => { m.states[0].y = -1; }, m => { m.keys = []; m.m = []; m.w = []; m.share = []; }]) {
    const bad = JSON.parse(JSON.stringify(md)); spoil(bad);
    assert.equal(F.usable(bad), false, spoil.toString());
    assert.equal(F.compile(bad, 'fa'), null);
  }
  assert.equal(F.compile(md, ''), null);
  assert.deepEqual(F.explain(null), []);
  assert.deepEqual(F.read(null, null), { value: 0, c: 0 });
});

test('the body values are the same everywhere: the page, the stream and Dream (dancefaders.py)', async () => {
  const { readFileSync } = await import('node:fs');
  const py = readFileSync(new URL('../../dancefaders.py', import.meta.url), 'utf8');
  const points = py.match(/POINTS = \(([^)]+)\)/)[1].match(/"([a-z_]+)"/g).map(s => s.slice(1, -1));
  assert.deepEqual(points, F.POINTS.map(p => p[0]));
  assert.ok(py.includes('KEYS = tuple(f"{p}.{a}" for p in POINTS for a in ("u", "v")) + ("tilt", "hand_l.u", "hand_l.v", "hand_r.u", "hand_r.v")'));
  assert.deepEqual(F.KEYS.slice(-5), ['tilt', 'hand_l.u', 'hand_l.v', 'hand_r.u', 'hand_r.v']);
  assert.ok(py.includes(`MAX_FADERS = ${D.MAX_FADERS}`) && py.includes(`MODEL = ${F.VERSION}`));
});
