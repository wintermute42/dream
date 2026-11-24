// #243: the dance lab's sessions (static/dancerec.js) – recording, playing back, the last seconds for a feedback,
// the test file. No browser, no camera: a simulated dancer (dance-sim.mjs) is recorded.
// Run: node --test tests/js/dancerec.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { frames, hand as paintedHand } from './dance-sim.mjs';

const require = createRequire(import.meta.url);
const D = require('../../static/dance.js'), M = require('../../static/dancemap.js'), R = require('../../static/dancerec.js'), L = require('../../static/dancelab.js');
const KEYS = D.SOURCES, MAP = [{ id: 't', on: true, src: 'g.throw', dst: 'fx.feedback', curve: 'lin', in: [0, 1], out: [0, 1], smooth: 0.1, origin: 'fixed' },
  { id: 'e', on: true, src: 'energy', dst: 'fx.trails', curve: 'soft', in: [0.1, 0.8], out: [0, 0.7], smooth: 0.2, origin: 'fixed' }];
// 33 pose points around the simulated body, so the stick figure has something to draw
const landmarks = f => Array.from({ length: 33 }, (_, i) => ({ x: f.body.x + (i === 15 ? f.hands.l.x - f.body.x : i === 16 ? f.hands.r.x - f.body.x : 0.01 * (i % 5)),
  y: f.body.y + (i === 15 ? f.hands.l.y - f.body.y : i === 16 ? f.hands.r.y - f.body.y : 0.02 * (i % 7)), visibility: 0.9 }));
// a hand of 21 points at a place in the picture, opening and closing – in picture heights, as the detection hands them over
const hand = (cx, cy, open) => paintedHand({ curl: 1 - open, at: [cx, cy] }).map(([x, y]) => [x * 16 / 9, y]);
// records what a detector makes of a list of simulated frames; marks: [[second, mark]]
function record(list, marks = [], withHands = false) {
  const d = D.create(), m = M.create(), rec = R.recorder(KEYS, MAP, 16 / 9), rng = R.ring(30), live = [];
  for (const f of list) {
    const inp = { ...f, aspect: 16 / 9, fingers: withHands ? { l: null, r: { pts: hand(f.hands.r.x, f.hands.r.y, 0.5 + 0.5 * Math.sin(f.t * 3)), c: 0.9 } } : undefined };
    const out = d.step(inp), tg = m.apply(MAP, out, 1 / 30), make = t => R.pack(t, KEYS, out, inp, landmarks(f), tg);
    rec.add(f.t, make); rng.push(make(f.t)); live.push({ out, tg });
    for (const [t, mark] of marks) if (Math.abs(f.t - t) < 1e-6) rec.mark(f.t, mark, 'button', 4);
  }
  return { session: JSON.parse(JSON.stringify(rec.stop())), rng, live };
}

test('a recording is numbers only, in the format, and plays back the very features it was made from', () => {
  const list = frames('throw', { seconds: 6, bpm: 100 }), { session, live } = record(list, [], true);
  assert.ok(R.good(session)); assert.equal(session.kind, 'session'); assert.equal(session.frames.length, list.length);
  assert.ok(Math.abs(session.seconds - (list.length - 1) / 30) < 0.01); assert.deepEqual(session.keys, KEYS); assert.deepEqual(session.map, MAP);
  // nothing in it but numbers, names and structure – no picture could hide in a frame
  const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    else assert.ok(x === null || typeof x === 'number' || (typeof x === 'string' && x.length < 40), `not a number or a name: ${String(x).slice(0, 60)}`); };
  walk(session.frames);
  assert.ok(JSON.stringify(session).length / session.frames.length < 2500, 'a frame stays small');
  // played back: the same values, the same gesture, the same targets
  session.frames.forEach((f, i) => {
    const back = R.unpack(f, session.keys), was = live[i].out;
    for (const k of KEYS) { assert.ok(Math.abs(back.v[k] - was.v[k]) < 1e-4, `${k} at frame ${i}`); assert.ok(Math.abs(back.c[k] - was.c[k]) < 1e-3, `${k} confidence at frame ${i}`); }
    assert.equal(back.gesture, was.gesture); assert.equal(back.bpm, was.bpm);
    for (const k of Object.keys(live[i].tg)) if (Math.abs(live[i].tg[k]) >= 0.005) assert.ok(Math.abs(f.o[k] - live[i].tg[k]) < 1e-3, k);
  });
  // … and through the mapping they do the same again, so a setting can be tried without dancing again
  const m = M.create(); let same = 0;
  session.frames.forEach((f, i) => { const tg = m.apply(MAP, R.unpack(f, session.keys), 1 / 30); if (Math.abs((tg['fx.feedback'] || 0) - (live[i].tg['fx.feedback'] || 0)) < 1e-3) same++; });
  assert.equal(same, session.frames.length);
  assert.ok(session.frames.some(f => f.g === 'throw'));
});

