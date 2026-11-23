// #221: the style layer (static/dreamstyle.js) and the first style world, today's look (static/world-classic.js).
// The registry as plain logic in Node; and in a headless Chrome the look itself: tests/js/style.html draws eyes, living
// things, the faces of light and the window motifs through the layer, and the pictures must be the ones kept in
// tests/js/style-ref.json – today's look stays today's look, whatever is moved around underneath.
// Run: node --test tests/js/style.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at;
//      STYLE_REF=write keeps the pictures drawn now as the new reference – only when the look is meant to change)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { ROOT, findChrome, runPage } from './browser.mjs';

const require = createRequire(import.meta.url);
const chrome = findChrome();
const REF = path.join(ROOT, 'tests', 'js', 'style-ref.json');
const read = name => readFileSync(path.join(ROOT, name), 'utf8');

test('the registry: a world by its name, today\'s look for anything unknown, parts fall back to the first world', () => {
  const S = require('../../static/dreamstyle.js');
  const eye = { draw() {} }, life = { draw() {} }, third = () => {}, mandala = () => {};
  assert.equal(S.FIRST, 'classic');
  assert.equal(S.part('eye'), undefined, 'nothing registered yet: nothing to draw with, no error');
  S.register('classic', { eye, life, motif: { third, mandala } });
  assert.equal(S.name, 'classic');
  assert.equal(S.eye(), eye);
  const ownLife = { draw() {} }, ownMandala = () => {};
  S.register('other', { life: ownLife, motif: { mandala: ownMandala, toString: 5 } });
  assert.deepEqual(S.names(), ['classic', 'other']);
  assert.equal(S.use('other'), 'other');
  assert.deepEqual([S.life(), S.eye(), S.motif('mandala'), S.motif('third')], [ownLife, eye, ownMandala, third], 'its own parts, the rest from the first world');
  assert.deepEqual(S.motifs(), ['third', 'mandala'], 'the kinds of motif are the first world\'s');
  for (const bad of ['nope', '', undefined, null, 7, 'constructor', '__proto__', 'Classic']) assert.equal(S.use(bad), 'classic', `${String(bad)} is today's look`);
  for (const bad of ['toString', 'constructor', 'nope']) assert.equal(S.motif(bad), undefined);
  for (const [name, world] of [['Bad Name', {}], ['', {}], ['ok', null], [5, {}], ['../x', {}]]) assert.throws(() => S.register(name, world));
});

test('every world Dream can name is a file that registers itself, and the pages offer it', () => {
  const worlds = /^WORLDS = \(([^)]*)\)/m.exec(read('settings.py'))[1].match(/"([a-z0-9-]+)"/g).map(s => s.slice(1, -1));
  assert.equal(worlds[0], 'classic', 'today\'s look is the first world and the default');
  const files = readdirSync(path.join(ROOT, 'static')).filter(f => /^world-.*\.js$/.test(f)).map(f => f.slice(6, -3)).sort();
  assert.deepEqual(files, [...worlds].sort(), 'one file static/world-<name>.js per world');
  for (const w of worlds) assert.ok(read(`static/world-${w}.js`).includes(`DreamStyle.register('${w}',`), `world-${w}.js registers '${w}'`);
  for (const page of ['static/eyes.html', 'static/window.html']) {
    const src = read(page), at = name => src.indexOf(`<script src="/static/${name}.js"></script>`);
    for (const w of worlds) assert.ok(at(`world-${w}`) > at('dreamstyle') && at('dreamstyle') > at('dreambrush') && at('dreambrush') >= 0, `${page} loads the brushes, the layer, then world-${w}.js`);
    assert.ok(/typeof m\.world === 'string'\) \{? ?DreamStyle\.use\(m\.world\)/.test(src), `${page} takes the world Dream names`);
    assert.ok(!/DreamEye\.(draw|irisWorld|pupilShape)\(|DreamLife\.draw\(/.test(src), `${page} draws through the style layer only`);
  }
  for (const page of ['static/index.html', 'static/remote.html']) {
    const sel = /<select id="world"[^>]*>(.*?)<\/select>/.exec(read(page))[1];
    assert.deepEqual([...sel.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]), worlds, `${page} offers every world, in Dream's order`);
  }
});

function compare(a, b) {                               // two small pictures (RGB bytes): how far apart, on average and at worst
  let sum = 0, far = 0, max = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > 12) far++; if (d > max) max = d; }
  return { mean: sum / a.length, far: far / a.length, max };
}

test('today\'s look through the style layer, drawn in a browser', { skip: chrome ? false : 'no Chrome or Chromium found (CHROME_BIN names one)' }, async t => {
  const r = await runPage(chrome, 'style.html');
  assert.equal(r.error, '');
  if (process.env.STYLE_REF === 'write') { writeFileSync(REF, JSON.stringify(r.scenes, null, 1) + '\n'); t.diagnostic('reference written'); }
  assert.ok(existsSync(REF), 'tests/js/style-ref.json is missing (STYLE_REF=write makes it)');
  const ref = JSON.parse(readFileSync(REF, 'utf8'));

  await t.test('the worlds and the motifs a world can draw', () => {
    assert.deepEqual(r.worlds, ['classic']);
    assert.deepEqual(r.motifs.sort(), ['cube', 'fork', 'mandala', 'penrose', 'stairs', 'third']);
  });
  await t.test('the pictures are the ones kept: eyes, pupils, living things, faces of light, window motifs', () => {
    assert.deepEqual(Object.keys(r.scenes).sort(), Object.keys(ref).sort());
    for (const name of Object.keys(ref)) {
      const a = Buffer.from(r.scenes[name], 'base64'), b = Buffer.from(ref[name], 'base64');
      assert.equal(a.length, 96 * 54 * 3);
      assert.equal(a.length, b.length);
      const d = compare(a, b), lit = a.reduce((s, v) => s + (v > 40 ? 1 : 0), 0) / a.length;
      t.diagnostic(`${name}: mean difference ${d.mean.toFixed(3)}, ${(d.far * 100).toFixed(2)} % clearly off, largest ${d.max}${a.equals(b) ? ' – identical' : ''}`);
      assert.ok(lit > 0.01, `${name}: something is drawn (${(lit * 100).toFixed(1)} % lit)`);
      // another machine's browser smooths an edge a little differently; another look is far beyond this
      assert.ok(d.mean < 0.5 && d.far < 0.005, `${name} is not today's look any more: mean ${d.mean.toFixed(2)}, ${(d.far * 100).toFixed(1)} % of the values off`);
    }
  });
  await t.test('an unknown world is today\'s look; a world that draws a part gets the rest from the first', () => {
    assert.equal(r.unknown, 'classic');
    assert.equal(r.used, 'test-partial');
    assert.ok(r.partialLife && r.partialMotif && r.fallback);
  });
});
