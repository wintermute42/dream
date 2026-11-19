// #210: what the drawing of the stage costs the AI. Opens the stage of a running Dream (real model, in a sandbox HOME –
// never your own Dream) in a headless Chromium on the real graphics card and counts the AI pictures that come back,
// once drawn with Canvas 2D and once with WebGL 2, for the stage alone and for the panel with an output window, at
// device scale 1 and 2 (Retina). The runs alternate, so warming up and other load hit all of them alike.
// Usage (Dream running on PORT with the settings to measure, e.g. sd-turbo, 1 step, strength 0.5):
//   PORT=7885 node scripts/measure_stage.cjs <playwright> [out.json]
//   SECONDS=20 WARMUP=8 RUNS=3   one window, the time before it, how often each combination is measured
//   RENDER=canvas,webgl SCENES=stage,panel+output SCALES=1,2   what to compare
//   FX=kaleido,trails   effects switched on by hand for the run (default: none)
//   HEADED=1   real windows instead of headless ones;  CHANNEL=chrome   the installed Chrome instead of Playwright's Chromium
const { chromium } = require(process.argv[2]);
const fs = require('fs');
const PORT = process.env.PORT || 7860, BASE = `http://127.0.0.1:${PORT}`;
const SECONDS = +process.env.SECONDS || 20, WARMUP = +process.env.WARMUP || 8, RUNS = +process.env.RUNS || 3;
const list = (v, d) => (v || d).split(',').map(s => s.trim()).filter(Boolean);
const RENDER = list(process.env.RENDER, 'canvas,webgl'), SCENES = list(process.env.SCENES, 'stage,panel+output'), SCALES = list(process.env.SCALES, '1,2').map(Number);
const FX = process.env.FX || '';
// the pages of a scene: the first one renders (it talks to /ws); [path, viewport]
const PAGES = {
  stage: [['/?stage=1', { width: 1920, height: 1080 }]],
  panel: [['/', { width: 1600, height: 1000 }]],
  'panel+output': [['/', { width: 1600, height: 1000 }], ['/output', { width: 1920, height: 1080 }]],
  'stage+output': [['/?stage=1', { width: 1920, height: 1080 }], ['/output', { width: 1920, height: 1080 }]],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = v => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const sd = v => v.length > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean(v)) ** 2, 0) / (v.length - 1)) : 0;

async function once(browser, render, scene, scale) {
  const pages = [];
  let pictures = 0, counting = false;
  for (const [i, [url, viewport]] of PAGES[scene].entries()) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale });
    await ctx.addInitScript(() => {                    // the page's own frames, and what its canvas really is
      window.__raf = 0; window.__gaps = []; let last = 0;
      // what the WebGL chain draws: passes and the pixels they fill
      window.__gl = { passes: 0, px: 0 };
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        const gl = get.call(this, kind, ...rest);
        if (gl && kind === 'webgl2' && !gl.__counted) {
          gl.__counted = true; let area = 0;
          const viewport = gl.viewport.bind(gl), drawArrays = gl.drawArrays.bind(gl);
          gl.viewport = (x, y, w, h) => { area = w * h; viewport(x, y, w, h); };
          gl.drawArrays = (...a) => { window.__gl.passes++; window.__gl.px += area; drawArrays(...a); };
        }
        return gl;
      };
      (function f(t) { window.__raf++; if (last) window.__gaps.push(t - last); last = t; requestAnimationFrame(f); })(0);
    });
    const page = await ctx.newPage();
    if (i === 0) page.on('websocket', ws => {
      if (!/\/ws$/.test(new URL(ws.url()).pathname)) return;
      ws.on('framereceived', f => { if (counting && typeof f.payload !== 'string') pictures++; });
    });
    await page.goto(`${BASE}${url}${url.includes('?') ? '&' : '?'}render=${render}`);
    pages.push(page);
    if (i === 0) await sleep(1500);                    // the stage first: an output window waits for its pictures
  }
  // the effects by hand for this run (none: also what an earlier run may have left)
  const effects = fx => pages[0].evaluate(fx => new Promise(r => { const w = new WebSocket(`ws://${location.host}/ctl?role=stage`);
    w.onopen = () => { w.send(JSON.stringify({ set: { fx: fx.replace(/,/g, '+'), fx_amt: 0.8 } })); setTimeout(() => { w.close(); r(); }, 300); }; }), fx);
  await effects(FX);
  await sleep(WARMUP * 1000);
  const raf0 = await Promise.all(pages.map(p => p.evaluate(() => { window.__gaps.length = 0; window.__gl.passes = window.__gl.px = 0; return window.__raf; })));
  const t0 = Date.now(); counting = true;
  await sleep(SECONDS * 1000);
  counting = false; const secs = (Date.now() - t0) / 1000;
  const raf1 = await Promise.all(pages.map(p => p.evaluate(() => window.__raf)));
  const info = await Promise.all(pages.map(p => p.evaluate(() => {
    const cv = document.getElementById('glcv'), shown = cv && getComputedStyle(cv).display !== 'none';
    const gaps = window.__gaps.slice().sort((a, b) => a - b), usual = gaps[gaps.length >> 1] || 16.7;
    return { renderer: shown ? 'webgl2' : 'canvas', canvas: shown ? `${cv.width}×${cv.height}` : '', passes: window.__gl.passes, px: window.__gl.px,
      late: +(gaps.filter(g => g > usual * 1.5).length / Math.max(1, gaps.length) * 100).toFixed(1), worst: Math.round(gaps[gaps.length - 1] || 0) };
  })));
  if (FX) await effects('');
  for (const p of pages) await p.context().close();
  const drawn = { passes: Math.round(info.reduce((a, i) => a + i.passes, 0) / secs), mpx: +(info.reduce((a, i) => a + i.px, 0) / secs / 1e6).toFixed(1) };
  return { pps: pictures / secs, drawn, late: info.map(i => i.late), worst: info.map(i => i.worst), fps: raf1.map((n, i) => Math.round((n - raf0[i]) / secs)), info };
}

