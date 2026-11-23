// #220: how much of a face shows (static/dreamvis.js) – mostly only the eyes, hints every minute or two, mouth, nose
// and outline rarely (and clearly then, yet never as solid as the eyes); and that the pages draw their faces by this
// rule alone.
// Run: node --test tests/js/vis.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const V = require('../../static/dreamvis.js');
const STATIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static');
const read = name => readFileSync(path.join(STATIC, name), 'utf8');
const SEEDS = [1, 7, 4242, 99991, 0x7ffffffe];
const HOUR = 3600000, STEP = 100;

// the moments of one seed over `ms`: when hints began and ended, and how strong the rare level got in them
function moments(seed, ms = 4 * HOUR) {
  const out = [];
  let cur = null;
  for (let t = 0; t < ms; t += STEP) {
    const v = V.at(t, seed);
    if (v.level && !cur) out.push(cur = { from: t, to: t, full: 0, round: v.round });
    if (cur) { if (v.level) { cur.to = t; cur.full = Math.max(cur.full, v.full); } else cur = null; }
  }
  return out;
}

test('mostly only the eyes: more than four fifths of the time nothing else shows', () => {
  for (const seed of SEEDS) {
    let eyes = 0, n = 0;
    for (let t = 0; t < 2 * HOUR; t += STEP, n++) if (V.at(t, seed).level === 0) eyes++;
    assert.ok(eyes / n > 0.8, `seed ${seed}: eyes only ${Math.round(100 * eyes / n)} % of the time`);
  }
});

test('hints come every one to two minutes and stay a few seconds', () => {
  for (const seed of SEEDS) {
    const m = moments(seed);
    assert.ok(m.length > 100, `${m.length} moments in four hours`);
    for (let i = 1; i < m.length; i++) {
      const gap = (m[i].from - m[i - 1].from) / 1000;
      assert.ok(gap >= 59 && gap <= 121, `seed ${seed}: ${gap} s from one moment to the next`);
    }
    for (const x of m) assert.ok(x.to - x.from > 8000 && x.to - x.from < 20000, `a moment of ${(x.to - x.from) / 1000} s`);
    assert.equal(new Set(m.map(x => x.round)).size, m.length, 'every moment has a number of its own');
  }
});

test('mouth, nose and outline: every five to ten minutes or so, only inside a moment of hints, clearly but never solid', () => {
  for (const seed of SEEDS) {
    const rare = moments(seed).filter(x => x.full > 0.02);
    assert.ok(rare.length >= 20 && rare.length <= 60, `${rare.length} rare moments in four hours`);
    for (const x of rare) assert.ok(x.full > 0.7, `a rare moment is clearly to be seen (${x.full.toFixed(2)})`);
    for (let i = 1; i < rare.length; i++) {
      const gap = (rare[i].from - rare[i - 1].from) / 60000;
      assert.ok(gap >= 3.9 && gap <= 11.1, `seed ${seed}: ${gap.toFixed(1)} min between two rare moments`);
    }
    for (let t = 0; t < HOUR; t += STEP) {
      const v = V.at(t, seed);
      assert.ok(v.full <= V.RARE_MAX + 1e-9, `never above ${V.RARE_MAX}`);
      assert.ok(v.full <= v.hint * V.RARE_MAX + 1e-9, 'the rare level never without the hints, and it leaves before them');
      assert.equal(v.level, v.full > 0.02 ? 2 : v.hint > 0.02 ? 1 : 0);
    }
  }
});

test('it comes and goes softly: no jump from one picture to the next', () => {
  for (const seed of SEEDS) {
    let last = V.at(0, seed);
    for (let t = 16; t < HOUR / 2; t += 16) {
      const v = V.at(t, seed);
      assert.ok(Math.abs(v.hint - last.hint) < 0.02 && Math.abs(v.full - last.full) < 0.01, `a jump at ${t} ms`);
      for (const k of ['hintForm', 'fullForm']) assert.ok(v[k] >= 0 && v[k] <= 1);
      if (v.level && last.level) assert.ok(v.hintForm >= last.hintForm && v.fullForm >= last.fullForm, 'what is drawn in stays drawn');
      last = v;
    }
  }
});

test('the nose shows only at the rare level, with the mouth – and what the rule does not know stays hidden: no grin', () => {
  assert.equal(V.PARTS.nose, 2);
  assert.ok(V.RARE_MAX >= 0.7 && V.RARE_MAX <= 0.85, 'the rare level: clearly to be seen, never as solid as the eyes');
  assert.ok(!Object.keys(V.PARTS).some(k => /grin|teeth/i.test(k)));
  const all = [V.EYES_ONLY, V.held(0), V.held(1), V.held(2), { level: 2, hint: 5, full: 5 }];
  for (let t = 0; t < HOUR; t += 250) all.push(V.at(t, 3));
  for (const v of all) {
    for (const part of ['nostrils', 'grin', 'teeth', '', 'toString', 'constructor', undefined]) assert.equal(V.of(v, part), 0, `${part} at level ${v.level}`);
    assert.equal(V.of(v, 'eyes'), 1);
    assert.equal(V.of(v, 'nose'), V.of(v, 'mouth'), 'the nose comes and goes with the mouth');
    if (v.level < 2 && v.full <= 0) assert.equal(V.of(v, 'nose'), 0, `no nose at level ${v.level}`);
    assert.ok(V.of(v, 'mouth') <= V.RARE_MAX && V.of(v, 'outline') <= V.RARE_MAX && V.of(v, 'hair') <= V.RARE_MAX);
    assert.ok(V.of(v, 'brows') <= 1);
  }
});

