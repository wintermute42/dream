// #224: the crossfade between two style worlds. The plan of a frame (static/dreamstyle.js: one world, or two with
// weights that add up to 1) as plain numbers in Node – a hand on the mix is followed softly, another world comes in a
// short fade, a device that does not keep up never draws two worlds for long ('fade') or ever ('dip') and does not
// see-saw – and the real pages in a headless Chrome (tests/js/blend.html): what they hear from Dream reaches the
// style layer, a mix is the two worlds' pictures added up, every pair of worlds draws with fire, trance and a face.
// Run: node --test tests/js/blend.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ROOT, findChrome, runPage } from './browser.mjs';

const require = createRequire(import.meta.url);
const S = require('../../static/dreamstyle.js');
const chrome = findChrome();
const read = name => readFileSync(path.join(ROOT, name), 'utf8');
for (const w of ['classic', 'one', 'two', 'three']) S.register(w, {});
const DT = 1 / 60, { SWITCH, DIP, SWEEP, FLIP, SLOW_SECS, BACK_SECS } = S.BLEND;
// `secs` of frames; returns every plan on the way
const run = (secs, o = { hold: 'mix' }, dt = DT) => Array.from({ length: Math.round(secs / dt) }, () => S.plan(dt, o));
const sum = p => p.reduce((a, [, w]) => a + w, 0);
const names = p => p.map(([w]) => w);

test('one world: one picture at full weight, and `use` changes at once', () => {
  S.use('one');
  assert.deepEqual(S.plan(DT, { hold: 'mix' }), [['one', 1]]);
  S.use('two');
  assert.deepEqual(S.plan(DT, { hold: 'mix' }), [['two', 1]]);
  assert.equal(S.use('no-such-world'), 'classic');
  assert.deepEqual(S.plan(DT, { hold: 'mix' }), [['classic', 1]]);
});

test('a mix is two worlds whose weights add up to 1; the mix follows a hand softly and exactly', () => {
  S.use('one'); S.blend('one', 'two', 0.5);
  const way = run(2);
  for (const p of way) { assert.ok(p.length <= 2); assert.ok(Math.abs(sum(p) - 1) < 1e-9); }
  for (let i = 1; i < way.length; i++) assert.ok(Math.abs((way[i][1] || [0, 0])[1] - (way[i - 1][1] || [0, 0])[1]) <= DT / SWEEP + 1e-9, 'no jump');
  assert.deepEqual(way.at(-1), [['one', 0.5], ['two', 0.5]]);
  assert.ok(way[5][1][1] > 0 && way[5][1][1] < 0.3, 'it sets out at once and softly');
  S.blend('one', 'two', 1);
  assert.deepEqual(run(2).at(-1), [['two', 1]]);          // all of the second world: one picture again
  S.blend('one', 'two', 0.2);
  assert.deepEqual(run(2).at(-1).map(([w, k]) => [w, +k.toFixed(6)]), [['one', 0.8], ['two', 0.2]]);
  S.blend('one', 'two', 0);
  assert.deepEqual(run(2).at(-1), [['one', 1]]);
});

test('the first word a page hears is shown at once; a world not registered is today\'s look', () => {
  S.use('classic'); S.blend('one', 'two', 0.25, true);
  assert.deepEqual(S.plan(DT, { hold: 'mix' }), [['one', 0.75], ['two', 0.25]]);
  S.blend('two', undefined, 0.7, true);
  assert.deepEqual(S.plan(DT, { hold: 'mix' }), [['two', 1]]);
  S.blend('nope', 'two', 2, true);
  assert.deepEqual(S.plan(DT, { hold: 'mix' }), [['two', 1]]);
  S.blend('nope', 'nope', 0.5, true);
  assert.deepEqual(S.plan(DT, { hold: 'mix' }), [['classic', 1]]);
});

test('another world comes in a short fade – never more than two pictures, never a jump', () => {
  S.use('one'); S.blend('two', 'two', 0);
  let way = run(SWITCH + 0.2);
  assert.deepEqual(names(way[0]), ['one', 'two']);
  assert.deepEqual(way.at(-1), [['two', 1]]);
  assert.ok(way.filter(p => p.length === 2).length * DT <= SWITCH + 0.05);
  // from a mix to a mix that shares a world: over the shared one; that shares none: over the nearer one
  S.use('one'); S.blend('one', 'two', 0.4, true); S.blend('one', 'three', 0.6);
  way = run(4);
  for (const p of way) { assert.ok(p.length <= 2); assert.ok(Math.abs(sum(p) - 1) < 1e-9); }
  assert.ok(way.some(p => p.length === 1 && p[0][0] === 'one'), 'through the world both mixes share');
  assert.deepEqual(way.at(-1).map(([w, k]) => [w, +k.toFixed(6)]), [['one', 0.4], ['three', 0.6]]);
  S.blend('two', 'classic', 0.3);
  way = run(5);
  for (const p of way) assert.ok(p.length <= 2 && Math.abs(sum(p) - 1) < 1e-9);
  assert.deepEqual(way.at(-1).map(([w, k]) => [w, +k.toFixed(6)]), [['two', 0.7], ['classic', 0.3]]);
});