test('feeding a session’s inputs to a fresh detector gives the same features again', () => {
  for (const move of ['throw', 'accordion', 'circle', 'talk']) {
    const { session, live } = record(frames(move, { seconds: 6, bpm: 110, jitter: 0.002, seed: 5 }), [], true), d = D.create();
    let worst = 0, turn = 0, gestures = 0;
    session.frames.forEach((f, i) => {
      const again = d.step(R.input(f));
      for (const k of KEYS) if (k !== 'phase' && k !== 'turn') worst = Math.max(worst, Math.abs(again.v[k] - live[i].out.v[k]));
      worst = Math.max(worst, Math.abs(((again.v.phase - live[i].out.v.phase + 1.5) % 1) - 0.5));     // a phase goes round
      turn = Math.max(turn, Math.abs(again.v.turn - live[i].out.v.turn));
      if (again.gesture === live[i].out.gesture) gestures++;
    });
    // the inputs are kept to four decimals; turning is read from differences of positions and feels that most
    assert.ok(worst < 0.03, `${move}: largest difference ${worst.toFixed(4)}`);
    assert.ok(turn < 0.25, `${move}: turning differs by ${turn.toFixed(4)}`);
    assert.equal(gestures, session.frames.length, `${move}: gesture the same in ${gestures}/${session.frames.length} frames`);
  }
});

test('the points of the skeleton and of the hands are kept for the stick figure, in the picture’s 0…1', () => {
  const list = frames('wave', { seconds: 2 }), { session } = record(list, [], true), f = session.frames[30], src = list[30];
  const b = R.body(f); assert.equal(b.length, R.BODY.length);
  assert.ok(Math.abs(b[R.WRIST.l][0] - src.hands.l.x) < 1e-3 && Math.abs(b[R.WRIST.r][1] - src.hands.r.y) < 1e-3);
  assert.deepEqual(R.wrist(f, 'l'), b[R.WRIST.l]);
  const h = R.hand21(f, 'r'); assert.equal(h.length, 21); assert.equal(R.hand21(f, 'l'), null);
  assert.ok(h.every(p => p[0] > 0 && p[0] < 1 && p[1] > 0 && p[1] < 1)); assert.ok(Math.abs(h[0][0] - src.hands.r.x) < 1e-3);
  for (const [a, c] of [...R.BONES, ...R.HAND_BONES]) assert.ok(a >= 0 && c >= 0);
  assert.ok(R.BONES.every(([a, c]) => a < R.BODY.length && c < R.BODY.length) && R.HAND_BONES.every(([a, c]) => a < 21 && c < 21));
  // markers only (no skeleton): the hand is where the marker was seen
  const m = R.pack(0, KEYS, D.create().step({ t: 0, hands: { l: [{ x: 0.3, y: 0.4, c: 0.9, src: 'marker', len: 0.05 }], r: null }, body: null }),
    { hands: { l: [{ x: 0.3, y: 0.4, c: 0.9, src: 'marker', len: 0.05 }], r: null }, body: null }, null, {});
  assert.equal(R.body(m), null); assert.deepEqual(R.wrist(m, 'l'), [0.3, 0.4]); assert.equal(R.wrist(m, 'r'), null);
  assert.deepEqual(R.input(m).hands.l[0], { x: 0.3, y: 0.4, c: 0.9, src: 'marker', len: 0.05 });
});