test('the parts and their levels', () => {
  const lv = n => Object.keys(V.PARTS).filter(k => V.PARTS[k] === n).sort();
  assert.deepEqual(lv(1), ['brows', 'crease', 'mark']);
  assert.deepEqual(lv(2), ['hair', 'mouth', 'nose', 'outline']);
  assert.deepEqual([0, 1, 2].map(n => ['eyes', 'brows', 'mark', 'mouth', 'nose', 'outline'].map(p => V.of(V.held(n), p))),
    [[1, 0, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0], [1, 1, 1, V.RARE_MAX, V.RARE_MAX, V.RARE_MAX]]);
  assert.equal(V.held(2).level, 2);
});

test('from the clock and the seed alone: the same in both windows of a pair, another rhythm for another seed', () => {
  let differs = 0;
  for (let t = 0; t < HOUR; t += 1000) {
    assert.deepEqual(V.at(t, 77), V.at(t, 77));
    if (V.at(t, 77).level !== V.at(t, 78).level) differs++;
  }
  assert.ok(differs > 20, 'two seeds do not show their hints at the same time');
  for (const bad of [NaN, undefined, Infinity]) assert.equal(V.at(bad, 1), V.EYES_ONLY, 'no clock: only the eyes');
  assert.equal(V.at(-5000, 1).level, 0);
});

test('calmer: no face while something else takes the screen, no mouth while the eyes are not calm', () => {
  const v = V.held(2);
  assert.equal(V.damp(v, 1, 1), v);
  assert.deepEqual([V.damp(v, 1, 0).level, V.damp(v, 1, 0).hint], [1, 1]);
  assert.equal(V.damp(v, 0, 1).level, 0);
  assert.equal(V.damp(v, 0, 1).full, 0, 'the rare level never without the hints');
  assert.ok(Math.abs(V.damp(v, 0.5).full - V.RARE_MAX / 2) < 1e-9);
  assert.equal(V.damp(v, 7, 7).full, V.RARE_MAX);
});

test('a level held from the address: ?face=0|1|2', () => {
  assert.deepEqual(['?face=0', '?debug&face=1', '?face=2&debug', '', '?face=3', '?face=1x', '?preface=1', undefined].map(V.asked), [0, 1, 2, -1, -1, -1, -1, -1]);
});

test('the pages draw nothing of a face past the rule', () => {
  const eyes = read('eyes.html'), win = read('window.html'), eye = read('dreameye.js'), classic = read('world-classic.js');
  for (const [name, src] of [['eyes.html', eyes], ['window.html', win], ['dreameye.js', eye], ['dreamlife.js', read('dreamlife.js')], ['world-classic.js', classic], ['dreambrush.js', read('dreambrush.js')]]) {
    assert.ok(!/grin/i.test(src), `${name}: the grin is gone`);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // without its comments
    // a nose only in the faces drawn in light (and in the skeleton the worlds share), and there only as far as the
    // rule lets it show (below, and tests/js/brush.test.mjs)
    if (!['world-classic.js', 'dreambrush.js'].includes(name)) assert.ok(!/nose|nostril/i.test(code), `${name}: no nose is drawn`);
  }
  for (const [name, src] of [['eyes.html', eyes], ['window.html', win]]) {
    assert.ok(src.includes('<script src="/static/dreamvis.js"></script>'), `${name} loads the rule`);
    assert.ok(/browAl: DreamVis\.of\(|browAl = DreamVis\.of\(/.test(src), `${name}: the brows show by the rule`);
    assert.ok(!/DreamVis[^;\n]*(aiFaces|DreamFace)|faceEdge\([^)]*vis/.test(src), `${name}: a face painted by the AI stays whole`);
  }
  // the faces drawn in light: every line and every dot carries the visibility of its part
  const body = classic.slice(classic.indexOf('function face('), classic.indexOf('const FACES = '));   // #221: today's look, the first style world
  const calls = body.split('\n').filter(l => !/const (line|leaf|dot) = /.test(l) && (/\b(line|leaf|dot)\(.*\);/.test(l) || /^\s*\}, wd.*\);/.test(l)));
  assert.ok(calls.length > 25, `${calls.length} drawing calls found`);
  for (const l of calls) assert.ok(/\* (mark|hair|outline|mouth|nose|part)\)|, w, al\)/.test(l), `a line without its part: ${l.trim().slice(0, 120)}`);
  const noses = body.split('\n').filter(l => /nose/i.test(l.replace(/\/\/.*$/, '')) && !/const mark = /.test(l));
  assert.ok(noses.length >= 2, 'the goddess and the cat have a nose');
  for (const l of noses) assert.ok(/\* nose\);/.test(l), `a nose past the rule: ${l.trim().slice(0, 120)}`);
  assert.equal(classic.replace(body, '').replace(/\/\/.*$/gm, '').match(/nose/gi), null, 'no nose anywhere else in today\'s look');
  // a face has one size, the eyes': nothing of it is fitted to the screen's height
  assert.ok(!/\bH\b|\bh\b|\bfit\(/.test(body.replace(/\/\/.*$/gm, '')), 'a face of light is never pressed into the screen');
  assert.ok(!/LINEFACES\.has|BACKS = \[[^\]]*LINEFACES/.test(eyes), 'no face is a background that stays for a minute');
  // with ?debug the page stays a window: no fullscreen
  assert.ok(/if \(!DEBUG\) try \{ await document\.documentElement\.requestFullscreen\(/.test(eyes) && eyes.match(/requestFullscreen/g).length === 1, 'eyes.html: fullscreen only without ?debug');
});
