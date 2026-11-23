// What the pages share (#189): the stage (index.html), the remote (remote.html), Dreamy Eyes (eyes.html), the dream
// windows and the output window. No build step, like fx.js: a page loads this file and calls DreamCommon.…; the texts
// go through T() of i18n.js, which the pages load before they call anything here.
//
//   <script src="/static/common.js" data-hide-key></script>   in the head: also takes the key out of the address
window.DreamCommon = (() => {
  'use strict';
  const $ = id => document.getElementById(id);

  // #175: the key stays in the cookie, not in the address bar, history or a shared link
  function hideKey() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('k')) { u.searchParams.delete('k'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
    } catch (e) { /* the address stays as it is */ }
  }
  if (document.currentScript && document.currentScript.dataset.hideKey !== undefined) hideKey();

  // a text as HTML: nothing in it is taken as markup
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // the playlists as options of a select, after its first option ("off"); #132: shown in the page's language
  function fillPlaylists(select, names) {
    select.innerHTML = select.options[0].outerHTML + names.map(n => `<option value="${esc(n)}">${esc(I18N.name(n))}</option>`).join('');
  }

  // #224: the controls of the crossfade between two style worlds (panel and Dream Control). The second world offers
  // what the first offers – the worlds are listed once in a page; returns how to show the drift's pace, also when it
  // is none of the offered ones (set from somewhere else)
  function worldControls(from, to, pace) {
    to.innerHTML = from.innerHTML;
    return v => {
      if (![...pace.options].some(o => o.value === String(v))) pace.add(new Option(I18N.t('Worlds drift: every {n} s', { n: v }), String(v)));
      pace.value = String(v);
    };
  }

  // what a device remembers about its own view (text size, open cards …): prefs('dream-ui-')('fs') reads, …('fs', 18) writes
  const prefs = prefix => (k, v) => { try { if (v === undefined) return localStorage.getItem(prefix + k); localStorage.setItem(prefix + k, v); } catch (e) { return null; } };

  // ---------- the cloud GPU ----------
  // #110: if the chosen RunPod GPU is not free, the other RTX one – only with consent, its price shown first
  const CLOUD_FALLBACK = { 'runpod:RTX-4090': 'runpod:RTX-5090', 'runpod:RTX-5090': 'runpod:RTX-4090',
    'runpod:RTX-4090-community': 'runpod:RTX-5090-community', 'runpod:RTX-5090-community': 'runpod:RTX-4090-community' };
  const gpuText = v => { const o = [...document.querySelectorAll('#gpu option')].find(x => x.value === v); return o ? o.textContent : v; };
  // #135: one question before a cloud GPU starts (the page's dialog #startdlg) – with the way out (another GPU) as its
  // own button, and "Cancel" (or Esc) always means: nothing starts. Resolves to { fallback } or null.
  // say: { community, costs } – the page's own words for the note; focus: put the focus on the main button
  function askCloudStart(gpu, say, focus) {
    const alt = CLOUD_FALLBACK[gpu], d = $('startdlg');
    $('startdlg-text').textContent = T('Start the cloud GPU: {gpu}?', { gpu: gpuText(gpu) });
    $('startdlg-note').textContent = (gpu.endsWith('-community') ? say.community + ' ' : '') + say.costs;
    $('startdlg-alt').hidden = !alt;
    if (alt) $('startdlg-alt').textContent = T('Start – if not free: {gpu}', { gpu: gpuText(alt) });
    $('startdlg-only').textContent = alt ? T('Try only {gpu}', { gpu: gpuText(gpu).split(' · ').slice(0, 2).join(' · ') }) : T('Start');
    return new Promise(res => {
      const done = v => { d.close(); res(v); };
      $('startdlg-alt').onclick = () => done({ fallback: alt });
      $('startdlg-only').onclick = () => done({ fallback: '' });
      $('startdlg-cancel').onclick = () => done(null);
      d.oncancel = e => { e.preventDefault(); done(null); };     // Esc
      d.showModal();
      if (focus) (alt ? $('startdlg-alt') : $('startdlg-only')).focus();
    });
  }

  // ---------- playlists: what the server offers (the owner's own file on the Mac) ----------
  const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const playlists = {
    read: async name => (await fetch('/playlists/' + encodeURIComponent(name))).json(),
    // both answer { ok, r }: r is the server's answer ({ name, count } / { name, prompts } or { error })
    save: async (name, text) => { const res = await fetch('/playlists', json({ name, text })); return { ok: res.ok, r: await res.json().catch(() => ({})) }; },
    generate: async topic => { const res = await fetch('/playlists/generate', json({ topic })); return { ok: res.ok, r: await res.json().catch(() => ({})) }; },
    remove: name => fetch('/playlists/' + encodeURIComponent(name), { method: 'DELETE' }),
    // an AI playlist of this run becomes the owner's own; true when it is saved
    keep: async name => (await fetch('/playlists', json({ name, text: (await playlists.read(name)).text }))).ok,
  };

  // ---------- the gallery: feed in, save, delete – and take a deletion back for a few seconds (#142) ----------
  // say(text): the page's status line; undoBox: where "Deleted. ↶ Undo" appears; buttonClass: the page's button style;
  // fedIn: what to say when a picture was fed in (the stage says nothing: one sees it)
  function gallery({ say, undoBox, buttonClass, fedIn }) {
    let undoTimer = 0;
    function undo(j) {
      const box = undoBox; box.textContent = '';
      box.append(T(j.count === 1 ? 'Deleted.' : '{n} deleted.', { n: j.count }) + ' ');
      const b = document.createElement('button'); if (buttonClass) b.className = buttonClass; b.textContent = T('↶ Undo');
      b.onclick = async () => { clearTimeout(undoTimer); box.textContent = ''; const r = await fetch('/gallery/undo/' + j.undo, { method: 'POST' });
        if (!r.ok) say(((await r.json().catch(() => ({}))).error) || T('Did not work.')); };
      box.append(b);
      clearTimeout(undoTimer); undoTimer = setTimeout(() => { box.textContent = ''; }, (j.secs || 6) * 1000 - 300);
    }
    async function act(id, what) {
      const r = await fetch(id ? `/gallery/${id}/${what}` : `/gallery/${what}`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) say(j.error || T('Did not work.'));
      else if (j.undo) undo(j);
      else if (what === 'save') say(T('Saved: {p}', { p: j.saved }));
      else if (fedIn) say(fedIn);
    }
    return { act, undo };
  }

  // ---------- a device lends its camera (#146, #156): about 12 pictures a second, 640 px wide – smooth in the Wi-Fi ----------
  // video: the element that plays the camera; socket(): the open /ctl line (or null); lent(): is the camera still lent?
  // Returns the function to call for every picture (setInterval(send, 1000 / 12)).
  function cameraSender(video, socket, lent) {
    const cv = document.createElement('canvas');
    let encoding = false;
    return function frame() {
      const ws = socket();
      if (!ws || ws.readyState !== 1 || ws.bufferedAmount > 300000 || encoding || !video.videoWidth) return;
      const W = 640, H = Math.round(W * video.videoHeight / video.videoWidth);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      cv.getContext('2d').drawImage(video, 0, 0, W, H);
      encoding = true;
      cv.toBlob(b => { encoding = false; const now = socket(); if (b && now && now.readyState === 1 && lent()) now.send(b); }, 'image/jpeg', 0.7);
    };
  }

  // ---------- the screen stays on: the Wake Lock API where the browser offers it (https) ----------
  // videoFallback: otherwise a tiny silent video loop, which keeps Android's screen awake as well (started by a tap).
  // Returns the function that asks for it (again): call it at the start, on a tap, when the page is shown again.
  function wakeLock(videoFallback) {
    let lock = null, vid = null;
    return async function keepAwake() {
      try { if ('wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); return; } } catch (e) { /* fall back */ }
      if (lock || !videoFallback) return;
      if (!vid) {
        vid = Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true, src: '/static/awake.webm' });
        vid.setAttribute('aria-hidden', 'true');
        Object.assign(vid.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0.01', left: '0', bottom: '0', pointerEvents: 'none' });
        document.body.append(vid);
      }
      vid.play().catch(() => {});
    };
  }

  return { hideKey, esc, fillPlaylists, worldControls, prefs, CLOUD_FALLBACK, askCloudStart, playlists, gallery, cameraSender, wakeLock };
})();