test('a feedback keeps the last seconds: its window, the mark at its end, the mapping in use', () => {
  const { rng } = record(frames('accordion', { seconds: 9 }));
  for (const secs of [4, 2, 8]) {
    const m = R.moment(rng, 'good', 'button', secs, MAP, KEYS, 16 / 9);
    assert.ok(R.good(m)); assert.equal(m.kind, 'feedback');
    assert.ok(Math.abs(m.seconds - secs) < 0.05, `${secs} s asked, ${m.seconds} s kept`); assert.equal(m.frames[0].t, 0);
    assert.deepEqual(m.marks, [{ t: m.seconds, mark: 'good', by: 'button', secs }]); assert.deepEqual(m.map, MAP);
  }
  // the ring forgets what is older than it holds, and a moment asked for early is as long as there is
  const short = R.ring(3); for (const f of rng.last(30)) short.push(f);
  assert.ok(Math.abs(R.moment(short, 'bad', 'voice', 8, MAP, KEYS).seconds - 3) < 0.05);
  const fresh = R.ring(30); assert.deepEqual(R.moment(fresh, 'bad', 'voice', 4, MAP, KEYS).frames, []);
  // what was going on around the mark
  const [r] = R.review(R.moment(rng, 'bad', 'control', 4, MAP, KEYS));
  assert.equal(r.gesture, 'accordion'); assert.ok(r.share > 0.9 && r.sure > 0.8); assert.equal(r.mark, 'bad'); assert.equal(r.by, 'control');
  assert.equal(r.targets[0][0], 'fx.trails'); assert.ok(r.energy > 0.2);
});

test('a recording takes at most 30 frames a second, carries its marks and has an end', () => {
  const rec = R.recorder(KEYS, MAP, 16 / 9); let made = 0;
  for (let i = 0; i < 600; i++) rec.add(100 + i / 120, t => { made++; return { t }; });   // a 120 Hz camera, 5 s
  assert.ok(Math.abs(rec.frames - 150) <= 2, `${rec.frames} frames`); assert.equal(made, rec.frames, 'a dropped frame is never built');
  rec.mark(102, 'good', 'button', 4); rec.mark(104.5, 'bad', 'voice', 4);
  assert.deepEqual(rec.stop().marks, [{ t: 2, mark: 'good', by: 'button', secs: 4 }, { t: 4.5, mark: 'bad', by: 'voice', secs: 4 }]);
  const long = R.recorder(KEYS, MAP, 16 / 9); let ok = true;
  for (let t = 0; t <= R.MAX_SECONDS + 5 && ok; t += 0.5) ok = long.add(t, t2 => ({ t: t2 }));
  assert.equal(ok, false, 'it says when it is full'); assert.ok(long.seconds <= R.MAX_SECONDS);
});

test('playback: runs, pauses, slow motion, jumps, loops over a stretch, stops at the end', () => {
  const { session } = record(frames('throw', { seconds: 6 })), p = R.player(session);
  assert.equal(p.tick(0).t, 0);
  assert.ok(Math.abs(p.tick(1).t - 1) < 0.04); assert.ok(Math.abs(p.pos - 1) < 1e-9);
  p.play(false); assert.ok(Math.abs(p.tick(5).t - 1) < 0.04);                 // paused: time stands
  p.play(); p.setSpeed(0.25); p.tick(2); assert.ok(Math.abs(p.pos - 1.5) < 1e-9);   // slow motion
  p.seek(4.2); assert.ok(Math.abs(p.frame.t - 4.2) < 0.04); p.seek(99); assert.equal(p.pos, session.seconds); p.seek(-3); assert.equal(p.pos, 0);
  p.setSpeed(1); p.setLoop(2, 3); assert.equal(p.pos, 2);
  const seen = []; for (let i = 0; i < 90; i++) seen.push(p.tick(1 / 30).t);
  assert.ok(Math.min(...seen) >= 2 - 0.04 && Math.max(...seen) <= 3 + 0.04, 'stays inside the stretch'); assert.ok(seen.filter((t, i) => i && t < seen[i - 1]).length >= 2, 'comes round');
  p.setLoop(null); p.seek(5.5); p.tick(3); assert.equal(p.pos, session.seconds); assert.equal(p.playing, false);   // the end
  p.play(); assert.equal(p.pos, 0, 'playing again starts over');
  p.setLoop(3, 3.01); assert.equal(p.loop, null, 'a stretch of nothing is no stretch');
  assert.equal(R.player(R.session('session', [], [], MAP, KEYS)).tick(1), null);
});

