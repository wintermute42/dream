/* Dream – recording the output (#276): one button in the panel's card "Output" and the same in Dream Control's.
   Idle it says "● Record"; while it records it shows how long the recording runs (● 02:14), and in the last minute
   before the automatic stop after 15 minutes it blinks (without motion – prefers-reduced-motion – it stands out in
   the warning colour instead). Afterwards a note says what was saved, or that the recording stopped by itself, with
   "Show in Finder" (only on this Mac). A plain message only when something went wrong. The markup is the page's; this
   file gives it its behaviour; the state comes from Dream ({"rec": …}, recording.py). Nothing of it is ever drawn into
   the output picture.

     const card = RecCard.mount({ el: id => element, send: msg => …, reveal: () => … (only on this Mac) });
     card.show(rec);           // {"rec": …} of Dream

   `clock`, `size`, `say`, `doneText`, `soon` and `button` are pure (tests/js/recorder.test.mjs). A global `RecCard`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  // tables of words are Maps: a word that came over the connection never reaches an object's own properties
  const ERRORS = new Map([
    ['nostage', () => T('The stage is not open – recording needs the stage on the Mac.')],
    ['nosupport', () => T('This browser cannot record video (MediaRecorder) – use Chrome for the stage.')],
    ['disk', () => T('The disk is nearly full – free some space to record.')],
    ['folder', () => T('The save folder cannot be written to – check it (README: Recording).')],
    ['interrupted', () => T('The stage went away during the recording – what came until then is saved.')],
    ['upload', () => T('The recording stopped: the stage could not hand its video to Dream.')],
    ['behind', () => T('The recording stopped: the video could not be saved fast enough.')],
    ['encoder', () => T('The browser stopped encoding the video – the recording up to then is saved.')],
  ]);
  const pick = (table, key, otherwise = '') => { const f = table.get(key); return typeof f === 'function' ? f() : otherwise; };

  const two = n => String(n).padStart(2, '0');
  function clock(secs) {
    const s = Math.max(0, Math.floor(+secs || 0)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? `${h}:${two(m)}` : two(m)) + ':' + two(s % 60);
  }
  function size(bytes) {
    const b = Math.max(0, +bytes || 0);
    return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`;
  }
  const soon = (st, secs) => (+st.max_secs || 900) - secs <= 60;   // the last minute before the automatic stop
  // the status line: only when something went wrong – and, for screen readers, the last minute (the button blinks)
  function say(st, secs = +((st || {}).secs) || 0) {
    const s = st || {};
    if (s.error === 'disk' && !s.on && s.last && s.last.reason === 'disk') return '';   // the note says it already
    if (s.error && ERRORS.has(s.error)) return pick(ERRORS, s.error);
    if (s.on && soon(s, secs)) return T('One minute left – then the recording stops by itself.');
    return '';
  }
  // after the stop: what was saved, and why it stopped when it was not by hand
  function doneText(last) {
    if (!last || !last.name) return '';
    const what = { name: last.name, size: size(last.bytes), time: clock(last.secs) };
    if (last.reason === 'time') return T('Stopped by itself after 15 minutes – saved: {name} ({size}, {time})', what);
    if (last.reason === 'disk') return T('Stopped: the disk is nearly full – saved: {name} ({size}, {time})', what);
    return T('Saved: {name} ({size}, {time})', what);
  }
  // the button: its visible words and what a screen reader hears beside them
  function button(on, secs = 0) {
    return on ? { text: clock(secs), sr: ' ' + T('Recording – stop'), dot: '●' } : { text: T('Record'), sr: '', dot: '●' };
  }

  function mount({ el, send, reveal }) {
    let st = {}, at = 0, secsAt = 0;
    const btn = el('recbtn'), stat = el('recstat'), done = el('recdone'), doneT = el('recdonetext');
    const finder = reveal ? el('recreveal') : null;
    const now = () => secsAt + (performance.now() - at) / 1000;
    function draw() {
      const secs = now(), b = button(!!st.on, secs), last = !!st.on && soon(st, secs);
      btn.setAttribute('aria-pressed', String(!!st.on));
      btn.classList.toggle('on', !!st.on);
      btn.classList.toggle('soon', last);
      btn.querySelector('.recdot').textContent = b.dot;
      btn.querySelector('.rectext').textContent = b.text;
      btn.querySelector('.recsr').textContent = b.sr;
      const text = say(st, secs);
      if (stat.textContent !== text) stat.textContent = text;
      stat.classList.toggle('recsr', last && !st.error);   // the last minute: read out, the button shows it
      const d = st.on ? '' : doneText(st.last);
      done.hidden = !d;
      if (doneT.textContent !== d) doneT.textContent = d;
      if (finder) finder.hidden = !d;
    }
    btn.onclick = () => send({ cmd: 'rec', arg: st.on ? 'stop' : 'start' });
    if (finder) finder.onclick = () => reveal();
    setInterval(() => { if (st.on) draw(); }, 250);   // the running time between Dream's messages (once a second)
    draw();
    return {
      show(s) { if (s && typeof s === 'object') { st = s; at = performance.now(); secsAt = +s.secs || 0; } draw(); },
      get on() { return !!st.on; },
    };
  }

  const api = { mount, clock, size, say, doneText, button, soon };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
