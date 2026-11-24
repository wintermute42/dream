// #252: Flowtrack's automatic (static/flowauto.js) on synthetic scenes – painted camera pictures, no camera, no model.
// Run: node --test tests/js/flowauto.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const A = createRequire(import.meta.url)('../../static/flowauto.js');
const W = 96, H = 54;
// a scene: a room of one brightness with a little noise, and spots of light in it [{x, y, r, rgb}]
function scene({ room = 20, spots = [], seed = 1 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 8;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, n = rnd(); let px = [room + n, room + n, room + n];
    for (const sp of spots) if (Math.hypot(x - sp.x * W, y - sp.y * H) <= sp.r) px = sp.rgb;
    d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = 255;
  }
  return d;
}
const FIRE = [255, 150, 40], WHITE = [255, 255, 255], CYAN = [20, 230, 240], MAGENTA = [240, 30, 220], GREEN = [40, 240, 60];
const look = d => A.survey(d, W, H);
// the automatic watching a scene for some seconds, the camera set as the automatic says (as the stage does it)
function watch(auto, d, seconds, t0 = 0, now = { kind: 'hand', short: false }) {
  let r; for (let t = t0; t <= t0 + seconds + 1e-9; t += 0.5) { r = auto.look(look(d), now, t); now = { kind: r.kind.value, short: r.short.value }; }
  return { ...r, now, t: t0 + seconds };
}

test('what a picture shows: brightness, bright and warm light, burnt-out light, markers', () => {
  const dark = look(scene({ room: 12 }));
  assert.ok(dark.lum < 0.06 && dark.bright === 0 && dark.markers.length === 0);
  const day = look(scene({ room: 120 }));
  assert.ok(day.lum > 0.45 && day.lum < 0.5 && day.warm === 0);
  const fire = look(scene({ room: 12, spots: [{ x: 0.4, y: 0.5, r: 4, rgb: FIRE }, { x: 0.6, y: 0.5, r: 4, rgb: FIRE }] }));
  assert.ok(fire.bright > 0.01 && fire.warm > 0.9 * fire.bright && fire.clipped === 0);
  const led = look(scene({ room: 12, spots: [{ x: 0.5, y: 0.5, r: 3, rgb: WHITE }] }));
  assert.ok(led.bright > 0 && led.warm === 0 && led.clipped > 0, 'white light is not fire, and it burns out');
  assert.deepEqual(look(scene({ room: 12, spots: [{ x: 0.3, y: 0.5, r: 3, rgb: CYAN }, { x: 0.7, y: 0.5, r: 3, rgb: MAGENTA }] })).markers.sort(), ['cyan', 'magenta']);
  assert.deepEqual(look(scene({ room: 12, spots: [{ x: 0.3, y: 0.5, r: 3, rgb: FIRE }] })).markers, [], 'fire is no marker');
});

test('the kind of detection: fire in the dark, markers, the hand AI in a bright room – each with its reason', () => {
  let r = watch(A.create(), scene({ room: 12, spots: [{ x: 0.5, y: 0.5, r: 4, rgb: FIRE }] }), 1);
  assert.deepEqual([r.kind.value, r.kind.code], ['on', 'fire']);
  r = watch(A.create(), scene({ room: 12, spots: [{ x: 0.5, y: 0.5, r: 3, rgb: WHITE }] }), 1);
  assert.deepEqual([r.kind.value, r.kind.code], ['on', 'lights']);
  r = watch(A.create(), scene({ room: 30, spots: [{ x: 0.3, y: 0.5, r: 3, rgb: CYAN }, { x: 0.7, y: 0.4, r: 3, rgb: MAGENTA }] }), 1);
  assert.deepEqual([r.kind.value, r.kind.code, r.kind.vars], ['marker', 'markers', { a: 'cyan', b: 'magenta' }]);
  r = watch(A.create(), scene({ room: 110 }), 1);
  assert.deepEqual([r.kind.value, r.kind.code], ['hand', 'room']);
  // one marker alone is no pair of markers; markers win over a bright room (they were put on for a reason)
  assert.equal(watch(A.create(), scene({ room: 110, spots: [{ x: 0.3, y: 0.5, r: 3, rgb: GREEN }] }), 1).kind.value, 'hand');
  assert.equal(watch(A.create(), scene({ room: 110, spots: [{ x: 0.3, y: 0.5, r: 3, rgb: GREEN }, { x: 0.7, y: 0.5, r: 3, rgb: MAGENTA }] }), 1).kind.value, 'marker');
  // every reason is a sentence
  for (const code of ['markers', 'fire', 'lights', 'room', 'wait', 'shortLights', 'shortBurnt', 'normalHand', 'normalLook', 'noOne', 'one', 'edge', 'lone', 'calibNone', 'calibOk', 'calibMoved', 'calibDark'])
    assert.ok(A.why(code, { a: 'cyan', b: 'magenta', n: 2 }).length > 10, code);
  assert.equal(A.why('constructor'), ''); assert.equal(A.why('no-such'), '');
});

