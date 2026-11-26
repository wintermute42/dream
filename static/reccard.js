/* Dream – recording the output (#276) in the panel's card "Output" and in Dream Control's: the button, the time left
   of the 15 minutes a recording may run (● REC · 12:46 left – plain to see in the last minute), the room left on the
   disk at the chosen quality, and after the stop the file with "Show in Finder" (only on this Mac) – and that it
   stopped by itself when it did. The markup is the page's; this file gives it its behaviour. What is
   recorded, the file and the room left come from Dream ({"rec": …}, recording.py) – both pages show the same. Nothing
   of it is ever drawn into the output picture.

     const card = RecCard.mount({ el: id => element, send: msg => …, reveal: () => … (only on this Mac) });
     card.show(rec);           // {"rec": …} of Dream

   `clock`, `size`, `say`, `doneText` and `button` are pure (tests/js/recorder.test.mjs). A global `RecCard`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  // tables of words are Maps: a word that came over the connection never reaches an object's own properties
  const ERRORS = new Map([
    ['nostage', () => T('The stage is not open – recording needs the stage on the Mac.')],
    ['nosupport', () => T('This browser cannot record video (MediaRecorder) – use Chrome for the stage.')],
    ['disk', () => T('Stopped: the disk is nearly full. Free some space to record again.')],
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
  // the line beside the button while it runs: ● REC · 12:46 left (counted down from what Dream says)
  function running(st, secs) {
    return '● REC · ' + T('{t} left', { t: clock(Math.max(0, (+st.max_secs || 900) - secs)) });
  }
  const soon = (st, secs) => (+st.max_secs || 900) - secs <= 60;   // the last minute
  // the status line: what is wrong, or how much room the disk has at this quality – changes rarely (read out)
  function say(st) {
    const s = st || {};
    if (s.error && ERRORS.has(s.error)) return pick(ERRORS, s.error);
    if (s.left_min == null) return '';
    const left = s.left_min >= 600 ? T('more than 10 hours') : s.left_min >= 120 ? T('about {h} hours', { h: Math.floor(s.left_min / 60) }) : T('about {m} min', { m: s.left_min });
    if (s.on && s.warn === 'disk') return T('⚠ Little room left on the disk: {left} – Dream stops by itself before it is full.', { left });
    if (s.on) return s.left != null && s.left <= 60 ? T('Less than a minute left – the recording stops by itself after 15 minutes.') : '';
    return s.left_min < 10 ? T('⚠ Little room left on the disk: {left} at this quality.', { left }) : T('Room on the disk for {left} at this quality.', { left });
  }
  // after the stop: what was saved
  function doneText(last) {
    if (!last || !last.name) return '';
    const what = { name: last.name, size: size(last.bytes), time: clock(last.secs) };
    return last.reason === 'time' ? T('Stopped by itself after 15 minutes – saved: {name} ({size}, {time})', what)
      : T('Saved: {name} ({size}, {time})', what);
  }
  function button(on) {
    return on ? { text: T('Stop'), title: T('Stop recording'), dot: '■' } : { text: T('Record'), title: T('Record what the audience sees as a video – Shift+R, or a MIDI button'), dot: '●' };
  }

  function mount({ el, send, reveal }) {
    let st = {}, at = 0, secsAt = 0;
    const btn = el('recbtn'), clk = el('recclock'), stat = el('recstat'), done = el('recdone'), doneT = el('recdonetext');
    const finder = reveal ? el('recreveal') : null;
    function draw() {
      const b = button(!!st.on);
      btn.setAttribute('aria-pressed', String(!!st.on));
      btn.classList.toggle('on', !!st.on);
      btn.querySelector('.recdot').textContent = b.dot;
      btn.querySelector('.rectext').textContent = b.text;
      btn.title = b.title;                          // the visible word is the button's name (axe: label-content-name-mismatch)
      clk.hidden = !st.on;
      if (st.on) {
        const secs = secsAt + (performance.now() - at) / 1000;
        clk.textContent = running(st, secs);
        clk.classList.toggle('soon', soon(st, secs));
      }
      const text = say(st);
      if (stat.textContent !== text) stat.textContent = text;
      stat.classList.toggle('warn', /⚠/.test(text) || (!!st.error && ERRORS.has(st.error)));
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
      toggle() { btn.click(); },
      get on() { return !!st.on; },
    };
  }

  const api = { mount, clock, size, say, doneText, button, running, soon };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
