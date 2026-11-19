// #214: several dream windows in a real browser. This test is their Dream: it serves the window page with its modules,
// speaks the /view stream (a WebSocket by hand – Node brings no server for it) and sends motifs, the painted face with
// its points, a wandering and the moods. tests/js/window.html holds four windows of different sizes and reports what
// they show: one large motif each, the dream as clouds with darkness between, the pair of eyes looking together, a
// painted face that moves (and one without points that stays still), a motif wandering from one window to another.
// Run: node --test tests/js/window.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm' };
const FACE = '/eyes/mask/aaaaaaaaaaaa.jpg', STILL = '/eyes/mask/bbbbbbbbbbbb.jpg';   // the same invented, drawn face twice: once with its points
const POINTS = JSON.parse(readFileSync(path.join(HERE, 'window-face.json'), 'utf8'));
const DREAM = readFileSync(path.join(HERE, 'window-dream.jpg'));

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

// one WebSocket message from the server: text or binary, not masked
function frame(data) {
  const text = typeof data === 'string', body = Buffer.from(data), n = body.length;
  const head = n < 126 ? Buffer.from([text ? 0x81 : 0x82, n]) : n < 65536 ? Buffer.from([text ? 0x81 : 0x82, 126, n >> 8, n & 255]) : null;
  assert.ok(head, 'a message of the test is never that long');
  return Buffer.concat([head, body]);
}

// serves the pages, is the windows' Dream, starts the browser and waits for the page's report
function windows(chrome) {
  return new Promise((resolve, reject) => {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'dream-windows-'));
    const socks = [], sent = [];
    let browser = null, pulse = null;
    const say = (i, msg) => { const text = JSON.stringify(msg); sent.push(text); if (socks[i] && !socks[i].destroyed) socks[i].write(frame(text)); };
    const motif = (i, m, wait = 0) => say(i, { motif: { ...m, wait, now: Date.now() + 5000 } });   // Dream's clock is five seconds ahead of the windows'
    const STEPS = {
      start() {
        socks.forEach((_, i) => { say(i, { aimasks: { goddess: FACE, cat: STILL } }); say(i, { marks: { aaaaaaaaaaaa: POINTS } }); });
        motif(0, { kind: 'pair', seed: 4242, half: 0 }); motif(1, { kind: 'pair', seed: 4242, half: 1 });
        motif(2, { kind: 'face', seed: 77, face: FACE }); motif(3, { kind: 'penrose', seed: 1234567 });
      },
      wander() {                                     // as windows.wander() plans it: there after 4 s, something new here after 8 s
        motif(0, { kind: 'penrose', seed: 1234567 }, 4); motif(1, { kind: 'mandala', seed: 99 }, 4); motif(3, { kind: 'face', seed: 5, face: STILL }, 8);
      },
      moods() {
        socks.forEach((_, i) => { for (const m of [{ wave: { index: i, of: 4 } }, { mood: { kind: 'blush', index: i, of: 4 } }, { mood: { kind: 'trance', index: i, of: 4 } }]) say(i, m); });
      },
    };
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
          res.end('ok');
          if (req.url === '/step' && STEPS[body]) STEPS[body]();
          if (req.url === '/result') { if (!process.env.KEEP) finish(); try { resolve({ ...JSON.parse(body), sent }); } catch (e) { reject(e); } }
        });
        return;
      }
      const url = req.url.split('?')[0];
      const file = url === '/' ? path.join(HERE, 'window.html') : url === '/window' ? path.join(ROOT, 'static', 'window.html')
        : url === FACE || url === STILL ? path.join(HERE, 'window-face.jpg') : /^\/static\/[\w./-]+$/.test(url) && !url.includes('..') ? path.join(ROOT, url.slice(1)) : '';
      if (!file || !existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.on('upgrade', (req, socket) => {            // a window connects: /view?as=window
      if (!req.url.startsWith('/view?as=window')) { socket.destroy(); return; }
      const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.on('data', () => {}); socket.on('error', () => {});   // a window has nothing to say
      socks.push(socket);
      socks.forEach((_, i) => say(i, { window: { index: i, of: socks.length } }));
      socket.write(frame(DREAM));
      if (!pulse) pulse = setInterval(() => { for (const s of socks) if (!s.destroyed) { s.write(frame(DREAM)); s.write(frame(JSON.stringify({ fx: { pulse: 1, k: 0.8, bass: 0.5 } }))); } }, 500);
    });
    const timer = process.env.KEEP ? null : setTimeout(() => { finish(); reject(new Error('no report from the browser within 150 s')); }, 150000);
    function finish() {
      clearTimeout(timer); clearInterval(pulse);
      for (const s of socks) s.destroy();
      server.close(); server.closeAllConnections();
      if (browser) { browser.once('exit', () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* stays in the temp folder */ } }); browser.kill(); }
    }
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      if (process.env.KEEP) console.log(`open ${url} – Ctrl-C ends`);
      browser = spawn(chrome, [...(process.env.KEEP ? [] : ['--headless=new']), '--no-sandbox', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-device-scale-factor=1', '--force-color-profile=srgb',
        '--window-size=1300,900', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
      browser.once('error', e => { finish(); reject(e); });
    });
  });
}

