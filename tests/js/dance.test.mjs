// #235: the dance detection (static/dance.js) on synthetic trajectories – no camera, no model, no browser.
// Run: node --test tests/js/dance.test.mjs   (the CI runs it too)
// A simulated dancer (dance-sim.mjs) makes each gesture in many variants (size, tempo, place and size of the body in
// the picture, jitter, frame rate, a wandering tempo); the hit rate and the false alarms on things that are no dance
// are counted and must stay where they are. The movement clock is checked against trajectories with a known tempo,
// the fusion against a sensor that agrees, disagrees or is the only source, the fingers against painted hands.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { frames, play, verdict, rng, hand, MOVES, NOT_MOVES } from './dance-sim.mjs';

const D = createRequire(import.meta.url)('../../static/dance.js');
const last = a => a[a.length - 1];

function variants(fn) {
  let n = 0;
  for (const size of [0.7, 1, 1.4]) for (const bpm of [70, 100, 130, 160]) for (const S of [0.06, 0.1, 0.16]) for (const jitter of [0, 0.004]) for (const fps of [30, 60]) {
    fn({ size, bpm, S, jitter: jitter * S / 0.1, fps, seed: ++n, wobble: 0.03, at: [0.3 + 0.4 * ((n * 7) % 10) / 10, 0.35 + 0.1 * (n % 3)] });
  }
}

test('every gesture is recognised in its variants: hit rate, and how soon', () => {
  for (const move of Object.keys(MOVES)) {
    let hit = 0, n = 0, at = 0;
    variants(o => { const v = verdict(play(D.create(), frames(move, o)), move); n++; if (v.hit) { hit++; at += v.at; } });
    console.log(`  ${move}: ${hit}/${n} recognised, after ${(at / hit).toFixed(2)} s on average`);
    assert.ok(hit / n >= 0.97, `${move}: hit rate ${(hit / n).toFixed(3)}`);
    assert.ok(at / hit < 2.5, `${move}: recognised after ${(at / hit).toFixed(2)} s`);
  }
});

test('walking, waving, talking hands, a single reach, swaying and standing set nothing off: false alarms', () => {
  for (const move of Object.keys(NOT_MOVES)) {
    let alarms = 0, n = 0;
    for (const S of [0.06, 0.1, 0.16]) for (const jitter of [0, 0.004, 0.008]) for (const fps of [30, 60]) for (const seed of [1, 2, 3]) {
      n++; if (play(D.create(), frames(move, { S, jitter: jitter * S / 0.1, fps, seed: seed * 17 + n, seconds: 10 })).some(o => o.gesture)) alarms++;
    }
    console.log(`  ${move}: ${alarms}/${n} false alarms`);
    assert.equal(alarms, 0, `${move}: ${alarms} false alarms in ${n}`);
  }
});

test('a gesture needs repetitions to come, and goes with hysteresis – no flicker', () => {
  const d = D.create(), a = play(d, frames('throw', { bpm: 100, seconds: 6 }));
  const first = a.find(o => o.gesture === 'throw');
  assert.ok(first.t >= 2 * 0.6 - 0.2, `not before two repetitions (${first.t.toFixed(2)} s)`);
  // then the dancer stands still: the gesture ends once, within about a second, and does not come back
  const b = play(d, frames('stand', { seconds: 4, from: 6 }));
  const ends = [...a, ...b].flatMap(o => o.events).filter(e => e === 'end:throw').length, starts = [...a, ...b].flatMap(o => o.events).filter(e => e === 'gesture:throw').length;
  assert.equal(starts, 1); assert.equal(ends, 1);
  const off = b.find(o => !o.gesture);
  assert.ok(off.t - 6 < 1.5, `gone ${(off.t - 6).toFixed(2)} s after stopping`);
  assert.equal(last(b).gesture, null);
});

test('size becomes strength: a larger movement gives a larger value at the gesture source', () => {
  const small = last(play(D.create(), frames('accordion', { size: 0.7 }))), large = last(play(D.create(), frames('accordion', { size: 1.4 })));
  assert.ok(small.v['g.accordion'] > 0.2 && large.v['g.accordion'] > small.v['g.accordion'] + 0.2, `${small.v['g.accordion']} → ${large.v['g.accordion']}`);
  assert.equal(large.v['g.throw'], 0);
});

