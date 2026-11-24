// #230: the painted face that opens out of the pupils of Dreamy Eyes is alive. This test is the eyes' Dream: it serves
// the real page with its modules, speaks /ctl and /view (WebSockets by hand) and hands over two painted faces – the same
// invented, drawn face twice, one with its points (as the stage on the Mac finds them), one without. tests/js/eyes-face.html
// lets each of them come through the pupils and reports: the one with points moves (blink, smile, brows, a slight turn),
// its own eyes are what lies on the pupils, a weak phone gets a smaller net and no turn; the one without stays still.
// Run: node --test tests/js/eyes-face.test.mjs   (CHROME_BIN names the browser; KEEP=1 leaves the page open to look at)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { ROOT, findChrome, wsAccept, wsFrame } from './browser.mjs';

const HERE = path.join(ROOT, 'tests', 'js');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.png': 'image/png' };
const FACE = '/eyes/mask/aaaaaaaaaaaa.jpg', STILL = '/eyes/mask/bbbbbbbbbbbb.jpg';
const POINTS = JSON.parse(readFileSync(path.join(HERE, 'window-face.json'), 'utf8'));
const DREAM = readFileSync(path.join(HERE, 'window-dream.jpg'));
createRequire(import.meta.url)('../../static/dreamface.js');   // a browser script: it hangs itself on the global object
const { AT, alive, life, mesh, pose } = globalThis.DreamFace;

function eyes(chrome) {
  return new Promise((resolve, reject) => {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'dream-eyes-'));
    const socks = [];
    let browser = null;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/result') {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => { res.end('ok'); if (!process.env.KEEP) finish(); try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        return;
      }
      const url = req.url.split('?')[0];
      const file = url === '/' ? path.join(HERE, 'eyes-face.html') : url === '/eyes' ? path.join(ROOT, 'static', 'eyes.html')
        : url === FACE || url === STILL ? path.join(HERE, 'window-face.jpg') : /^\/static\/[\w./-]+$/.test(url) && !url.includes('..') ? path.join(ROOT, url.slice(1)) : '';
      if (!file || !existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.on('upgrade', (req, socket) => {
      const say = msg => socket.write(wsFrame(JSON.stringify(msg)));
      if (req.url.startsWith('/ctl?role=remote&as=eyes')) {   // what Dream tells Dreamy Eyes: their role, the faces, the points
        wsAccept(req, socket);
        say({ role: 'eyes', can_take: false, can: [] });
        say({ feeds_mine: [], aimasks: { goddess: FACE, cat: STILL } });
        say({ marks: { aaaaaaaaaaaa: POINTS, bbbbbbbbbbbb: POINTS.slice(2), 'not-a-face': POINTS } });   // only the first is a face's points
        say({ eyes_cfg: { trance_every: 0 } });
      } else if (req.url.startsWith('/view?preview=1&as=eyes')) {
        wsAccept(req, socket);
        socket.write(wsFrame(DREAM));
      } else { socket.destroy(); return; }
      socks.push(socket);
    });
    const timer = process.env.KEEP ? null : setTimeout(() => { finish(); reject(new Error('no report from the browser within 120 s')); }, 120000);
    function finish() {
      clearTimeout(timer);
      for (const s of socks) s.destroy();
      server.close(); server.closeAllConnections();
      if (browser) { browser.once('exit', () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* stays in the temp folder */ } }); browser.kill(); }
    }
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      if (process.env.KEEP) console.log(`open ${url} – Ctrl-C ends`);
      browser = spawn(chrome, [...(process.env.KEEP ? [] : ['--headless=new']), '--no-sandbox', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-device-scale-factor=1', '--force-color-profile=srgb',
        '--window-size=500,800', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
      browser.once('error', e => { finish(); reject(e); });
    });
  });
}

