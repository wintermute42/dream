// #265: the slots of Dream Dance as sentences (static/danceslots.js) – what fits where, what a hand makes of the slots,
// the words of a sentence, the three strengths, the names of new sets, what lights up (the sentences, the signal's way,
// the traffic light), what Dream takes from a movement shown, and the introduction (static/danceintro.js). No browser.
// Run: node --test tests/js/danceslots.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../../static/danceslots.js'), I = require('../../static/danceintro.js');
const slot = (src, fx, amt = 1) => ({ src, fx, amt });
const set = { base: [slot('energy', 'trails'), slot('open', 'kaleido')], accents: [slot('g.throw', 'tunnel'), null, null, null], hands: ['paint', 'warp'] };

test('what fits where – the same rules as Dream’s (dance.py slot_conflict)', () => {
  assert.equal(S.fits(set, 'accents', 1, 'tunnel'), 'taken');
  assert.equal(S.fits(set, 'accents', 0, 'tunnel'), null, 'its own place');
  assert.equal(S.fits(set, 'base', 1, 'feedback'), 'group', 'the two base slots of one group cancel out');
  assert.equal(S.fits(set, 'base', 1, 'mandala'), null, 'replacing the base slot’s own effect by one of its group');
  assert.equal(S.fits(set, 'accents', 1, 'mirror'), 'base', 'an accent of a base slot’s group');
  assert.equal(S.fits(set, 'accents', 1, 'waves'), null, 'accents may share a group: they come one at a time');
  for (const fx of S.EFFECTS) assert.ok(S.REASONS[S.fits(set, 'accents', 1, fx) || 'taken'](), fx);   // every reason has words
  // the python side keeps the very same three reasons
  const py = readFileSync(new URL('../../dance.py', import.meta.url), 'utf8');
  for (const r of ['taken', 'group', 'base']) assert.ok(py.includes(`"${r}"`), r);
});

test('a hand on the slots: an effect, empty, the strength, the hands’ switches (at most two)', () => {
  const a = S.place(set, { where: 'accents', i: 1, slot: slot('g.wave', 'hue', 3) });
  assert.deepEqual(a.accents[1], { ...slot('g.wave', 'hue', 1), tol: 'normal' }); assert.equal(set.accents[1], null, 'the slots handed in stay');
  // a strength is one of three steps; an accent keeps its tolerance, a base movement has none
  assert.deepEqual(S.STEPS, [0, 0.5, 1]);
  assert.deepEqual([0, 0.2, 0.3, 0.6, 0.8, 1].map(S.stepOf), [0, 0, 1, 1, 2, 2]);
  assert.equal(S.place(set, { where: 'base', i: 0, slot: slot('energy', 'trails', 0.7) }).base[0].amt, 0.5);
  assert.equal(S.place(set, { where: 'base', i: 0, slot: { ...slot('energy', 'trails'), tol: 'loose' } }).base[0].tol, undefined);
  assert.equal(S.place(set, { where: 'accents', i: 0, slot: { ...slot('g.throw', 'tunnel'), tol: 'loose' } }).accents[0].tol, 'loose');
  assert.equal(S.place(set, { where: 'accents', i: 0, slot: { ...slot('g.throw', 'tunnel'), tol: 'sloppy' } }).accents[0].tol, 'normal');
  assert.equal(S.place(set, { where: 'base', i: 0, slot: null }).base[0], null);
  assert.deepEqual(S.place(set, { hand: 'light', on: true }).hands, ['paint', 'warp'], 'two are on: a third does not come');
  assert.deepEqual(S.place(set, { hand: 'paint', on: false }).hands, ['warp']);
  assert.deepEqual(S.place({ ...set, hands: ['warp'] }, { hand: 'paint', on: true }).hands, ['paint', 'warp']);
  assert.equal(S.handFits(set, 'light'), 'hands'); assert.equal(S.handFits(set, 'paint'), null);
});

test('a tile glows while its slot acts, as strongly as its effect is after the rules; the hands glow in its colour', () => {
  const live = { out: { 'fx.trails': 0.8, 'fx.kaleido': 0.1, 'fx.tunnel': 0.5 }, held: id => ({ base0: 0.8, base1: 0.5, accent0: 0 })[id] || 0 };
  assert.equal(S.level(live, 'base0', 'fx.trails'), 0.8);
  assert.equal(S.level(live, 'base1', 'fx.kaleido'), 0.1, 'held back by its group or the budget: the tile shows it');
  assert.equal(S.level(live, 'accent0', 'fx.tunnel'), 0, 'its row does not ask: another row moves that target');
  assert.equal(S.level(null, 'base0', 'fx.trails'), 0);
  const g = S.glow(set, live);
  assert.deepEqual(g.l, { col: S.COLOURS.afterglow, k: 0.8 }); assert.deepEqual(g.r, g.l);
  assert.equal(S.glow(set, { out: {}, held: () => 0 }), null, 'nothing acts: the hands as they are');
});

