// #272: the Hue lamps in the panel's Output card (static/huecard.js) – what the status line says at each step, the
// pair button, the list of rooms and lamps with their switches; the card is the panel's alone.
// Run: node --test tests/js/huecard.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const H = require('../../static/huecard.js');
const A = '11111111-1111-4111-8111-000000000001', B = '33333333-3333-4333-8333-000000000001';
const lamps = [{ id: 'g:' + B, name: 'Living room', kind: 'room', colour: true },
  { id: 'l:' + A, name: 'Signe floor', kind: 'light', colour: true },
  { id: 'l:2', name: 'Plain', kind: 'light', colour: false }];

test('the status line says what to do next, step by step', () => {
  assert.match(H.say({ st: 'nohost' }), /Enter the address/);
  assert.match(H.say({ st: 'unpaired', host: '192.168.1.2' }), /press “Pair”, then the round button/);
  assert.match(H.say({ st: 'unpaired', error: 'nobutton' }), /not pressed in time/);
  assert.match(H.say({ st: 'unpaired', error: 'revoked' }), /no longer knows Dream/);
  assert.match(H.say({ st: 'unpaired', error: '__proto__' }), /Not paired yet/);    // an odd word: the plain text
  assert.equal(H.say({ st: 'pairing', left: 27 }), 'Now press the round button on the bridge … 27 s');
  assert.match(H.say({ st: 'ready', name: 'Hue Bridge', lamps }, false, ''), /choose the lamps and rooms/);
  assert.match(H.say({ st: 'ready', name: 'Hue Bridge', lamps }, false, 'l:' + A), /switch on/);
  assert.equal(H.say({ st: 'live', name: 'Hue Bridge', n: 1 }), 'Live: one lamp of Hue Bridge dreams along');
  assert.equal(H.say({ st: 'live', name: 'Hue Bridge', n: 3 }), 'Live: 3 lamps of Hue Bridge dream along');
  assert.match(H.say({ st: 'down', name: 'Hue Bridge' }), /tries again by itself/);
  assert.match(H.say({ st: 'cert', host: '192.168.1.2' }), /does not give it the key/);
  assert.equal(H.say({ st: 'something new' }), '');
});

test('the pair button: only when a bridge answers, waiting while the button is to be pressed', () => {
  assert.deepEqual(H.pairText({ st: 'looking' }), { text: '🔗 Pair', disabled: true });
  assert.deepEqual(H.pairText({ st: 'unpaired' }), { text: '🔗 Pair', disabled: false });
  assert.equal(H.pairText({ st: 'pairing' }).disabled, true);
  assert.deepEqual(H.pairText({ st: 'live', paired: true }), { text: '🔗 Pair again', disabled: false });
});

test('the list: rooms and lamps, each with its switch, the choice kept in order and nothing twice', () => {
  const rows = H.items({ lamps }, 'l:' + A);
  assert.deepEqual(rows.map(r => [r.label, r.kind, r.checked]), [['🏠 Living room', 'Room', false], ['💡 Signe floor', '', true], ['💡 Plain', '', false]]);
  assert.equal(rows[2].colour, false);
  assert.equal(H.toggled('l:' + A, 'g:' + B, true), `l:${A}+g:${B}`);
  assert.equal(H.toggled(`l:${A}+g:${B}`, 'l:' + A, false), 'g:' + B);
  assert.equal(H.toggled('l:' + A, 'l:' + A, true), 'l:' + A);
  assert.deepEqual(H.items({}, ''), []);
});

test('the panel has the card, its script and every element it needs; Dream Control has none of it', () => {
  const html = readFileSync(new URL('../../static/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<script src="/static/huecard.js">'));
  for (const id of ['huerow', 'hue_lamps', 'hueglow', 'hue_bridge', 'huefind', 'huefound', 'huepair', 'hueunpair', 'huelist', 'hue_lamps_amt', 'v-hue_lamps_amt', 'huestat'])
    assert.ok(html.includes(`id="${id}"`), id);
  const remote = readFileSync(new URL('../../static/remote.html', import.meta.url), 'utf8');
  assert.ok(!remote.includes('huecard') && !remote.includes('hue_pair'));
});
