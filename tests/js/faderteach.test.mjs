// #267: teaching a base movement of one's own (static/faderteach.js, the parts without a page) and how it stands in
// the sentences of Dream Dance (static/danceslots.js): the states' values and names, what is sent to Dream, the words
// and the pictogram of its sentence, what Dream takes from a movement shown. No browser.
// Run: node --test tests/js/faderteach.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const FT = require('../../static/faderteach.js'), S = require('../../static/danceslots.js'), F = require('../../static/dancefaders.js');
const de = JSON.parse(readFileSync(new URL('../../static/i18n/de.json', import.meta.url), 'utf8'));

test('the states are spread evenly from 0 to 1 – two of them, or with steps between', () => {
  assert.deepEqual(FT.stateValues(2), [0, 1]);
  assert.deepEqual(FT.stateValues(3), [0, 0.5, 1]);
  assert.deepEqual(FT.stateValues(4), [0, 0.33333, 0.66667, 1]);
  assert.deepEqual(FT.stateValues(F.MAX_STATES), [0, 0.25, 0.5, 0.75, 1]);
});

test('the names: of the base movement (none twice among them) and of each state (each its own)', () => {
  assert.equal(FT.nameProblem('Knees', ['upright', 'deep in the knees']), null);
  assert.equal(FT.nameProblem('  Knees ', [' upright', 'deep  in the knees ']), null, 'spaces are tidied');
  assert.deepEqual(FT.nameProblem('', ['a', 'b']), { what: 'name' });
  assert.deepEqual(FT.nameProblem('<b>', ['a', 'b']), { what: 'name' });
  assert.deepEqual(FT.nameProblem('knees', ['a', 'b'], ['Knees']), { what: 'taken' });
  assert.deepEqual(FT.nameProblem('Knees', ['a', '', 'b']), { what: 'state', i: 1 });
  assert.deepEqual(FT.nameProblem('Knees', ['up', 'Up']), { what: 'twice', i: 1 });
});

test('what is sent to Dream: the name, the states with their values, the regression – numbers and names only', () => {
  const model = { v: 1, keys: ['knee_l.v'], m: [-3], w: [1], b: 0.5, share: [1], states: [{ y: 0, at: 0 }, { y: 0.5, at: 0.5 }, { y: 1, at: 1 }] };
  const file = FT.fileOf(' Lean ', ['left', ' middle ', 'right'], model);
  assert.deepEqual(file, { format: 'dream-dance-fader', version: 1, name: 'Lean', states: [{ name: 'left', y: 0 }, { name: 'middle', y: 0.5 }, { name: 'right', y: 1 }], model });
  assert.equal(FT.readFrom({ ...model, keys: ['knee_l.v', 'ankle_r.u'], m: [0, 0], w: [1, 1], share: [0.7, 0.3] }), 'knees ↕ 70 % · feet ↔ 30 %');
  for (const p of Object.values(F.PART)) assert.ok(de[p], p);
});

test('a base movement of one’s own stands in a sentence like a built-in one: its words, its pictogram', () => {
  const faders = { f0a1b2c3d: { name: 'Knees', to: 'deep in the knees' } };
  assert.deepEqual(S.phrase('base', { src: 'f.f0a1b2c3d', fx: 'waves', amt: 1 }, {}, faders), { lead: 'When I', move: 'go towards “deep in the knees”', fx: 'the waves grow stronger' });
  assert.equal(S.phrase('base', { src: 'f.f0a1b2c3d', fx: 'waves', amt: 1 }).move, 'a base movement of yours', 'one the page does not know (yet)');
  assert.ok(de['go towards “{n}”'] && de['a base movement of yours']);
  assert.ok(S.OWN_BASE.test('f.f0a1b2c3d') && !S.OWN_BASE.test('g.m0a1b2c3d') && !S.OWN_BASE.test('f.f0a1b2c3'));
  const p = S.pictogram('f.f0a1b2c3d');
  assert.notEqual(p, S.pictogram('energy')); assert.notEqual(p, S.pictogram('g.m0a1b2c3d')); assert.ok(p.includes('aria-hidden="true"'));
  // shown, Dream takes the clearest continuous value – a base movement of one's own too
  const still = { g: {}, v: { energy: 0.05, open: 0.5, turn: 0, height: 0.4, 'f.f0a1b2c3d': 0.1 } };
  assert.deepEqual(S.strongest([still, { g: {}, v: { ...still.v, 'f.f0a1b2c3d': 0.95 } }], { base: [...S.BASE, 'f.f0a1b2c3d'] }), { src: 'f.f0a1b2c3d', where: 'base', sure: 0.85 });
  assert.equal(S.strongest([still, { g: {}, v: { ...still.v, 'f.f0a1b2c3d': 0.95 } }]), null, 'only the values asked for');
  // a sentence for it: in a free place, with an effect that fits
  const set = { base: [{ src: 'energy', fx: 'trails', amt: 0.5 }, null], accents: [null, null, null, null], hands: [] };
  const r = S.assign(set, 'base', 'f.f0a1b2c3d', 'waves');
  assert.equal(r.why, null); assert.equal(r.i, 1); assert.deepEqual(r.slots.base[1], { src: 'f.f0a1b2c3d', fx: 'waves', amt: 0.5 });
});

test('the page loads the learner before the teacher, the stage before the stream – and only transform and opacity move', () => {
  const page = readFileSync(new URL('../../static/dance.html', import.meta.url), 'utf8'), stage = readFileSync(new URL('../../static/index.html', import.meta.url), 'utf8');
  const at = (html, name) => html.indexOf(`<script src="/static/${name}"></script>`);
  assert.ok(at(page, 'dancefaders.js') >= 0 && at(page, 'dancefaders.js') < at(page, 'faderteach.js'));
  assert.ok(at(page, 'danceslots.js') < at(page, 'faderteach.js') && page.includes('<section id="faderteach"></section>'));
  assert.ok(at(stage, 'dancefaders.js') >= 0 && at(stage, 'dancefaders.js') < at(stage, 'dance.js'));
  assert.ok(page.includes('FaderTeach.mount(') && page.includes('learnBase:') && page.includes('fadersChanged()'));
  assert.ok(stage.includes('danceDet.setFaders(') && stage.includes("fetch('/dance/faders')") && stage.includes('m.dance.faders'));
  const css = readFileSync(new URL('../../static/moveteach.css', import.meta.url), 'utf8');
  for (const m of css.matchAll(/transition:([^;}]+)/g)) for (const part of m[1].split(',')) assert.match(part.trim(), /^(transform|opacity)\b/);
  // with less motion wished for, the cards keep their layout – only the animation goes
  const calm = css.match(/@media \(prefers-reduced-motion: reduce\) \{([^}]*)\}/g).join('');
  assert.ok(!/display\s*:/.test(calm), calm);
});