test('one visible hand is enough for a throw and a circle', () => {
  for (const move of ['throw', 'circle']) {
    let hit = 0, n = 0;
    for (const size of [0.7, 1, 1.4]) for (const bpm of [70, 100, 130, 160]) { n++; if (verdict(play(D.create(), frames(move, { size, bpm, only: 'r', seed: n })), move).hit) hit++; }
    assert.equal(hit, n, `${move} with one hand: ${hit}/${n}`);
  }
});

test('markers alone (no skeleton): the same gestures; standing, walking, waving and talking set nothing off', () => {
  for (const move of Object.keys(MOVES)) {
    let hit = 0, n = 0;
    for (const size of [0.7, 1, 1.4]) for (const bpm of [70, 100, 130, 160]) for (const S of [0.06, 0.1, 0.16]) { n++; if (verdict(play(D.create(), frames(move, { size, bpm, S, seed: n, seconds: 8, noBody: true, src: 'marker' })), move, 5).hit) hit++; }
    console.log(`  ${move} (markers): ${hit}/${n}`);
    assert.ok(hit / n >= 0.95, `${move} with markers: ${hit}/${n}`);
  }
  // without a skeleton a whole body swaying sideways cannot be told from a push: that one is left out here
  for (const move of ['stand', 'walk', 'hello', 'talk', 'reach', 'cheer']) {
    for (const S of [0.06, 0.1, 0.16]) for (const seed of [1, 2, 3]) {
      assert.ok(!play(D.create(), frames(move, { S, seed, seconds: 10, noBody: true, src: 'marker', jitter: 0.003 })).some(o => o.gesture), `${move} with markers`);
    }
  }
});

test('the movement clock finds the tempo and keeps the phase of a repetition', () => {
  for (const bpm of [60, 90, 120, 150, 180]) {
    const outs = play(D.create(), frames('throw', { bpm, seconds: 8, fps: 60 })), end = last(outs);
    assert.ok(Math.abs(end.bpm - bpm) < 0.02 * bpm, `${bpm} a minute: clock says ${end.bpm}`);
    assert.ok(end.c.tempo > 0.8, `${bpm}: confidence ${end.c.tempo}`);
    assert.ok(Math.abs(end.v.tempo - (bpm - 40) / 160) < 0.03);
    // a beat each repetition, at the top of the throw (a quarter into the sine), never two for one
    const beats = outs.filter(o => o.t > 3 && o.events.includes('beat')).map(o => o.t);
    assert.ok(Math.abs(beats.length - 5 * bpm / 60) <= 1, `${bpm}: ${beats.length} beats in 5 s`);
    for (const b of beats) { const off = ((b * bpm / 60 - 0.25) % 1 + 1.5) % 1 - 0.5; assert.ok(Math.abs(off) < 0.1, `${bpm}: beat ${off.toFixed(2)} of a repetition off the top`); }
    // the phase counts up between the beats and the pulse falls from each beat
    const i = outs.findIndex(o => o.t > 4 && o.events.includes('beat'));
    assert.ok(outs[i].v.pulse > 0.8 && outs[i + Math.round(60 * 60 / bpm / 2)].v.pulse < 0.3);
  }
});

test('the clock follows a change of tempo and stops when the dancer does', () => {
  const d = D.create();
  play(d, frames('push', { bpm: 90, seconds: 5 }));
  const b = play(d, frames('push', { bpm: 140, seconds: 5, from: 5 }));
  assert.ok(Math.abs(last(b).bpm - 140) < 4, `after the change: ${last(b).bpm}`);
  const c = play(d, frames('stand', { seconds: 4, from: 10 }));
  assert.equal(last(c).bpm, 0); assert.equal(last(c).v.tempo, 0); assert.ok(last(c).c.tempo < 0.1);
  assert.ok(!c.filter(o => o.t > 12).some(o => o.events.includes('beat')), 'no beats without a movement');
});

