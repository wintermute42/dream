// #204: the WebGL 2 chain of the stage and the output windows (static/gl-stage.js) against the Canvas 2D drawing
// (static/fx.js): tests/js/gl-stage.html draws every effect and every step of the chain both ways in a headless Chrome
// (software WebGL is enough) and this test reads how far the pictures are apart.
// Run: node --test tests/js/gl-stage.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// how far the two drawings may be apart: the mean per colour channel (of 255) and the share of pixels that differ
// clearly (edges of wedges, slices and dots, where the two draw their antialiasing differently)
const MEAN = 2, FAR = 1;
// these must change the picture at all, so a shader that does nothing cannot pass
const UNCHANGED_OK = ['cross-fade', 'square picture covers'];

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  const mac = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) for (const d of readdirSync(cache).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
    for (const sub of ['chrome-mac-arm64', 'chrome-mac']) {
      mac.push(path.join(cache, d, sub, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), path.join(cache, d, sub, 'Chromium.app/Contents/MacOS/Chromium'));
    }
  }
  return mac.find(existsSync) || '';
}

// serves the test page and static/, starts the browser on it and waits for the page's report
function compare(chrome) {
  return new Promise((resolve, reject) => {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'dream-gl-'));
    let browser = null;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/result') {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => { res.end('ok'); if (!process.env.KEEP) finish(); try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        return;
      }
      const file = req.url === '/' ? path.join(ROOT, 'tests', 'js', 'gl-stage.html')
        : /^\/static\/[\w-]+\.js$/.test(req.url) ? path.join(ROOT, req.url.slice(1)) : '';
      if (!file || !existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
      res.end(readFileSync(file));
    });
    const timer = process.env.KEEP ? null : setTimeout(() => { finish(); reject(new Error('no report from the browser within 90 s')); }, 90000);
    function finish() {
      clearTimeout(timer); server.close(); server.closeAllConnections();
      // the browser's helper processes may still write for a moment: try a few times, and a left-over folder is no failure
      if (browser) { browser.once('exit', () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* stays in the temp folder */ } }); browser.kill(); }
    }
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      if (process.env.KEEP) console.log(`open ${url} – Ctrl-C ends`);
      browser = spawn(chrome, [...(process.env.KEEP ? [] : ['--headless=new']), '--no-sandbox', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-device-scale-factor=1', '--force-color-profile=srgb',
        '--window-size=900,700', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
      browser.once('error', e => { finish(); reject(e); });
    });
  });
}

const chrome = findChrome();
test('WebGL 2 chain against the Canvas 2D drawing', { skip: !chrome && !process.env.CI ? 'no Chrome or Chromium found (set CHROME_BIN)' : false }, async t => {
  assert.ok(chrome, 'no Chrome or Chromium found (set CHROME_BIN)');
  const report = await compare(chrome);
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
  await t.test('context lost: Canvas 2D takes over, restored: WebGL 2 again', () => {
    assert.ok(report.lost && report.restored, 'the browser cannot lose a context on purpose');
    assert.equal(report.lost.renderer, 'canvas');
    assert.equal(report.lost.shown, 'visible');
    assert.ok(report.lost.mean <= 0.01, `after the loss the Canvas 2D drawing shows the same picture (${report.lost.mean})`);
    assert.equal(report.restored.renderer, 'webgl2');
    assert.ok(report.restored.mean <= MEAN && report.restored.far <= FAR, `restored: ${report.restored.mean} / ${report.restored.far} %`);
  });
});
