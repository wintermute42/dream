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
  assert.deepEqual(lv(1), ['brows', 'crease', 'mark', 'outline']);
  assert.deepEqual(lv(2), ['hair', 'mouth', 'nose']);
  assert.deepEqual([0, 1, 2].map(n => ['eyes', 'brows', 'mark', 'mouth', 'nose', 'hair', 'outline'].map(p => V.of(V.held(n), p))),
    [[1, 0, 0, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0, V.OUTLINE_HINT], [1, 1, 1, V.RARE_MAX, V.RARE_MAX, V.RARE_MAX, V.RARE_MAX]]);
  assert.equal(V.held(2).level, 2);
});

test('the outline of a face comes with the hints, moderately, and grows fuller at the rare level – without a jump', () => {
  assert.ok(V.OUTLINE_HINT >= 0.35 && V.OUTLINE_HINT <= 0.6, 'moderate with the hints');
  for (const seed of SEEDS) {
    let last = 0, hints = 0, withOutline = 0, top = 0;
    for (let t = 0; t < HOUR; t += 16) {
      const v = V.at(t, seed), o = V.of(v, 'outline');
      assert.ok(Math.abs(o - last) < 0.02, `the outline jumps at ${t} ms`);
      assert.ok(o <= V.RARE_MAX && o >= V.of(v, 'mouth') && o <= Math.max(V.OUTLINE_HINT * V.of(v, 'brows'), v.full) + 1e-9);
      if (v.full <= 0) assert.ok(Math.abs(o - V.OUTLINE_HINT * v.hint) < 1e-9, 'with the hints: as they come and go, at its own strength');
      if (v.hint > 0.9) { hints++; if (o >= V.OUTLINE_HINT * 0.9) withOutline++; }
      top = Math.max(top, o); last = o;
    }
    assert.equal(withOutline, hints, 'whenever the hints are there, so is the outline');
    assert.ok(top > 0.7, 'fuller in the rare moment');
  }
});

// ---------- one face at a time ----------
// a place where faces follow each other, stepped frame by frame: what is to be seen of each face
function watch(wants, { fps = 60, shows = () => 1 } = {}) {
  const s = V.turn(), frames = [];
  let f = 0;
  for (const [want, secs] of wants) for (let i = 0; i < secs * fps; i++, f++) {
    const sh = shows(f / fps);
    V.step(s, want, 1 / fps, sh);
    frames.push({ key: s.key, al: s.al * sh });
  }
  return frames;
}
// no frame in which a face jumps, and never two faces: a face only ever follows one that is gone
function oneAtATime(frames, bound) {
  let last = { key: null, al: 0 }, changes = 0;
  for (const [i, f] of frames.entries()) {
    assert.ok(f.al >= 0 && f.al <= 1);
    if (f.key === last.key) assert.ok(Math.abs(f.al - last.al) <= bound, `frame ${i}: ${last.al.toFixed(3)} → ${f.al.toFixed(3)} is a jump`);
    else {
      changes++;
      assert.ok(last.al <= 0.005, `frame ${i}: the face before was still to be seen (${last.al.toFixed(3)})`);
      assert.ok(f.al <= bound, `frame ${i}: the next face is there at once (${f.al.toFixed(3)})`);
    }
    last = f;
  }
  return changes;
}

test('one face at a time: the one shown fades out completely, only then the next fades in – no cut, never two', () => {
  for (const fps of [60, 30, 12]) {
    const bound = 1.6 / (Math.min(V.TURN.out, V.TURN.in) * fps);   // the steepest an eased fade gets in one frame
    const frames = watch([['goddess', 3], ['cat', 4], ['medusa', 0.4], ['forest', 0.3], ['cat', 5], [null, 3], ['mermaid', 3]], { fps });
    assert.equal(oneAtATime(frames, bound), 4, 'the goddess, the cat (medusa and forest never got their turn), then none, then the mermaid');
    assert.ok(!frames.some(f => f.key === 'medusa' && f.al > 0.01), 'a face asked for only a moment never flashes up');
    const at = secs => frames[Math.round(secs * fps) - 1];
    assert.deepEqual([at(3).key, at(3).al], ['goddess', 1]);
    assert.deepEqual([at(7).key, at(7).al], ['cat', 1], 'the cat is there in full well within four seconds');
    assert.equal(at(3 + V.TURN.out * 0.5).key, 'goddess', 'half way out it is still the goddess, alone');
    assert.ok(at(3 + V.TURN.out + 0.1).key === 'cat' && at(3 + V.TURN.out + 0.1).al < 0.1, 'then the cat begins from nothing');
  }
  assert.ok(V.TURN.out >= 0.8 && V.TURN.out <= 1.5 && V.TURN.in >= 0.8 && V.TURN.in <= 1.5, 'each way takes about a second');
});

test('one face at a time: between two moments nothing shows, so the next face simply comes with the rule', () => {
  // the rule's hint as a moment: in over 3 s, there 4 s, out over 3.5 s, then nothing
  const hint = s => { const p = s % 20; return p < 3 ? p / 3 : p < 7 ? 1 : p < 10.5 ? 1 - (p - 7) / 3.5 : 0; };
  const s = V.turn();
  V.step(s, 'goddess', 1 / 60, 0);
  assert.deepEqual([s.key, s.al], ['goddess', 1], 'nothing to be seen: it is simply the face of the next moment');
  V.step(s, 'cat', 1 / 60, 0.003);
  assert.deepEqual([s.key, s.al], ['cat', 1]);
  V.step(s, 'medusa', 1 / 60, 0.5);
  assert.equal(s.key, 'cat', 'in full view the one shown goes first');
  const frames = watch([['goddess', 20], ['cat', 20], ['forest', 20]], { shows: hint });
  oneAtATime(frames, 0.03);
  assert.deepEqual([...new Set(frames.filter(f => f.al > 0.99).map(f => f.key))], ['goddess', 'cat', 'forest'], 'each moment its face, in full');
  assert.ok(frames.every((f, i) => f.al === hint(i / 60)), 'and nothing but the rule fades it');
});

