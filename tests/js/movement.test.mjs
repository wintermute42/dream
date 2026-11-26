// #249: the movement engine (static/movement.js) – the register of sources, the room's energy, the modes as presets of
// the mapping table and the soft change between them. No camera, no model, no browser.
// Run: node --test tests/js/movement.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const M = require('../../static/movement.js'), Map_ = require('../../static/dancemap.js'), D = require('../../static/dance.js');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const row = (id, src, dst, more = {}) => ({ id, on: true, src, dst, curve: 'lin', in: [0, 1], out: [0, 1], smooth: 0, origin: 'fixed', ...more });
// a record of the feature stream with this energy, as dance.js gives it
const rec = (energy, c = 1, more = {}) => ({ t: 0, v: { energy, still: 0, open: 0.5, ...more }, c: { energy: c, still: c, open: c }, src: { energy: 'pose' }, bpm: 0, gesture: null, gc: 0, size: 0, g: {}, hands: { l: null, r: null }, events: [] });
const eyes = (energy, conf = 1, more = {}) => ({ id: 'eyes:' + Math.random(), kind: 'eyes', name: 'Dreamy Eyes', on: true, used: true, active: true, rate: 5, conf, energy, ...more });
const TABLES = { mood: [row('m', 'energy', 'fx.pulse')], flowtrack: [row('f', 'present', 'touch.paint')], dance: [row('d', 'energy', 'fx.kaleido')] };
const run = (eng, input, seconds, dt = 1 / 60) => { let out; for (let t = 0; t < seconds; t += dt) out = eng.step({ tables: TABLES, dt, ...input }); return out; };

test('the modes and the kinds of sources are the ones Dream knows', () => {
  const py = readFileSync(new URL('../../settings.py', import.meta.url), 'utf8');
  const tuple = name => JSON.parse('[' + py.match(new RegExp(name + ' = \\(([^)]*)\\)'))[1].replace(/,\s*$/, '') + ']');
  assert.deepEqual(Object.keys(M.MODES), tuple('MOVE_MODES'));
  assert.deepEqual(M.KINDS, tuple('MOVE_SOURCES'));
  const mv = readFileSync(new URL('../../movement.py', import.meta.url), 'utf8');
  for (const [mode, m] of Object.entries(M.MODES)) {
    const line = mv.match(new RegExp(`"${mode}": \\{"sources": \\(([^)]*)\\), "camera": (True|False)\\}`));
    assert.ok(line, mode);
    assert.deepEqual(m.sources, JSON.parse('[' + line[1].replace(/,\s*$/, '') + ']'), mode);
    assert.equal(m.camera, line[2] === 'True', mode);
  }
  assert.deepEqual(M.TABLES, ['mood', 'flowtrack', 'dance']);
});

test('the Mac camera runs only for a mode that needs it', () => {
  assert.equal(M.cameraOn('off'), false);
  assert.equal(M.cameraOn('flowtrack'), true);
  assert.equal(M.cameraOn('dance'), true);
  assert.equal(M.cameraOn('mood'), false, 'the mood runs without the camera');
  assert.equal(M.cameraOn('mood', { cam: true }), true, '… unless asked');
  assert.equal(M.cameraOn('off', { cam: true }), false);
  assert.equal(M.cameraOn('dance', { off: 'eyes+camera' }), false, 'switched off is off');
  for (const odd of [undefined, null, 'party', 'constructor', '__proto__', 3, {}]) assert.equal(M.cameraOn(odd, { cam: true }), false, String(odd));
  assert.equal(M.uses('mood', 'eyes'), true);
  assert.equal(M.uses('dance', 'eyes'), false, 'the dance does not listen to the room');
  assert.equal(M.uses('mood', 'eyes', { off: 'eyes' }), false);
  assert.equal(M.uses('mood', 'window'), false, 'dream windows are no source');
});

test('the energy of the room is a mean weighted by confidence', () => {
  assert.deepEqual(M.room([]), { energy: 0, conf: 0 });
  near(M.room([{ energy: 0.8, conf: 1 }, { energy: 0.2, conf: 1 }]).energy, 0.5);
  const r = M.room([{ energy: 1, conf: 0.1 }, { energy: 0, conf: 0.9 }]);
  near(r.energy, 0.1); near(r.conf, 0.91);
  // one lively device among five quiet ones does not rule the room
  assert.ok(M.room([...Array(5).fill({ energy: 0.05, conf: 0.8 }), { energy: 1, conf: 0.8 }]).energy < 0.25);
  // what is not sure at all, or no number, does not count
  near(M.room([{ energy: 1, conf: 0 }, { energy: NaN, conf: 1 }, { energy: 0.3, conf: 0.5 }]).energy, 0.3);
  near(M.room([{ energy: 7, conf: 1 }]).energy, 1);
});

