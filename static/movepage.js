/* Dream – what the pages of the movement modes share (#251 Dream Dance, #252 Flowtrack).

   Such a page is a window of its own on this Mac (for a second screen). It does not talk to Dream itself: it reads the
   stage in the window that opened it, through that window's `DreamBridge.<name>` – the live movement, the camera
   picture (drawn here, kept nowhere), the settings. `link` finds the bridge and notices when the stage was reloaded or
   closed; `agree` and `clockText` are pure (tests/js/movepage.test.mjs). A global `MovePage`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);

  // the bridge of the stage that opened this window, or null (no opener, the stage is loading, another site)
  function find(name, win = root) {
    try { const o = win.opener; return (o && !o.closed && o.DreamBridge && o.DreamBridge[name]) || null; } catch (e) { return null; }
  }
  // Calls on(bridge) once the stage is there and lost() when it went (reloaded, closed) – looked at once a second.
  // After a loss the page starts anew when the stage is back (`again`, by default a reload): what it mounted was bound
  // to the stage that is gone.
  function link(name, { on, lost = () => {}, win = root, again = () => win.location.reload(), every = 1000 } = {}) {
    let bridge = null, had = false;
    const look = () => {
      const b = find(name, win);
      if (b === bridge) return;
      if (had && b) { again(); return; }
      if (bridge && !b) lost();
      bridge = b;
      if (b) { had = true; on(b); }
    };
    look();
    const timer = win.setInterval(look, every);
    return { get bridge() { return bridge; }, stop: () => win.clearInterval(timer), look };
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
    none: () => T('No beat yet – effects on the beat wait for your movement or the music.'),
    move: () => T('Your movement gives the beat.'),
    music: () => T('The music gives the beat.'),
    apart: () => T('Two beats: your movement and the music each push the effects.'),
    together: () => T('You dance on the music’s beat – both clocks agree.'),
  };
  const agreeText = (move, music) => AGREE[agree(move, music)]();
  const clockText = c => (c && c.on && c.bpm > 0 ? T('{n} a minute', { n: Math.round(c.bpm) }) : '–');
  // a dot that beats: its look for a pulse 0 … 1 (only transform and opacity)
  function beat(dot, c) {
    const on = !!c && c.on, p = on ? Math.min(1, Math.max(0, c.pulse || 0)) : 0;
    dot.style.opacity = on ? (0.3 + 0.7 * p).toFixed(2) : '0.15';
    dot.style.transform = `scale(${(on ? 0.75 + 0.45 * p : 0.7).toFixed(2)})`;
  }
  // not while typing or choosing: a key of the page (K, G, B, R …) is not a letter of a name
  const typing = e => { const el = e.target; return e.repeat || e.metaKey || e.ctrlKey || e.altKey || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'range', 'radio', 'button'].includes(el.type)); };

  const api = { find, link, agree, agreeText, clockText, beat, typing };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MovePage = api;
})(typeof window !== 'undefined' ? window : globalThis);
