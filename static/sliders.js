// #216: the sliders of the panel and of Dream Control – one drawing for both pages. Everything a slider knows about its
// setting comes from the settings table of the server (settings.py, sent once over /ctl as "schema": default, range,
// weight, "zero" for a zero inside the range, "needs" for the switch it only acts with); nothing of it is written here.
//
//   const sliders = DreamSliders.create({ on: key => …is that switch on… });   wraps every <input type="range">
//   sliders.schema(m.schema); sliders.paint();                                   after a change the page made itself
//   const resetMsg = DreamSliders.resetButton(button, send, say);  resetMsg(m.reset)
//
// What a slider shows: the fill from the left end or, with a zero in the range, from the zero mark (with a light snap
// to it and a "0" button); a double click or double tap brings it home (zero, else the default); the colour and the
// thickness of the fill tell how much it shapes the picture right now (cool → orange → red), the three strongest
// shimmer, and every card carries a strip in the same scale. Only transform and opacity are animated.
// A later sign on a slider hangs itself in with `sliders.each(item => …)` (item.run is the box around the track) and
// `create({ painted })`, which is called for every slider whose drawing changed.
(function (root) {
  'use strict';

  // ---------- the rules: pure, tested in tests/js/sliders.test.mjs ----------
  const SNAP = 0.02;        // the zero catches a dragged thumb within this share of the range
  const STRONG = 0.5;       // from here a setting counts as "strongly changed" (said to screen readers, a wide strip)
  const SHIMMER = 0.15;     // below this nothing shimmers, however few settings are changed
  const TOP = 3;
  const COOL = [199, 139, 255], WARM = [255, 157, 66], HOT = [255, 77, 94];

  const clamp01 = x => Math.min(1, Math.max(0, x));
  const home = s => (s.zero ? 0 : s.d);
  // how much a value shapes the picture, 0 … 1: its distance from the default, as a share of the way to that end of
  // the range, times the weight of the setting
  function influence(s, v) {
    if (!s || !s.w || v === s.d) return 0;
    const room = v > s.d ? s.hi - s.d : s.d - s.lo;
    return room > 0 ? clamp01(Math.abs(v - s.d) / room) * s.w : 0;
  }
  // the filled part of the track as two shares of its length, and where the zero mark stands
  function fill(v, lo, hi, zero) {
    const at = x => (hi > lo ? clamp01((x - lo) / (hi - lo)) : 0), p = at(v), z = zero ? at(0) : 0;
    return { from: Math.min(p, z), to: Math.max(p, z), zero: z };
  }
  const snap = (s, v) => (s && s.zero && Math.abs(v) < (s.hi - s.lo) * SNAP ? 0 : v);
  // cool (the page's accent) → orange in the middle → red
  function colour(u, cool = COOL) {
    const [a, b, t] = u < 0.5 ? [cool, WARM, u * 2] : [WARM, HOT, u * 2 - 1];
    return 'rgb(' + a.map((c, i) => Math.round(c + (b[i] - c) * clamp01(t))).join(', ') + ')';
  }
  // the keys of the strongest settings, strongest first
  function strongest(byKey, n = TOP) {
    return Object.entries(byKey).filter(([, u]) => u >= SHIMMER).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k]) => k);
  }
  const rules = { SNAP, STRONG, SHIMMER, home, influence, fill, snap, colour, strongest };

  // ---------- the page ----------
  function create({ on = () => true, painted = null, doc = root.document } = {}) {
    const T = root.T || (t => t);
    const items = [], cards = new Map();
    let schema = {}, dragging = null, lastTap = null, queued = false;

    const el = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e; };
    // the label that names a slider: its own (for=…), or the one standing before it in its row
    function labelOf(item) {
      let label = item.input.id && doc.querySelector(`label[for="${item.input.id}"]`);
      for (let e = item.box.previousElementSibling; !label && e && !e.classList.contains('sl'); e = e.previousElementSibling) {
        if (e.tagName === 'LABEL' && !e.htmlFor) label = e;
      }
      return label || null;
    }
    function wrap(input) {
      const box = el('span', 'sl'), run = el('span', 'sl-run'), mark = el('span', 'sl-mark'), shine = el('span', 'sl-shine');
      const zero = el('button', 'sl-zero');
      zero.type = 'button'; zero.textContent = '0'; zero.disabled = true;
      box.style.cssText = input.style.cssText; input.style.cssText = '';      // its place in the row is the box's now
      if (input.dataset.only) box.dataset.only = input.dataset.only;           // hidden from guests together
      input.before(box); run.append(input, mark, shine); box.append(run, zero);
      const item = { input, key: input.dataset.setting || input.id, box, run, zero, s: null, u: 0, drawn: '' };
      const card = input.closest('details.sec, section');
      if (card && !cards.has(card)) {
        card.classList.add('sl-card');
        const sr = el('span', 'sl-sr'); (card.querySelector('summary, h2') || card).append(sr);
        cards.set(card, { sr, drawn: '' });
      }
      item.card = card;
      zero.onclick = () => set(item, 0);
      items.push(item);
    }
    // as if by hand: the page's own wiring sends it and shows the value
    function set(item, v) {
      item.input.value = v;
      item.input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const itemOf = target => items.find(i => i.input === target);

    doc.querySelectorAll('input[type=range]').forEach(wrap);
    // before the page's own listeners read the value: a dragged thumb snaps to the zero mark (arrow keys never do)
    doc.addEventListener('input', e => {
      const item = itemOf(e.target);
      if (item && item === dragging && item.s) { const v = snap(item.s, +item.input.value); if (v !== +item.input.value) item.input.value = v; }
    }, true);
    for (const type of ['input', 'change']) doc.addEventListener(type, soon);
    // a double click or a double tap (two short touches at about the same place) brings the slider home
    doc.addEventListener('pointerdown', e => {
      dragging = itemOf(e.target) || null;
      if (dragging) dragging.down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    }, true);
    doc.addEventListener('pointerup', e => {
      const item = dragging; dragging = null;
      if (!item || !item.down) return;
      const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 24, up = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      const tap = near(item.down, up) && up.t - item.down.t < 400;
      if (tap && lastTap && lastTap.item === item && up.t - lastTap.t < 450 && near(lastTap, up)) {
        lastTap = null;
        if (item.s) setTimeout(() => set(item, home(item.s)));          // after the browser put the thumb under the finger
      } else lastTap = tap ? { ...up, item } : null;
    }, true);
    doc.addEventListener('pointercancel', () => { dragging = null; }, true);

    function soon() {
      if (queued) return;
      queued = true; Promise.resolve().then(() => { queued = false; paint(); });
    }
    function setSchema(sc) {
      schema = sc || {};
      for (const item of items) {
        const s = item.s = schema[item.key] || null, name = labelOf(item);
        if (s) { item.input.min = s.lo; item.input.max = s.hi; }
        item.box.classList.toggle('sl-bipolar', !!(s && s.zero));
        if (name && !item.input.getAttribute('aria-label') && !name.htmlFor) {     // a label beside its slider names it
          name.id = name.id || 'sl-name-' + items.indexOf(item); item.input.setAttribute('aria-labelledby', name.id);
        }
        const text = item.input.getAttribute('aria-label') || (name && name.firstChild ? name.firstChild.textContent.trim() : item.key);
        item.zero.setAttribute('aria-label', T('{name}: set to 0', { name: text }));
        item.zero.title = T('Set to 0');
        item.drawn = '';
      }
      paint();
    }
    const accent = () => {
      const m = /^#([0-9a-f]{6})$/i.exec(root.getComputedStyle(doc.body).getPropertyValue('--accent').trim());
      return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : COOL;
    };
    function paint() {
      const cool = accent(), byKey = {}, byCard = new Map();
      for (const item of items) {
        const { input, s } = item, v = +input.value;
        const acts = s && (!s.needs || on(s.needs)) && !input.closest('.modepart.off');
        item.u = acts ? influence(s, v) : 0;
        byKey[item.key] = Math.max(byKey[item.key] || 0, item.u);
        if (item.card) byCard.set(item.card, Math.max(byCard.get(item.card) || 0, item.u));
      }
      const top = strongest(byKey);
      for (const item of items) {
        const { input, s, box, u } = item, v = +input.value, f = fill(v, +input.min, +input.max, s && s.zero);
        const shimmer = u > 0 && top.includes(item.key), strong = u >= STRONG;
        const drawn = [f.from, f.to, f.zero, u.toFixed(3), shimmer, cool, v === 0].join('|');
        if (drawn === item.drawn) continue;
        item.drawn = drawn;
        const st = box.style;
        st.setProperty('--pa', f.from.toFixed(4)); st.setProperty('--pb', f.to.toFixed(4)); st.setProperty('--pz', f.zero.toFixed(4));
        st.setProperty('--c', colour(u, cool)); st.setProperty('--th', (6 + 5 * u).toFixed(1) + 'px');
        box.classList.toggle('sl-top', shimmer); box.classList.toggle('sl-strong', strong);
        item.zero.disabled = !(s && s.zero && v !== 0);
        if (strong) input.setAttribute('aria-description', T('strongly changed')); else input.removeAttribute('aria-description');
        if (painted) painted(item);
      }
      for (const [card, c] of cards) {
        const u = byCard.get(card) || 0, drawn = u.toFixed(3) + cool;
        if (drawn === c.drawn) continue;
        c.drawn = drawn;
        card.style.setProperty('--cc', u > 0.02 ? colour(u, cool) : 'transparent');
        card.style.setProperty('--cw', (u > 0.02 ? 3 + 5 * u : 0).toFixed(1) + 'px');
        card.classList.toggle('sl-strong-card', u >= STRONG);
        c.sr.textContent = u >= STRONG ? ' – ' + T('strongly changed') : '';
      }
    }
    return { schema: setSchema, paint, each: fn => items.forEach(fn) };
  }

  // "↺ Reset" (#216): one tap, no question – and for the seconds the server allows the same button takes it back.
  // send: the page's /ctl sender; say: the page's status line. Returns what the page calls with the server's "reset".
  function resetButton(button, send, say) {
    const T = root.T || (t => t);
    let timer = 0, undo = false;
    function show() {
      button.textContent = undo ? T('Reset · ↶ Undo') : T('↺ Reset');
      button.title = undo ? T('Undo the reset: everything glides back to what it was')
        : T('Reset: zoom, rotation, colour and the other picture settings glide to their defaults, effects, style and autopilot go off – prompt, model, inputs and outputs stay');
      button.classList.remove('sl-undo');
      if (undo) { void button.offsetWidth; button.classList.add('sl-undo'); }   // the bar of the seconds starts anew
    }
    button.classList.add('sl-reset');
    button.onclick = () => send({ reset: undo ? 'undo' : true });
    show();
    return function onMessage(r) {
      clearTimeout(timer);
      undo = r.undo > 0;
      if (undo) {
        button.style.setProperty('--secs', r.undo + 's');
        timer = setTimeout(() => { undo = false; show(); }, r.undo * 1000);
      }
      show();
      say(r.undone ? T('Everything back as it was.') : undo ? T('Reset – the picture glides to its defaults.') : T('Already at the defaults.'));
    };
  }

  const api = { rules, create, resetButton };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamSliders = api;
})(typeof window !== 'undefined' ? window : globalThis);
