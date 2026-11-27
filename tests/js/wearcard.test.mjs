// #277: the worn devices in the panel (static/wearcard.js) – what each line says and offers (allow the clutch once, or
// revoke), what the line under the list says, and the word under the clutch's button when the wrist steers it or is gone.
// Run: node --test tests/js/wearcard.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const W = require('../../static/wearcard.js');
const stick = (over = {}) => ({ id: 'a1b2c3d4e5f6', name: 'StickS3 E5F6', kind: 'sticks3', live: true, seen: 0, battery: 80, rate: 50,
  paired: false, ready: false, refused: 0, firmware: '1.0.0', ...over });
const matrix = (over = {}) => ({ id: '0a0b0c0d0e0f', name: 'ATOM Matrix 0E0F', kind: 'matrix', live: true, seen: 0, battery: -1, rate: 0,
  paired: false, ready: false, refused: 0, firmware: '1.0.0', ...over });

test('a StickS3 that is there but not allowed offers "allow" and says its button does nothing yet', () => {
  const [r] = W.items([stick()]);
  assert.equal(r.action, 'allow'); assert.equal(r.icon, '⌚'); assert.equal(r.live, true); assert.equal(r.warn, false);
  assert.match(r.state, /50 values\/s · battery 80 %/); assert.match(r.note, /only once you allow it/);
  const [pressed] = W.items([stick({ refused: 3 })]);                          // pressed while not allowed: said plainly
  assert.match(pressed.note, /pressed 3× – not allowed yet/); assert.equal(pressed.warn, true);
  const [away] = W.items([stick({ live: false, seen: 40 })]);                   // not there: nothing to allow (Dream refuses it too)
  assert.equal(away.action, null); assert.match(away.state, /gone for 40 s/);
});

test('an allowed StickS3 offers "revoke"; it is ready once it confirmed its key; gone it says the clutch stays', () => {
  assert.match(W.items([stick({ paired: true, waiting: true })])[0].note, /waiting for the device to confirm/);
  const [lost] = W.items([stick({ paired: true, waiting: false })]);            // the key never arrived: said, and how to fix it
  assert.match(lost.note, /did not get its key – revoke and allow it again/); assert.equal(lost.warn, true);
  const [ready] = W.items([stick({ paired: true, ready: true })]);
  assert.equal(ready.action, 'revoke'); assert.match(ready.note, /engages and releases the clutch/);
  const [gone] = W.items([stick({ paired: true, ready: true, live: false, seen: 300, battery: -1 })]);
  assert.equal(gone.action, 'revoke'); assert.equal(gone.warn, true); assert.match(gone.note, /clutch stays as it was/); assert.match(gone.state, /gone for 5 min/);
  assert.match(W.items([stick({ paired: true, live: false, seen: null })])[0].state, /not seen since Dream started/);
});

test('a display needs no word of the owner and shows no rate; a low battery is marked', () => {
  const [m] = W.items([matrix({ battery: 12, low: true })]);
  assert.equal(m.action, null); assert.equal(m.note, ''); assert.equal(m.state, 'battery 12 % ⚠'); assert.match(m.role, /display/);
  assert.deepEqual(W.items([matrix()])[0].state, '');
});

test('what came over the connection is only shown, never called', () => {
  const odd = W.items([{ id: 'x', kind: 'constructor', name: '<b>x</b>'.repeat(20), live: true }, null, { kind: 'sticks3' }]);
  assert.equal(odd.length, 1); assert.equal(odd[0].icon, '•'); assert.equal(odd[0].role, ''); assert.ok(odd[0].name.length <= 40);
  assert.deepEqual(W.items('nonsense'), []);
});

test('the line under the list: without --lan, nothing yet, and the port', () => {
  assert.match(W.statusText({ lan: false, port: 7020, devices: [] }), /only on this Mac – start it with --lan/);
  assert.match(W.statusText({ lan: true, port: 7020, advert: true, devices: [] }), /No worn device yet.*Port 7020, announced/);
  assert.equal(W.statusText({ lan: true, port: 7021, advert: false, devices: [stick()] }), 'Port 7021 – enter this Mac’s address in the device’s setup');
});

test('under the clutch: the wrist steers it, or it is gone and the clutch stays', () => {
  assert.deepEqual(W.clutchLine([stick(), matrix()]), { text: '', warn: false });        // nothing allowed: no word
  assert.deepEqual(W.clutchLine([stick({ paired: true, ready: true })]), { text: '⌚ StickS3 E5F6: the button on the wrist engages and releases.', warn: false });
  const gone = W.clutchLine([stick({ paired: true, ready: true, live: false })]);
  assert.equal(gone.warn, true); assert.match(gone.text, /StickS3 E5F6 is gone – the clutch stays as it is/);
});

test('worn blind: a low battery is a warning, and the last press is said', () => {
  const [low] = W.items([stick({ paired: true, ready: true, battery: 12, low: true })]);
  assert.equal(low.warn, true); assert.match(low.state, /battery 12 % ⚠/);
  assert.equal(W.items([stick({ paired: true, ready: true })])[0].last, '');
  assert.equal(W.items([stick({ paired: true, ready: true, last: { on: true, ago: 12 } })])[0].last, 'Last press: engaged, 12 s ago');
  assert.equal(W.lastText({ on: false, ago: 600 }), 'Last press: released, 10 min ago');
  assert.equal(W.lastText('x'), ''); assert.equal(W.items([matrix({ last: { on: true, ago: 1 } })])[0].last, '');
});
