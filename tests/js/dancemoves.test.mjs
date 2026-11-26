// #236: moves of one's own (static/dancemoves.js, recognised by static/dance.js) on synthetic trajectories – no camera,
// no model, no browser. Run: node --test tests/js/dancemoves.test.mjs   (the CI runs it too)
// A simulated dancer (dance-sim.mjs) teaches four moves that are no built-in gesture – each from one take of a few
// repetitions, with jitter and a wandering tempo – and then dances them in many variants (size, tempo, place and size
// of the body in the picture, jitter, frame rate). The hit rate, the false alarms on things that are no dance, and the
// built-in gestures beside the taught ones are counted and must stay where they are – as for the built-in gestures
// (dance.test.mjs).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { frames, play, verdict, MOVES, NOT_MOVES, OWN_MOVES } from './dance-sim.mjs';

const require = createRequire(import.meta.url);
const D = require('../../static/dance.js'), MV = require('../../static/dancemoves.js');
const last = a => a[a.length - 1];

// a take: what the stream says of the hands while the dancer shows the move
const takeOf = (move, o = {}) => play(D.create(), frames(move, { bpm: 100, seconds: 6, jitter: 0.003, wobble: 0.03, seed: 5, ...o })).map(x => ({ t: x.t, l: x.hands.l, r: x.hands.r }));
function teach(move, o) {
  const g = MV.grid(takeOf(move, o)), seg = MV.segment(g);
  assert.equal(seg.why, null, `${move}: ${seg.why}`);
  const tpl = MV.template(g, seg.reps, seg.hands);
  return { g, seg, tpl, c: MV.compile(tpl, 'm_' + move) };
}
const TAUGHT = Object.fromEntries(Object.keys(OWN_MOVES).map(m => [m, teach(m)]));
const dancer = (only = Object.keys(OWN_MOVES)) => { const d = D.create(); d.setMoves(only.map(m => TAUGHT[m].c)); return d; };

function variants(fn) {
  let n = 0;
  for (const size of [0.8, 1, 1.25]) for (const bpm of [85, 100, 118]) for (const S of [0.06, 0.1, 0.16]) for (const jitter of [0, 0.004]) for (const fps of [30, 60]) {
    fn({ size, bpm, S, jitter: jitter * S / 0.1, fps, seed: ++n, wobble: 0.03, at: [0.3 + 0.4 * ((n * 7) % 10) / 10, 0.35 + 0.1 * (n % 3)] });
  }
}

test('a take is cut into its repetitions: the period, three to five of them, the hands it is made with', () => {
  for (const [move, t] of Object.entries(TAUGHT)) {
    assert.ok(Math.abs(t.seg.period - 0.6) < 0.02, `${move}: period ${t.seg.period}`);
    assert.equal(t.seg.reps.length, MV.MAX_REPS); assert.ok(t.seg.count >= 8, `${move}: ${t.seg.count} found in six seconds`);
    assert.equal(t.seg.hands, 'lr');
    t.seg.reps.forEach((r, i) => { assert.ok(Math.abs(r.t1 - r.t0 - t.seg.period) < 1e-6); if (i) assert.ok(Math.abs(r.t0 - t.seg.reps[i - 1].t1) < 1e-6, 'one after the other'); });
    assert.ok(MV.usable(t.tpl) && t.tpl.pts.length === MV.M && t.tpl.tol < 0.3, `${move}: tolerance ${t.tpl.tol}`);
  }
  // a few repetitions are enough, and the standing before and after them is no part of the move
  const short = [...takeOf('stand', { seconds: 1.5 }), ...takeOf('drum', { seconds: 2.1, from: 1.5 }), ...takeOf('stand', { seconds: 1.5, from: 3.6 })];
  const seg = MV.segment(MV.grid(short));
  assert.equal(seg.why, null); assert.equal(seg.reps.length, 3); assert.ok(Math.abs(seg.period - 0.6) < 0.03);
  assert.ok(seg.reps[0].t0 >= 1.4 && last(seg.reps).t1 <= 3.7, `${seg.reps[0].t0} … ${last(seg.reps).t1}`);
  // one hand alone: the move is that hand's
  assert.equal(MV.segment(MV.grid(takeOf('arc', { only: 'r' }))).hands, 'r');
});

test('a take that is no move says why: too short, no hands, hardly any movement, no repetition, too few', () => {
  const why = s => MV.segment(MV.grid(s)).why;
  assert.equal(why([]), 'short');
  assert.equal(why(takeOf('drum', { seconds: 0.5 })), 'short');
  assert.equal(why(takeOf('drum').map(s => ({ t: s.t, l: null, r: null }))), 'nohands');
  assert.equal(why(takeOf('stand')), 'small');
  assert.equal(why(takeOf('sway')), 'small');
  assert.equal(why(takeOf('reach')), 'norhythm');
  assert.equal(why(takeOf('talk', { seconds: 8 })), 'norhythm');
  const few = MV.segment(MV.grid([...takeOf('stand', { seconds: 2 }), ...takeOf('drum', { seconds: 1.5, from: 2 }), ...takeOf('stand', { seconds: 2, from: 3.5 })]));
  assert.equal(few.why, 'few'); assert.equal(few.count, 2);
});

