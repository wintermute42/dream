// #253: the performers' part of the page of Flowtrack (static/flowprofiles.js) – what it says of a profile, and what it
// may reach. Run: node --test tests/js/flowprofiles.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { perform, session } from './flow-sim.mjs';

const require = createRequire(import.meta.url);
const P = require('../../static/flowprofile.js'), UI = require('../../static/flowprofiles.js');
const read = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const repeat = (plan, n) => Array.from({ length: n }, () => plan).flat();
const learned = (plan, opts, prop) => { const got = P.learn(session(perform(plan, opts))); return P.profile('Person A', prop || got.prop, got); };

test('a profile in words: tempo, turning, plane, figures, how much it was learned from', () => {
  const poi = learned(repeat([{ secs: 8, way: 'poi', f: 0.8, k: 0.8 }, { secs: 8, way: 'poi', f: 1.8, k: 1.1 }, { secs: 3, way: 'rest' }], 3), { src: 'light', seed: 3 });
  const said = UI.describe(poi);
  assert.match(said[0], /^\d+–\d+ a minute$/); assert.ok(said.includes('turns anticlockwise') && said.includes('mostly circles seen face-on'));
  assert.match(said[said.length - 1], /^learned from \d+ s of movement$/);
  assert.ok(said.some(t => /figures? of their own$/.test(t)));
  const line = UI.describe(learned(repeat([{ secs: 10, way: 'line', f: 1.2, k: 1 }, { secs: 2, way: 'rest' }], 3), { seed: 6 }));
  assert.ok(line.includes('mostly upright lines') && !line.some(t => t.startsWith('turns')), line.join(' · '));
  assert.ok(line.some(t => /^\d+ a minute$/.test(t)), 'one steady tempo is one number');
});

test('what a profile changes, in sentences: the speed the effects are full at, the smoothing, what the automatic expects', () => {
  const big = P.compile(learned(repeat([{ secs: 8, way: 'fans', f: 0.9, k: 0.9 }, { secs: 8, way: 'fans', f: 1.8, k: 1.1 }, { secs: 3, way: 'rest' }], 3), { seed: 3 }), 'p1');
  const gentle = P.compile(learned(repeat([{ secs: 8, way: 'gentle', f: 0.45, k: 0.8 }, { secs: 8, way: 'gentle', f: 1.1, k: 1.8 }, { secs: 3, way: 'rest' }], 3), { seed: 5 }), 'p2');
  assert.match(UI.effect(big)[0], /keep their range up to \d\.\d times the speed/);
  assert.match(UI.effect(gentle)[0], /full strength at \d+ % of the speed/);
  assert.match(UI.effect(gentle).join(' '), /waits 2\.5 s when the performer is out of sight and expects the detection “Hands \(AI\)”/);
  assert.match(UI.effect({ ...big, speed: 8, smooth: 0.7, auto: { hold: 6, kind: 'on' } }).join(' '), /about as fast .* answer faster \(smoothing × 0\.70\)\. .* waits 6\.0 s .* “Fire\/LED”/);
  assert.match(UI.effect({ ...big, smooth: 1.4 }).join(' '), /more calmly \(smoothing × 1\.40\)/);
});

test('small things: a session’s name in the list, the energy curve as a line', () => {
  assert.equal(UI.sessionName({ id: '20261124-120500-ab12', seconds: 84.6 }), '2026-11-24 12:05 · 85 s');
  assert.equal(UI.sessionName({ id: 'odd' }), 'odd · 0 s');
  const pts = UI.curvePoints([0, 0.5, 1, 7, -3], 96, 28).split(' ').map(p => p.split(',').map(Number));
  assert.deepEqual(pts.map(p => p[0]), [0, 24, 48, 72, 96]);
  assert.deepEqual(pts.map(p => p[1]), [27, 14, 1, 1, 27], 'inside the box, whatever the value');
});

test('the part talks to Dream about profiles and the lab’s sessions only, and has no way to a picture', () => {
  const ui = read('static/flowprofiles.js'), core = read('static/flowprofile.js'), page = read('static/flowtrack.html');
  const urls = [...ui.matchAll(/fetch\('([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(urls)].sort(), ['/dance/sessions', '/dance/sessions/', '/flow/profiles', '/flow/profiles/']);
  for (const [name, src] of [['flowprofiles.js', ui], ['flowprofile.js', core]])
    assert.ok(!/toDataURL|toBlob|getImageData|drawImage|getUserMedia|<video|new WebSocket|localStorage|XMLHttpRequest/.test(src), name + ' touches no picture, no camera, no other line');
  assert.ok(!/fetch\(/.test(core), 'the computation talks to nobody');
  // the live take is a session in the page's memory: it goes into `learn`, never to Dream
  assert.ok(/R\.recorder\(/.test(ui) && !/sessions'[^)]*method: 'POST'/.test(ui));
  // the page mounts it with the bridge's live record, and the panel has the choice too
  assert.ok(page.includes("FlowProfiles.mount($('profiles')") && page.includes('/static/flowprofiles.css') && page.includes('/static/flowprofile.js'));
  const stage = read('static/index.html');
  assert.ok(stage.includes('id="flow_profile"') && stage.includes('aria-label="Performer"') && stage.includes("flow_profile: 'flow_profile'"));
  assert.ok(!read('static/remote.html').includes('flow_profile'), 'Dream Control has nothing of movement the panel lacks – and not this');
  // the profile only acts in the mode Flowtrack
  assert.ok(stage.includes("const flowFitted = () => (moveMode() === 'flowtrack' ? flowFit.profile : null);"));
});
