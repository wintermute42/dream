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
  assert.match(P.agreeText(c(120), c(121)), /both beats agree/);
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
  // released – how Dream starts – is said plainly: the button's state, its word and the line below it
  const attrs = {}, btn = { setAttribute: (k, v) => { attrs[k] = v; }, classList: { toggle: (c, on) => { attrs.on = on; } } }, note = {};
  C.clutchShow(btn, false, note);
  assert.deepEqual([attrs['aria-pressed'], attrs.on, btn.textContent], ['false', false, 'Clutch: released']);
  assert.match(note.textContent, /^Released: your dance does nothing yet/);
  C.clutchShow(btn, true, note);
  assert.deepEqual([attrs['aria-pressed'], attrs.on, btn.textContent], ['true', true, 'Clutch: engaged']);
  assert.match(note.textContent, /^Engaged: /);
  assert.equal(C.setLabel('waves'), 'Waves'); assert.equal(C.setLabel('My set 1'), 'My set 1'); assert.equal(C.setLabel('constructor'), 'constructor');
  for (const page of ['static/index.html', 'static/remote.html', 'static/dance.html']) {
    const html = read(page);
    assert.ok(/id="clutchbtn"[^>]*aria-pressed=/.test(html) && html.includes('id="dance_set"'), page);
    assert.ok(html.includes('MoveCard.clutchShow(') && html.includes('MoveCard.fillSets'), page);
  }
});