test('a new proposal must hold before the kind changes: no flapping', () => {
  const auto = A.create(), room = scene({ room: 110 }), fire = scene({ room: 12, spots: [{ x: 0.5, y: 0.5, r: 4, rgb: FIRE }] });
  let r = watch(auto, room, 2);
  assert.equal(r.kind.value, 'hand');
  r = watch(auto, fire, 1, r.t + 0.5, r.now);          // the light goes out and a torch is lit: not yet …
  assert.equal(r.kind.value, 'hand', 'one second is no decision');
  r = watch(auto, room, 1, r.t + 0.5, r.now);          // … and the light is back: nothing happened
  assert.equal(r.kind.value, 'hand');
  r = watch(auto, fire, A.SETTLE + 1, r.t + 0.5, r.now);
  assert.deepEqual([r.kind.value, r.kind.code], ['on', 'fire'], 'after a few seconds it is fire');
  // a flicker of single frames never switches
  const flap = A.create(); let now = { kind: 'hand', short: false }, kinds = new Set();
  for (let t = 0; t < 30; t += 0.5) { const x = flap.look(look(Math.round(t * 2) % 2 ? fire : room), now, t); kinds.add(x.kind.value); now = { kind: x.kind.value, short: x.short.value }; }
  assert.equal(kinds.size, 1);
});

test('the exposure: short for lights, normal for the hand AI – and the short exposure does not fool the automatic', () => {
  const auto = A.create(), fire = scene({ room: 12, spots: [{ x: 0.5, y: 0.5, r: 4, rgb: FIRE }] });
  let r = watch(auto, fire, 2);
  assert.deepEqual([r.short.value, r.short.code], [true, 'shortLights']);
  assert.deepEqual([watch(A.create(), scene({ room: 110 }), 2).short.value, watch(A.create(), scene({ room: 110 }), 2).short.code], [false, 'normalHand']);
  const burnt = A.create().look(look(scene({ room: 12, spots: [{ x: 0.5, y: 0.5, r: 4, rgb: WHITE }] })), { kind: 'on', short: false }, 0);
  assert.deepEqual([burnt.short.value, burnt.short.code], [true, 'shortBurnt']);
  // in a bright room with markers the exposure is short: every room is black then. The automatic keeps the brightness
  // it knew – it does not take the black picture for a dark room and the markers' absence for "fire or nothing"
  const m = A.create(), lit = scene({ room: 110, spots: [{ x: 0.3, y: 0.5, r: 3, rgb: CYAN }, { x: 0.7, y: 0.5, r: 3, rgb: MAGENTA }] });
  r = watch(m, lit, 2);
  assert.deepEqual([r.kind.value, r.short.value], ['marker', true]);
  const black = scene({ room: 4, spots: [{ x: 0.3, y: 0.5, r: 3, rgb: CYAN }, { x: 0.7, y: 0.5, r: 3, rgb: MAGENTA }] });   // the same room, short exposure
  r = watch(m, black, 10, r.t + 0.5, r.now);
  assert.equal(r.kind.value, 'marker'); assert.ok(r.room > 0.3, 'the room is still known as bright');
  // a kind chosen by hand gets the exposure it needs, whatever the automatic would have chosen
  const byHand = A.create().look(look(scene({ room: 110 })), { kind: 'on', short: false, hand: true }, 0);
  assert.deepEqual([byHand.kind.value, byHand.short.value], ['hand', true]);
  assert.equal(A.create().look(look(fire), { kind: 'hand', short: true, hand: true }, 0).short.value, false);
  // the lights go out for good: after a while a normal exposure, to look at the room again
  r = watch(auto, scene({ room: 3 }), 25, 3, { kind: 'on', short: true });
  assert.deepEqual([r.kind.value, r.short.value, r.short.code], ['on', false, 'normalLook']);
});