test('the continuous features: normalised to the body, each with source and confidence', () => {
  const still = last(play(D.create(), frames('stand', { seconds: 3 })));
  assert.ok(still.v.energy < 0.03 && still.v.still > 0.9, `standing: energy ${still.v.energy}, still ${still.v.still}`);
  assert.ok(still.v.height < 0.15, 'hands hang'); assert.ok(still.v.open > 0.2 && still.v.open < 0.5);
  assert.equal(still.src.energy, 'pose'); assert.ok(still.c.energy > 0.8);
  // the same dance, small and far away or large and near, left or right in the picture: the same numbers
  const mean = (outs, k) => outs.filter(o => o.t > 2).reduce((a, o) => a + o.v[k], 0) / outs.filter(o => o.t > 2).length;
  const near = play(D.create(), frames('accordion', { S: 0.16, at: [0.3, 0.45] })), far = play(D.create(), frames('accordion', { S: 0.06, at: [0.7, 0.35] }));
  for (const k of ['energy', 'open', 'height', 'tempo']) assert.ok(Math.abs(mean(near, k) - mean(far, k)) < 0.04, `${k}: ${mean(near, k).toFixed(3)} near, ${mean(far, k).toFixed(3)} far`);
  assert.ok(mean(near, 'energy') > 0.2 && mean(near, 'still') < 0.05);
  // faster and larger is more energy; arms wide is open, hands up is high
  assert.ok(mean(play(D.create(), frames('throw', { bpm: 150, size: 1.4 })), 'energy') > mean(play(D.create(), frames('throw', { bpm: 80, size: 0.7 })), 'energy') + 0.2);
  const up = last(play(D.create(), frames('cheer', { seconds: 5 })));
  assert.ok(up.v.height > 0.75, `arms up: height ${up.v.height}`);
  // turn: a circle against the clock is positive, with the clock negative, a throw neither
  const ccw = mean(play(D.create(), frames('circle', { bpm: 60 })), 'turn'), cw = mean(play(D.create(), frames('circle', { bpm: -60 })), 'turn');
  assert.ok(ccw > 0.3 && cw < -0.3, `turn ${ccw.toFixed(2)} / ${cw.toFixed(2)}`);
  assert.ok(Math.abs(mean(play(D.create(), frames('throw')), 'turn')) < 0.1);
  // every source the mapping can take is in every record, with a confidence and a source
  for (const k of D.SOURCES) { assert.ok(Number.isFinite(still.v[k]), k); assert.ok(still.c[k] >= 0 && still.c[k] <= 1, k); assert.equal(typeof still.src[k], 'string'); }
});

test('nobody in the picture: every value says it is not known (confidence 0) and nothing fires', () => {
  const d = D.create(); let out;
  for (let i = 0; i < 90; i++) out = d.step({ t: i / 30, hands: { l: null, r: null }, body: null });
  for (const k of D.SOURCES) { assert.equal(out.c[k], 0, k); assert.equal(out.v[k], 0, k); }
  assert.equal(out.gesture, null); assert.deepEqual(out.events, []);
});

// ---------- the motion sensor on the arm ----------
// a gyroscope swinging about one axis with the movement (rad/s)
const gyro = (t, bpm, amp = 5) => [0.3 * Math.sin(2 * Math.PI * bpm / 60 * t + 1), amp * Math.cos(2 * Math.PI * bpm / 60 * t), 0.2];
test('the sensor alone: energy, stillness, tempo and beats – no camera needed', () => {
  const d = D.create(), outs = [];
  for (let i = 0; i < 8 * 60; i++) { const t = i / 60; outs.push(d.step({ t, hands: { l: null, r: null }, body: null, sensor: { g: gyro(t, 120), age: 0.01 } })); }
  const end = last(outs);
  assert.equal(end.src.energy, 'sensor'); assert.ok(end.v.energy > 0.3 && end.c.energy > 0.8);
  assert.ok(Math.abs(end.bpm - 120) < 3, `sensor tempo ${end.bpm}`); assert.equal(end.src.tempo, 'sensor');
  assert.ok(Math.abs(outs.filter(o => o.t > 3 && o.events.includes('beat')).length - 10) <= 1);
  assert.equal(end.c.open, 0); assert.equal(end.c.height, 0);     // what only the camera knows stays unknown
  assert.equal(end.gesture, null);
  // the arm rests
  for (let i = 0; i < 120; i++) outs.push(d.step({ t: 8 + i / 60, hands: { l: null, r: null }, body: null, sensor: { g: [0.02, 0.01, 0], age: 0.01 } }));
  assert.ok(last(outs).v.still > 0.9 && last(outs).v.energy < 0.03);
  // a strike of the arm is the impulse, falling off quickly
  d.kick(0.8); const k = d.step({ t: 10.02, hands: { l: null, r: null }, body: null, sensor: { g: [0, 0, 0], age: 0.01 } });
  assert.ok(k.v.impulse > 0.6 && k.c.impulse > 0.8);
});

