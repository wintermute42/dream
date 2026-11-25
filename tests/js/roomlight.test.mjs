// #212: the stage's part of the room light (static/roomlight.js) – the average colour of what the audience sees, how
// often it looks, and that it says nothing while the light is off.
// Run: node --test tests/js/roomlight.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { create, mean, sway, SIDE, EVERY, RISE, REST } = require('../../static/roomlight.js');

// what the stage hands out: SIDE × SIDE RGBA pixels of one colour, the first `part` of them in another
function picture(rgb, other, part = 0) {
  const px = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let i = 0; i < SIDE * SIDE; i++) px.set([...(i < part ? other : rgb), 255], i * 4);
  return px;
}

test('the average colour of the drawn pixels; nothing drawn is no colour', () => {
  assert.deepEqual(mean(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255])), [128, 0, 128]);
  assert.equal(mean(new Uint8ClampedArray(16)), null);                    // all transparent
  assert.deepEqual(mean(new Uint8ClampedArray([200, 100, 0, 255, 9, 9, 9, 0])), [200, 100, 0]);   // the transparent one does not count
});

test('it looks every EVERY ms while on, and tells the colour, a beat and a flash', () => {
  const sent = [];
  let half = false;
  const light = create({ send: m => sent.push(m), pixels: (w, h) => {
    assert.equal(w, SIDE); assert.equal(h, SIDE);
    return half ? picture([0, 0, 200], [200, 0, 0], SIDE * SIDE / 2) : picture([0, 0, 200]);
  } });
  light.beat(1); light.flash(1);
  assert.equal(light.tick(0), false);                                    // off: nothing, not even a look
  assert.deepEqual(sent, []);
  light.on = true;
  assert.equal(light.tick(1000), true);
  assert.equal(light.tick(1000 + EVERY / 2), false);                     // not yet again
  half = true;
  assert.equal(light.tick(1000 + EVERY), true);
  assert.deepEqual(sent, [{ led: { rgb: [0, 0, 200] } }, { led: { rgb: [100, 0, 100] } }]);
  light.beat(0.8123); light.flash(); light.beat(0);
  assert.deepEqual(sent.slice(2), [{ led: { beat: 0.812 } }, { led: { flash: 1 } }]);
  assert.ok(light.cost >= 0);
  light.reset();
  assert.equal(light.cost, 0);
});

test('no copy of the picture yet: nothing is sent (never a black flash)', () => {
  const sent = [];
  for (const px of [null, new Uint8ClampedArray(SIDE * SIDE * 4)]) {
    const light = create({ send: m => sent.push(m), pixels: () => px });
    light.on = true;
    assert.equal(light.tick(0), false);
  }
  assert.deepEqual(sent, []);
});

// ---------- #270: the dance on the LED chain ----------
const record = (l, r) => ({ hands: { l, r } });

test('an accent sets off one flash and one running pulse – again only after its target was back at rest', () => {
  const sent = [];
  const light = create({ send: m => sent.push(m.led), pixels: () => picture([0, 0, 200]) });
  light.on = true;
  let t = 0;
  const frame = out => light.dance(out, null, (t += 16));
  frame({});
  for (let i = 0; i < 30; i++) frame({ 'led.flash': 0.8, 'led.chase': 0.6 });   // one gesture, held for half a second
  frame({ 'led.flash': RISE * 0.9, 'led.chase': RISE * 0.9 });                   // a dip that is no rest: still the same one
  frame({ 'led.flash': 0.8, 'led.chase': 0.6 });
  assert.deepEqual(sent, [{ dflash: 0.8 }, { chase: 0.6, dir: 1 }]);
  frame({ 'led.flash': REST / 2, 'led.chase': 0 });
  frame({ 'led.flash': 1, 'led.chase': 1 });
  assert.equal(sent.length, 4);
  light.on = false;
  frame({}); frame({ 'led.flash': 1 });
  assert.equal(sent.length, 4, 'nothing while the light is off');
});

test('the running pulse goes the way the hands went just now', () => {
  const s = sway();
  let t = 0;
  for (let i = 0; i < 20; i++) s.step(record([0.1 + i * 0.03, 0], [0.5, 0]).hands, (t += 16));    // the left hand moves right
  assert.equal(s.dir, 1);
  for (let i = 0; i < 20; i++) s.step(record([0.7, 0], [0.5 - i * 0.04, 0]).hands, (t += 16));   // the right hand moves left, faster
  assert.equal(s.dir, -1);
  for (let i = 0; i < 60; i++) s.step(record(null, [0, 0]).hands, (t += 16));                     // still: no way
  assert.equal(s.dir, 0);
  const sent = [], light = create({ send: m => sent.push(m.led), pixels: () => picture([0, 0, 200]) });
  light.on = true; t = 0;
  for (let i = 0; i < 20; i++) light.dance({}, record(null, [0.6 - i * 0.04, 0]), (t += 16));
  for (let i = 0; i < 30; i++) light.dance({}, record(null, [-0.2, 0]), (t += 16));        // the hand has stopped by then
  light.dance({ 'led.chase': 1 }, record(null, [-0.2, 0]), (t += 16));
  assert.deepEqual(sent, [{ chase: 1, dir: -1 }], 'the last way it went');
});

test('the brightness travels with the colour, once more as 0 when it is gone, and not at all without a dance', () => {
  const sent = [];
  const light = create({ send: m => sent.push(m.led), pixels: () => picture([0, 0, 200]) });
  light.on = true;
  light.tick(0);
  light.dance({ 'led.level': -0.4 }, null, EVERY); light.tick(EVERY);
  light.dance({}, null, 2 * EVERY); light.tick(2 * EVERY); light.tick(3 * EVERY);
  assert.deepEqual(sent.map(m => m.dim), [undefined, 0.4, 0, undefined]);
});