test('the one person: the performer is followed, whoever stands at the edge is ignored', () => {
  const auto = A.create(), poi = (x, y) => [{ x: x - 0.06, y, w: 1 }, { x: x + 0.06, y: y + 0.03, w: 1 }];
  let p = auto.person([...poi(0.5, 0.5), { x: 0.05, y: 0.6, w: 1 }, { x: 0.95, y: 0.4, w: 3 }], 0);   // two phones in the audience, one of them brighter
  assert.deepEqual(p.keep, [0, 1]); assert.equal(p.ignored, 2); assert.equal(p.code, 'edge'); assert.deepEqual(p.vars, { n: 2 });
  // the performer wanders to the edge: still followed, still only them
  for (let i = 1; i <= 40; i++) p = auto.person([...poi(0.5 + i * 0.01, 0.5), { x: 0.05, y: 0.6, w: 1 }], i * 0.1);
  assert.deepEqual(p.keep, [0, 1]); assert.ok(p.centre[0] > 0.8, `the middle went along: ${p.centre[0]}`);
  // lost for a moment (a turn, a dip of the flame): nobody from the audience steps in
  p = auto.person([{ x: 0.05, y: 0.6, w: 1 }], 4.5);
  assert.deepEqual(p.keep, []); assert.equal(p.ignored, 1);
  p = auto.person(poi(0.88, 0.5), 5.5);
  assert.deepEqual(p.keep, [0, 1], 'and the performer is back');
  // gone for good: the next one in the middle is the performer
  for (let t = 6; t < 10; t += 0.5) p = auto.person([], t);
  assert.equal(p.code, 'noOne'); assert.equal(p.centre, null);
  p = auto.person([{ x: 0.1, y: 0.5, w: 5 }, { x: 0.45, y: 0.5, w: 1 }], 10);
  assert.deepEqual(p.keep, [1], 'the one in the middle, not the bright one at the edge');
  // someone alone at the edge is the performer after all – when they stay
  const lone = A.create();
  assert.deepEqual(lone.person([{ x: 0.08, y: 0.5, w: 1 }], 0).keep, []);
  assert.deepEqual(lone.person([{ x: 0.08, y: 0.5, w: 1 }], 2).keep, []);
  p = lone.person([{ x: 0.08, y: 0.5, w: 1 }], 3.1);
  assert.deepEqual([p.keep, p.code], [[0], 'lone']);
  // odd input never breaks it
  for (const odd of [null, undefined, [], [{ x: NaN, y: 0.5 }], [{}]]) assert.deepEqual(A.create().person(odd, 0).keep, []);
});

test('the calibration: the same view in other light is the same view, a moved camera is not', () => {
  // a room with structure: a window, a shelf, a door – as brightness per pixel
  const w = 160, h = 90, room = (dx = 0, gain = 1, lift = 0) => { const g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = x - dx; let v = 40 + 0.2 * u;
      if (u > 20 && u < 50 && y > 10 && y < 40) v = 200; if (u > 90 && u < 100) v = 15; if (y > 70) v = 90 + 0.3 * u; if (u > 120 && u < 150 && y > 30 && y < 60) v = 140;
      g[y * w + x] = Math.max(0, Math.min(255, v * gain + lift)); } return g; };
  const was = A.signature(room(), w, h);
  assert.equal(was.length, A.GW * A.GH); assert.match(was, /^[0-9]+$/);
  let s = A.sameView(was, A.signature(room(0, 0.6, 20), w, h));
  assert.ok(s.known && s.score > 0.9, `darker and flatter, the same view: ${s.score}`);
  s = A.sameView(was, A.signature(room(40), w, h));
  assert.ok(s.known && s.score < 0.35, `the camera was turned: ${s.score}`);
  // Dream's own projection does not count: it changes all the time
  const quad = [[0.3, 0.2], [0.7, 0.2], [0.7, 0.8], [0.3, 0.8]], skip = (x, y) => A.inQuad(quad, x, y);
  const lit = room(); for (let y = 18; y < 72; y++) for (let x = 48; x < 112; x++) lit[y * w + x] = 255;
  s = A.sameView(A.signature(room(), w, h, skip), A.signature(lit, w, h, skip));
  assert.ok(s.known && s.score > 0.95, 'whatever is projected, the room around it is the same');
  assert.ok(A.signature(room(), w, h, skip).includes('-'));
  assert.equal(A.inQuad(quad, 0.5, 0.5), true); assert.equal(A.inQuad(quad, 0.1, 0.5), false); assert.equal(A.inQuad([[0, 0], [0, 0], [0, 0], [0, 0]], 0.5, 0.5), false);
  // a dark or plain picture says nothing – and nothing is claimed
  const flat = A.signature(new Uint8Array(w * h).fill(8), w, h);
  assert.equal(A.sameView(was, flat).known, false);
  for (const odd of [null, '', 'abc', 7, was.slice(1)]) assert.equal(A.sameView(was, odd).known, false);
  // the automatic says "moved" only after three looks in a row, and takes it back when the view matches again
  const auto = A.create(), turned = A.signature(room(40), w, h);
  assert.deepEqual(auto.view('', was), { code: 'calibNone', hint: false });
  assert.equal(auto.view(was, A.signature(room(0, 0.8), w, h)).code, 'calibOk');
  assert.equal(auto.view(was, turned).hint, false); assert.equal(auto.view(was, turned).hint, false);
  const third = auto.view(was, turned);
  assert.deepEqual([third.code, third.hint], ['calibMoved', true]);
  assert.equal(auto.view(was, flat).hint, true, 'the light going out does not take the hint back');
  assert.deepEqual([auto.view(was, was).code, auto.view(was, was).hint], ['calibOk', false]);
  assert.equal(A.create().view(was, flat).code, 'calibDark');
});