test('the page of Dream Dance reads the stage and never talks to Dream itself', () => {
  const html = read('static/dance.html');
  assert.ok(html.includes("MovePage.link('dance'"));
  assert.ok(!/new WebSocket|fetch\(|XMLHttpRequest|getUserMedia/.test(html), 'no connection and no camera of its own');
  for (const part of ['id="clutchbtn"', 'id="dance_set"', 'id="setsave"', 'id="dot-move"', 'id="dot-music"', 'id="dancelab"']) assert.ok(html.includes(part), part);
  // the detection is chosen on the page itself: the dance's own (hands or markers – never light), and the camera
  const kind = html.match(/<select id="dance_kind"[^]*?<\/select>/)[0];
  assert.ok(kind.includes('value="hand"') && kind.includes('value="marker"') && !kind.includes('value="on"'));
  assert.ok(html.includes('id="flow_device"') && html.includes('bridge.setKind(') && html.includes('id="detectstate"'));
  assert.ok(html.includes('<h2>Beat</h2>') && !/Clocks?</.test(html), 'the card is called “Beat”');
  const bridge = read('static/index.html');
  for (const part of ['setKind:', 'setCam:', 'setFingers:', 'detect:']) assert.ok(bridge.includes(part), part);
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

test('the page of Flowtrack: the automatic with its reasons, the effect per target – and nothing of its own', () => {
  const html = read('static/flowtrack.html');
  assert.ok(html.includes("MovePage.link('flowtrack'"));
  assert.ok(!/new WebSocket|fetch\(|XMLHttpRequest|getUserMedia/.test(html), 'no connection and no camera of its own');
  // every choice of the automatic: its value, its reason, the hand's own choice, and the way back to the automatic
  for (const k of ['kind', 'short', 'person']) for (const part of ['-value', '-why', '-by', '-auto', '-tag']) assert.ok(html.includes(`id="${k}${part}"`), k + part);
  for (const part of ['id="autobtn"', 'id="calib-why"', 'id="calib-go"', 'id="unproject"', 'id="effects"', 'id="dancelab"']) assert.ok(html.includes(part), part);
  const stage = read('static/index.html');
  assert.ok(stage.includes('window.DreamBridge.flowtrack') && stage.includes("window.open('/flowtrack'"));
  assert.ok(stage.includes('id="flowautobtn"'), 'the automatic\'s switch is in the panel too');
});

// ---- the Detection card of the page: two choices of the stage (what is detected, which camera), shown by the page ----
// a <select> as the browser has one: a value it has no option for selects nothing
class Select {
  constructor(values = []) { this.options = values.map(v => ({ value: v, textContent: v })); this.dataset = {}; this.at = this.options.length ? 0 : -1; }
  get value() { return this.at < 0 ? '' : this.options[this.at].value; }
  set value(v) { this.at = this.options.findIndex(o => o.value === String(v)); }
  set textContent(t) { this.options = []; this.at = -1; }
  append(o) { this.options.push(o); if (this.at < 0) this.at = 0; }
}
const doc = () => ({ activeElement: null, createElement: () => ({}) });
// the part of the stage the page reads and steers, as static/index.html offers it
function stage() {
  const s = { kind: 'hand', cam: '', cams: [['', 'Camera: as picture'], ['Front camera', 'Front camera'], ['Infrared', 'Infrared']], mode: 'dance', camera: 'running' };
  return { s, state: () => ({ ...s, tracking: s.kind, clutch: false, hold: 0, set: '', sets: [], own: [], move: null, music: null }),
    setKind: v => { s.kind = v; }, setCam: v => { s.cam = v; } };
}

test('the camera’s select holds the cameras the stage knows, the one in use chosen', () => {
  const d = doc(), sel = new Select(['']), b = stage();
  assert.equal(P.fillCams(sel, b.state().cams, b.state().cam, d), 2);
  assert.deepEqual(sel.options.map(o => [o.value, o.textContent]), b.s.cams); assert.equal(sel.value, '');
  // the stage lists its cameras only once the browser named them: the select follows when they come
  const late = new Select(['']);
  assert.equal(P.fillCams(late, [['', 'Camera: as picture']], '', d), 0, 'none named yet: the page says so');
  assert.equal(late.options.length, 1);
  assert.equal(P.fillCams(late, b.s.cams, 'Infrared', d), 2);
  assert.deepEqual(late.options.map(o => o.value), ['', 'Front camera', 'Infrared']); assert.equal(late.value, 'Infrared');
  // filled anew only when the list changed – an open select is not rebuilt under the hand
  const same = late.options; P.fillCams(late, b.s.cams.map(c => [...c]), 'Infrared', d); assert.equal(late.options, same);
  // a stage that tells no list (too old, reloading): never an empty select, and the choice stays
  for (const none of [undefined, null, [], 'x']) {
    const e = new Select(['']); assert.equal(P.fillCams(e, none, undefined, d), 0);
    assert.deepEqual(e.options.map(o => o.value), ['']); assert.ok(e.options[0].textContent); assert.equal(e.value, '');
  }
  // a camera chosen once and unplugged keeps its place
  const gone = new Select(['']); P.fillCams(gone, [['', 'Camera: as picture']], 'Infrared', d);
  assert.deepEqual(gone.options.map(o => o.value), ['', 'Infrared']); assert.equal(gone.value, 'Infrared');
});

test('choosing a camera never changes what is detected, and both selects follow the stage', () => {
  const d = doc(), kind = new Select(['hand', 'marker']), cam = new Select(['']), b = stage();
  const tick = () => { const st = b.state(); P.pick(kind, st.kind, d); P.fillCams(cam, st.cams, st.cam, d); };
  tick(); assert.deepEqual([kind.value, cam.value], ['hand', '']);
  // the user chooses the markers on the page …
  d.activeElement = kind; kind.value = 'marker'; b.setKind(kind.value); tick();
  // … then goes to the camera's select and chooses one
  d.activeElement = cam; tick(); assert.equal(kind.value, 'marker', 'leaving the first select keeps its choice');
  cam.value = 'Infrared'; b.setCam(cam.value); tick(); d.activeElement = null; tick();
  assert.deepEqual([kind.value, cam.value], ['marker', 'Infrared']); assert.deepEqual([b.s.kind, b.s.cam], ['marker', 'Infrared']);
  // the panel's Movement card changes them: the page follows, each select by itself
  b.s.kind = 'hand'; tick(); assert.deepEqual([kind.value, cam.value], ['hand', 'Infrared']);
  b.s.cam = 'Front camera'; tick(); assert.deepEqual([kind.value, cam.value], ['hand', 'Front camera']);
  // while the user is in a select, the stage does not pull it away
  d.activeElement = kind; kind.value = 'marker'; tick(); assert.equal(kind.value, 'marker');
  d.activeElement = null;
  // what the stage does not tell, or a kind the page does not have (Flowtrack's light), leaves the choice alone
  for (const odd of [undefined, null, '', 'on', 7]) { kind.value = 'marker'; assert.equal(P.pick(kind, odd, d), false); assert.equal(kind.value, 'marker', String(odd)); }
});

test('a stage window from before an update is not shown half: the page asks for a reload', () => {
  const needs = { calls: ['state', 'setKind', 'setCam', 'lab.detect'], state: ['kind', 'cams'] };
  const fresh = { state: () => ({ kind: 'hand', cams: [] }), setKind() {}, setCam() {}, lab: { detect() {} } };
  const stale = { state: () => ({ mode: 'dance', camera: 'running' }), lab: {} };
  assert.deepEqual(P.missing(fresh, needs), []);
  assert.deepEqual(P.missing(stale, needs), ['setKind', 'setCam', 'lab.detect', 'state.kind', 'state.cams']);
  assert.deepEqual(P.missing({ state() { throw new Error('reloading'); } }, { state: ['kind'] }), ['state.kind']);
  const said = [], timers = [];
  const win = { opener: { closed: false, DreamBridge: { dance: stale }, location: { reload: () => said.push('stage reloads') } }, setInterval: f => { timers.push(f); return 1; }, clearInterval() {} };
  const link = P.link('dance', { win, needs, on: () => said.push('on'), old: names => said.push('old ' + names.length), lost: () => said.push('lost'), again: () => said.push('again') });
  assert.deepEqual(said, ['old 5']); assert.equal(link.bridge, null, 'never handed to the page');
  timers[0](); assert.deepEqual(said, ['old 5'], 'said once');
  assert.equal(P.reloadStage(win), true); assert.equal(P.reloadStage({ opener: null }), false);
  delete win.opener.DreamBridge; timers[0](); win.opener.DreamBridge = { dance: fresh }; timers[0]();
  assert.deepEqual(said, ['old 5', 'stage reloads', 'lost', 'on'], 'the new stage fits: the page starts without a reload of its own');
  assert.equal(link.bridge, fresh);
});

test('why nothing runs, and what to do', () => {
  const st = (more = {}) => ({ mode: 'dance', camera: 'running', tracking: 'hand', kind: 'hand', ...more });
  assert.deepEqual(P.detectText(st()), { on: true, text: 'Running now: Hands (AI)' });
  assert.deepEqual(P.detectText(st({ tracking: 'marker' })), { on: true, text: 'Running now: LED markers' });
  const why = more => { const r = P.detectText(st(more), '', 'Mood'); assert.equal(r.on, false); assert.ok(!/Running now/.test(r.text) && r.text.length > 30, r.text); return r.text; };
  assert.match(why({ mode: 'off' }), /movement is off.*Switch to Dream Dance/);
  assert.match(why({ mode: 'mood' }), /mode is “Mood”.*Switch to Dream Dance/);
  assert.match(why({ camera: 'camera' }), /camera is being opened/);
  assert.match(why({ camera: 'loading' }), /model for the hands is loading/);
  assert.match(why({ camera: 'nocam' }), /no camera.*Allow the camera/);
  assert.match(why({ camera: 'nomodel' }), /could not be loaded.*LED markers/);
  assert.match(why({ camera: 'off' }), /switched off as a source.*Sources/);
  assert.match(why({ tracking: 'off' }), /detection has not started/);
  assert.match(why({ tracking: undefined }), /detection has not started/, 'never “Running now: nothing”');
  assert.equal(P.detectText(st({ camera: 'later' }), 'Some new state').text, 'Nothing runs: Some new state');
});

// what a page uses of its bridge is on its list of needs, and the stage's bridge offers all of it
function contract(page, from) {
  const html = read(page), stageHtml = read('static/index.html');
  const needs = new Function('return ' + html.match(/const NEEDS = (\{[^;]+\});/)[1])();
  // the stage's script from where the bridges begin: the parts the bridges share, and the bridges themselves
  const bridge = stageHtml.slice(stageHtml.indexOf('const labOpts = {'), stageHtml.indexOf('setInterval(() => { if (labApi'));
  const script = html.slice(html.lastIndexOf('<script>'));
  const calls = new Set([...script.matchAll(/\bbridge\.((?:lab\.)?\w+)\(/g)].map(m => m[1]));
  const state = new Set([...script.matchAll(/\bst\.(\w+)\b/g)].map(m => m[1]));
  for (const c of calls) assert.ok(needs.calls.includes(c), page + ': needs.calls lacks ' + c);
  for (const k of state) assert.ok(needs.state.includes(k), page + ': needs.state lacks ' + k);
  for (const c of needs.calls) assert.match(bridge, new RegExp('\\b' + c.split('.').pop() + '(:|\\(| = |,)'), page + ': ' + c);
  const told = bridge.slice(bridge.indexOf(from)); assert.ok(bridge.includes(from), page);
  for (const k of needs.state) assert.match(told.slice(told.indexOf('state: () =>')), new RegExp('\\b' + k + '(:|,)'), page + ': state.' + k);
  assert.ok(html.includes('needs: NEEDS') && html.includes('id="oldstage"') && html.includes('MovePage.reloadStage()'), page);
  return { html, script, calls, state };
}

test('the pages name what they need of the stage, and the stage has it', () => {
  const { html, script, calls, state } = contract('static/dance.html', 'window.DreamBridge = { dance: {');
  assert.ok(calls.has('setKind') && calls.has('setCam') && state.has('cams') && state.has('kind'));
  const flow = contract('static/flowtrack.html', 'window.DreamBridge.flowtrack = {');
  assert.ok(flow.calls.has('setKind') && flow.state.has('kind') && flow.state.has('calib'));
  // both selects are labelled, the camera's is never empty, and only the helpers write a choice of the stage into them
  assert.match(html, /<label for="dance_kind">/); assert.match(html, /<label for="flow_device">Camera<\/label>/);
  assert.match(html, /<select id="flow_device"[^>]*>\s*<option value="">/);
  assert.ok(html.includes("MovePage.pick($('dance_kind'), st.kind)") && html.includes("MovePage.fillCams($('flow_device'), st.cams, st.cam)") && html.includes('id="camnote"'));
  assert.ok(!/\$\('(dance_kind|flow_device)'\)\.value = /.test(script), 'no select is written past the helpers');
  assert.ok(html.includes('MovePage.detectText(') && !html.includes("T('nothing')"));
});
