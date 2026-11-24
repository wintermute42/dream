/* Dream – what the pages of the movement modes share (#251 Dream Dance, #252 Flowtrack).

   Such a page is a window of its own on this Mac (for a second screen). It does not talk to Dream itself: it reads the
   stage in the window that opened it, through that window's `DreamBridge.<name>` – the live movement, the camera
   picture (drawn here, kept nowhere), the settings. `link` finds the bridge, notices when the stage was reloaded or
   closed and refuses a stage too old for the page; `pick`, `fillCams` and `detectText` show the stage's detection; `agree` and `clockText` are pure (tests/js/movepage.test.mjs). A global `MovePage`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);

  // the bridge of the stage that opened this window, or null (no opener, the stage is loading, another site)
  function find(name, win = root) {
    try { const o = win.opener; return (o && !o.closed && o.DreamBridge && o.DreamBridge[name]) || null; } catch (e) { return null; }
  }
  // What a page needs of its bridge and the stage does not have: the stage window is a page too, and one loaded before
  // Dream was updated still runs the old script – its bridge lacks what came since. needs: {calls: ['setKind',
  // 'lab.detect'], state: ['kind', 'cams']} → the names that are missing (none: the two fit each other).
  function missing(bridge, needs = {}) {
    const out = [];
    for (const path of needs.calls || []) {
      let o = bridge;
      for (const k of path.split('.')) o = o == null ? undefined : o[k];
      if (typeof o !== 'function') out.push(path);
    }
    let st = null;
    try { st = typeof bridge.state === 'function' ? bridge.state() : null; } catch (e) { /* counted as missing below */ }
    for (const k of needs.state || []) if (!st || st[k] === undefined) out.push('state.' + k);
    return out;
  }
  // Calls on(bridge) once the stage is there and lost() when it went (reloaded, closed) – looked at once a second.
  // After a loss the page starts anew when the stage is back (`again`, by default a reload): what it mounted was bound
  // to the stage that is gone. A stage that lacks what the page `needs` is never handed over: old(names) instead, and
  // on() as soon as a stage that fits is there (the old one was reloaded).
  function link(name, { on, lost = () => {}, old = () => {}, needs = null, win = root, again = () => win.location.reload(), every = 1000 } = {}) {
    let seen = null, bridge = null, had = false;
    const look = () => {
      const b = find(name, win);
      if (b === seen) return;
      if (had && b) { again(); return; }
      if (seen && !b) lost();
      seen = b; bridge = null;
      if (!b) return;
      const lack = needs ? missing(b, needs) : [];
      if (lack.length) { old(lack); return; }
      bridge = b; had = true; on(b);
    };
    look();
    const timer = win.setInterval(look, every);
    return { get bridge() { return bridge; }, stop: () => win.clearInterval(timer), look };
  }
  // the stage window loads anew (the page's button for a stage that is too old); false: there is none to reload
  function reloadStage(win = root) {
    try { if (win.opener && !win.opener.closed) { win.opener.location.reload(); return true; } } catch (e) { /* another site by now */ }
    return false;
  }

  // A choice of the stage, shown in a <select> of the page: only a value the select has, and never while the user is
  // in it – whatever else the stage says (nothing, a value this page does not know) leaves the choice as it is.
  function pick(select, value, doc = root.document) {
    if (typeof value !== 'string' || select.value === value || (doc && doc.activeElement === select)) return false;
    if (![...select.options].some(o => o.value === value)) return false;
    select.value = value;
    return true;
  }
  // The cameras the stage knows, in a <select> of the page: [[value, text], …] as the stage lists them, `cam` the one
  // in use ('' – the picture's camera). Filled anew only when the list changed; the choice stays. Returns how many
  // cameras there are to choose from besides "as picture" – none: the browser has not named any yet.
  function fillCams(select, cams, cam, doc = root.document) {
    const list = (Array.isArray(cams) ? cams : []).filter(c => Array.isArray(c) && typeof c[0] === 'string').map(c => [c[0], String(c[1] == null || c[1] === '' ? c[0] : c[1])]);
    const cur = typeof cam === 'string' ? cam : '';
    if (!list.some(c => c[0] === '')) list.unshift(['', T('Camera: as picture')]);
    if (!list.some(c => c[0] === cur)) list.push([cur, cur]);
    const key = JSON.stringify(list);
    if (select.dataset.filled !== key) {
      const chosen = select.dataset.filled === undefined ? cur : select.value;   // a choice being made stays
      select.dataset.filled = key; select.textContent = '';
      for (const [v, t] of list) { const o = doc.createElement('option'); o.value = v; o.textContent = t; select.append(o); }
      select.value = list.some(c => c[0] === chosen) ? chosen : cur;
    }
    pick(select, cur, doc);
    return list.filter(c => c[0] !== '').length;
  }
  // Why the dance's detection runs or does not, and what to do – one line for the page. st: the bridge's state (mode,
  // camera: the tracker's code, tracking: what it runs, kind: the dance's choice); status: the stage's own words for
  // the camera's state; modeName: the mode's name as the card shows it. → {on, text}
  const RUNS = { hand: () => T('Hands (AI)'), marker: () => T('LED markers'), on: () => T('Fire/LED') };
  function detectText(st, status = '', modeName = '') {
    const say = (on, text) => ({ on, text });
    if (!st) return say(false, '');
    if (st.mode !== 'dance') return say(false, st.mode === 'off'
      ? T('Nothing runs: movement is off. Switch to Dream Dance (button above) – your choice here is kept for it.')
      : T('Nothing runs for the dance: the movement mode is “{m}”. Switch to Dream Dance (button above) – your choice here is kept for it.', { m: modeName || st.mode }));
    switch (st.camera) {
      case 'running':
        return RUNS[st.tracking] ? say(true, T('Running now: {k}', { k: RUNS[st.tracking]() }))
          : say(false, T('Nothing runs: the camera is on, but the detection has not started – choose the kind again.'));
      case 'camera': return say(false, T('Nothing runs yet: the camera is being opened …'));
      case 'loading': return say(false, T('Nothing runs yet: the AI model for the hands is loading (the first time about 15 MB) – a moment …'));
      case 'nocam': return say(false, T('Nothing runs: no camera. Allow the camera for Dream in the browser or connect one – then choose it here.'));
      case 'nomodel': return say(false, T('Nothing runs: the AI model for the hands could not be loaded (the first time needs the internet). “LED markers” work without it.'));
      case 'off': return say(false, T('Nothing runs: the Mac’s camera is switched off as a source of movement – switch it on in the Movement card of the panel (“Sources”).'));
      default: return say(false, status ? T('Nothing runs: {why}', { why: status }) : T('Nothing runs: the camera has not started yet.'));
    }
  }

  // Do the dancer's own clock and the music's beat clock agree? Both locked and the tempos within 6 % of each other –
  // also when one runs at half or double the other's tempo. {on, bpm} each → 'none' | 'move' | 'music' | 'apart' | 'together'
  function agree(move, music) {
    const a = !!move && move.on && move.bpm > 0, b = !!music && music.on && music.bpm > 0;
    if (!a && !b) return 'none';
    if (!b) return 'move';
    if (!a) return 'music';
    const near = r => Math.abs(r - 1) < 0.06, r = move.bpm / music.bpm;
    return near(r) || near(r * 2) || near(r / 2) ? 'together' : 'apart';
  }
  const AGREE = {
    none: () => T('No beat yet – effects on the beat wait for your dance or the music.'),
    move: () => T('Your dance gives the beat.'),
    music: () => T('The music gives the beat.'),
    apart: () => T('Two beats: your dance and the music each push the effects.'),
    together: () => T('You dance on the music’s beat – both beats agree.'),
  };
  const agreeText = (move, music) => { switch (agree(move, music)) { case 'move': return AGREE.move(); case 'music': return AGREE.music(); case 'apart': return AGREE.apart(); case 'together': return AGREE.together(); default: return AGREE.none(); } };
  const clockText = c => (c && c.on && c.bpm > 0 ? T('{n} a minute', { n: Math.round(c.bpm) }) : '–');
  // a dot that beats: its look for a pulse 0 … 1 (only transform and opacity)
  function beat(dot, c) {
    const on = !!c && c.on, p = on ? Math.min(1, Math.max(0, c.pulse || 0)) : 0;
    dot.style.opacity = on ? (0.3 + 0.7 * p).toFixed(2) : '0.15';
    dot.style.transform = `scale(${(on ? 0.75 + 0.45 * p : 0.7).toFixed(2)})`;
  }
  // not while typing or choosing: a key of the page (K, G, B, R …) is not a letter of a name
  const typing = e => { const el = e.target; return e.repeat || e.metaKey || e.ctrlKey || e.altKey || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'range', 'radio', 'button'].includes(el.type)); };

  const api = { find, link, missing, reloadStage, pick, fillCams, detectText, agree, agreeText, clockText, beat, typing };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MovePage = api;
})(typeof window !== 'undefined' ? window : globalThis);