test('a repetition can be thrown away: the template is the mean of the ones that are left', () => {
  const t = TAUGHT.eight, less = MV.template(t.g, t.seg.reps.slice(1, 4), t.seg.hands);
  assert.ok(MV.usable(less));
  const far = Math.max(...less.pts.flatMap((p, i) => p.map((x, k) => Math.abs(x - t.tpl.pts[i][k]))));
  assert.ok(far < 0.12, `the same move from three of its repetitions (${far})`);
  assert.equal(MV.template(t.g, [], t.seg.hands), null);
});

test('what is no template is not used (fail closed)', () => {
  const ok = TAUGHT.drum.tpl;
  for (const bad of [null, {}, { ...ok, v: 2 }, { ...ok, hands: 'x' }, { ...ok, period: 9 }, { ...ok, pts: ok.pts.slice(1) }, { ...ok, pts: ok.pts.map(p => p.map(() => NaN)) }, { ...ok, pts: ok.pts.map(() => [0, 0, 0, 0]) }, { ...ok, tol: 'a' }]) {
    assert.equal(MV.compile(bad, 'm1'), null);
  }
  assert.equal(MV.compile(ok, ''), null);
  const d = D.create(); d.setMoves([null, { id: 'throw', pts: [] }, { id: 7 }, TAUGHT.drum.c]);
  assert.deepEqual(Object.keys(last(play(d, frames('stand', { seconds: 1 }))).g), [...D.GESTURES, 'm_drum'], 'no built-in name, nothing broken');
});

test('every taught move is recognised in its variants: hit rate, and how soon', () => {
  for (const move of Object.keys(OWN_MOVES)) {
    let hit = 0, n = 0, at = 0;
    variants(o => { const v = verdict(play(dancer(), frames(move, o)), 'm_' + move, 4); n++; if (v.hit) { hit++; at += v.at; } });
    console.log(`  ${move}: ${hit}/${n} recognised, after ${(at / hit).toFixed(2)} s on average`);
    assert.ok(hit / n >= 0.97, `${move}: hit rate ${(hit / n).toFixed(3)}`);
    assert.ok(at / hit < 2.5, `${move}: recognised after ${(at / hit).toFixed(2)} s`);
  }
});

test('walking, waving, talking hands, a single reach, swaying and standing set no taught move off: false alarms', () => {
  for (const move of Object.keys(NOT_MOVES)) {
    let alarms = 0, n = 0;
    for (const S of [0.06, 0.1, 0.16]) for (const jitter of [0, 0.004, 0.008]) for (const fps of [30, 60]) for (const seed of [1, 2, 3]) {
      n++; if (play(dancer(), frames(move, { S, jitter: jitter * S / 0.1, fps, seed: seed * 17 + n, seconds: 10 })).some(o => o.gesture)) alarms++;
    }
    console.log(`  ${move}: ${alarms}/${n} false alarms`);
    assert.equal(alarms, 0, `${move}: ${alarms} false alarms in ${n}`);
  }
});

test('the built-in gestures stay what they are beside the taught moves', () => {
  for (const move of Object.keys(MOVES)) {
    let hit = 0, n = 0;
    variants(o => { n++; if (verdict(play(dancer(), frames(move, o)), move).hit) hit++; });
    assert.ok(hit / n >= 0.97, `${move} with four taught moves: ${hit}/${n}`);
  }
});

test('a taught move needs repetitions to come, and goes with hysteresis – no flicker', () => {
  const d = dancer(), a = play(d, frames('drum', { bpm: 100, seconds: 6 }));
  const first = a.find(o => o.gesture === 'm_drum');
  assert.ok(first.t >= 2 * 0.6 - 0.1, `not before two repetitions (${first.t.toFixed(2)} s)`);
  const b = play(d, frames('stand', { seconds: 4, from: 6 })), ev = [...a, ...b].flatMap(o => o.events);
  assert.equal(ev.filter(e => e === 'gesture:m_drum').length, 1); assert.equal(ev.filter(e => e === 'end:m_drum').length, 1);
  assert.ok(b.find(o => !o.gesture).t - 6 < 1.5); assert.equal(last(b).gesture, null);
  // one swing of it is not the move
  assert.ok(!play(dancer(), [...frames('drum', { seconds: 0.7 }), ...frames('stand', { seconds: 4, from: 0.7 })]).some(o => o.gesture));
});