test('all sources feed the one stream: the camera, Dreamy Eyes, and both together', () => {
  const eng = M.create({ maps: Map_ });
  // the camera's stream alone
  near(run(eng, { mode: 'mood', rec: rec(0.6) }, 0.1)['fx.pulse'], 0.6, 1e-3);
  assert.equal(eng.frame.src.energy, 'pose');
  // the stream and two pairs of eyes: the mean of the three
  near(run(eng, { mode: 'mood', rec: rec(0.6), remote: [eyes(0.3), eyes(0.0)] }, 0.1)['fx.pulse'], 0.3, 1e-3);
  assert.equal(eng.frame.src.energy, 'pose+eyes');
  // no camera at all: the mood runs from the eyes alone
  near(run(eng, { mode: 'mood', rec: null, remote: [eyes(0.8), eyes(0.4)] }, 0.1)['fx.pulse'], 0.6, 1e-3);
  assert.equal(eng.frame.src.energy, 'eyes');
  assert.equal(eng.frame.v.present, 1);
  // eyes that are silent, switched off or not this mode's do not count; nothing at all: nothing moves
  const out = run(eng, { mode: 'mood', rec: null, remote: [eyes(1, 1, { active: false }), eyes(1, 1, { used: false }), eyes(1, 0)] }, 0.1);
  assert.deepEqual(out, {});
  assert.equal(eng.frame.v.present, 0);
  // a camera that sees someone but no hands yet still gives its energy
  near(run(eng, { mode: 'mood', rec: null, cam: { energy: 0.5, conf: 0.5 } }, 0.1)['fx.pulse'], 0.5, 1e-3);
  // the rest of the stream's record passes through untouched: a table reads it as before
  eng.step({ mode: 'dance', tables: TABLES, rec: rec(0.4, 1, { open: 0.77 }), dt: 1 / 60 });
  assert.equal(eng.frame.v.open, 0.77);
});

test('phones and wristbands reach the room through the stream, not twice', () => {
  // dance.js weighs the sensor against the camera; the register lists the device, the mean does not count it again
  const eng = M.create({ maps: Map_ });
  const phone = { ...eyes(1), kind: 'phone', id: 'phone:x' };
  near(run(eng, { mode: 'mood', rec: rec(0.2), remote: [phone] }, 0.1)['fx.pulse'], 0.2, 1e-3);
  const det = D.create();
  let r; for (let i = 0; i < 30; i++) r = det.step({ t: i / 30, hands: { l: null, r: null }, sensor: { g: [4, 0, 0], age: 0 } });
  assert.ok(r.v.energy > 0.3 && r.src.energy === 'sensor', 'a sensor alone is energy in the stream');
});

test('a still room is stillness, and movement ends it at once', () => {
  const eng = M.create({ maps: Map_ });
  run(eng, { mode: 'mood', rec: null, remote: [eyes(0)] }, 2);
  assert.ok(eng.frame.v.still > 0.95 && eng.frame.c.still === 1);
  run(eng, { mode: 'mood', rec: null, remote: [eyes(0.6)] }, 0.3);
  assert.ok(eng.frame.v.still < 0.1);
  run(eng, { mode: 'mood', rec: null, remote: [] }, 0.5);
  assert.equal(eng.frame.c.still, 0, 'nobody reports: nothing is known, so nothing calms');
});

test('a mode is only its table: the same stream, another preset', () => {
  for (const [mode, want] of [['mood', ['fx.pulse']], ['flowtrack', ['touch.paint']], ['dance', ['fx.kaleido']], ['off', []]]) {
    const eng = M.create({ maps: Map_ });
    assert.deepEqual(Object.keys(run(eng, { mode, rec: rec(0.5) }, 0.1)), want, mode);
  }
  // off is off: no record is made, no table applied
  const eng = M.create({ maps: Map_ });
  run(eng, { mode: 'off', rec: rec(1), remote: [eyes(1)] }, 0.2);
  assert.equal(eng.frame, null);
  near(eng.room.conf, 0);
});