test('the time line: stretches of recognised gestures, the list of feedback moments, poses for a multiple exposure', () => {
  const list = [...frames('throw', { seconds: 5 }), ...frames('stand', { seconds: 3, from: 5 }), ...frames('accordion', { seconds: 5, from: 8 })];
  const { session } = record(list, [[4, 'good'], [7, 'bad'], [12.5, 'good']]);
  const g = R.gestures(session);
  assert.deepEqual(g.map(x => x.name), ['throw', 'accordion']);
  assert.ok(g[0].t0 < 2.5 && g[0].t1 > 4.9 && g[0].t1 < 6.5 && g[1].t0 > 8.5 && g[1].t1 > 12.9, JSON.stringify(g));
  const rv = R.review(session);
  assert.deepEqual(rv.map(r => [r.t, r.mark, r.gesture]), [[4, 'good', 'throw'], [7, 'bad', 'throw'], [12.5, 'good', 'accordion']]);
  assert.ok(rv[0].share > 0.5 && rv[2].share > 0.8); assert.equal(rv[0].targets[0][0], 'fx.feedback');
  const idx = R.poses(session, 1, 3, 8);
  assert.equal(idx.length, 8); assert.ok(Math.abs(session.frames[idx[0]].t - 1) < 0.04 && Math.abs(session.frames[idx[7]].t - 3) < 0.04);
  assert.ok(idx.every((x, i) => !i || x > idx[i - 1])); assert.equal(R.poses(session, 2, 2, 5).length, 1);
});

test('a session becomes a test file: the detector’s input and what is expected of it – and a detector can be checked against it', () => {
  const list = [...frames('throw', { seconds: 5 }), ...frames('talk', { seconds: 5, from: 5 })];
  const { session } = record(list, [[4.5, 'good'], [7, 'bad'], [9.5, 'good']]), file = JSON.parse(JSON.stringify(R.testFile(session, 'throw then talk')));
  assert.equal(file.format, 'dream-dance-test'); assert.equal(file.frames.length, session.frames.length);
  assert.deepEqual(Object.keys(file.frames[0]).sort(), ['i', 'p', 't']); assert.ok(!('b' in file.frames[0].p), 'the skeleton is not needed to test');
  assert.deepEqual(file.expect.map(e => [e.t1, e.mark, e.was, e.want]), [[4.5, 'good', 'throw', 'throw'], [7, 'bad', 'throw', null], [9.5, 'good', null, 'none']]);
  const res = R.check(file, D.create);
  assert.deepEqual(res.map(r => [r.want, r.got, r.ok]), [['throw', 'throw', true], ['none', 'none', true]]);   // the "bad" has no want yet: not checked
  // a detector that recognises nothing fails the first line
  assert.deepEqual(R.check(file, () => ({ step: () => ({ gesture: null }) })).map(r => r.ok), [false, true]);
});

// Every test file of a folder through the detection: [name, lines checked]; a line that does not hold fails.
function checkFolder(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(name => {
    const file = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    assert.equal(file.format, 'dream-dance-test', name);
    const res = R.check(file, D.create);
    for (const r of res) assert.ok(r.ok, `${name}: ${r.t0}–${r.t1} s expected ${r.want}, got ${r.got}`);
    return [name, res.length];
  });
}

// Only invented movement lives in the repository: a file here is made by the simulated dancer and says so.
test('the test files kept in tests/js/dance-sessions hold: the detection does what each expects – and all are synthetic', () => {
  const dir = new URL('./dance-sessions/', import.meta.url), done = checkFolder(dir);
  assert.ok(done.length >= 1, 'at least the synthetic one');
  for (const [name, n] of done) {
    assert.ok(n >= 1, `${name}: nothing expected`);
    assert.match(name, /^synthetic[a-z0-9-]*\.json$/, `${name}: only synthetic sessions belong in the repository – a real recording goes to a private folder (DREAM_DANCE_SESSIONS)`);
    assert.match(JSON.parse(readFileSync(new URL(name, dir), 'utf8')).name, /^synthetic/, `${name}: its name says it is synthetic`);
  }
});

// Real recordings stay private: DREAM_DANCE_SESSIONS=/path/to/a/private/folder runs them through the same check.
const OWN = process.env.DREAM_DANCE_SESSIONS;
test('the test files of a private folder (DREAM_DANCE_SESSIONS) hold too', { skip: OWN ? false : 'DREAM_DANCE_SESSIONS is not set' }, () => {
  const done = checkFolder(pathToFileURL(resolve(OWN) + sep));
  console.log(`  ${done.length} private test files, ${done.reduce((a, d) => a + d[1], 0)} expectations checked`);
  for (const [name, n] of done) if (!n) console.log(`  ${name}: nothing expected yet (write a gesture into "want")`);
});