test('size becomes strength: as large as taught is all of it, smaller is less; far too small is not the move', () => {
  const at = size => last(play(dancer(), frames('drum', { size, seconds: 6 })));
  const small = at(0.65), taught = at(1), large = at(1.3);
  assert.equal(taught.gesture, 'm_drum'); assert.ok(taught.v['g.m_drum'] > 0.9, String(taught.v['g.m_drum']));
  assert.ok(small.v['g.m_drum'] > 0.4 && small.v['g.m_drum'] < taught.v['g.m_drum'] - 0.2, `${small.v['g.m_drum']} → ${taught.v['g.m_drum']}`);
  assert.equal(large.v['g.m_drum'], 1); assert.ok(taught.c['g.m_drum'] >= 0.6);
  assert.equal(at(0.3).gesture, null);
  assert.equal(taught.v['g.m_eight'], 0);
});

test('tolerance has an end: the other way round, at double tempo, a shoulder width higher – not the move', () => {
  const sure = (o, mod = f => f) => Math.max(...play(dancer(['drum']), frames('drum', { seconds: 7, ...o }).map(mod)).map(x => x.g.m_drum));
  assert.ok(sure({}) > 0.9);
  // the hands swapped: the left a quarter behind the right
  assert.ok(sure({}, f => ({ ...f, hands: { l: { ...f.hands.r, x: f.hands.l.x }, r: { ...f.hands.l, x: f.hands.r.x } } })) < 0.35, 'swapped hands');
  assert.ok(sure({ bpm: 200 }) < 0.35, 'double tempo');
  assert.ok(sure({ bpm: 50 }) < 0.35, 'half tempo');
  assert.ok(sure({}, f => ({ ...f, hands: { l: { ...f.hands.l, y: f.hands.l.y - 0.15 }, r: { ...f.hands.r, y: f.hands.r.y - 0.15 } } })) < 0.35, 'one and a half shoulder widths higher');
});

test('a move taught with one hand is that hand’s: the other may do what it likes, and without the hand there is no move', () => {
  const t = teach('arc', { only: 'r' }), one = MV.compile(t.tpl, 'm_one');
  const d = () => { const x = D.create(); x.setMoves([one]); return x; };
  assert.equal(last(play(d(), frames('arc', { seconds: 6, only: 'r', seed: 3 }))).gesture, 'm_one');
  assert.equal(last(play(d(), frames('arc', { seconds: 6, seed: 4 }))).gesture, 'm_one', 'the left hand is there too');
  assert.ok(!play(d(), frames('arc', { seconds: 6, only: 'l' })).some(o => o.gesture === 'm_one'));
});

test('a taught move that looks like a built-in gesture goes before it; taking the moves away gives the gesture back', () => {
  const t = teach('throw'), mine = MV.compile(t.tpl, 'm_mine'), d = D.create(); d.setMoves([mine]);
  const a = play(d, frames('throw', { seconds: 6, seed: 2 }));
  assert.equal(last(a).gesture, 'm_mine'); assert.ok(last(a).g.throw < 0.35);
  d.setMoves([]);
  const b = play(d, frames('throw', { seconds: 4, from: 6, seed: 2 }));
  assert.equal(b[0].gesture, null, 'the move that is gone is off at once'); assert.equal(last(b).gesture, 'throw');
  assert.ok(!('m_mine' in last(b).g) && !('g.m_mine' in last(b).v));
});

test('markers alone (no skeleton): a move taught with markers is recognised with markers', () => {
  const t = teach('eight', { noBody: true, src: 'marker', seconds: 9 }), c = MV.compile(t.tpl, 'm_mk');
  let hit = 0, n = 0;
  for (const size of [0.85, 1, 1.2]) for (const bpm of [88, 100, 114]) for (const S of [0.06, 0.1, 0.16]) {
    const d = D.create(); d.setMoves([c]); n++;
    if (verdict(play(d, frames('eight', { size, bpm, S, seed: n, seconds: 9, noBody: true, src: 'marker' })), 'm_mk', 6).hit) hit++;
  }
  console.log(`  eight (markers): ${hit}/${n}`);
  assert.ok(hit / n >= 0.9, `${hit}/${n}`);
});

test('matching is cheap: a look at two dozen moves takes a millisecond or two', () => {
  const d = D.create(); d.setMoves(Array.from({ length: D.MAX_MOVES }, (_, i) => MV.compile(TAUGHT[Object.keys(OWN_MOVES)[i % 4]].tpl, 'm' + i)));
  const fr = frames('drum', { seconds: 20 }), t0 = performance.now(); play(d, fr);
  const perLook = (performance.now() - t0) / (20 * 15);
  console.log(`  ${perLook.toFixed(3)} ms a look with ${D.MAX_MOVES} moves`);
  assert.ok(perLook < 4, `${perLook} ms`);
});
