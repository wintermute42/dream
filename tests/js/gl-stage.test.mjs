// #204: the WebGL 2 chain of the stage and the output windows (static/gl-stage.js) against the Canvas 2D drawing
// (static/fx.js): tests/js/gl-stage.html draws every effect and every step of the chain both ways in a headless Chrome
// (software WebGL is enough) and this test reads how far the pictures are apart.
// Run: node --test tests/js/gl-stage.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ROOT, findChrome, runPage } from './browser.mjs';

// how far the two drawings may be apart: the mean per colour channel (of 255) and the share of pixels that differ
// clearly (edges of wedges, slices and dots, where the two draw their antialiasing differently)
const MEAN = 4, FAR = 2.5;
// these must change the picture at all, so a shader that does nothing cannot pass
const UNCHANGED_OK = ['cross-fade', 'square picture covers'];

const chrome = findChrome();
test('WebGL 2 chain against the Canvas 2D drawing', { skip: !chrome && !process.env.CI ? 'no Chrome or Chromium found (set CHROME_BIN)' : false }, async t => {
  assert.ok(chrome, 'no Chrome or Chromium found (set CHROME_BIN)');
  const report = await runPage(chrome, 'gl-stage.html');
  assert.equal(report.error, '', report.error);
  assert.equal(report.renderer, 'webgl2', 'the browser gave no WebGL 2 context');
  assert.equal(report.forced, 'canvas', 'the Canvas 2D drawing can be asked for');
  for (const c of report.cases) {
    await t.test(c.name, st => {
      st.diagnostic(`mean difference ${c.mean}, clearly different pixels ${c.far} %`);
      assert.ok(c.mean <= MEAN && c.far <= FAR, `${c.name}: mean difference ${c.mean} (≤ ${MEAN}), clearly different pixels ${c.far} % (≤ ${FAR})`);
      if (!UNCHANGED_OK.includes(c.name)) assert.ok(c.changed > 1, `${c.name}: the picture did not change (${c.changed})`);
    });
  }
  await t.test('every effect of fx.js is compared', () => {
    const fx = readFileSync(path.join(ROOT, 'static', 'fx.js'), 'utf8');
    const names = [...fx.match(/const ORDER = \[(.*?)\]/)[1].matchAll(/'(\w+)'/g), ...fx.match(/const FILTERS = \[(.*?)\]/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
    assert.ok(names.length >= 12);
    for (const n of names) assert.ok(report.cases.some(c => c.name === n), `no comparison for the effect ${n}`);
  });
  await t.test('a new picture under the smoothing: what is shown does not jump back (#215)', st => {
    st.diagnostic(`difference to the frame before: Canvas 2D ${report.kept.canvas}, WebGL 2 ${report.kept.webgl}`);
    for (const k of ['canvas', 'webgl']) assert.ok(report.kept[k] <= MEAN, `${k}: the smoothed picture moved when the new one took over (${report.kept[k]} > ${MEAN})`);
  });
  await t.test('the chain draws sparingly (#210)', () => {
    const s = report.sparing;
    assert.equal(s.still, 0, 'a still picture is not drawn again');
    assert.equal(s.changed, 1, 'a change is drawn');
    assert.ok(s.settling >= 5 && s.settling <= 25, `the smoothing draws while it catches up, then rests (${s.settling} of 60 frames)`);
    assert.equal(s.settled, 0, 'the smoothing at rest draws nothing');
    assert.ok(s.caughtUp <= MEAN, `at rest the smoothed picture is the newest one (${s.caughtUp})`);
    assert.ok(s.woken >= 4, `a new picture wakes the smoothing (${s.woken})`);
    assert.ok(s.limited >= 13 && s.limited <= 17, `a preview at 30 frames per second draws every other frame (${s.limited} of 30)`);
    assert.deepEqual(s.square, [256, 144], 'the canvas is as fine as the picture covering it');
    assert.deepEqual(s.effects, [320, 180], 'with effects it is as fine as their buffer');
    assert.deepEqual(s.large, [320, 180], 'and never finer than the screen');
  });
  await t.test('flow morph: shapes travel instead of appearing twice', st => {
    st.diagnostic(JSON.stringify(report.morph));
    const m = report.morph;
    assert.ok(m, 'no report on the morph');
    assert.ok(m.flow.mean <= MEAN, `half-way along the field the picture is the one half-way (mean difference ${m.flow.mean})`);
    assert.ok(m.flow.far <= FAR, `the morph leaves no dark edge where the field points out of the picture (${m.flow.far} % of the pixels differ clearly)`);
    assert.ok(m.fade.mean > 3 * m.flow.mean, `without the field the two pictures only cross-fade (${m.fade.mean} against ${m.flow.mean})`);
    assert.ok(m.broken <= 0.01, `a broken field is not used (${m.broken})`);
    assert.ok(m.camera.flow.mean <= MEAN && m.camera.fade.mean > 3 * m.camera.flow.mean,
      `within the camera's motion (#215) the field leads to the half-way picture too (${m.camera.flow.mean}, cross-fade ${m.camera.fade.mean})`);
  });
  await t.test('smoothing arrives at the new picture', st => {
    st.diagnostic(JSON.stringify(report.arrive));
    const a = report.arrive;
    assert.ok(a, 'no report on the smoothing');
    assert.ok(a.precise, 'the browser keeps the smoothed picture as floating-point numbers');
    assert.ok(a.webgl <= 2, `WebGL 2: at most ${a.webgl} brightness levels of the old picture are left (≤ 2)`);
    assert.ok(a.canvas <= 6, `Canvas 2D: at most ${a.canvas} brightness levels of the old picture are left (≤ 6)`);
  });
  await t.test('context lost: Canvas 2D takes over, restored: WebGL 2 again', () => {
    assert.ok(report.lost && report.restored, 'the browser cannot lose a context on purpose');
    assert.equal(report.lost.renderer, 'canvas');
    assert.equal(report.lost.shown, 'visible');
    assert.ok(report.lost.mean <= 0.01, `after the loss the Canvas 2D drawing shows the same picture (${report.lost.mean})`);
    assert.equal(report.restored.renderer, 'webgl2');
    assert.ok(report.restored.mean <= MEAN && report.restored.far <= FAR, `restored: ${report.restored.mean} / ${report.restored.far} %`);
  });
});