test('camera and sensor together: they confirm each other, and each carries on when the other fails', () => {
  const run = (sensor, cam = true) => {
    const d = D.create();
    return frames('throw', { bpm: 110, size: 0.5, seconds: 6, fps: 60 }).map(f => d.step({ ...f, ...(cam ? {} : { hands: { l: null, r: null }, body: null }), sensor: sensor ? sensor(f.t) : null }));
  };
  const alone = run(null), agree = run(t => ({ g: gyro(t, 110), age: 0.01 })), rest = run(() => ({ g: [0.02, 0.01, 0], age: 0.01 }));
  const conf = outs => outs.filter(o => o.t > 3).reduce((a, o) => a + o.g.throw, 0) / outs.filter(o => o.t > 3).length;
  console.log(`  throw confidence: camera ${conf(alone).toFixed(2)}, with agreeing sensor ${conf(agree).toFixed(2)}, with resting sensor ${conf(rest).toFixed(2)}`);
  // a small throw the camera alone is not sure of …
  assert.ok(conf(agree) > conf(alone) + 0.1, 'a sensor in the same tempo confirms');
  assert.equal(last(alone).gesture, null); assert.equal(last(agree).gesture, 'throw');
  assert.ok(conf(rest) < conf(alone) - 0.1, 'an arm at rest doubts');
  assert.equal(last(agree).src.energy, 'pose+sensor'); assert.ok(last(agree).c.energy > last(alone).c.energy);
  // the sensor stops sending (old data): the camera goes on alone
  const stale = run(t => ({ g: gyro(t, 110), age: t < 3 ? 0.01 : 5 }));
  assert.equal(last(stale).src.energy, 'pose'); assert.equal(last(stale).gesture, 'throw');
  // the camera loses the dancer: the sensor keeps energy and tempo alive
  const dark = run(t => ({ g: gyro(t, 110), age: 0.01 }), false);
  assert.equal(last(dark).src.energy, 'sensor'); assert.ok(Math.abs(last(dark).bpm - 110) < 3);
});

// ---------- markers ----------
function picture(w, h, spots) {                        // spots: [x, y, radius px, [r, g, b], streak px]
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = 14; d[i * 4 + 1] = 12; d[i * 4 + 2] = 16; d[i * 4 + 3] = 255; }
  for (const [x, y, r, col, streak = 0] of spots) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = Math.max(0, Math.abs(i - x * w) - streak / 2), dy = j - y * h;
      if (dx * dx + dy * dy <= r * r) { const core = dx * dx + dy * dy <= (r / 2.5) ** 2; for (let c = 0; c < 3; c++) d[(j * w + i) * 4 + c] = core ? 255 : col[c]; }
    }
  }
  return d;
}
const CYAN = [20, 230, 240], MAGENTA = [240, 30, 220], ORANGE = [255, 140, 20], WHITE = [250, 250, 245];
test('two LED markers are found by colour: one hand each; lamps and fire are not markers', () => {
  const cols = { l: 'cyan', r: 'magenta' };
  const m = D.findMarkers(picture(320, 180, [[0.25, 0.4, 4, CYAN], [0.7, 0.6, 5, MAGENTA], [0.5, 0.1, 9, WHITE], [0.9, 0.8, 7, ORANGE]]), 320, 180, cols);
  assert.ok(Math.abs(m.l.x - 0.25) < 0.01 && Math.abs(m.l.y - 0.4) < 0.015, JSON.stringify(m.l));
  assert.ok(Math.abs(m.r.x - 0.7) < 0.01 && Math.abs(m.r.y - 0.6) < 0.015, JSON.stringify(m.r));
  assert.ok(m.l.c > 0.8 && m.r.c > 0.8); assert.equal(m.l.len, 0);
  // only white light and fire in the picture: no marker
  const none = D.findMarkers(picture(320, 180, [[0.5, 0.1, 9, WHITE], [0.9, 0.8, 7, ORANGE], [0.2, 0.5, 5, [255, 220, 40]], [0.4, 0.5, 5, [255, 40, 20]]]), 320, 180, cols);
  assert.equal(none.l, null); assert.equal(none.r, null);
  // a fast hand smears its marker into a streak: its length and direction are reported, its middle is the place
  const s = D.findMarkers(picture(320, 180, [[0.5, 0.5, 3, CYAN, 40]]), 320, 180, cols);
  assert.ok(Math.abs(s.l.x - 0.5) < 0.01 && s.l.len > 0.1 && s.l.len < 0.2 && Math.abs(s.l.ang) < 0.1, JSON.stringify(s.l));
  // a second spot of the same colour (a reflection): still the larger one, but less sure
  const two = D.findMarkers(picture(320, 180, [[0.3, 0.3, 5, CYAN], [0.6, 0.7, 4, CYAN]]), 320, 180, cols);
  assert.ok(Math.abs(two.l.x - 0.3) < 0.01 && two.l.c < m.l.c);
  // red, orange and yellow cannot be chosen at all
  assert.deepEqual(Object.keys(D.MARKER_HUES).sort(), ['blue', 'cyan', 'green', 'magenta']);
});

