// #219, #229: "you in the dream" (static/dreamyou.js) – the person in front of Dreamy Eyes, cut out on the phone and
// drawn as in a dream. A headless Chrome draws an invented person (tests/js/you.html): dreamy as it comes and goes (it
// wavers, runs out softly, comes apart), the face exactly the camera's picture while it is clear; the room is never
// shown; and the file never talks to anyone and asks no model.
// Run: node --test tests/js/you.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ROOT, findChrome, runPage } from './browser.mjs';

const chrome = findChrome();
const FRAMES = ['null', 'blossom', 'mandala', 'mist'];

test('the drawing sends nothing: no network, no export of the picture in dreamyou.js', () => {
  const code = readFileSync(path.join(ROOT, 'static', 'dreamyou.js'), 'utf8');
  for (const word of ['fetch', 'WebSocket', 'XMLHttpRequest', 'sendBeacon', 'toBlob', 'toDataURL', 'send(', 'postMessage', 'localStorage', 'indexedDB', 'captureStream', 'import(']) {
    assert.ok(!code.includes(word), `dreamyou.js must not use ${word}`);
  }
});

test('the dream look is drawn, not computed by a model: no AI, no worker, no blur filter, no loop over a large picture', () => {
  const code = readFileSync(path.join(ROOT, 'static', 'dreamyou.js'), 'utf8');
  for (const word of ['Worker', 'wasm', 'tflite', 'onnx', 'mediapipe', 'importScripts', 'aimask', 'img2img', '/make', '/ws', '.filter', 'createImageData', '<script']) {
    assert.ok(!code.includes(word), `dreamyou.js must not use ${word}`);
  }
  assert.equal(code.split('getImageData').length - 1, 1, 'pixels are read in one place only: the tiny outline');
});

test('you in the dream, drawn in a browser', { skip: chrome ? false : 'no Chrome or Chromium found (CHROME_BIN names one)' }, async t => {
  const r = await runPage(chrome, 'you.html');
  assert.equal(r.error, '');

  await t.test('the person is cut out, mirrored like a mirror, the face in the picture', () => {
    assert.deepEqual(r.crop, { x: 76, y: 0, s: 360 });
    assert.equal(r.mirrored[0], r.mirrored[1]);
    assert.equal(r.cutCorner, 0, 'nothing of the room in the cut-out');
    assert.equal(r.cutFace, 255);
    assert.ok(Math.abs(r.eyes.x0 - r.eyesWant.x0) < 0.002 && Math.abs(r.eyes.x1 - r.eyesWant.x1) < 0.002, 'its eyes, for our pupils');
  });

  await t.test('the person runs out softly instead of ending in a line', () => {
    assert.ok(r.edge.step < 64, `no step in the person's edge (${r.edge.step})`);
    assert.ok(r.edge.near > 0 && r.edge.near < 250 && r.edge.past === 0, `thinner towards the edge (${r.edge.near}), nothing past it (${r.edge.past})`);
    assert.ok(r.overEdge > r.overChest + 30, `mist and shimmer at the edge (${r.overEdge}), not in front of the person's middle (${r.overChest})`);
  });

  await t.test('in the middle of the moment the face is clear: exactly the camera\'s picture, nothing over it', () => {
    assert.deepEqual(r.peak, [0, 1, 0], 'dreamy as it comes, clear in the middle, dreamy as it goes');
    for (const f of FRAMES) {
      assert.ok(r.face[f] <= 1, `frame ${f}: a pixel of the clear face differs by ${r.face[f]}`);
      assert.equal(r.overFace[f], 0, `frame ${f}: something is drawn over the clear face`);
    }
    assert.ok(r.holedCore <= 1, `a hole in the mask shows in the face (${r.holedCore})`);
  });

  await t.test('in every other style world too: at the peak the face unchanged, nothing over it, the room never shown, its frames show', () => {
    assert.ok(Object.keys(r.worlds).length > 0);
    for (const [w, x] of Object.entries(r.worlds)) for (const f of Object.keys(x.face)) {
      assert.ok(x.face[f] <= 1, `${w}, frame ${f}: a pixel of the face differs by ${x.face[f]}`);
      assert.equal(x.overFace[f], 0, `${w}, frame ${f}: something is drawn over the face`);
      assert.equal(x.room[f], 0, `${w}, frame ${f}: ${x.room[f]} pixels of the room are shown`);
      if (f !== 'null') assert.ok(x.frameDrawn[f] > 2000, `${w}, frame ${f} shows (${x.frameDrawn[f]} pixels)`);
    }
  });

  await t.test('before and after it is dreamy: the face soft and wavering', () => {
    assert.ok(r.dreamy.face > 30, `the face is not the plain camera picture (${r.dreamy.face})`);
    assert.ok(r.dreamy.moved > 100, `it wavers: ${r.dreamy.moved} pixels of the face differ a moment later`);
  });

  await t.test('the dream around: its picture as the background, a glow, now and then a frame – never the room', () => {
    for (const f of FRAMES) assert.equal(r.room[f], 0, `frame ${f}: ${r.room[f]} pixels of the room are shown`);
    assert.equal(r.dreamy.room, 0, 'nor while it is dreamy');
    assert.ok(r.corner[2] > r.corner[0] && r.corner[2] > r.corner[1], `the dream behind the person (${r.corner})`);
    assert.ok(r.glow > 60, `the outline glows (${r.glow})`);
    for (const f of FRAMES.slice(1)) assert.ok(r.frameDrawn[f] > 2000, `frame ${f} shows (${r.frameDrawn[f]} pixels)`);
  });

  await t.test('it leaves by coming apart into the dream: the outside first, the face last, torn into streaks, then nothing', () => {
    assert.equal(r.leave.start, 255, 'whole before it leaves');
    assert.ok(r.leave.cornerMid < 30 && r.leave.faceMid > 200, `on its way: the edge is gone (${r.leave.cornerMid}), the face still there (${r.leave.faceMid})`);
    assert.ok(r.leave.torn[1] > 5000 && r.leave.torn[0] < r.leave.torn[1] / 10, `what is left is drawn aside, more and more (${r.leave.torn})`);
    assert.equal(r.leave.end, 0, 'nothing is left at the end: no person, no mist, no spark');
    assert.ok(r.leave.steps >= 4, `not a plain fade: its pieces go one after the other (${r.leave.steps} different moments)`);
  });

  await t.test('it draws whatever it is given, and quickly', () => {
    assert.equal(r.thrown, 0);
    assert.equal(r.outlines, 2, 'the outline is made once per mask, not once per picture');
    assert.ok(r.ms > 0 && r.ms < 2000, `a picture takes ${r.ms.toFixed(1)} ms without a graphics card`);
  });
});