test('the traffic light: green only when nothing blocks', () => {
  const live = { seen: true, markerWanted: false, markers: 0 };
  assert.deepEqual(S.light({ mode: 'dance', clutch: true }, live), { green: true, clutch: 'ok', person: 'ok', marker: 'none' });
  assert.equal(S.light({ mode: 'dance', clutch: false }, live).clutch, 'block');
  assert.equal(S.light({ mode: 'dance', clutch: false }, live).green, false);
  assert.equal(S.light({ mode: 'dance', clutch: true }, { ...live, seen: false }).person, 'block');
  assert.deepEqual(S.light({ mode: 'dance', clutch: true }, { ...live, markerWanted: true }), { green: false, clutch: 'ok', person: 'ok', marker: 'block' });
  assert.equal(S.light({ mode: 'dance', clutch: true }, { ...live, markerWanted: true, markers: 2 }).green, true);
  assert.equal(S.light({ mode: 'mood', clutch: true }, live).green, false, 'another mode: the dance does nothing');
  assert.equal(S.light({ mode: 'dance', clutch: true }, null).person, 'block', 'nothing comes from the stage: nobody');
});

test('a sentence says what will happen – each half in words of its own', () => {
  assert.deepEqual(S.phrase('accents', slot('g.throw', 'trails')), { lead: 'When I', move: 'throw my arms up', fx: 'trails follow' });
  assert.deepEqual(S.phrase('base', slot('energy', 'waves')), { lead: 'When I', move: 'move a lot', fx: 'the waves grow stronger' });
  assert.equal(S.phrase('accents', slot('g.m0a1b2c3d', 'hue'), { m0a1b2c3d: 'Lasso' }).move, 'dance “Lasso”', 'a move of one’s own by its name');
  // every movement and every effect has its words, in both lanes – in the translations too
  const de = JSON.parse(readFileSync(new URL('../../static/i18n/de.json', import.meta.url), 'utf8'));
  for (const src of [...S.BASE, ...S.ACCENTS]) { const p = S.phrase(S.BASE.includes(src) ? 'base' : 'accents', slot(src, 'hue')); assert.notEqual(p.move, src); assert.ok(de[p.move], p.move); }
  for (const fx of S.EFFECTS) for (const w of ['base', 'accents']) { const p = S.phrase(w, slot('energy', fx)); assert.notEqual(p.fx, fx); assert.ok(de[p.fx], p.fx); }
});

test('a new set gets the name the dancer gives it – a suggestion, never a silent number', () => {
  assert.equal(S.suggestName('Waves', ['standard', 'waves']), 'Waves – mine');
  assert.equal(S.suggestName('Waves', ['Waves – mine']), 'Waves – mine 2', 'taken: the number stands in the field to be seen');
  assert.equal(S.suggestName('a/b<c>', []), 'abc – mine');
  assert.equal(S.nameProblem('Waves – mine', ['standard']), null);
  assert.equal(S.nameProblem('standard', ['standard']), 'taken');
  for (const bad of ['', ' ', 'a/b', '<b>', 'x'.repeat(33)]) assert.equal(S.nameProblem(bad, []), 'chars', bad);
  // the same names as Dream takes (dance.py SLOT_NAME)
  const py = readFileSync(new URL('../../dance.py', import.meta.url), 'utf8');
  assert.ok(py.includes('SLOT_NAME = re.compile(r"[^\\W_][\\w .+\\-–]{0,31}")'));
});

test('the signal’s way: each link glows while it lets the movement through', () => {
  const live = { running: true, seen: true, gesture: null, v: { energy: 0.3 } };
  assert.deepEqual(S.chain({ clutch: true, strength: 1 }, live, 0.5), { detect: true, moves: true, clutch: true, effects: true, strength: true });
  assert.deepEqual(S.chain({ clutch: false, strength: 1 }, live, 0), { detect: true, moves: true, clutch: false, effects: false, strength: false });
  assert.equal(S.chain({ clutch: true, strength: 0 }, live, 0.5).strength, false, 'strength 0 in the panel: nothing comes out');
  assert.equal(S.chain({ clutch: true }, { ...live, seen: false }, 0).detect, false);
  assert.equal(S.chain({ clutch: true }, { ...live, v: { energy: 0.02 } }, 0).moves, false, 'standing still');
  assert.equal(S.chain({ clutch: true }, { ...live, gesture: 'throw', v: {} }, 0).moves, true);
  assert.equal(S.chain(null, null, 0).detect, false);
});