const chrome = findChrome();
test('dream windows: four of them in a browser', { skip: !chrome && !process.env.CI ? 'no Chrome or Chromium found (set CHROME_BIN)' : false }, async t => {
  assert.ok(chrome, 'no Chrome or Chromium found (set CHROME_BIN)');
  const r = await windows(chrome);
  assert.equal(r.error, '', r.error);
  await t.test('one large motif in every window, whatever its size', () => {
    assert.deepEqual(r.first.map(w => w.kind), ['pair', 'pair', 'face', 'penrose']);
    assert.equal(new Set(r.first.map(w => w.size.join('x'))).size >= 3, true, 'windows of different sizes');
    for (const w of r.first) assert.ok(w.lit > 0.12, `a window shows something (${w.lit})`);
  });
  await t.test('the dream as clouds: soft fields, darkness between, never the whole rectangle', () => {
    for (const w of [...r.first, ...r.second]) {
      t.diagnostic(`clouds: clear ${w.clear.toFixed(2)}, soft ${w.soft.toFixed(2)}, solid ${w.solid.toFixed(2)}`);
      assert.ok(w.clear > 0.04 && w.soft > 0.2 && w.solid < 0.75, `clear ${w.clear}, soft ${w.soft}, solid ${w.solid}`);
    }
  });
  await t.test('the pair of eyes looks the same way, by Dream\'s clock', () => {
    for (const a of r.ahead) assert.ok(Math.abs(a - 5000) < 1500, `a window takes Dream's clock (${a} ms ahead)`);
    assert.deepEqual(r.pair.mirror, [false, true]);
    assert.ok(r.pair.together > 0.7, `they look the same way ${Math.round(r.pair.together * 100)} % of the time`);
    assert.ok(r.pair.same > 0.9, `the same world in both irises ${Math.round(r.pair.same * 100)} % of the time`);
  });
  await t.test('a painted face moves by its points; without points it is shown still', () => {
    assert.ok(r.face.alive && r.face.triangles > 100, `a net of ${r.face.triangles} triangles`);
    assert.ok(r.face.moved > 20, `${r.face.moved} triangles moved`);
    assert.ok(r.face.smile > 0.3, `it smiles (${r.face.smile})`);
    assert.deepEqual(r.still, { alive: false, triangles: 0 });
    assert.ok(r.second[3].lit > 0.12, 'and the still face is there');
  });
  await t.test('a motif dissolves in one window and forms in another', () => {
    assert.deepEqual(r.mid.map(w => w.leaving), [true, true, false, true]);
    assert.deepEqual(r.mid.map(w => w.next), ['penrose', 'mandala', null, 'face']);
    assert.deepEqual(r.second.map(w => w.kind), ['penrose', 'mandala', 'face', 'face']);
    assert.ok(r.sameBeing, 'the same shape (its seed) as in the window it left');
  });
  await t.test('wave, blush and trance reach every window', () => {
    for (const w of r.moods) assert.ok(w.trance && w.lit > 0.05);
  });
  await t.test('a weak device: fewer pixels, coarser clouds', () => {
    const { before, after } = r.weak;
    assert.deepEqual([before.tier, after.tier], [2, 0]);
    assert.ok(after.size[0] <= before.size[0] / 2 + 1 && after.cloud[0] < before.cloud[0] * 0.6, JSON.stringify(r.weak));
    assert.ok(after.soft > 0.2 && after.clear > 0.04, 'still clouds');   // (how bright it is says nothing here: the windows are in trance)
  });
  await t.test('what Dream says is small', () => {
    for (const text of r.sent) if (!text.startsWith('{"marks"')) assert.ok(text.length < 200, text);
    assert.ok(r.sent.filter(s => s.startsWith('{"marks"')).every(s => s.length < 1200));
  });
});