test('what the drift does – the target becomes the world, the next one the target – changes nothing of the picture', () => {
  S.use('one'); S.blend('one', 'two', 0.999, true);
  run(0.5);
  S.blend('two', 'three', 0);
  const way = run(0.5);
  assert.ok(way.every(p => p.at(-1)[0] === 'two' && p.at(-1)[1] > 0.99), 'the second world stays');
  assert.deepEqual(way.at(-1), [['two', 1]]);
  S.blend('two', 'three', 0.004);
  assert.deepEqual(names(run(0.5).at(-1)), ['two', 'three']);
});

test('fade: one world at a time – the nearer one, with a short fade past the middle and no see-saw around it', () => {
  S.use('one'); S.blend('one', 'two', 0.45, true);
  let way = run(1, { hold: 'fade' });
  assert.deepEqual(way.at(-1), [['one', 1]]);
  assert.ok(way.filter(p => p.length === 2).length * DT <= SWITCH * 0.45 + 0.05, 'a mix it came with is left quickly');
  let pairs = 0;
  for (let i = 0; i < 600; i++) {                        // a hand that trembles around the middle
    S.blend('one', 'two', 0.5 + (FLIP - 0.01) * Math.sin(i / 7));
    if (S.plan(DT, { hold: 'fade' }).length === 2) pairs++;
  }
  assert.equal(pairs, 0);
  S.blend('one', 'two', 0.5 + FLIP + 0.02);
  way = run(SWITCH + 0.5, { hold: 'fade' });
  assert.ok(way.some(p => p.length === 2));
  assert.ok(way.filter(p => p.length === 2).length * DT <= SWITCH + 0.05, 'two pictures only for the short fade');
  assert.deepEqual(way.at(-1), [['two', 1]]);
  for (let k = 0.6; k >= 0.44; k -= 0.01) { S.blend('one', 'two', k); assert.deepEqual(S.plan(DT, { hold: 'fade' }), [['two', 1]]); }
  S.blend('one', 'two', 0.5 - FLIP - 0.02);
  assert.deepEqual(run(SWITCH + 0.5, { hold: 'fade' }).at(-1), [['one', 1]]);
});

test('dip: one picture at any time – down to black, the other world, up again', () => {
  S.use('one'); S.blend('one', 'two', 0);
  run(0.2, { hold: 'dip' });
  S.blend('one', 'two', 1);
  const way = run(2 * DIP + 0.3, { hold: 'dip' });
  assert.ok(way.every(p => p.length === 1));
  const dark = way.findIndex(p => p[0][1] < 0.02);
  assert.ok(dark > 0, 'it goes dark');
  assert.ok(way.slice(0, dark).every(p => p[0][0] === 'one') && way.slice(dark + 1).every(p => p[0][0] === 'two'), 'the worlds change in the dark');
  for (let i = 1; i < way.length; i++) assert.ok(Math.abs(way[i][0][1] - way[i - 1][0][1]) <= DT / DIP + 1e-9, 'no jump of the brightness');
  assert.deepEqual(way.at(-1), [['two', 1]]);
});

test('how a device mixes is decided by how it keeps up: mixing, then the short fade, the weakest through black – and back only after a while', () => {
  const strong = { fps: 60, tier: 2 };
  S.use('one'); S.blend('one', 'two', 0.5);
  // (each test of this file leaves the device as it found it: a strong one that waited long enough)
  run(BACK_SECS * 12, strong, 0.05);
  assert.equal(run(3, strong).at(-1).length, 2);
  assert.equal(S.mixing.mode, 'mix');
  // two worlds are too much for it: after a few seconds it shows one
  let way = run(SLOW_SECS - 0.5, { fps: 20, tier: 2 });
  assert.equal(way.at(-1).length, 2, 'not at the first slow frames');
  way = run(1 + SWITCH, { fps: 20, tier: 2 });
  assert.equal(S.mixing.mode, 'fade');
  assert.equal(way.at(-1).length, 1);
  // with one world it is fast again – and stays with one for a good while: no see-saw
  way = run(BACK_SECS - 5, strong, 0.05);
  assert.ok(way.every(p => p.length === 1));
  way = run(10, strong, 0.05);
  assert.equal(way.at(-1).length, 2, 'then it tries again');
  // it fails again at once: the next try comes later
  run(SLOW_SECS + 1 + SWITCH, { fps: 20, tier: 2 });
  assert.equal(S.mixing.mode, 'fade');
  way = run(BACK_SECS * 1.5, strong, 0.05);
  assert.ok(way.every(p => p.length === 1), 'the wait has grown');
  // … also when the mix it fails at comes long after it was allowed again (a drift that stayed with one world)
  S.blend('one', 'two', 0); run(BACK_SECS * 12, strong, 0.05); assert.equal(S.mixing.mode, 'mix');
  S.blend('one', 'two', 0.5); run(SLOW_SECS + 1 + SWITCH, { fps: 20, tier: 2 });
  S.blend('one', 'two', 0); run(BACK_SECS * 3, strong, 0.05);
  assert.equal(S.mixing.mode, 'fade', 'and grown again');
  // three frames a second: found out in a few seconds of the clock, not after as many frames as a fast device draws
  run(BACK_SECS * 12, strong, 0.05); S.blend('one', 'two', 0.5);
  assert.equal(run(3, strong).at(-1).length, 2);
  way = run(SLOW_SECS + 1.5, { fps: 50, tier: 2 }, 1 / 3);   // (the page's smoothed rate still says 50)
  assert.equal(S.mixing.mode, 'fade');
  assert.ok(way.length <= 15);
  // a device whose page already draws with less detail does not mix at all; the weakest goes through black
  run(BACK_SECS * 12, strong, 0.05);
  S.use('one'); S.blend('one', 'two', 0.3);
  way = run(3, { fps: 40, tier: 1 });
  assert.ok(way.every(p => p.length === 1 && p[0][0] === 'one'));
  S.blend('one', 'two', 0.9);
  way = run(3, { fps: 25, tier: 0 });
  assert.ok(way.every(p => p.length === 1), 'tier 0: never two pictures');
  assert.ok(way.some(p => p[0][1] < 0.05) && S.mixing.mode === 'dip');
  assert.deepEqual(way.at(-1), [['two', 1]]);
  run(BACK_SECS * 12, strong, 0.05); S.use('classic');
});