test('a change of mode fades: the old effect goes out while the new one comes in, never a jolt', () => {
  const eng = M.create({ maps: Map_ }), dt = 1 / 60;
  run(eng, { mode: 'dance', rec: rec(0.8) }, 0.5);
  let was = eng.step({ mode: 'dance', tables: TABLES, rec: rec(0.8), dt }), top = 0, both = false;
  near(was['fx.kaleido'], 0.8, 1e-3);
  for (let t = 0; t < 1.2; t += dt) {                 // … to flowtrack, then on to the mood in the middle of the fade
    const now = eng.step({ mode: t < 0.3 ? 'flowtrack' : 'mood', tables: TABLES, rec: rec(0.8), dt });
    for (const k of ['fx.kaleido', 'touch.paint', 'fx.pulse']) top = Math.max(top, Math.abs((now[k] || 0) - (was[k] || 0)));
    if (now['fx.kaleido'] > 0.05 && now['touch.paint'] > 0.05) both = true;
    was = now;
  }
  assert.ok(top < 0.06, `largest step in one frame: ${top.toFixed(3)}`);
  assert.ok(both, 'for a moment both act');
  assert.deepEqual(Object.keys(was), ['fx.pulse'], 'then only the new mode acts');
  near(was['fx.pulse'], 0.8, 1e-3);
  assert.equal(eng.gain('dance'), 0); assert.equal(eng.gain('mood'), 1);
  // switching off fades out as well
  const first = eng.step({ mode: 'off', tables: TABLES, rec: rec(0.8), dt });
  assert.ok(first['fx.pulse'] > 0.7, 'not gone in one frame');
  assert.deepEqual(run(eng, { mode: 'off', rec: rec(0.8) }, M.FADE + 0.1), {});
  // the page's first frame starts in its mode: a reload does not fade in
  const fresh = M.create({ maps: Map_ });
  near(fresh.step({ mode: 'dance', tables: TABLES, rec: rec(0.8), dt })['fx.kaleido'], 0.8, 1e-3);
});

test('the mood and the dance have a strength; flowtrack is not scaled by it', () => {
  const eng = M.create({ maps: Map_ });
  near(run(eng, { mode: 'mood', rec: rec(0.4), strength: 0.5 }, 0.1)['fx.pulse'], 0.2, 1e-3);
  near(run(eng, { mode: 'mood', rec: rec(0.4), strength: 2 }, 0.1)['fx.pulse'], 0.8, 1e-3);
  near(run(eng, { mode: 'mood', rec: rec(0.9), strength: 3 }, 0.1)['fx.pulse'], 1, 1e-3);   // never more than all of it
  assert.deepEqual(run(eng, { mode: 'mood', rec: rec(0.9), strength: 0 }, 0.1), { 'fx.pulse': 0 });
  // #265: the dance's "Movement – strength" tunes all its sentences together
  near(run(M.create({ maps: Map_ }), { mode: 'dance', rec: rec(0.6), strength: 0.5 }, 0.1)['fx.kaleido'], 0.3, 1e-3);
  assert.deepEqual(run(M.create({ maps: Map_ }), { mode: 'dance', rec: rec(0.6), strength: 0 }, 0.1), { 'fx.kaleido': 0 });
  near(run(M.create({ maps: Map_ }), { mode: 'flowtrack', rec: rec(0.4), strength: 0 }, 0.1)['touch.paint'], 1, 1e-3);
});

test('the register lists the Mac camera first, with its state, then the others', () => {
  const eng = M.create({ maps: Map_ });
  eng.step({ mode: 'mood', tables: TABLES, remote: [eyes(0.3, 0.8, { id: 'eyes:1' }), eyes(0.1, 0.8, { id: 'eyes:2' })], dt: 1 / 60 });
  let list = eng.sources('mood', { off: '', cam: false }, { running: false });
  assert.deepEqual(list.map(s => s.id), ['camera', 'eyes:1', 'eyes:2']);
  assert.deepEqual({ ...list[0], name: 0 }, { id: 'camera', kind: 'camera', name: 0, on: true, used: false, active: false, rate: 0, conf: 0, energy: 0 });
  list = eng.sources('dance', { off: 'camera' }, { running: true, rate: 29.6, conf: 0.9, energy: 0.4 });
  assert.deepEqual([list[0].on, list[0].used, list[0].active, list[0].rate, list[0].conf], [false, false, true, 30, 0.9]);
  const kinds = M.byKind(list);
  assert.deepEqual(kinds.map(k => [k.kind, k.n]), [['camera', 1], ['eyes', 2], ['phone', 0], ['band', 0]]);
});

