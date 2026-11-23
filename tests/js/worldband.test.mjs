// #224: the band of worlds (static/worldband.js) – how the style worlds are chosen in the panel and in Dream Control:
// one small picture per world Dream knows, a tap fades over to it, where the crossfade stands, the drift's switch and
// pace, and the line that says what is going on. What is shown and asked for as plain values in Node (with the German
// of static/i18n/de.json), the controls themselves in a headless Chrome (tests/js/worldband.html).
// Run: node --test tests/js/worldband.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ROOT, findChrome, runPage } from './browser.mjs';

const read = name => readFileSync(path.join(ROOT, name), 'utf8');
const de = JSON.parse(read('static/i18n/de.json'));
const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
const lang = { de: false };
globalThis.I18N = { t: (text, vars) => fill(lang.de ? (assert.ok(text in de, `no German for: ${text}`), de[text]) : text, vars) };   // as static/i18n.js
const W = createRequire(import.meta.url)('../../static/worldband.js');
const WORLDS = /^WORLDS = \(([^)]*)\)/m.exec(read('settings.py'))[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
const german = f => { lang.de = true; try { return f().replace(/­/g, ''); } finally { lang.de = false; } };
const chrome = findChrome();

test('every world Dream knows has its name, its short name and a few words about it – in German too', () => {
  assert.ok(WORLDS.length >= 5 && WORLDS[0] === 'classic');
  for (const w of WORLDS) {
    assert.ok(Object.hasOwn(W.NAMES, w) && Object.hasOwn(W.ABOUT, w), `static/worldband.js has no name for the world '${w}'`);
    for (const say of [W.name, W.short, W.about]) { assert.ok(say(w).length > 2); assert.ok(german(() => say(w)).length > 2); }
    assert.ok(W.about(w).startsWith(W.name(w) + ' – '));
  }
  assert.deepEqual(german(() => WORLDS.slice(0, 5).map(W.short).join()), 'Klassisch,Biolumineszenz,Tusche,Kupferstich,Aurora');
  assert.ok(de.Bioluminescence.includes('­') && de.Engraving.includes('­'), 'long names may break under a narrow picture');
  assert.equal(W.name('new-world'), 'New-world', 'a world without a line of its own is shown by its name');
  assert.equal(W.name('constructor'), 'Constructor');
});

test('what the settings mean: the world that shows most, and the one it is blended with', () => {
  const v = (world, world_to, world_mix) => { const r = W.view({ world, world_to, world_mix }); return [r.cur, r.next, r.mixing, r.mix]; };
  assert.deepEqual(v('ink', 'aurora', 0), ['ink', null, false, 0]);
  assert.deepEqual(v('ink', 'aurora', 0.32), ['ink', 'aurora', true, 0.32]);
  assert.deepEqual(v('ink', 'aurora', 0.5), ['aurora', 'ink', true, 0.5]);
  assert.deepEqual(v('ink', 'aurora', 1), ['aurora', null, false, 1]);
  assert.deepEqual(v('ink', 'ink', 0.7), ['ink', null, false, 0], 'one world: nothing to blend');
  assert.deepEqual(v('ink', undefined, 'x'), ['ink', null, false, 0]);
  assert.deepEqual(v('ink', 'aurora', 7), ['aurora', null, false, 1]);
});

test('a tap fades over to that world: that world alone, the one after it as the next target', () => {
  assert.deepEqual(W.tap(WORLDS, 'ink'), { world: 'ink', world_to: WORLDS[(WORLDS.indexOf('ink') + 1) % WORLDS.length], world_mix: 0 });
  assert.deepEqual(W.tap(WORLDS, WORLDS.at(-1)), { world: WORLDS.at(-1), world_to: 'classic', world_mix: 0 });
  assert.equal(W.tap(WORLDS, 'no-such-world'), null);
  assert.deepEqual(W.tap(['classic'], 'classic'), { world: 'classic', world_to: 'classic', world_mix: 0 });
});

test('the switch and the pace: off is 0, on is the pace it last had (calm at first)', () => {
  assert.deepEqual(W.PACES, [300, 120, 45]);
  assert.deepEqual([W.auto(false, 300), W.auto(true, 300), W.auto(true, 0), W.auto(true, undefined), W.auto(true, 77)], [0, 300, 120, 120, 77]);
  const settings = read('settings.py');
  assert.match(settings, new RegExp(`"world_auto": num\\(${W.PACE}, 0, 900\\)`), 'calm is the pace a new Dream wanders at');
});

test('the line that says what is going on', () => {
  const st = { world: 'classic', world_to: 'deepsea', world_mix: 0.32, world_auto: 120 };
  assert.equal(german(() => W.status(st, { wait: 0, next: null }, 0)), 'gerade: Klassisch → Biolumineszenz · 32 %');
  assert.equal(german(() => W.status({ ...st, world_mix: 0 }, { wait: 0, next: 40 }, 0)), 'gerade: Klassisch · nächste Welt in 0:40');
  assert.equal(german(() => W.status({ ...st, world_mix: 0 }, { wait: 0, next: 40 }, 12.3)), 'gerade: Klassisch · nächste Welt in 0:28', 'it counts down by itself');
  assert.equal(german(() => W.status({ ...st, world_mix: 0 }, { wait: 0, next: 40 }, 99)), 'gerade: Klassisch · nächste Welt in 0:00');
  assert.equal(german(() => W.status({ ...st, world: 'deepsea', world_to: 'ink', world_mix: 0 }, { wait: 180, next: null }, 20)), 'Biolumineszenz gewählt · Wandern pausiert noch 2:40');
  assert.equal(german(() => W.status({ ...st, world_mix: 0.8 }, { wait: 61 }, 0)), 'Biolumineszenz gewählt · Wandern pausiert noch 1:01', 'a hand on the mix: the world that shows most');
  assert.equal(german(() => W.status({ ...st, world_mix: 0.8 }, { wait: 61 }, 61)), 'gerade: Klassisch → Biolumineszenz · 80 %', 'the wait is over: it goes on from there');
  assert.equal(german(() => W.status({ ...st, world_auto: 0 }, { wait: 99, next: 5 }, 0)), 'Klassisch · Wandern aus');
  assert.equal(german(() => W.status({ ...st, world_mix: 0.9, world_auto: 0 }, {}, 0)), 'Biolumineszenz · Wandern aus');
  assert.equal(german(() => W.status({ ...st, world_mix: 0 }, { wait: 0, next: null }, 0)), 'gerade: Klassisch');
  assert.match(german(() => W.status({ ...st, world_mix: 0 }, { wait: 0, next: null, idle: true }, 0)), /^gerade: Klassisch · Wandern ruht, solange keine Dreamy Eyes/);
  assert.equal(W.status(st, undefined, undefined), 'now: Classic → Bioluminescence · 32 %');
  assert.deepEqual([W.clock(0), W.clock(0.2), W.clock(59.5), W.clock(160), W.clock(-4)], ['0:00', '0:01', '1:00', '2:40', '0:00']);
  // said aloud: the same without the clock, so a screen reader hears a change and not every second
  assert.equal(german(() => W.spoken({ ...st, world_mix: 0 }, { wait: 0, next: 40 })), 'gerade: Klassisch');
  assert.equal(german(() => W.spoken(st, { wait: 170 })), 'Klassisch gewählt · Wandern pausiert');
  assert.ok(!/\d/.test(W.spoken(st, { wait: 0 })) && !/\d/.test(W.spoken({ ...st, world_auto: 0 }, {})));
});

test('the panel and Dream Control show the band of worlds instead of lists and an unnamed slider; MIDI is as it was', () => {
  for (const page of ['static/index.html', 'static/remote.html']) {
    const src = read(page);
    assert.match(src, /<div id="worldband"><\/div>/, page);
    assert.ok(src.includes('<link rel="stylesheet" href="/static/worldband.css">') && src.includes('<script src="/static/worldband.js"></script>'), `${page} loads the band`);
    assert.ok(src.indexOf('/static/worldband.js') > src.indexOf('/static/i18n.js'), `${page}: after the translations`);
    assert.ok(!/id="world(_to|_mix|_auto)?"/.test(src), `${page}: the lists and the slider are gone`);
    assert.equal(src.match(/const worldBand = WorldBand\.mount\(/g).length, 1, page);
    assert.equal(src.match(/\b(const|let|var) worldBand\b/g).length, 1, `${page}: a name of its own`);
    assert.match(src, /if \(m\.worlds\) worldBand\.worlds\(m\.worlds\);/, `${page} takes Dream's list of worlds`);
    assert.match(src, /if \(m\.world_drift\) worldBand\.drift\(m\.world_drift\);/, `${page} takes Dream's word on the drift`);
    assert.match(src, /worldBand\.set\(/, `${page} shows Dream's settings`);
    assert.match(src, /send: set => (\{ Object\.assign\(state, set\); send\(\{ set \}\); \}|sendCtl\(\{ set \}\))/, `${page}: a tap is one word to Dream`);
    assert.ok(src.includes('<option value="world_mix">Style worlds: crossfade</option>') && src.includes('<option value="world">Button: next style world</option>'), `${page}: the MIDI knob and button`);
    assert.ok(!/world-[a-z]+\.js|dreamstyle\.js/.test(src), `${page} loads the worlds only for their pictures, by the band itself`);
  }
  assert.ok(!/worldControls/.test(read('static/common.js')));
  // only transform and opacity are animated
  const css = read('static/worldband.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const moves = [...css.matchAll(/transition:\s*([^;}]+)/g)].flatMap(m => m[1].split(',').map(p => p.trim().split(/\s+/)[0]));
  assert.ok(moves.length >= 5 && moves.every(p => ['opacity', 'transform', 'none'].includes(p)), `transitions: ${moves}`);
  assert.ok(!/@keyframes|animation/.test(css));
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('the band of worlds in a browser', { skip: chrome ? false : 'no Chrome or Chromium found (CHROME_BIN names one)' }, async () => {
  const r = await runPage(chrome, 'worldband.html', { gl: false });
  assert.equal(r.error, '');
  const five = ['classic', 'deepsea', 'ink', 'etching', 'aurora'];
  // one picture per world, in Dream's order, each a radio button of one group with its name
  assert.equal(r.empty.chips, 0, 'no worlds before Dream names them');
  assert.deepEqual(r.chips.map(c => c.world), five);
  assert.deepEqual(r.chips.map(c => c.name), ['Classic', 'Bioluminescence', 'Ink', 'Engraving', 'Aurora']);
  assert.deepEqual(r.chips.map(c => c.label), ['Classic', 'Bioluminescence', 'Ink & watercolour', 'Engraving', 'Aurora']);
  assert.ok(r.chips.every(c => c.role === 'radio' && c.canvas && c.title.startsWith(c.label + ' – ')));
  assert.deepEqual(r.group, { role: 'radiogroup', label: 'Style world' });
  // the world that shows is marked, the one it is blended with dashed; one of them takes the focus
  assert.deepEqual(r.chips.map(c => [c.checked, c.next, c.tab]), [['true', false, 0], ['false', true, -1], ['false', false, -1], ['false', false, -1], ['false', false, -1]]);
  assert.deepEqual(r.past.slice(0, 2), [['false', true], ['true', false]], 'past the middle the other world is the one that shows');
  // the crossfade is shown, not set here
  assert.deepEqual(r.mixing, { status: 'now: Classic → Bioluminescence · 32 %', now: '32', text: 'Classic → Bioluminescence · 32 %', role: 'progressbar',
    label: 'Crossfade from the style world to the second one', from: 'Classic', to: 'Bioluminescence', fill: 'scaleX(0.32)', live: 'now: Classic → Bioluminescence', slider: false });
  // a tap is one word to Dream
  assert.deepEqual(r.taps, [{ world: 'etching', world_to: 'aurora', world_mix: 0 }, { world: 'aurora', world_to: 'classic', world_mix: 0 }, { world: 'classic', world_to: 'deepsea', world_mix: 0 }]);
  // the keyboard: arrows move the focus round and round without choosing, a press chooses
  assert.deepEqual(r.keys, { focus: 'ink', sent: 0, tabs: [-1, -1, 0, -1, -1], end: 'aurora', round: 'classic', chosen: [{ world: 'classic', world_to: 'deepsea', world_mix: 0 }] });
  assert.equal(r.focusRing, 'solid', 'the focus shows');
  // the drift: a switch and three paces
  assert.deepEqual(r.auto, { role: 'switch', on: 'true', label: 'Wander through the worlds by itself', group: 'radiogroup',
    paces: [['slow', '300', 'false', false], ['calm', '120', 'true', false], ['lively', '45', 'false', false]] });
  assert.deepEqual(r.off.sent, [{ world_auto: 45 }, { world_auto: 0 }], 'a pace, then the switch: off');
  assert.deepEqual([r.off.on, r.off.paces, r.off.status, r.off.dead], ['false', [['false', true], ['false', true], ['false', true]], 'Classic · wandering off', 0]);
  assert.deepEqual(r.back, [{ world_auto: 45 }], 'on again: the pace it had');
  assert.deepEqual(r.odd, { paces: ['false', 'false', 'false'], on: 'true' }, 'a pace set from elsewhere: on, none of the three');
  // the line
  assert.equal(r.next, 'now: Classic · next world in 0:40');
  assert.equal(r.wait, 'Bioluminescence chosen · wandering paused for another 2:40');
  assert.match(r.idle, /^now: Bioluminescence · wandering rests while no Dreamy Eyes/);
  assert.equal(r.live, 'now: Bioluminescence');
  // each world drew its own picture – and the band left the style layer as it found it
  for (const p of r.pictures) assert.ok(p.drawn && p.lit > 0.08 && p.lit < 0.8, `${p.world}: ${JSON.stringify(p)}`);
  for (const [i, a] of r.pictures.entries()) for (const b of r.pictures.slice(i + 1)) {
    assert.ok(a.sum.reduce((s, v, k) => s + Math.abs(v - b.sum[k]), 0) + Math.abs(a.lit - b.lit) * 100 > 4, `${a.world} and ${b.world} look alike`);
  }
  assert.equal(r.world, 'classic');
  // room: one row in the panel's column; narrow, the pictures wrap and nothing runs over
  assert.equal(new Set(r.fit.wide.chips.map(c => c[1])).size, 1, 'one row in the panel');
  assert.ok(new Set(r.fit.narrow.chips.map(c => c[1])).size >= 2 && r.fit.narrow.chips.length === 7, 'narrow: more rows');
  for (const f of [r.fit.wide, r.fit.narrow]) { assert.equal(f.over, 0); assert.ok(f.names); assert.ok(f.chips.every(c => c[2] >= 44), `a finger's room: ${f.chips.map(c => c[2])}`); assert.ok(f.status > 10); }
  assert.equal(r.fit.plain, 'Two-more');
  assert.ok(r.moving.length > 0 && r.moving.every(m => /^(opacity|transform)(, (opacity|transform))*\/none$/.test(m)), `only transform and opacity move: ${r.moving}`);
});
