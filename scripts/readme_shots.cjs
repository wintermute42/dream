// Takes the screenshots of the README (#190) from a running Dream in a fresh sandbox HOME – never from your own Dream
// (its settings, devices and paths would show):
// no QR codes (they carry keys), no real addresses, a neutral prompt. Usage (Dream running with --lan on PORT/HTTPS):
//   DREAM_STATE=<sandbox>/.local/state/dream HOST=<lan ip> PORT=7870 HTTPS=7444 node scripts/readme_shots.cjs <playwright> <out dir>
const { chromium } = require(process.argv[2]);
const fs = require('fs'), path = require('path');
const OUT = process.argv[3], ST = process.env.DREAM_STATE, HOST = process.env.HOST, PORT = process.env.PORT || 7860, HTTPS = process.env.HTTPS || 7443;
const key = n => fs.readFileSync(path.join(ST, n), 'utf8').trim();
const C = key('control-token'), E = key('eyes-token');
const PROMPT = 'a glowing jellyfish nebula drifting through a violet ocean, bioluminescent, iridescent, dreamy, soft light';
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctl = await (await b.newContext()).newPage();
  await ctl.goto(`http://127.0.0.1:${PORT}/remote`);
  await ctl.evaluate(p => new Promise(r => { const w = new WebSocket(`ws://${location.host}/ctl?role=stage`); w.onopen = () => { w.send(JSON.stringify({ set: { prompt: p, playlist: '', strength: 0.7, mix: 0.3, zoom: 0.02, rot: 0.5, hue: 3, smooth: 0.15, auto: false, fx: '' } })); setTimeout(r, 500); }; }), PROMPT);
  for (const lang of ['en', 'de']) {
    const ctx = async (o = {}) => { const c = await b.newContext({ deviceScaleFactor: 1, ignoreHTTPSErrors: true, permissions: ['camera'], ...o });
      await c.addInitScript(l => { try { localStorage.setItem('dream-lang', l); } catch (e) {} }, lang);
      await c.addCookies([{ name: 'dream-lang', value: lang, url: `http://127.0.0.1:${PORT}` }, { name: 'dream-lang', value: lang, url: `http://${HOST}:${PORT}` }, { name: 'dream-lang', value: lang, url: `https://${HOST}:${HTTPS}` }]);
      return c.newPage(); };
    const hideQr = p => p.evaluate(() => { document.body.classList.remove('show-qr'); document.querySelectorAll('img[src*="qr.svg"]').forEach(i => i.removeAttribute('src')); });
    // 1 + 2: the panel with the stage (it dreams a while first), and the stage alone
    const panel = await ctx({ viewport: { width: 1600, height: 1000 } });
    await panel.goto(`http://127.0.0.1:${PORT}/`); await panel.waitForTimeout(70000); await hideQr(panel);
    await panel.screenshot({ path: path.join(OUT, `panel-${lang}.png`) });
    const stage = await ctx({ viewport: { width: 1600, height: 900 } });
    await stage.goto(`http://127.0.0.1:${PORT}/?stage=1`); await stage.waitForTimeout(45000); await hideQr(stage);
    await stage.screenshot({ path: path.join(OUT, `stage-${lang}.png`) });
    // 3: Dream Control on a phone
    const phone = await ctx({ viewport: { width: 390, height: 844 } });
    await phone.goto(`http://${HOST}:${PORT}/control?k=${C}`); await phone.waitForTimeout(4000); await hideQr(phone);
    await phone.screenshot({ path: path.join(OUT, `control-${lang}.png`) });
    // 4: Dreamy Eyes, and their trance
    const eyes = await ctx({ viewport: { width: 844, height: 390 } });
    await eyes.goto(`https://${HOST}:${HTTPS}/eyes?k=${E}&debug`); await eyes.click('#go'); await eyes.waitForTimeout(8000);
    await eyes.evaluate(() => { const d = dreamyEyes; d.portal.next = 1e15; d.decor.length = 0; });
    await eyes.screenshot({ path: path.join(OUT, `eyes-${lang}.png`) });
    await eyes.evaluate(() => { dreamyEyes.tranceStart(performance.now()); dreamyEyes.trance.t0 = performance.now() - 8500; }); await eyes.waitForTimeout(600);
    await eyes.screenshot({ path: path.join(OUT, `trance-${lang}.png`) });
    for (const p of [panel, stage, phone, eyes]) await p.context().close();
  }
  await b.close(); process.exit(0);
})();