test('what a face does next: blinks, looks, smiles and lifts its brows – early, when it is seen for a few seconds only', () => {
  const seen = { look: 0, turn: 0 };
  for (let run = 0; run < 20; run++) {
    const f = alive(0, true), did = { blink: 0, smile: 0, brow: 0 };
    for (let t = 0; t < 7000; t += 33) {
      const e = life(f, t, 0.033, { pulse: 0 });
      for (const v of [...e.blink, e.smile]) assert.ok(v >= 0 && v <= 1);
      for (const v of [...e.look, ...e.brow, e.turn, e.nod]) assert.ok(v >= -1 && v <= 1);
      did.blink = Math.max(did.blink, e.blink[0], e.blink[1]); did.smile = Math.max(did.smile, e.smile);
      did.brow = Math.max(did.brow, Math.abs(e.brow[0]), Math.abs(e.brow[1]), e.kind);
      seen.look = Math.max(seen.look, Math.hypot(...e.look)); seen.turn = Math.max(seen.turn, Math.abs(e.turn));
    }
    assert.ok(did.blink > 0.8 && did.smile > 0.5 && did.brow > 0.15, JSON.stringify(did));   // every time it is seen
  }
  assert.ok(seen.look > 0.5 && seen.turn > 0.5, JSON.stringify(seen));
  const f = alive(0), calm = life(f, 10, 0.033), shut = life(f, 20, 0.033, { closed: true }), petted = alive(0);
  assert.deepEqual(calm.blink, [0, 0]);
  assert.deepEqual(shut.blink, [1, 1]);               // in trance (the windows) its eyes stay closed
  for (let t = 0; t < 2000; t += 33) life(petted, t, 0.033, { petted: true });
  assert.ok(petted.smile > 0.9);                       // Dreamy Eyes are petted: the face smiles along
});

test('the face changes its look often enough to be seen: a smile every 8–19 s, the brows every 5–14 s, glances well to the side', () => {
  const runs = 30, n = { smile: 0, brow: 0, side: 0, looks: 0 };
  for (let run = 0; run < runs; run++) {
    const f = alive(0);
    let smiling = false, browing = false, want = null;
    for (let t = 0; t < 60000; t += 33) {
      const e = life(f, t, 0.033, { pulse: 0 });
      if (e.smile > 0.6 && !smiling) n.smile++;
      smiling = e.smile > 0.6;
      const b = Math.max(Math.abs(e.brow[0]), Math.abs(e.brow[1]), e.kind) > 0.15;
      if (b && !browing) n.brow++;
      browing = b;
      if (f.want !== want) { want = f.want; n.looks++; if (Math.abs(want[0]) >= 0.45) n.side++; }
    }
  }
  assert.ok(n.smile / runs >= 3.2 && n.smile / runs <= 7.5, `${n.smile / runs} smiles a minute`);
  assert.ok(n.brow / runs >= 4.3 && n.brow / runs <= 12, `${n.brow / runs} brow moves a minute`);
  assert.ok(n.side / n.looks > 0.65, `${n.side} of ${n.looks} glances well to one side`);
});

test('strong expressions, clearly to see – and they never fold the net over: nothing of the face is torn', () => {
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) });
  globalThis.document = { createElement: canvas };
  try {
    const m = mesh(POINTS, {}, 512), T = m.tris, B = m.base;
    const area = (P, a, b, c) => ((P[2 * b] - P[2 * a]) * (P[2 * c + 1] - P[2 * a + 1]) - (P[2 * c] - P[2 * a]) * (P[2 * b + 1] - P[2 * a + 1])) / 2;
    for (const e of [{ smile: 1 }, { brow: [1, 1] }, { brow: [1, 0.15] }, { brow: [0.2, 0.2], kind: 1 }, { brow: [-0.85, -0.85] }, { look: [-1, 0] }, { look: [1, -0.8] }, { look: [0.5, 0.8] },
      { turn: 1, nod: 1 }, { turn: -1, nod: -1 }, { smile: 1, brow: [1, 1], look: [1, 0.8], turn: 1, nod: -1 }, { brow: [-0.85, -0.85], look: [-1, -0.5], turn: -1, nod: 0.6 }]) {   // (a closing lid folds the iris under it: that is meant, and drawn over)
      const q = pose(m, e);
      let folded = 0;
      for (let t = 0; t < T.length; t += 3) { const a0 = area(B, T[t], T[t + 1], T[t + 2]), a1 = area(q, T[t], T[t + 1], T[t + 2]); if (a0 * a1 < 0) folded += Math.abs(a1); }
      assert.ok(folded < 30, `${JSON.stringify(e)}: ${folded.toFixed(1)} px² folded over (of a 512 px face)`);
    }
    // and they are clearly to see (#230): a smile lifts the corners of the mouth by 15 % of its width, the brows go up by
    // well over half the eye's height, the gaze goes 15 % of the eye's width to the side, the head turns by a tenth of the face
    const moved = (q, i, ax) => q[2 * i + ax] - B[2 * i + ax];
    let q = pose(m, { smile: 1 });
    assert.ok(-moved(q, AT.lips[0], 1) >= 0.14 * m.mouth && -moved(q, AT.lips[4], 1) >= 0.14 * m.mouth && -moved(q, AT.cheek[2], 1) >= 0.08 * m.mouth, 'a broad smile');
    q = pose(m, { brow: [1, 1] });
    assert.ok(-moved(q, AT.browA[2], 1) >= 0.6 * m.lidGap[0], 'brows well up');
    q = pose(m, { brow: [-0.85, -0.85] });
    assert.ok(moved(q, AT.browA[4], 1) > 0.25 * m.lidGap[0] && Math.abs(moved(q, AT.browA[4], 0)) > 0.15 * m.lidGap[0], 'a frown: the inner ends down and together');
    q = pose(m, { look: [1, 0] });
    assert.ok(moved(q, AT.iris[0], 0) >= 0.14 * m.eye, 'a glance to the side');
    q = pose(m, { turn: 1 });
    assert.ok(moved(q, AT.nose[2], 0) >= 0.09 * m.r, 'the head turns');
  } finally { delete globalThis.document; }
});

