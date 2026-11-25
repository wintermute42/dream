// #250: the movement card (static/movecard.js) – what it says: the energy of the room in a word, the chips of the
// sources, what Dream detects in one line. And the card's markup in both pages: the same modes as Dream knows.
// Run: node --test tests/js/movecard.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const C = require('../../static/movecard.js'), M = require('../../static/movement.js');
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const src = (kind, more = {}) => ({ id: kind + ':' + Math.random(), kind, name: kind, on: true, used: true, active: true, rate: 5, conf: 0.8, energy: 0.3, ...more });

test('the modes of the card are the modes of the engine, in both pages', () => {
  assert.deepEqual(C.MODES, Object.keys(M.MODES));
  for (const page of ['static/index.html', 'static/remote.html']) {
    const html = read(page), card = html.slice(html.indexOf('id="movecard"'), html.indexOf('</select>', html.indexOf('id="move_mode"')));
    assert.deepEqual([...card.matchAll(/<button type="button" data-mode="(\w+)"/g)].map(m => m[1]), C.MODES, page + ': one button per mode');
    assert.deepEqual([...card.matchAll(/<option value="(\w+)"/g)].map(m => m[1]), C.MODES, page + ': the setting it holds');
    assert.equal((card.match(/aria-pressed="true"/g) || []).length, 1, page + ': one mode at a time');
    assert.ok(html.includes('/static/movecard.js') && html.includes('/static/movecard.css'), page);
  }
});

test('the energy of the room in a word', () => {
  assert.equal(C.words(null), 'no source');
  assert.equal(C.words({ energy: 0.9, conf: 0 }), 'no source', 'nobody reports: nothing is known');
  assert.deepEqual([0, 0.1, 0.3, 0.6, 0.95].map(energy => C.words({ energy, conf: 0.8 })), ['still', 'calm', 'moving', 'lively', 'wild']);
});

test('the sources: one chip per kind, with its state', () => {
  const uses = mode => kind => M.uses(mode, kind, {});
  let chips = C.chips([src('camera', { active: false }), src('eyes'), src('eyes', { rate: 6, conf: 0.6 })], uses('mood'), '');
  assert.deepEqual(chips.map(c => c.kind), M.KINDS);
  const by = Object.fromEntries(chips.map(c => [c.kind, c]));
  assert.deepEqual([by.eyes.label, by.eyes.live, by.eyes.rate, by.eyes.state], ['Dreamy Eyes (2)', true, 11, '11 values/s · 70 % sure']);
  assert.deepEqual([by.camera.used, by.camera.live, by.camera.state], [false, false, 'not used by this mode']);
  assert.deepEqual([by.phone.n, by.phone.live, by.phone.state], [0, false, 'nothing comes']);
  // switched off: it says so and its light is out, even while values come
  chips = C.chips([src('eyes')], uses('mood'), 'eyes+band');
  assert.deepEqual(chips.filter(c => !c.on).map(c => c.kind), ['eyes', 'band']);
  assert.deepEqual([chips[1].live, chips[1].state], [false, 'switched off']);
  // a kind the mode does not listen to is never "live"
  assert.equal(C.chips([src('eyes')], uses('dance'), '')[1].live, false);
  assert.equal(C.chips([src('camera')], uses('dance'), '')[0].live, true);
});

test('what Dream detects, in one line', () => {
  assert.equal(C.info('flowtrack', { running: true, kind: 'on', rate: 29.6, present: true }), 'Detects: Fire/LED · 30 values/s · someone there');
  assert.equal(C.info('flowtrack', { running: true, kind: 'hand', rate: 12, present: false }), 'Detects: Hands (AI) · 12 values/s · nobody');
  assert.equal(C.info('flowtrack', { running: false, status: 'No camera' }), 'No camera', 'what is wrong comes first');
  assert.equal(C.info('flowtrack', null), 'The camera is starting …');
  assert.equal(C.info('flowtrack', { running: true, kind: '__proto__', rate: 1, present: false }), 'Detects: __proto__ · 1 values/s · nobody');
  assert.equal(C.info('dance', { live: true, gesture: 'Circling', sure: 0.82, bpm: 96.4 }), 'Circling · 82 % sure · 96 a minute');
  assert.equal(C.info('dance', { live: true, gesture: null, bpm: 0 }), 'no gesture');
  assert.equal(C.info('dance', { live: false }), 'Waiting for movement …');
  assert.equal(C.info('mood', {}), ''); assert.equal(C.info('off', {}), '');
});

test('a mode nobody knows is shown as off', () => {
  assert.equal(C.name('party'), 'Off'); assert.equal(C.name('constructor'), 'Off'); assert.equal(C.name('dance'), 'Dream Dance');
});

test('the card moves only transform and opacity', () => {
  const css = read('static/movecard.css');
  for (const m of css.matchAll(/transition:\s*([^;]+);/g)) {
    if (m[1].trim() === 'none') continue;
    for (const part of m[1].split(',')) assert.match(part.trim().split(/\s+/)[0], /^(opacity|transform|visibility)$/, m[0]);
  }
  // #265: one animation – the symbol of the traffic light that blocks pulses: transform only, and never with reduced motion
  assert.deepEqual([...css.matchAll(/animation\s*:\s*([\w-]+)/g)].map(m => m[1]).filter(n => n !== 'none'), ['mc-pulse']);
  for (const m of css.matchAll(/@keyframes[^{]+\{((?:[^{}]*\{[^{}]*\})+)/g)) for (const p of m[1].matchAll(/([a-z-]+)\s*:/g)) assert.ok(['opacity', 'transform'].includes(p[1]), p[1]);
  assert.ok(/prefers-reduced-motion: reduce\) \{ \.mc-sym\[data-state=block\] \{ animation: none; \}/.test(css));
});