test('what was shown: the clearest gesture is an accent, else the value that changed most is a base movement', () => {
  const still = { g: { throw: 0.1 }, v: { energy: 0.1, open: 0.5, turn: 0, height: 0.2 } };
  assert.deepEqual(S.strongest([still, { g: { throw: 0.7, push: 0.5 }, v: still.v }, still]), { src: 'g.throw', where: 'accents', sure: 0.7 });
  assert.deepEqual(S.strongest([still, { g: {}, v: { energy: 0.8, open: 0.55, turn: 0, height: 0.2 } }]), { src: 'energy', where: 'base', sure: 0.7000000000000001 });
  assert.equal(S.strongest([still, still]), null, 'nothing clear: Dream says so');
  assert.equal(S.strongest([{ g: { m0a1b2c3d: 0.9 }, v: {} }], { gestures: ['throw'] }), null, 'only the movements asked for');
  assert.equal(S.strongest([{ g: { m0a1b2c3d: 0.9 }, v: {} }]).src, 'g.m0a1b2c3d', 'a move of one’s own is a gesture like the others');
  assert.equal(S.strongest([{ g: {}, v: { turn: -0.6 } }, { g: {}, v: { turn: -0.5 } }]).src, 'turn', 'turning counts both ways');
});

test('a new sentence goes into a free place of its lane, or takes the last one’s place – and keeps the rules', () => {
  const r = S.assign(set, 'accents', 'g.wave', 'waves');
  assert.equal(r.i, 1); assert.equal(r.replaced, null); assert.equal(r.why, null);
  assert.deepEqual(r.slots.accents[1], { src: 'g.wave', fx: 'waves', amt: 0.5, tol: 'normal' });
  assert.equal(S.assign(set, 'accents', 'g.throw', 'hue').i, 0, 'the movement has a sentence already: that one changes');
  const full = S.assign(set, 'base', 'turn', 'hue');
  assert.equal(full.i, 1); assert.deepEqual(full.replaced, set.base[1]); assert.equal(full.slots.base[1].src, 'turn');
  assert.equal(S.assign(set, 'accents', 'g.wave', 'feedback').why, 'base', 'an accent of a base movement’s group is greyed');
  assert.equal(S.assign(set, 'accents', 'g.wave', 'feedback').slots, set, 'and changes nothing');
  // an effect in another sentence moves to the new one
  const mv = S.assign(set, 'accents', 'g.wave', 'tunnel');
  assert.equal(mv.why, null); assert.deepEqual(mv.moved, { where: 'accents', i: 0, slot: set.accents[0] });
  assert.deepEqual(mv.slots.accents.filter(Boolean).map(x => x.src + '→' + x.fx), ['g.wave→tunnel']);
  assert.equal(S.assign(set, 'base', 'turn', 'feedback').why, 'group', 'the other base movement’s group: greyed');
});

test('every movement has its pictogram – a small figure, no text in it', () => {
  for (const src of [...S.BASE, ...S.ACCENTS, 'g.m0a1b2c3d', 'hands']) {
    const svg = S.pictogram(src);
    assert.match(svg, /^<svg class="ds-pict"[^>]*aria-hidden="true"/); assert.ok(!/<text/.test(svg), src);
  }
  assert.notEqual(S.pictogram('g.throw'), S.pictogram('g.push'));
});

test('the introduction goes the signal’s way, one sentence a step, and stays off once switched off', () => {
  assert.deepEqual(I.STEPS.map(s => s.k), ['camera', 'clutch', 'slots', 'beat', 'learn']);
  for (const s of I.STEPS) { assert.ok(s.at.length > 0); assert.equal(s.say().split(/[.!?]\s/).length, 1, s.k); }
  assert.equal(I.wanted(null), true, 'the first time'); assert.equal(I.wanted('on'), true); assert.equal(I.wanted('off'), false);
  const html = readFileSync(new URL('../../static/dance.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="beatcard"') && html.includes('class="mp-card mp-clutch"') && html.includes('id="help"'));
});

test('the slots live on the page of Dream Dance only – nothing of them on the stage’s output', () => {
  for (const f of ['static/output.html', 'static/remote.html']) assert.ok(!readFileSync(new URL('../../' + f, import.meta.url), 'utf8').includes('danceslots'), f);
  const html = readFileSync(new URL('../../static/dance.html', import.meta.url), 'utf8');
  assert.ok(html.includes('danceslots.js') && html.includes('id="ui-slots"') && html.includes('id="ui-table"'));
  // only transform and opacity move
  const css = readFileSync(new URL('../../static/danceslots.css', import.meta.url), 'utf8');
  for (const m of css.matchAll(/transition:([^;}]+)/g)) for (const part of m[1].split(',')) assert.match(part.trim(), /^(transform|opacity|none)\b/);
  for (const m of css.matchAll(/@keyframes[^{]+\{((?:[^{}]*\{[^{}]*\})+)/g)) for (const p of m[1].matchAll(/([a-z-]+)\s*:/g)) assert.ok(['opacity', 'transform'].includes(p[1]), p[1]);
});