test('two pictures handing over by one number: the old one is gone at the middle, the new one only comes from there', () => {
  let last = [1, 0];
  for (let k = 0; k <= 1.0001; k += 1 / 180) {
    const [was, is] = V.handover(k);
    assert.ok(Math.min(was, is) === 0, `both to be seen at ${k.toFixed(3)}`);
    assert.ok(Math.abs(was - last[0]) < 0.02 && Math.abs(is - last[1]) < 0.02, `a jump at ${k.toFixed(3)}`);
    last = [was, is];
  }
  assert.deepEqual([V.handover(0), V.handover(0.5), V.handover(1), V.handover(-3), V.handover(7)], [[1, 0], [0, 0], [0, 1], [1, 0], [0, 1]]);
});

test('the eyes show their faces one at a time', () => {
  const eyes = read('eyes.html').replace(/\/\/.*$/gm, '');
  assert.ok(/DreamVis\.step\(vis\.face, [^;]+, dt, [^;]+\);\s*vis\.shown = DreamVis\.damp\(vis\.cur, vis\.face\.al\)/.test(eyes), 'the face shown is the one whose turn it is, as far as it is there');
  const draws = eyes.match(/faceMask\(vis\.mode[^;]*;/g) || [];
  assert.ok(draws.length >= 2 && draws.every(d => /vis\.shown/.test(d) && !/vis\.cur/.test(d)), 'every face of light is drawn by its turn');
  assert.ok(!/vis\.mode = /.test(eyes), 'nothing sets the face shown past its turn');
  assert.ok(/'silhouette' \? DreamVis\.handover\(bs\.mix\)/.test(eyes), "the person's outline never lies over another mask");
  assert.equal((eyes.match(/portal\.phase = 'out'; portal\.t0 = t; \}/g) || []).length, 2, 'a painted face leaves from as far as it had come (only its own time and the person leaving set it going otherwise)');
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
  const eyes = read('eyes.html'), win = read('window.html'), eye = read('dreameye.js');
  for (const [name, src] of [['eyes.html', eyes], ['window.html', win], ['dreameye.js', eye], ['dreamlife.js', read('dreamlife.js')]]) {
    assert.ok(!/grin/i.test(src), `${name}: the grin is gone`);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // without its comments
    // a nose only in the faces drawn in light, and there only as far as the rule lets it show (below)
    if (name !== 'eyes.html') assert.ok(!/nose|nostril/i.test(code), `${name}: no nose is drawn`);
  }
  for (const [name, src] of [['eyes.html', eyes], ['window.html', win]]) {
    assert.ok(src.includes('<script src="/static/dreamvis.js"></script>'), `${name} loads the rule`);
    assert.ok(/browAl: DreamVis\.of\(|browAl = DreamVis\.of\(/.test(src), `${name}: the brows show by the rule`);
    assert.ok(!/DreamVis[^;\n]*(aiFaces|DreamFace)|faceEdge\([^)]*vis/.test(src), `${name}: a face painted by the AI stays whole`);
  }
  // the faces drawn in light: every line and every dot carries the visibility of its part
  const body = eyes.slice(eyes.indexOf('function faceMask('), eyes.indexOf('// #160: faces painted by the AI'));
  const calls = body.split('\n').filter(l => !/const (line|leaf|dot) = /.test(l) && (/\b(line|leaf|dot)\(.*\);/.test(l) || /^\s*\}, wd.*\);/.test(l)));
  assert.ok(calls.length > 25, `${calls.length} drawing calls found`);
  for (const l of calls) assert.ok(/\* (mark|hair|outline|mouth|nose|part)\)|, w, al\)/.test(l), `a line without its part: ${l.trim().slice(0, 120)}`);
  const noses = body.split('\n').filter(l => /nose/i.test(l.replace(/\/\/.*$/, '')) && !/const mark = /.test(l));
  assert.ok(noses.length >= 2, 'the goddess and the cat have a nose');
  for (const l of noses) assert.ok(/\* nose\);/.test(l), `a nose past the rule: ${l.trim().slice(0, 120)}`);
  assert.equal(eyes.slice(0, eyes.indexOf('function faceMask(')).replace(/\/\/.*$/gm, '').match(/nose/gi), null, 'no nose anywhere else in the page');
  // a face has one size, the eyes': nothing of it is fitted to the screen's height
  assert.ok(!/\bH\b|\bh\b|\bfit\(/.test(body.replace(/\/\/.*$/gm, '')), 'a face of light is never pressed into the screen');
  assert.ok(!/LINEFACES\.has|BACKS = \[[^\]]*LINEFACES/.test(eyes), 'no face is a background that stays for a minute');
  // with ?debug the page stays a window: no fullscreen
  assert.ok(/if \(!DEBUG\) try \{ await document\.documentElement\.requestFullscreen\(/.test(eyes) && eyes.match(/requestFullscreen/g).length === 1, 'eyes.html: fullscreen only without ?debug');
});
