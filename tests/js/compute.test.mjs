// #238: who computes right now (static/compute.js) – what the panel and Dream Control say for every state of the cloud
// GPU, where the stage's pictures are painted (the Mac bridges while the cloud prepares), and the badge in a real
// browser. No GPU, no cloud: the statuses are made up.
// Run: node --test tests/js/compute.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { findChrome, runPage } from './browser.mjs';

const read = file => readFileSync(new URL('../../static/' + file, import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(read('compute.js'), { window, T: (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => vars[k]) : text) });
const { now, canStart, becameReady, STEPS } = window.DreamCompute;

const running = work => ({ state: 'running', type: 'runpod:RTX-4090', minutes: 3, cost_eur: 0.04, busy: false, work });
const OFF = { state: 'off', busy: false };
const PREPARING = [['machine', 'GPU starts'], ['download', 'Model is downloaded (43 %)'], ['loading', 'Model loads'], ['compiling', 'Is optimised']];

test('the Mac computes while "Local" is chosen – whatever the cloud does', () => {
  assert.deepEqual({ ...now('local', OFF, true) }, { paints: 'mac', kind: 'mac', text: 'Computing now: Mac', sub: '', offer: false, steps: null });
  for (const [phase, step] of PREPARING) {
    const info = now('local', running({ phase, eta_min: 4, percent: 43 }), true);
    assert.equal(info.paints, 'mac');
    assert.equal(info.text, 'Computing now: Mac');
    assert.equal(info.sub, `The cloud prepares: ${step} · about 4 min left (it costs already)`);
    assert.equal(info.offer, false);
  }
});

test('a cloud GPU that is ready is offered while the Mac computes', () => {
  const info = now('local', running({ phase: 'ready' }), true);
  assert.equal(info.paints, 'mac');
  assert.equal(info.offer, true);
  assert.match(info.sub, /ready \(it costs\)/);
  assert.equal(now('cloud', running({ phase: 'ready' }), true).offer, false);
});

test('the cloud computes once it is ready', () => {
  for (const bridge of [true, false]) {
    const info = now('cloud', running({ phase: 'ready' }), bridge);
    assert.deepEqual([info.paints, info.kind, info.text, info.steps], ['cloud', 'cloud', 'Computing now: Cloud ✓', null]);
  }
});

test('while the cloud prepares, the Mac bridges – and says at which step the cloud is', () => {
  for (const [phase, step] of PREPARING) {
    const info = now('cloud', running({ phase, eta_min: 2, percent: 43 }), true);
    assert.deepEqual([info.paints, info.kind], ['mac', 'bridge']);
    assert.equal(info.text, `The Mac bridges – cloud: ${step} …`);
    assert.equal(info.sub, 'about 2 min left (it costs already) · the cloud takes over by itself');
    assert.deepEqual(info.steps.map(s => s.at), STEPS.map((s, i) => i < STEPS.indexOf(phase) ? 'done' : s === phase ? 'now' : 'todo'));
    assert.equal(info.steps.filter(s => s.at === 'now')[0].name, step);
  }
});

test('with bridging off nobody paints until the cloud is ready', () => {
  const info = now('cloud', running({ phase: 'compiling', eta_min: 3 }), false);
  assert.deepEqual([info.paints, info.kind, info.text], [null, 'wait', 'The cloud prepares: Is optimised …']);
  assert.match(info.sub, /about 3 min left \(it costs already\) · no pictures until then/);
});

test('the five steps, in order, the percent only on the download', () => {
  const steps = now('cloud', running({ phase: 'download', percent: 12 }), true).steps;
  assert.deepEqual(Array.from(steps, s => s.name), ['GPU starts', 'Model is downloaded (12 %)', 'Model loads', 'Is optimised', 'Ready']);
  assert.equal(now('cloud', running({ phase: 'download' }), true).steps[1].name, 'Model is downloaded');
  assert.equal(now('cloud', running({ phase: 'loading', percent: 12 }), true).steps[1].name, 'Model is downloaded');
});

test('a cloud GPU that does not answer: the Mac computes, and it is said that it costs', () => {
  const down = running({ phase: 'unreachable' });
  assert.deepEqual([now('cloud', down, true).paints, now('cloud', down, true).kind, now('cloud', down, true).text], ['mac', 'down', 'Cloud not reachable – the Mac computes']);
  assert.deepEqual([now('cloud', down, false).paints, now('cloud', down, false).text], [null, 'Cloud not reachable – no pictures']);
  for (const backend of ['cloud', 'local']) assert.match(now(backend, down, true).sub, /costs until you delete it/);
});

test('"Cloud GPU" chosen with none started: the Mac computes, or nobody with bridging off', () => {
  for (const cloud of [OFF, { state: 'setup' }, { state: 'off', busy: false, fail: { kind: 'error', text: 'x' } }, running({ phase: 'stopping' })]) {
    assert.deepEqual([now('cloud', cloud, true).paints, now('cloud', cloud, true).text], ['mac', 'No cloud GPU started – the Mac computes']);
    assert.deepEqual([now('cloud', cloud, false).paints, now('cloud', cloud, false).kind], [null, 'wait']);
  }
});

test('"Start" is offered while no cloud GPU is there, or one that does not answer', () => {
  assert.equal(canStart(OFF), true);
  assert.equal(canStart(running({ phase: 'unreachable' })), true);
  for (const c of [{ state: 'setup' }, { state: 'off', busy: true, work: { phase: 'machine' } }, running({ phase: 'compiling' }), running({ phase: 'ready' })]) assert.equal(canStart(c), false);
});

test('"ready" is told once: when a status with a step is followed by one that is ready', () => {
  assert.equal(becameReady(running({ phase: 'compiling' }), running({ phase: 'ready' })), true);
  assert.equal(becameReady(running({ phase: 'unreachable' }), running({ phase: 'ready' })), true);
  assert.equal(becameReady(running({ phase: 'ready' }), running({ phase: 'ready' })), false);
  assert.equal(becameReady(OFF, running({ phase: 'ready' })), false);            // the page was opened while it ran
  assert.equal(becameReady(running({ phase: 'machine' }), running({ phase: 'download' })), false);
});

test('no page shows a line of a log, and both draw the shared badge', () => {
  for (const page of ['index.html', 'remote.html']) {
    const html = read(page);
    assert.match(html, /<div id="computing" class="compute"><\/div>/, page);
    assert.match(html, /<script src="\/static\/compute\.js"><\/script>/, page);
    assert.match(html, /<link rel="stylesheet" href="\/static\/compute\.css">/, page);
    assert.match(html, /DreamCompute\.draw\(/, page);
    assert.match(html, /id="cloud_bridge"/, page);
    for (const line of html.split('\n')) if (/textContent/.test(line)) assert.ok(!/\.log\b/.test(line), `${page} writes a log line into the page: ${line.trim().slice(0, 120)}`);
  }
  assert.ok(!/lastLine\(c\.log\)/.test(read('index.html')), 'the status line is built without the log');
});

const chrome = findChrome();
test('the badge in a browser', { skip: !chrome && !process.env.CI ? 'no Chrome or Chromium found (set CHROME_BIN)' : false }, async () => {
  const r = await runPage(chrome, 'compute.html');
  assert.equal(r.error, '', r.error);
  assert.deepEqual(r.mac, { kind: 'mac', text: 'Computing now: Mac', role: 'status', sub: false, steps: false, offer: false });
  assert.equal(r.bridge.kind, 'bridge');
  assert.deepEqual(r.bridge.marks, ['✓', '●', '○', '○', '○']);
  assert.deepEqual(r.bridge.current, ['Model is downloaded (43 %)']);       // aria-current="step" on exactly the step it is at
  assert.equal(r.bridge.stepsLabel, 'Steps of the cloud GPU');
  assert.ok(r.bridge.onlyTransformAndOpacity, 'only transform and opacity are animated');
  assert.equal(r.bridge.dotMoves, !r.bridge.reducedMotion, 'the dot breathes – unless the system asks for less motion');
  assert.equal(r.sameNodes, true, 'a new status rewrites the texts, not the badge');
  assert.deepEqual(r.offer, { shown: true, text: '☁ Cloud ready – switch?', tag: 'BUTTON', taps: 1, height: true });
  assert.equal(r.cloud.kind, 'cloud');
  assert.equal(r.cloud.offer, false);
  assert.ok(r.contrast >= 4.5, `the text on the offer button: contrast ${r.contrast}`);
});