test('marker and hand model for one hand: they confirm each other; in the dark and on fast moves the marker leads', () => {
  const pose = { x: 0.4, y: 0.5, c: 0.8, src: 'pose' }, marker = { x: 0.41, y: 0.5, c: 0.9, src: 'marker', len: 0 };
  const both = D.fuseHand([pose, marker]);
  assert.equal(both.src, 'pose+marker'); assert.ok(both.c > 0.95 && both.x > 0.4 && both.x < 0.41);
  const away = { ...pose, x: 0.7 };                    // the model guesses somewhere else
  assert.equal(D.fuseHand([away, marker]).src, 'marker');
  assert.equal(D.fuseHand([pose, marker], { dark: true }).src, 'marker');
  assert.equal(D.fuseHand([pose, marker], { fast: true }).src, 'marker');
  assert.equal(D.fuseHand([{ ...away, c: 0.9 }, { ...marker, c: 0.2 }]).src, 'pose');   // a doubtful marker does not win
  assert.equal(D.fuseHand([pose]).src, 'pose'); assert.equal(D.fuseHand([marker]).src, 'marker');
  assert.equal(D.fuseHand([]), null); assert.equal(D.fuseHand([{ x: NaN, y: 0, c: 1, src: 'pose' }]), null);
});

// ---------- fingers ----------
test('fingers from 21 hand points: fist ↔ open hand, spread and pinch – whatever the size and the turn of the hand', () => {
  for (const size of [0.5, 1, 2.5]) for (const turn of [0, 0.8, 2.2, -1.5, Math.PI]) {
    const o = { size, turn }, open = D.fingerValues(hand({ ...o })), fist = D.fingerValues(hand({ ...o, curl: 1 })), half = D.fingerValues(hand({ ...o, curl: 0.45 }));
    assert.ok(open.palm > 0.9 && fist.palm < 0.1, `open ${open.palm.toFixed(2)}, fist ${fist.palm.toFixed(2)} (size ${size}, turn ${turn})`);
    assert.ok(half.palm > fist.palm + 0.15 && half.palm < open.palm - 0.15, `half ${half.palm.toFixed(2)}`);
    const wide = D.fingerValues(hand({ ...o, spread: 0.4 })), closed = D.fingerValues(hand({ ...o, spread: 0.03 }));
    assert.ok(wide.spread > 0.8 && closed.spread < 0.1, `spread ${wide.spread.toFixed(2)} / ${closed.spread.toFixed(2)}`);
    assert.ok(D.fingerValues(hand({ ...o, pinch: true })).near > 0.9 && open.near < 0.2, 'pinch');
    assert.ok(fist.spread < 0.1, 'a fist is not spread');
  }
  assert.equal(D.fingerValues(null), null); assert.equal(D.fingerValues([[0, 0]]), null);
});