test('Dreamy Eyes: energy from two small pictures, only numbers', () => {
  const w = 16, h = 12, pic = fn => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const v = fn(i % w, (i / w) | 0); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; } return d; };
  const s = M.sight();
  let r = s.look(pic(() => 120), w, h, 0);
  assert.deepEqual(r, { e: 0, c: 0 }, 'one picture is no movement yet');
  r = s.look(pic(() => 120), w, h, 0.07);
  assert.equal(r.e, 0); assert.equal(r.c, 1);
  // noise of the camera (a few grey steps everywhere) is not movement
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 1; i <= 10; i++) r = s.look(pic(() => 120 + (rnd() - 0.5) * 16), w, h, 0.07 + i * 0.07);
  assert.equal(r.e, 0);
  // someone moves through a third of the picture: energy at once …
  for (let i = 0; i < 4; i++) r = s.look(pic((x) => (x >= i * 2 && x < i * 2 + 5 ? 220 : 120)), w, h, 1 + i * 0.07);
  assert.ok(r.e > 0.5, `energy ${r.e}`);
  // … and gone again within about a second of rest
  for (let i = 0; i < 20; i++) r = s.look(pic(() => 120), w, h, 1.3 + i * 0.07);
  assert.ok(r.e < 0.1, `energy ${r.e}`);
  // a dark picture is mostly noise: less sure
  const dark = M.sight(); dark.look(pic(() => 6), w, h, 0);
  assert.equal(dark.look(pic(() => 6), w, h, 0.07).c, 0.2);
  // what it returns is two numbers – nothing of the picture
  assert.deepEqual(Object.keys(r), ['e', 'c']);
  // a picture of another size starts anew instead of comparing what cannot be compared
  assert.equal(s.look(new Uint8ClampedArray(8 * 8 * 4), 8, 8, 3).c, 0);
});

