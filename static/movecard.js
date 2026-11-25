/* Dream – the movement card (#250): one card for everything movement does.

   The mode – off, mood, flowtrack, dance; one at a time – as four buttons, the part of the card the mode in use needs
   at hand (the mood: its strength and the energy of the room; flowtrack and the dance: what Dream detects right now),
   "Page ↗" for a mode that has a page of its own, and the sources: one chip per kind with a light while values come;
   a tap switches the kind off or on; in Dream Dance the traffic light of what blocks the dance (`lamp`, #265). The same card stands in the panel and – only the mode and the mood's strength –
   in Dream Control: the markup is the page's (so it is translated and drawn like everything else there), this file
   gives it its behaviour.
   `words`, `chips`, `info` and `light` are pure (tests/js/movecard.test.mjs). Looks: movecard.css – only transform and opacity
   move. A global `MoveCard`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const MODES = ['off', 'mood', 'flowtrack', 'dance'];
  // every table of names is a Map and is read through `say`: a key Dream does not know (a mode, a kind or a detection
  // that came over the connection) never becomes a call into an object's own or inherited properties
  const NAMES = new Map([['off', () => T('Off')], ['mood', () => T('Mood')], ['flowtrack', () => 'Flowtrack'], ['dance', () => 'Dream Dance']]);
  const KINDS = new Map([['camera', () => T('Mac camera')], ['eyes', () => 'Dreamy Eyes'], ['phone', () => T('Phone')], ['band', () => T('Wristband')]]);
  const DETECTS = new Map([['hand', () => T('Hands (AI)')], ['on', () => T('Fire/LED')], ['marker', () => T('LED markers')]]);
  function say(table, key, otherwise) { const text = table.get(key); return typeof text === 'function' ? text() : otherwise; }
  const name = mode => say(NAMES, mode, T('Off'));
  // #251: the dance's clutch and the movement sets – what the panel, the page of Dream Dance and Dream Control show alike
  // (released is how Dream starts: the button and the line below it say so plainly)
  const clutchText = on => (on ? T('Clutch: engaged') : T('Clutch: released'));
  const clutchNote = on => (on ? T('Engaged: your dance acts on top of the sliders and controllers.') : T('Released: your dance does nothing yet – engage the clutch to let it steer.'));
  function clutchShow(btn, on, note) {
    btn.setAttribute('aria-pressed', String(!!on)); btn.classList.toggle('on', !!on); btn.textContent = clutchText(on);
    if (note) note.textContent = clutchNote(on);
  }
  const SETS = new Map([['standard', () => T('Standard')], ['waves', () => T('Flowing')], ['fire', () => T('Wild')]]);
  const setLabel = n => say(SETS, n, n);
  // the choices of a set's select: every set by its name; a name not in the list yet (Dream has not said so) stands as
  // it is. Rebuilt only when something changed, so an open list is not torn away.
  function fillSets(select, names, current) {
    const cur = current == null ? '' : String(current), want = (names || []).concat(cur && !(names || []).includes(cur) ? [cur] : []);
    const key = want.join('\n');
    if (select.dataset.filled !== key) {
      select.dataset.filled = key; select.textContent = '';
      for (const n of want) { const o = document.createElement('option'); o.value = n; o.textContent = T('Set: {s}', { s: setLabel(n) }); select.append(o); }
    }
    if (select.value !== cur && document.activeElement !== select) select.value = cur;
  }

  // #265: the traffic light of Dream Dance – what blocks the dance. st: {mode, clutch}; live: what the stage sees right
  // now ({seen, markers, markerWanted}). → {green, clutch, person, marker}: each 'ok' | 'block' | 'none' (does not apply)
  function light(st, live) {
    const clutch = st && st.clutch ? 'ok' : 'block';
    const person = live && live.seen ? 'ok' : 'block';
    const marker = !live || !live.markerWanted ? 'none' : live.markers > 0 ? 'ok' : 'block';
    return { green: !!st && st.mode === 'dance' && clutch === 'ok' && person === 'ok' && marker !== 'block', clutch, person, marker };
  }
  // … drawn as a lamp and three symbols – the words only on hover (and for a screen reader). opts.clutch(): a tap on the
  // clutch's symbol (the page of Dream Dance); without it the symbol only shows (the panel has the clutch's button).
  function lamp(box, opts = {}) {
    const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
    const dot = el('i', 'mc-lamp'), sym = {
      clutch: el(opts.clutch ? 'button' : 'span', 'mc-sym', '🔓'), person: el('span', 'mc-sym', '👤'), marker: el('span', 'mc-sym', '◉') };
    box.classList.add('mc-light'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', T('What blocks the dance'));
    dot.setAttribute('aria-hidden', 'true');
    if (opts.clutch) { sym.clutch.type = 'button'; sym.clutch.onclick = opts.clutch; } else sym.clutch.setAttribute('role', 'img');
    sym.person.setAttribute('role', 'img'); sym.marker.setAttribute('role', 'img');
    box.textContent = ''; box.append(dot, sym.clutch, sym.person, sym.marker);
    const tip = (e, text) => { if (e.title !== text) { e.title = text; e.setAttribute('aria-label', text); } };
    const say = {
      clutch: { ok: () => (opts.clutch ? T('Clutch engaged – your dance steers (click or key K to release)') : T('Clutch engaged – your dance steers')),
        block: () => (opts.clutch ? T('Clutch released – your dance does nothing yet (click or key K)') : T('Clutch released – your dance does nothing yet')) },
      person: { ok: () => T('Someone is detected'), block: () => T('Nobody detected – step into the camera’s view') },
      marker: { ok: () => T('LED markers are seen'), block: () => T('LED markers chosen, but none is seen'), none: () => T('No LED markers chosen') },
    };
    return {
      show(st, live) {
        const lt = light(st, live);
        for (const k of ['clutch', 'person', 'marker']) { if (sym[k].dataset.state !== lt[k]) sym[k].dataset.state = lt[k]; tip(sym[k], say[k][lt[k]]()); }
        const go = lt.green ? 'go' : 'stop';
        if (box.dataset.state !== go) box.dataset.state = go;
        tip(box, lt.green ? T('Green: nothing blocks – your dance steers the dream') : T('Something blocks the dance – see the symbols'));
        return lt;
      },
    };
  }

  // the energy of the room in a word: {energy, conf} → text (nothing known: no source reports)
  function words(room) {
    if (!room || !(room.conf > 0)) return T('no source');
    const e = room.energy;
    return e < 0.04 ? T('still') : e < 0.2 ? T('calm') : e < 0.5 ? T('moving') : e < 0.8 ? T('lively') : T('wild');
  }

  // The chips of the "Sources" field: list – the register (movement.js: sources()); uses(kind) – whether the mode in
  // use listens to that kind; off – the kinds switched off ("eyes+band"). One chip per kind, in the register's order.
  function chips(list, uses, off) {
    const out = new Set(String(off || '').split('+'));
    return [...KINDS.keys()].map(kind => {
      const mine = list.filter(s => s.kind === kind), live = mine.filter(s => s.active), on = !out.has(kind), used = !!uses(kind);
      const rate = Math.round(live.reduce((a, s) => a + s.rate, 0)), sure = live.length ? Math.round(100 * live.reduce((a, s) => a + s.conf, 0) / live.length) : 0;
      const label = say(KINDS, kind, kind) + (mine.length > 1 ? ` (${mine.length})` : '');
      const state = !on ? T('switched off') : !used ? T('not used by this mode') : live.length ? T('{n} values/s · {p} % sure', { n: rate, p: sure }) : T('nothing comes');
      return { kind, label, on, used, live: on && used && live.length > 0, rate, state, n: mine.length };
    });
  }

  // What Dream detects right now, in one line, for the mode's part of the card.
  // flowtrack: {running, kind ('hand' | 'on' | 'marker'), rate, present, status}; dance: {gesture (its name) | null, sure, bpm, live}
  function info(mode, d) {
    if (mode === 'flowtrack') {
      if (!d || !d.running) return (d && d.status) || T('The camera is starting …');
      const what = say(DETECTS, d.kind, d.kind);
      return T('Detects: {k} · {n} values/s', { k: what, n: Math.round(d.rate || 0) }) + ' · ' + (d.present ? T('someone there') : T('nobody'));
    }
    if (mode === 'dance') {
      if (!d || !d.live) return (d && d.status) || T('Waiting for movement …');
      return (d.gesture ? T('{g} · {p} % sure', { g: d.gesture, p: Math.round((d.sure || 0) * 100) }) : T('no gesture')) + (d.bpm > 0 ? ' · ' + T('{n} a minute', { n: Math.round(d.bpm) }) : '');
    }
    return '';
  }

  // box: the card's element (its markup is the page's). send(changes): settings a hand changed. uses(mode, kind): as
  // DreamMove.uses with the page's options. pages: {mode: () => …} – the modes that have a page of their own.
  function mount(box, { send, uses = () => true, pages = {} }) {
    const $ = sel => box.querySelector(sel), all = sel => [...box.querySelectorAll(sel)];
    const buttons = all('.movemodes button'), parts = all('.movepart'), select = $('#move_mode'), page = $('.movepage');
    const meter = $('.movemeter'), fill = meter && meter.querySelector('.fill'), peakEl = meter && meter.querySelector('.peak'), word = $('.movemeter-word');
    const srcBox = $('.movesources'), cam = $('#move_cam');
    let mode = 'off', off = '', peak = 0, peakAt = 0, drawn = '', shownInfo = {}, list = [];

    function paint() {
      for (const b of buttons) { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
      for (const p of parts) { const on = p.dataset.for.split(' ').includes(mode); p.classList.toggle('on', on); p.inert = !on; }
      if (page) { const has = typeof pages[mode] === 'function'; page.disabled = !has;
        page.setAttribute('aria-label', has ? T('Open the page of {m} in its own window', { m: name(mode) }) : T('This mode has no page of its own')); }
      drawn = ''; sources(list);
    }
    function choose(m, tell) {
      if (!MODES.includes(m)) m = 'off';
      const changed = m !== mode; mode = m;
      if (select && select.value !== m) select.value = m;
      paint();
      // the page's own select (hidden) holds the setting where there is one: its change tells Dream as every control does
      if (tell && changed) { if (select) select.dispatchEvent(new Event('change', { bubbles: true })); else send({ move_mode: m }); }
    }
    buttons.forEach((b, i) => {
      b.addEventListener('click', () => choose(b.dataset.mode, true));
      b.addEventListener('keydown', e => {             // the arrow keys walk through the modes, as in a group of choices
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault(); const next = buttons[(i + step + buttons.length) % buttons.length]; next.focus(); choose(next.dataset.mode, true);
      });
    });
    if (page) page.addEventListener('click', () => { if (typeof pages[mode] === 'function') pages[mode](); });

    function sources(next) {
      list = next || [];
      if (!srcBox) return;
      const rows = chips(list, kind => uses(mode, kind), off), key = JSON.stringify(rows);
      if (key === drawn) return;
      drawn = key;
      const keep = document.activeElement && srcBox.contains(document.activeElement) ? document.activeElement.dataset.kind : null;
      srcBox.textContent = '';
      for (const r of rows) {
        const b = document.createElement('button'), dot = document.createElement('i'), txt = document.createElement('span');
        b.type = 'button'; b.dataset.kind = r.kind; b.setAttribute('aria-pressed', String(r.on));
        b.className = (r.live ? 'live' : '') + (r.used ? '' : ' unused');
        dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true'); txt.textContent = r.label;
        b.append(dot, txt);
        if (r.live) { const n = document.createElement('span'); n.className = 'rate'; n.textContent = T('{n}/s', { n: r.rate }); n.setAttribute('aria-hidden', 'true'); b.append(n); }
        b.setAttribute('aria-label', r.label + ': ' + r.state); b.title = r.state + ' – ' + (r.on ? T('tap to switch this kind of source off') : T('tap to switch it on again'));
        b.addEventListener('click', () => {
          const now = new Set(off.split('+').filter(Boolean)); if (r.on) now.add(r.kind); else now.delete(r.kind);
          off = [...KINDS.keys()].filter(k => now.has(k)).join('+'); send({ move_off: off }); drawn = ''; sources(list);
        });
        srcBox.append(b);
      }
      if (keep) { const again = srcBox.querySelector(`[data-kind="${keep}"]`); if (again) again.focus(); }
    }
    // the energy bar: follows at once; the mark holds the last peak for a second, then sinks
    function energy(room, now) {
      if (!meter) return;
      const known = !!room && room.conf > 0, e = known ? Math.min(1, Math.max(0, room.energy)) : 0;
      if (e >= peak) { peak = e; peakAt = now; } else if (now - peakAt > 1000) peak = Math.max(e, peak - (now - peakAt - 1000) / 1500 * 0.05);
      meter.classList.toggle('unknown', !known);
      fill.style.transform = `scaleX(${e.toFixed(3)})`;
      peakEl.style.transform = `translateX(${(-100 + 100 * Math.max(peak, 0.02)).toFixed(1)}%)`;
      const pct = String(Math.round(e * 100)), w = words(room);
      if (meter.getAttribute('aria-valuenow') !== pct) meter.setAttribute('aria-valuenow', pct);
      if (meter.getAttribute('aria-valuetext') !== w) meter.setAttribute('aria-valuetext', w);
      if (word && word.textContent !== w) word.textContent = w;
    }
    function tell(m, d) {
      const el = $('#moveinfo-' + m); if (!el) return;
      const text = info(m, d); if (shownInfo[m] !== text) { shownInfo[m] = text; el.textContent = text; }
    }
    paint();
    return {
      get mode() { return mode; }, get off() { return off; },
      // Dream's word (the state): the mode, the kinds switched off
      set(st) { if ('move_off' in st) { off = String(st.move_off || ''); drawn = ''; } if ('move_mode' in st) choose(st.move_mode, false); else sources(list); },
      // what is live right now: {room, sources, flowtrack, dance, now (ms)} – only the part of the mode in use is drawn
      show(live) {
        if (live.sources) sources(live.sources);
        if (mode === 'mood') energy(live.room, live.now == null ? Date.now() : live.now);
        if (mode === 'flowtrack') tell('flowtrack', live.flowtrack);
        if (mode === 'dance') tell('dance', live.dance);
      },
      redraw() { drawn = ''; paint(); },
    };
  }

  const api = { mount, words, chips, info, MODES, name, clutchText, clutchNote, clutchShow, setLabel, fillSets, light, lamp };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoveCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