test('the pages draw a frame once per planned world and add the pictures up; they only hear of the worlds', () => {
  for (const page of ['eyes.html', 'window.html']) {
    const src = read(`static/${page}`);
    assert.match(src, /DreamStyle\.blend\(m\.world, m\.world_to, m\.world_mix, !mix\.told\)/, page);
    assert.match(src, /DreamStyle\.plan\(/, page);
    assert.match(src, /DreamStyle\.paint\(world\)/, page);
    assert.match(src, /globalCompositeOperation = 'lighter'; main\.globalAlpha = weight; main\.drawImage\(mix\.cv, 0, 0\)/, page);
    assert.ok(!/DreamStyle\.use\(/.test(src), `${page} leaves the choice of the world to the plan`);
    assert.ok(!/world_(to|mix|auto)['"]?\s*:/.test(src) && !/set:\s*\{[^}]*world/.test(src), `${page} never sets a world`);
  }
});

test('the pages, drawn in a browser', { skip: chrome ? false : 'no Chrome or Chromium found (CHROME_BIN names one)' }, async () => {
  const r = await runPage(chrome, 'blend.html', { gl: false });
  assert.equal(r.error, '');
  for (const page of ['eyes', 'window']) {
    const p = r[page];
    // what Dream says reaches the style layer: the first word at once, the next one as a fade
    assert.deepEqual(p.heard, { a: 'ink', b: 'aurora', k: 0.25 }, page);
    assert.deepEqual(p.first, ['ink', 'aurora'], page);
    assert.equal(p.next.length, 2, `${page}: another word is no cut (${p.next})`);
    assert.deepEqual(p.later, ['deepsea'], `${page}: … but a short fade`);
    // a mix is the two worlds' pictures added up – and neither of the two
    assert.ok(p.sum.apart > 6, `${page}: the two worlds differ (${p.sum.apart.toFixed(1)})`);
    assert.ok(p.sum.off < 3.5, `${page}: half and half is the mean of both pictures (off by ${p.sum.off.toFixed(2)})`);
    assert.ok(p.sum.fromA > p.sum.off * 1.5 && p.sum.fromB > p.sum.off * 1.5, `${page}: … and neither of them`);
    assert.deepEqual(p.sum.passes, [1, 1, 2, 1], `${page}: one picture per world, two only for a mix`);
    assert.ok(p.sum.quarter < p.sum.fromA && p.sum.quarter > 0, `${page}: a quarter of the way is nearer to the first world`);
    // every pair of worlds, with fire, trance and a face
    assert.equal(p.pairs.length, r.worlds.length * (r.worlds.length - 1) / 2, page);
    for (const q of p.pairs) assert.ok(q.lit > 0.02 && q.passes === 2, `${page} ${q.a}+${q.b}: ${JSON.stringify(q)}`);
  }
  // a weak device: one picture at any time, through black
  assert.ok(r.dip.passes.every(n => n === 1), 'dip: never two pictures');
  assert.ok(r.dip.darkest < r.dip.before * 0.15 && r.dip.after > r.dip.before * 0.3, `dip: ${JSON.stringify({ ...r.dip, passes: 0 })}`);
  assert.deepEqual(r.dip.end, ['etching']);
  // the short fade: two pictures only while it lasts
  assert.ok(r.fade.pairs > 0 && r.fade.pairs * r.fade.dt <= SWITCH + 0.1, `fade: ${JSON.stringify(r.fade)}`);
  assert.deepEqual([r.fade.held, r.fade.end], [['deepsea'], ['etching']]);
});
