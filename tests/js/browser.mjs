// A test page in a headless Chrome or Chromium (#204, #216): no packages, the runner's own browser.
// CHROME_BIN names the browser; KEEP=1 leaves the page open to look at.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function findChrome() {
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

// serves the test page (a file of tests/js) and static/, starts the browser on it and waits for the page's report
// (the page POSTs it to /result as JSON)
export function runPage(chrome, page) {
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
      const file = req.url === '/' ? path.join(ROOT, 'tests', 'js', page)
        : /^\/static\/[\w-]+\.(js|css)$/.test(req.url) ? path.join(ROOT, req.url.slice(1))
        : /^\/tests\/[\w-]+\.js$/.test(req.url) ? path.join(ROOT, 'tests', 'js', req.url.slice(7)) : '';   // what test pages share
      if (!file || !existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
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