test('the built-in presets through the real tables: the mood has no gestures and calms a still room', () => {
  // the tables as dance.py builds them, read from its source: ids, sources and targets of the mood
  const py = readFileSync(new URL('../../dance.py', import.meta.url), 'utf8');
  const mood = [...py.match(/MOOD_ROWS = \[([\s\S]*?)\n\]/)[1].matchAll(/_row\("(\w+)", "([\w.]+)", "([\w.]+)"/g)].map(m => ({ id: m[1], src: m[2], dst: m[3] }));
  assert.ok(mood.length >= 5);
  assert.ok(mood.every(r => r.src === 'energy' || r.src === 'still'), 'the mood knows only energy and stillness');
  const known = Map_.targets(['kaleido', 'trails', 'feedback']);
  for (const r of mood) assert.ok(known[r.dst], r.dst + ' is a target of the one interface');
  assert.equal(known['touch.paint'], 'instant'); assert.equal(known['ai.prompt'], 'slow'); assert.equal(known['stage.calm'], 'instant');
  // a still room: the table's row to "stage.calm" rises, slowly
  const eng = M.create({ maps: Map_ }), tables = { mood: [row('calm', 'still', 'stage.calm', { in: [0.5, 1], smooth: 3 })] };
  let out; for (let t = 0; t < 12; t += 1 / 30) out = eng.step({ mode: 'mood', tables, rec: null, remote: [eyes(0)], dt: 1 / 30 });
  assert.ok(out['stage.calm'] > 0.9);
  for (let t = 0; t < 0.5; t += 1 / 30) out = eng.step({ mode: 'mood', tables, rec: null, remote: [eyes(0.7)], dt: 1 / 30 });
  assert.ok(out['stage.calm'] < 0.9, 'movement wakes it');
});

// ---------- #251: the clutch of the dance, and the dance on top of the base ----------
test('the clutch: released, the dance is gone in a third of a second – engaged, back as softly', () => {
  const eng = M.create({ maps: Map_ }), dt = 1 / 60;
  run(eng, { mode: 'dance', rec: rec(0.8), clutch: true }, 0.3);
  let was = eng.step({ mode: 'dance', tables: TABLES, rec: rec(0.8), clutch: true, dt })['fx.kaleido'], top = 0;
  near(was, 0.8, 1e-3);
  const at = {};
  for (let t = dt; t <= 0.5; t += dt) {
    const now = eng.step({ mode: 'dance', tables: TABLES, rec: rec(0.8), clutch: false, dt })['fx.kaleido'] || 0;
    top = Math.max(top, Math.abs(now - was)); was = now;
    if (t >= 0.15 && at.half === undefined) at.half = now;
    if (t >= M.CLUTCH + dt && at.end === undefined) at.end = now;
  }
  assert.ok(top < 0.08, `largest step in one frame: ${top.toFixed(3)}`);
  assert.ok(at.half > 0.2 && at.half < 0.6, `half way: ${at.half}`);
  assert.equal(at.end, 0, 'after about 0.3 s only the base is left');
  assert.equal(eng.hold, 0);
  // engaged again: in again, as softly
  top = 0; was = 0;
  for (let t = 0; t < 0.5; t += dt) { const now = eng.step({ mode: 'dance', tables: TABLES, rec: rec(0.8), clutch: true, dt })['fx.kaleido'] || 0; top = Math.max(top, Math.abs(now - was)); was = now; }
  assert.ok(top < 0.08); near(was, 0.8, 1e-3);
  assert.ok(Math.abs(M.CLUTCH - 0.3) < 1e-9);
});

test('the clutch is the dance’s: the mood and flowtrack act whatever it says', () => {
  for (const [mode, key] of [['mood', 'fx.pulse'], ['flowtrack', 'touch.paint']]) {
    const eng = M.create({ maps: Map_ });
    assert.ok(run(eng, { mode, rec: rec(0.8), clutch: false }, 0.5)[key] > 0.7, mode);
  }
  // a page that loads with the clutch released starts released – no flash of the dance
  const eng = M.create({ maps: Map_ });
  assert.equal(eng.step({ mode: 'dance', tables: TABLES, rec: rec(0.8), clutch: false, dt: 1 / 60 })['fx.kaleido'] || 0, 0);
});

test('the dance acts on top of the base: a controller moved while dancing shifts the base, the dance stays on top', () => {
  near(M.onTop(0.2, 0.3), 0.5);
  near(M.onTop(0.5, 0.3), 0.8);                        // the base moved up: the dance is still its 0.3 on top
  near(M.onTop(0.5, 0), 0.5);                          // clutch released (the dance's part is 0): only the base
  near(M.onTop(0.9, 0.3), 1);                          // never past the target's range
  near(M.onTop(0.2, -0.5), 0);
  near(M.onTop(0.1, -0.5, -1, 1), -0.4);               // a target that goes both ways
  near(M.onTop(undefined, 0.3), 0.3); near(M.onTop(NaN, NaN), 0); near(M.onTop('0.25', 0.25), 0.5);
  // through the engine: the same dance, two bases
  const eng = M.create({ maps: Map_ });
  const dance = run(eng, { mode: 'dance', rec: rec(0.4), clutch: true }, 0.2)['fx.kaleido'];
  near(M.onTop(0.1, dance) - M.onTop(0.3, dance), -0.2);
});

test('a mode has its own detection: light chosen for flowtrack never becomes the dance\'s', () => {
  assert.equal(M.camKind('flowtrack', { flow: 'on', dance: 'hand' }), 'on');
  assert.equal(M.camKind('dance', { flow: 'on', dance: 'hand' }), 'hand', 'flowtrack with LEDs, then Dream Dance: hands');
  assert.equal(M.camKind('dance', { flow: 'marker', dance: 'hand' }), 'hand');
  assert.equal(M.camKind('dance', { flow: 'hand', dance: 'marker' }), 'marker', 'markers only when chosen for the dance');
  assert.equal(M.camKind('mood', { flow: 'marker', dance: 'hand' }), 'marker');
  assert.equal(M.camKind('dance', { flow: 'on', dance: 'on' }), 'hand', 'the dance never runs on light');
  assert.equal(M.camKind('dance', {}), 'hand'); assert.equal(M.camKind('flowtrack', { flow: '__proto__' }), 'hand');
});
