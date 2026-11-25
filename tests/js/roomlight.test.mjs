// #212: the stage's part of the room light (static/roomlight.js) – the average colour of what the audience sees, how
// often it looks, and that it says nothing while the light is off.
// Run: node --test tests/js/roomlight.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { create, mean, SIDE, EVERY } = require('../../static/roomlight.js');

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
