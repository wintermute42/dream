// #222: the style worlds besides today's look (static/world-<name>.js). What the owner's rules ask of every one of them:
// it draws the whole vocabulary itself (eyes, living things, faces of light, window motifs, the night behind the eyes,
// a window's sky, fire, trance, "you in the dream"); of a face only what the face rule lets through, and never a nose;
// none of today's signs – hearts, stars, letters – but a form of its own; and it never talks to anyone.
// The files as text in Node; the drawing in a headless Chrome (tests/js/worlds.html).
// Run: node --test tests/js/worlds.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { ROOT, findChrome, runPage } from './browser.mjs';

const require = createRequire(import.meta.url);
const chrome = findChrome();
const read = name => readFileSync(path.join(ROOT, name), 'utf8');
const FILES = readdirSync(path.join(ROOT, 'static')).filter(f => /^world-.*\.js$/.test(f));
const OTHERS = FILES.map(f => f.slice(6, -3)).filter(w => w !== 'classic');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');   // without its comments

test('a world only draws: no network, no export of a picture, no storage – it is handed the camera\'s picture for "you in the dream"', () => {
  for (const f of FILES) {
    const src = read(`static/${f}`);
    for (const word of ['fetch', 'WebSocket', 'XMLHttpRequest', 'sendBeacon', 'toBlob', 'toDataURL', '.send(', 'postMessage', 'localStorage', 'indexedDB', 'captureStream', 'import(', 'getUserMedia', 'document.cookie']) {
      assert.ok(!src.includes(word), `${f} must not use ${word}`);
    }
  }
});

test('the worlds besides today\'s look: no nose in the code, no letters, nothing an old phone cannot draw every frame', () => {
  const vis = require('../../static/dreamvis.js');
  assert.ok(OTHERS.length > 0);
  for (const w of OTHERS) {
    const src = code(read(`static/world-${w}.js`));
    assert.ok(!/nose|nostril/i.test(src), `world-${w}.js draws no nose (the word stands in its code)`);
    assert.ok(!/fillText|strokeText|\.font\s*=/.test(src), `world-${w}.js writes no letters`);
    assert.ok(!/shadowBlur|shadowColor/.test(src), `world-${w}.js casts no shadows (old phones)`);
    for (const part of [...src.matchAll(/DreamVis\.of\(\s*\w+\s*,\s*'([^']*)'/g)].map(m => m[1])) assert.ok(part in vis.PARTS, `world-${w}.js asks the face rule for '${part}', which it does not know`);
  }
});

test('the test pages load every world', () => {
  for (const page of ['tests/js/worlds.html', 'tests/js/style.html', 'tests/js/you.html']) {
    for (const f of FILES) assert.ok(read(page).includes(`<script src="/static/${f}"></script>`), `${page} loads ${f}`);
  }
});

function apart(a, b) {                                 // two small pictures: how far apart on average
  const x = Buffer.from(a, 'base64'), y = Buffer.from(b, 'base64');
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}
const lit = a => { const x = Buffer.from(a, 'base64'); let n = 0; for (const v of x) if (v > 40) n++; return n / x.length; };

test('the worlds, drawn in a browser', { skip: chrome ? false : 'no Chrome or Chromium found (CHROME_BIN names one)' }, async t => {
  const r = await runPage(chrome, 'worlds.html');
  assert.equal(r.error, '');
  assert.deepEqual(Object.keys(r.worlds).sort(), [...OTHERS].sort());
  for (const [name, w] of Object.entries(r.worlds)) {
    await t.test(`${name}: every scene is drawn without an error, in a look of its own`, () => {
      assert.equal(w.error, '');
      for (const [scene, pic] of Object.entries(w.scenes)) {
        // (a face is little and faint by the rule: a sign on the forehead, a breath of the rest)
        assert.ok(lit(pic) > (scene.startsWith('faces') ? 0.0002 : 0.004), `${name}, ${scene}: something is drawn (${(lit(pic) * 100).toFixed(2)} % lit)`);
        const d = apart(pic, r.classic[scene]);
        t.diagnostic(`${name}, ${scene}: ${d.toFixed(1)} away from today's look`);
        assert.ok(d > 1.5, `${name}, ${scene}: looks like today's look (${d.toFixed(2)} apart)`);
      }
      t.diagnostic(`${name}: all scenes in ${w.ms} ms (software rendering)`);
    });
    await t.test(`${name}: the full vocabulary – every part and every window motif is its own`, () => {
      assert.deepEqual(w.own, ['eye', 'life', 'face', 'back', 'sky', 'fire', 'trance', 'you']);
      assert.deepEqual(w.ownMotifs.sort(), ['cube', 'fork', 'mandala', 'penrose', 'stairs', 'third']);
      assert.ok(w.modes.length >= 3 && new Set(w.modes).size === w.modes.length, `${w.modes.length} faces of light`);
      assert.ok(w.frames.length >= 2, 'frames around "you in the dream"');
    });
    await t.test(`${name}: the face rule – mostly only the eyes, never a nose`, () => {
      for (const part of w.parts) assert.ok(['eyes', 'lids', 'lashes', 'shadow', 'brows', 'crease', 'mark', 'mouth', 'outline', 'hair'].includes(part), `asks the rule for '${part}'`);
      for (const [mode, f] of Object.entries(w.faces)) {
        assert.equal(f.eyesOnly, 0, `${mode}: nothing of a face while only the eyes show`);
        assert.ok(f.nose <= 6, `${mode}: the place of a nose stays empty (${f.nose})`);
        assert.ok(f.hints > 150, `${mode}: the hints show (${f.hints} pixels)`);
        assert.ok(f.rare > f.hints * 1.3, `${mode}: the rare moment adds mouth and outline (${f.hints} → ${f.rare} pixels)`);
      }
      assert.ok(w.browShows > 50, `the eye's brow comes with the hints (${w.browShows})`);
    });
    await t.test(`${name}: none of today's signs – a form of its own for each, no letters`, () => {
      assert.deepEqual(w.borrowed, { life: [], pupils: [] }, 'nothing drawn by today\'s look where it draws a heart, a star, a letter');
      assert.equal(w.letters, 0);
      for (const [sign, n] of Object.entries(w.signs)) assert.ok(n > 40, `${sign}: its own form shows (${n} pixels)`);
    });
  }
});
