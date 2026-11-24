// #251: what the pages of the movement modes share (static/movepage.js) – finding the stage that opened the page, and
// the two clocks. And the page of Dream Dance itself: a window of its own that reads the stage, never Dream directly.
// Run: node --test tests/js/movepage.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const P = require('../../static/movepage.js'), C = require('../../static/movecard.js');
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('the bridge is the opener’s – or nothing', () => {
  const bridge = { state: () => ({}) };
  assert.equal(P.find('dance', { opener: { closed: false, DreamBridge: { dance: bridge } } }), bridge);
  assert.equal(P.find('dance', { opener: null }), null, 'opened by hand: no stage');
  assert.equal(P.find('dance', { opener: { closed: true, DreamBridge: { dance: bridge } } }), null, 'the stage was closed');
  assert.equal(P.find('dance', { opener: { closed: false } }), null, 'the stage is still loading');
  assert.equal(P.find('flowtrack', { opener: { closed: false, DreamBridge: { dance: bridge } } }), null, 'another page’s bridge is not this one’s');
  const foreign = { get opener() { throw new Error('another site'); } };
  assert.equal(P.find('dance', foreign), null, 'a window of another site: nothing, and no error');
});

test('the page follows the stage: there, gone, back again', () => {
  const said = [], timers = [];
  const win = { opener: { closed: false }, setInterval: f => { timers.push(f); return 1; }, clearInterval() {}, location: { reload: () => said.push('reload') } };
  const link = P.link('dance', { win, on: () => said.push('on'), lost: () => said.push('lost'), again: () => said.push('again') });
  assert.deepEqual(said, [], 'the stage is loading: wait');
  const first = { n: 1 }; win.opener.DreamBridge = { dance: first }; timers[0]();
  assert.deepEqual(said, ['on']); assert.equal(link.bridge, first);
  timers[0](); assert.deepEqual(said, ['on'], 'nothing changed: nothing happens');
  delete win.opener.DreamBridge; timers[0]();          // the stage reloads
  assert.deepEqual(said, ['on', 'lost']); assert.equal(link.bridge, null);
  win.opener.DreamBridge = { dance: { n: 2 } }; timers[0]();
  assert.deepEqual(said, ['on', 'lost', 'again'], 'what was mounted belonged to the old stage: start anew');
  // a stage that was replaced between two looks is a new stage too
  const said2 = [], t2 = [], w2 = { opener: { closed: false, DreamBridge: { dance: {} } }, setInterval: f => { t2.push(f); return 1; }, clearInterval() {} };
  P.link('dance', { win: w2, on: () => said2.push('on'), again: () => said2.push('again') });
  w2.opener.DreamBridge = { dance: {} }; t2[0]();
  assert.deepEqual(said2, ['on', 'again']);
});

test('the two clocks: who gives the beat', () => {
  const c = (bpm, on = true) => ({ on, bpm, pulse: 0.5 });
  assert.equal(P.agree(null, null), 'none');
  assert.equal(P.agree(c(0, false), c(120, false)), 'none');
  assert.equal(P.agree(c(96), c(0, false)), 'move');
  assert.equal(P.agree(c(0, false), c(120)), 'music');
  assert.equal(P.agree(c(120), c(122)), 'together');
  assert.equal(P.agree(c(60), c(121)), 'together', 'half time is the same beat');
  assert.equal(P.agree(c(240), c(118)), 'together', 'double time too');
  assert.equal(P.agree(c(100), c(128)), 'apart');
  assert.equal(P.clockText(c(96.4)), '96 a minute'); assert.equal(P.clockText(c(0, false)), '–'); assert.equal(P.clockText(null), '–');
  assert.match(P.agreeText(c(120), c(121)), /both clocks agree/);
  const dot = { style: {} };
  P.beat(dot, { on: true, bpm: 100, pulse: 1 }); assert.deepEqual(dot.style, { opacity: '1.00', transform: 'scale(1.20)' });
  P.beat(dot, { on: true, bpm: 100, pulse: 0 }); assert.deepEqual(dot.style, { opacity: '0.30', transform: 'scale(0.75)' });
  P.beat(dot, null); assert.deepEqual(dot.style, { opacity: '0.15', transform: 'scale(0.70)' });
});

test('a key of the page is not a letter of a name', () => {
  const key = (tagName, type, more = {}) => ({ target: { tagName, type }, ...more });
  assert.equal(P.typing(key('BODY')), false); assert.equal(P.typing(key('BUTTON')), false);
  assert.equal(P.typing(key('INPUT', 'range')), false); assert.equal(P.typing(key('INPUT', 'checkbox')), false);
  assert.equal(P.typing(key('INPUT', 'text')), true); assert.equal(P.typing(key('SELECT')), true); assert.equal(P.typing(key('TEXTAREA')), true);
  assert.equal(P.typing(key('BODY', '', { repeat: true })), true); assert.equal(P.typing(key('BODY', '', { metaKey: true })), true);
});

test('the clutch and the sets say the same in the panel, on the page and in Dream Control', () => {
  assert.equal(C.clutchText(true), 'Clutch: engaged'); assert.equal(C.clutchText(false), 'Clutch: released');
  assert.equal(C.setLabel('waves'), 'Waves'); assert.equal(C.setLabel('My set 1'), 'My set 1'); assert.equal(C.setLabel('constructor'), 'constructor');
  for (const page of ['static/index.html', 'static/remote.html', 'static/dance.html']) {
    const html = read(page);
    assert.ok(/id="clutchbtn"[^>]*aria-pressed=/.test(html) && html.includes('id="dance_set"'), page);
    assert.ok(html.includes('MoveCard.clutchText') && html.includes('MoveCard.fillSets'), page);
  }
});

test('the page of Dream Dance reads the stage and never talks to Dream itself', () => {
  const html = read('static/dance.html');
  assert.ok(html.includes("MovePage.link('dance'"));
  assert.ok(!/new WebSocket|fetch\(|XMLHttpRequest|getUserMedia/.test(html), 'no connection and no camera of its own');
  for (const part of ['id="clutchbtn"', 'id="dance_set"', 'id="setsave"', 'id="dot-move"', 'id="dot-music"', 'id="dancelab"']) assert.ok(html.includes(part), part);
  // the stage has no lab of its own any more: the lab is the page
  const stage = read('static/index.html');
  assert.ok(!stage.includes('dancelab.js') && !stage.includes('id="dancelab"'));
  assert.ok(stage.includes("window.open('/dance'") && stage.includes('window.DreamBridge'));
  // only transform and opacity move
  for (const m of read('static/movepage.css').matchAll(/transition:\s*([^;]+);/g)) {
    if (m[1].trim() === 'none') continue;
    for (const part of m[1].split(',')) assert.match(part.trim().split(/\s+/)[0], /^(opacity|transform)$/, m[0]);
  }
});