test('tuning a row in the lab: target, curve, ranges and smoothing – each inside its range, the table handed in untouched', () => {
  const rows = [MAP[0], MAP[1]], t = (ch, id = 'e') => L.tune(rows, id, ch).find(r => r.id === id);
  assert.deepEqual(t({ inLo: 0.3 }).in, [0.3, 0.8]); assert.deepEqual(t({ inLo: 0.95 }).in, [0.8, 0.8], 'from never passes to');
  assert.deepEqual(t({ inHi: 0.05 }).in, [0.1, 0.1]); assert.deepEqual(t({ inHi: 7 }).in, [0.1, 1]);
  assert.deepEqual(t({ outHi: 0.4 }).out, [0, 0.4]); assert.deepEqual(t({ outLo: -0.5 }).out, [0, 0.7], 'an effect\u2019s amount never goes below nothing');
  assert.equal(t({ curve: 's' }).curve, 's'); assert.equal(t({ curve: 'zigzag' }).curve, 'soft');
  assert.equal(t({ smooth: 1.2 }).smooth, 1.2); assert.equal(t({ smooth: 99 }).smooth, 5); assert.equal(t({ smooth: -1 }).smooth, 0);
  assert.equal(t({ dst: 'ai.hue' }).dst, 'ai.hue'); assert.equal(t({ dst: 'ai.hue' }).origin, 'own');
  // a target that goes both ways (turning) may go out below zero
  assert.deepEqual(t({ dst: 'fx.spin', outLo: -0.6 }).out, [-0.6, 0.7]);
  assert.equal(rows[1].in[0], 0.1); assert.equal(rows[1].origin, 'fixed'); assert.equal(L.tune(rows, 'e', { inLo: 0.3 })[0], rows[0], 'other rows are the same rows');
  assert.equal(L.clock(0), '0:00'); assert.equal(L.clock(125.9), '2:05'); assert.equal(L.clock(-3), '0:00');
});

test('feedback without hands: a spoken word, and the wristband’s one button', () => {
  for (const w of ['good', 'Good.', ' Super! ', 'yes', 'Great!', 'very good', 'nice']) assert.equal(R.verdict(w), 'good', w);
  for (const w of ['bad', 'Bad.', 'No!', 'not good', 'wrong', 'nope']) assert.equal(R.verdict(w), 'bad', w);
  assert.equal(R.verdict('not bad'), 'good');
  assert.ok(!R.good({ format: 'dream-dance', version: 1, keys: [], marks: [], frames: [{ t: 0, v: [], c: [] }] }), 'a frame without its input and points is no session');
  for (const w of ['', null, 'a glowing forest at night', 'goodness', 'that was really good this time', '123', 'good bad']) assert.equal(R.verdict(w), null, String(w));
  // the page's language beside it: the German words come from the translations (static/i18n/de.json)
  const de = JSON.parse(readFileSync(new URL('../../static/i18n/de.json', import.meta.url), 'utf8'));
  const words = { good: de['good great yes nice super top right'].split(' '), bad: de['bad no nope wrong'].split(' '), not: de.not.split(' ') };
  assert.ok(words.good.length >= 3 && words.bad.length >= 2 && words.not.length >= 1);
  assert.equal(R.verdict(words.good[0] + '.', words), 'good'); assert.equal(R.verdict(' ' + words.bad[0].toUpperCase() + '!', words), 'bad');
  assert.equal(R.verdict(words.not[0] + ' ' + words.good[0], words), 'bad'); assert.equal(R.verdict(words.good[0], R.WORDS), null);
  // one press: good – once the time for a second press is over; two presses: bad, and no good as well
  const c = R.clutch(0.5);
  assert.equal(c.press(10), null); assert.equal(c.due(10.3), null); assert.equal(c.due(10.6), 'good'); assert.equal(c.due(10.7), null);
  assert.equal(c.press(20), null); assert.equal(c.press(20.3), 'bad'); assert.equal(c.due(21), null);
  assert.equal(c.press(30), null); assert.equal(c.due(30.6), 'good'); assert.equal(c.press(30.7), null); assert.equal(c.due(31.3), 'good');
});