test('fingers in the stream: pinch holds with hysteresis, a snap is an event, a lost hand says so', () => {
  const d = D.create(), ev = [];
  let t = 0, out;
  const feed = (pts, n, c = 0.9) => { for (let i = 0; i < n; i++) { t += 1 / 30; out = d.step({ t, hands: { l: null, r: null }, body: null, fingers: { r: pts ? { pts, c } : null, l: null } }); ev.push(...out.events); } };
  feed(hand(), 15);
  assert.ok(out.v['r.palm'] > 0.9 && out.c['r.palm'] > 0.8 && out.src['r.palm'] === 'hand'); assert.equal(out.c['l.palm'], 0);
  feed(hand({ pinch: true }), 10);
  assert.ok(out.v['r.pinch'] > 0.9); assert.deepEqual(ev.filter(e => e.startsWith('r.')), ['r.pinch']);
  // thumb and index a little apart: still held; clearly apart: released, once
  const loose = hand({ pinch: true }).map((p, i) => (i >= 1 && i <= 4 ? [p[0] - 0.02, p[1]] : p));
  feed(loose, 10); assert.ok(out.v['r.pinch'] > 0.9, 'held with hysteresis');
  feed(hand(), 10); assert.ok(out.v['r.pinch'] < 0.1); assert.deepEqual(ev.filter(e => e.startsWith('r.')), ['r.pinch', 'r.release']);
  // a fist flying open is a snap – slowly opening is none
  feed(hand({ curl: 1 }), 15); for (let k = 10; k >= 0; k--) feed(hand({ curl: k / 10 }), 3);
  assert.ok(!ev.includes('r.snap'), 'opening slowly is no snap');
  feed(hand({ curl: 1 }), 15); feed(hand({ curl: 0.5 }), 1); feed(hand(), 2);
  assert.equal(ev.filter(e => e === 'r.snap').length, 1); assert.ok(out.v['r.snap'] > 0.5);
  feed(hand(), 30); assert.ok(out.v['r.snap'] < 0.05); assert.equal(ev.filter(e => e === 'r.snap').length, 1);
  // the hand model loses the hand: no value, confidence 0 – a gap, not a frozen number
  feed(null, 5); assert.equal(out.c['r.palm'], 0); assert.equal(out.v['r.palm'], 0); assert.equal(out.src['r.palm'], '');
  feed(hand(), 3, 0.2); assert.equal(out.c['r.palm'], 0, 'a doubtful hand counts as lost');
});

test('the body from the pose model: the middle of the shoulders and a size that survives turning sideways', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  Object.assign(lm[11], { x: 0.55, y: 0.3 }); Object.assign(lm[12], { x: 0.45, y: 0.3 }); Object.assign(lm[23], { x: 0.54, y: 0.55 }); Object.assign(lm[24], { x: 0.46, y: 0.55 });
  const front = D.bodyFrom(lm, 16 / 9);
  assert.ok(Math.abs(front.x - 0.5) < 1e-9 && Math.abs(front.y - 0.3) < 1e-9 && Math.abs(front.s - 0.25 * 0.75) < 0.01, JSON.stringify(front));
  Object.assign(lm[11], { x: 0.505 }); Object.assign(lm[12], { x: 0.495 });   // turned sideways: the shoulders nearly cover each other
  assert.ok(Math.abs(D.bodyFrom(lm, 16 / 9).s - front.s) < 0.02);
  lm[11].visibility = 0.1; assert.equal(D.bodyFrom(lm), null); assert.equal(D.bodyFrom(null), null);
});

test('a jump in time starts anew, and a hand that is gone stops counting', () => {
  const d = D.create(); play(d, frames('throw', { seconds: 5 }));
  const o = d.step({ t: 100, hands: { l: null, r: null }, body: null });
  assert.equal(o.gesture, null); assert.equal(o.bpm, 0);
  const d2 = D.create(), r = rng(3); play(d2, frames('wave', { seconds: 5 }));
  let out; for (let i = 0; i < 60; i++) out = d2.step({ t: 5 + i / 30, hands: { l: null, r: null }, body: { x: 0.5 + 0.001 * r(), y: 0.4, s: 0.1, c: 0.9 } });
  assert.equal(out.gesture, null); assert.equal(out.c.open, 0);
});
