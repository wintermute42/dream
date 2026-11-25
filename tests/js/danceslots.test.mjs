// #265: the slots of Dream Dance (static/danceslots.js) – what fits where, what a hand makes of the slots, what the
// page shows lights up and the traffic light. No browser. Run: node --test tests/js/danceslots.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../../static/danceslots.js');
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
  assert.deepEqual(a.accents[1], slot('g.wave', 'hue', 1)); assert.equal(set.accents[1], null, 'the slots handed in stay');
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

test('an own copy gets a free name', () => {
  assert.equal(S.copyName('Waves', ['standard', 'waves']), 'Waves 2');
  assert.equal(S.copyName('Wellen', ['Wellen 2', 'Wellen 3']), 'Wellen 4');
  assert.match(S.copyName('a/b<c>', []), /^abc 2$/);
});

test('the slots live on the page of Dream Dance only – nothing of them on the stage’s output', () => {
  for (const f of ['static/output.html', 'static/remote.html']) assert.ok(!readFileSync(new URL('../../' + f, import.meta.url), 'utf8').includes('danceslots'), f);
  const html = readFileSync(new URL('../../static/dance.html', import.meta.url), 'utf8');
  assert.ok(html.includes('danceslots.js') && html.includes('id="ui-slots"') && html.includes('id="ui-table"'));
});