const chrome = findChrome();
test('Dreamy Eyes: the painted face in the pupils is alive', { skip: !chrome && !process.env.CI ? 'no Chrome or Chromium found (set CHROME_BIN)' : false }, async t => {
  assert.ok(chrome, 'no Chrome or Chromium found (set CHROME_BIN)');
  const r = await eyes(chrome);
  assert.equal(r.error, '', r.error);
  await t.test('only what Dream names as a face\'s points is taken', () => {
    assert.deepEqual(r.marks, ['aaaaaaaaaaaa']);
  });
  await t.test('a face without points stays the still picture it was – and is there', () => {
    assert.equal(r.still.net, false);
    assert.ok(r.still.lit > 0.2, `the face fills ${r.still.lit} of the middle`);
  });
  await t.test('its own eyes are what comes to lie on the pupils, and in the pupils it looks straight out', () => {
    const iris = k => POINTS[2 * AT.iris[5 * k]] / 1000, y = (POINTS[2 * AT.iris[0] + 1] + POINTS[2 * AT.iris[5] + 1]) / 2000;
    assert.ok(Math.abs(r.eyes.x0 - iris(0)) < 1e-6 && Math.abs(r.eyes.x1 - iris(1)) < 1e-6 && Math.abs(r.eyes.y - y) < 1e-6, JSON.stringify(r.eyes));
    assert.ok(r.inPupils.off < 0.5, `in the pupils its irises are ${r.inPupils.off} px from where Dream found them`);
    assert.ok(r.inPupils.p < 0.3 && r.inPupils.frames > 2);
  });
  await t.test('with points it moves: it blinks, smiles with its mouth, lifts its brows and turns its head a little', () => {
    assert.equal(r.alive.size, 512);
    assert.ok(r.alive.moved > 40, `${r.alive.moved} triangles moved`);
    assert.ok(r.alive.smile > 0.5 && r.alive.mouthUp > 4, `the corners of its mouth went up by ${r.alive.mouthUp} px`);
    assert.ok(r.alive.browUp > 2, `its brows went up by ${r.alive.browUp} px`);
    assert.ok(r.alive.lidDown > 4, `its lids came down by ${r.alive.lidDown} px`);
    assert.ok(r.alive.turned > 0.2, `its nose moved by ${r.alive.turned} px`);
    assert.ok(r.alive.changed > 0.01, `${r.alive.changed} of the face's picture changed`);
    assert.ok(r.alive.lit > 0.2);
  });
  await t.test('a phone that runs short: a smaller net, moved less often, no turn of the head', () => {
    assert.equal(r.weak.size, 288);
    assert.equal(r.weak.turned, 0);
    assert.ok(r.weak.moved > 10 && r.weak.every >= 100, JSON.stringify(r.weak));
  });
});