(async () => {
  const browser = await chromium.launch({ headless: !process.env.HEADED, channel: process.env.CHANNEL || 'chromium',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'] });
  const probe = await (await browser.newContext()).newPage();
  const gpu = await probe.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'), e = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'WebGL 2') : 'no WebGL 2'; });
  await probe.context().close();
  console.log(`graphics card of the browser: ${gpu}`);
  const combos = [];
  for (const scene of SCENES) for (const scale of SCALES) for (const render of RENDER) combos.push({ scene, scale, render, pps: [], fps: [], late: [], worst: [], info: null });
  for (let run = 0; run < RUNS; run++) {
    for (const c of combos) {
      const r = await once(browser, c.render, c.scene, c.scale);
      c.pps.push(+r.pps.toFixed(2)); c.fps.push(r.fps); c.late.push(r.late); c.worst.push(r.worst); c.drawn = r.drawn; c.info = r.info;
      console.log(`run ${run + 1}  ${c.scene.padEnd(13)} ×${c.scale}  ${c.render.padEnd(6)}  ${r.pps.toFixed(2)} pictures/s   display ${r.fps.join(' / ')} fps, late frames ${r.late.join(' / ')} %, longest ${r.worst.join(' / ')} ms   ${r.info.map(i => i.renderer + (i.canvas ? ' ' + i.canvas : '')).join(' / ')}${r.drawn.passes ? `, ${r.drawn.passes} passes/s, ${r.drawn.mpx} megapixels/s` : ''}`);
    }
  }
  await browser.close();
  console.log(`\n${SECONDS} s windows after ${WARMUP} s, ${RUNS} runs each${FX ? `, effects ${FX}` : ''} – AI pictures per second (mean ± standard deviation, lowest–highest)`);
  for (const c of combos) {
    const base = combos.find(b => b.scene === c.scene && b.scale === c.scale && b.render === 'canvas');
    c.mean = +mean(c.pps).toFixed(2); c.sd = +sd(c.pps).toFixed(2);
    c.loss = base && base !== c ? +((1 - mean(c.pps) / mean(base.pps)) * 100).toFixed(1) : null;
    console.log(`${c.scene.padEnd(13)} ×${c.scale}  ${c.render.padEnd(6)}  ${c.mean.toFixed(2)} ± ${c.sd.toFixed(2)}  (${Math.min(...c.pps).toFixed(2)}–${Math.max(...c.pps).toFixed(2)})`
      + (c.drawn && c.drawn.passes ? `   ${c.drawn.passes} passes/s, ${c.drawn.mpx} megapixels/s` : '') + (c.loss === null ? '' : `   ${c.loss > 0 ? '−' : '+'}${Math.abs(c.loss)} % against Canvas 2D`));
  }
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ gpu, seconds: SECONDS, warmup: WARMUP, runs: RUNS, fx: FX, combos }, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
