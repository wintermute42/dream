/* Dream – the slots of Dream Dance (#265, a prototype): a few fixed places instead of the mapping table.

   Base movement: 2 slots (a continuous value – energy, opening, turning, height – sets one effect), accents: 4 slots
   (a gesture sets off one effect; a taught movement of #236 gets its place here later), hands in the picture: paint,
   stir, impulses, light as switches, at most 2 at once. One strength per slot; Dream picks curve, ranges and smoothing
   (dance.py compiles the slots into rows of the dance table, the engine keeps every effect visible: dancemap.js).
   A tile opens the chooser with all effects as tiles; what does not fit is greyed out, its reason on hover.
   What acts is seen without reading: the tiles glow while they act, with a level; an accent flashes when its gesture
   is recognised; the skeleton's hands glow in the colour of the effect; a traffic light of three symbols says what
   blocks (the clutch, nobody detected, markers chosen but not seen). Text only on hover and for screen readers.
   The built-in sets can't be changed: "Adapt" makes an own copy, "Reset" brings it back, "Remove" deletes it.

   `fits`, `light`, `level`, `glow`, `place`, `copyName` are pure (tests/js/danceslots.test.mjs). Looks: danceslots.css –
   only transform and opacity move. A global `DanceSlots`. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./dancemap.js') : root.DreamDanceMap;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const BASE = ['energy', 'open', 'turn', 'height'];
  const ACCENTS = ['g.throw', 'g.accordion', 'g.push', 'g.circle', 'g.wave'];
  const HANDS = ['paint', 'warp', 'impulse', 'light'];
  const MAX_HANDS = 2, BUILTIN = ['standard', 'waves', 'fire'];
  const GROUP_OF = Object.fromEntries(Object.entries(M.GROUPS).flatMap(([g, list]) => list.map(e => [e, g])));
  const EFFECTS = Object.values(M.GROUPS).flat();
  const COLOURS = { symmetry: '#c78bff', space: '#5bb8ff', afterglow: '#ffc857', disturbance: '#ff7a8a', colour: '#7fe3a0' };
  const GROUP_NAMES = { symmetry: () => T('Symmetry'), space: () => T('Space'), afterglow: () => T('Afterglow'), disturbance: () => T('Disturbance'), colour: () => T('Colour') };
  const HAND_NAMES = { paint: () => T('Paint'), warp: () => T('Stir'), impulse: () => T('Impulses'), light: () => T('Light in the dark') };
  const HAND_ICONS = { paint: '🖌️', warp: '🫧', impulse: '💥', light: '💡' };
  const HAND_WHAT = { paint: () => T('Your hands draw trails of light'), warp: () => T('Your hands push and swirl the picture'),
    impulse: () => T('A fast hand sends a wave through the picture'), light: () => T('Where your hands are, the dark picture lights up') };
  const REASONS = {
    taken: () => T('Already in another slot'),
    group: () => T('Same group as the other base slot – the two would cancel each other out'),
    base: () => T('Same group as a base movement – it would only replace it for a moment'),
    hands: () => T('At most 2 at once – switch another one off first'),
  };

  // Why an effect does not fit into a slot beside the others, or null (the same rule as dance.py `slot_conflict`).
  function fits(slots, where, i, fx) {
    const others = [];
    for (const w of ['base', 'accents']) (slots[w] || []).forEach((s, j) => { if (s && !(w === where && j === i)) others.push([w, s]); });
    if (others.some(([, s]) => s.fx === fx)) return 'taken';
    const baseGroups = new Set(others.filter(([w]) => w === 'base').map(([, s]) => GROUP_OF[s.fx]));
    if (baseGroups.has(GROUP_OF[fx])) return where === 'base' ? 'group' : 'base';
    return null;
  }
  // Can this hand switch be switched on? null, or 'hands' when two are on already.
  const handFits = (slots, h) => ((slots.hands || []).includes(h) || (slots.hands || []).length < MAX_HANDS ? null : 'hands');
  // The slots after a hand changed one: {where, i, slot: {src, fx, amt} | null} or {hand, on}.
  function place(slots, ch) {
    const next = { base: (slots.base || []).slice(), accents: (slots.accents || []).slice(), hands: (slots.hands || []).slice() };
    if (ch.hand) {
      next.hands = next.hands.filter(h => h !== ch.hand);
      if (ch.on && next.hands.length < MAX_HANDS) next.hands = HANDS.filter(h => h === ch.hand || next.hands.includes(h));
      return next;
    }
    next[ch.where][ch.i] = ch.slot ? { src: ch.slot.src, fx: ch.slot.fx, amt: clamp(+ch.slot.amt, 0, 1) } : null;
    return next;
  }
  // How strongly a slot acts right now, 0 … 1: what its target is at (after the groups and the budget), while its row asks.
  function level(live, rowId, dst) {
    if (!live) return 0;
    const asks = Math.abs(live.held(rowId) || 0);
    return asks > 0.01 ? clamp(Math.abs(live.out[dst] || 0), 0, 1) : 0;
  }
  // The hands' glow: the colour of the effect that acts most right now – {l, r: {col, k}} or null.
  function glow(slots, live) {
    let best = null;
    for (const [w, id] of [['base', 'base'], ['accents', 'accent']]) (slots[w] || []).forEach((s, i) => {
      if (!s) return;
      const k = level(live, id + i, 'fx.' + s.fx);
      if (k > 0.05 && (!best || k > best.k)) best = { col: COLOURS[GROUP_OF[s.fx]], k };
    });
    return best ? { l: best, r: best } : null;
  }
  // The traffic light: what blocks the dance. st: the bridge's state (clutch, mode); live: the bridge's live().
  // → {green, clutch, person, marker}: each 'ok' | 'block' | 'none' (does not apply)
  function light(st, live) {
    const clutch = st && st.clutch ? 'ok' : 'block';
    const person = live && live.seen ? 'ok' : 'block';
    const marker = !live || !live.markerWanted ? 'none' : live.markers > 0 ? 'ok' : 'block';
    return { green: !!st && st.mode === 'dance' && clutch === 'ok' && person === 'ok' && marker !== 'block', clutch, person, marker };
  }
  // A name for an own copy of a set: "<shown name> 2", 3 … – one no set has.
  function copyName(shown, taken) {
    const base = String(shown).replace(/[^\p{L}\p{N}_ .+-]/gu, '').slice(0, 20).trim() || 'Set';
    for (let n = 2; n < 100; n++) { const name = `${base} ${n}`; if (!taken.includes(name)) return name; }
    return base + ' ' + Date.now() % 1000;
  }

  // ---------- the page part ----------
  // opts: {bridge, fxNames: {effect: name}, fxIcons: {effect: icon}, label(src) → name, setLabel(name) → name, figure}
  function mount(box, opts) {
    const { bridge } = opts, fxName = e => (opts.fxNames && opts.fxNames[e]) || e, icon = e => (opts.fxIcons && opts.fxIcons[e]) || '✦';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const tip = (e, text) => { e.title = text; e.setAttribute('aria-label', text); };
    box.classList.add('ds'); box.textContent = '';

    // ---- live: the figure and the traffic light ----
    const liveBox = el('div', 'ds-live'), fig = el('canvas', 'ds-fig');
    fig.setAttribute('role', 'img'); fig.setAttribute('aria-label', T('Live: your skeleton – each hand glows in the colour of the effect it sets off'));
    const lamp = el('div', 'ds-light'); lamp.setAttribute('role', 'group'); lamp.setAttribute('aria-label', T('What blocks the dance'));
    const dot = el('i', 'ds-lamp'); dot.setAttribute('aria-hidden', 'true');
    const symClutch = el('button', 'ds-sym', '🔓'); symClutch.type = 'button';
    const symPerson = el('span', 'ds-sym', '👤'), symMarker = el('span', 'ds-sym', '◉');
    symPerson.setAttribute('role', 'img'); symMarker.setAttribute('role', 'img');
    symClutch.onclick = () => { const st = bridge.state(); bridge.setClutch(!st.clutch); };
    lamp.append(dot, symClutch, symPerson, symMarker);
    liveBox.append(fig, lamp);

    // ---- the set: choose, adapt, reset, remove ----
    const head = el('div', 'ds-sethead'), sel = el('select', 'ds-set'), lock = el('span', 'ds-lock', '🔒');
    sel.setAttribute('aria-label', T('Set of slots'));
    lock.setAttribute('role', 'img'); tip(lock, T('A built-in set – it can’t be changed. “Adapt” makes your own copy.'));
    const btn = (text, title) => { const b = el('button', 'btn', text); b.type = 'button'; b.title = title; return b; };
    const adaptBtn = btn(T('✎ Adapt'), T('Make your own copy of this set to change it'));
    const resetBtn = btn(T('↺ Reset'), T('Back to the slots of the set it was made from'));
    const removeBtn = btn(T('✕ Remove'), T('Remove this set of your own'));
    head.append(sel, lock, adaptBtn, resetBtn, removeBtn);
    sel.onchange = () => bridge.setSet(sel.value);

    // ---- the slots ----
    const grid = el('div', 'ds-slots');
    const section = (title, cls) => { const s = el('section', 'ds-sec ' + cls), h = el('h3', '', title), row = el('div', 'ds-row'); s.append(h, row); grid.append(s); return row; };
    const baseRow = section(T('Base movement'), 'ds-base'), accRow = section(T('Accents'), 'ds-acc'), handRow = section(T('Hands in the picture'), 'ds-hands');
    const tiles = [];
    function slotTile(where, i) {
      const wrap = el('div', 'ds-slot'), b = el('button', 'ds-tile'), glowEl = el('i', 'ds-glow'), flash = el('i', 'ds-flash'), src = el('span', 'ds-src'), ic = el('span', 'ds-icon'), nm = el('span', 'ds-name'),
        meter = el('i', 'ds-meter'), bar = el('b'), amt = el('input');
      b.type = 'button'; glowEl.setAttribute('aria-hidden', 'true'); flash.setAttribute('aria-hidden', 'true'); meter.setAttribute('aria-hidden', 'true'); ic.setAttribute('aria-hidden', 'true');
      meter.append(bar); b.append(glowEl, flash, src, ic, nm, meter);
      amt.type = 'range'; amt.min = 0; amt.max = 1; amt.step = 0.05; amt.className = 'ds-amt';
      wrap.append(b, amt);
      const t = { where, i, wrap, b, glowEl, flash, src, ic, nm, bar, amt, id: (where === 'base' ? 'base' : 'accent') + i, drawn: '', lvl: -1 };
      b.onclick = () => choose(t);
      amt.oninput = () => { const s = cur()[where][i]; if (s) change({ where, i, slot: { ...s, amt: +amt.value } }, 200); };
      tiles.push(t); return wrap;
    }
    for (let i = 0; i < 2; i++) baseRow.append(slotTile('base', i));
    for (let i = 0; i < 4; i++) accRow.append(slotTile('accents', i));
    // #236 will put taught movements here – a place kept for them, not built yet
    const own = el('div', 'ds-slot ds-own'), ownTile = el('span', 'ds-tile ds-tile-own');
    ownTile.append(el('span', 'ds-icon', '＋'), el('span', 'ds-name', T('Own movement')));
    ownTile.setAttribute('role', 'img'); tip(ownTile, T('Your own taught movements get a place here (coming with teaching, #236)'));
    own.append(ownTile); accRow.append(own);
    const handTiles = HANDS.map(h => {
      const b = el('button', 'ds-tile ds-hand'), glowEl = el('i', 'ds-glow'), ic = el('span', 'ds-icon', HAND_ICONS[h]), nm = el('span', 'ds-name', HAND_NAMES[h]());
      b.type = 'button'; glowEl.setAttribute('aria-hidden', 'true'); ic.setAttribute('aria-hidden', 'true'); b.append(glowEl, ic, nm);
      b.onclick = () => { const s = cur(); if (b.getAttribute('aria-disabled') === 'true') { hint(b, REASONS.hands()); return; } change({ hand: h, on: !(s.hands || []).includes(h) }); };
      handRow.append(b); return { h, b, glowEl, drawn: '', lvl: -1 };
    });

    // ---- the chooser: all effects as tiles, by group ----
    const dlg = el('dialog', 'ds-chooser'), dlgHead = el('h3', 'ds-dlg-title'), srcRow = el('div', 'ds-srcs'), fxGrid = el('div', 'ds-fxgrid'), dlgBtns = el('div', 'btns');
    srcRow.setAttribute('role', 'radiogroup'); srcRow.setAttribute('aria-label', T('Movement'));
    const emptyBtn = btn(T('Empty slot'), T('Nothing in this slot')), closeBtn = btn(T('Close'), T('Close without a change (Esc)'));
    dlgBtns.append(emptyBtn, closeBtn); dlg.append(dlgHead, srcRow, fxGrid, dlgBtns); dlg.setAttribute('aria-labelledby', 'ds-dlg-title'); dlgHead.id = 'ds-dlg-title';
    closeBtn.onclick = () => dlg.close();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // a click beside the dialog
    box.append(liveBox, el('div', 'ds-right'));
    box.lastChild.append(head, grid);
    box.append(dlg);
    const toast = el('div', 'ds-toast'); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); box.append(toast);
    let toastTimer = 0;
    function hint(near, text) {
      toast.textContent = text; toast.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('on'), 2400);
      if (near) { near.classList.remove('ds-nudge'); void near.offsetWidth; near.classList.add('ds-nudge'); }
    }

    // ---- state: what Dream says, and a hand's change on its way ----
    let pending = null, timer = 0;
    const info = () => bridge.slots() || { use: 'standard', sets: BUILTIN, own: [], data: {}, from: {}, rows: [] };
    const builtin = () => !info().own.includes(info().use);
    const cur = () => pending || info().data[info().use] || { base: [null, null], accents: [null, null, null, null], hands: [] };
    function change(ch, wait = 0) {
      if (builtin()) { hint(adaptBtn, T('A built-in set can’t be changed – “Adapt” makes your own copy.')); return; }
      pending = place(cur(), ch); draw(true);
      clearTimeout(timer); timer = setTimeout(() => { timer = 0; bridge.slotsDo({ op: 'save', name: info().use, slots: pending }); setTimeout(() => { if (!timer) pending = null; }, 400); }, wait);
    }
    adaptBtn.onclick = () => {
      const i = info(), name = copyName(opts.setLabel(i.use), i.sets);
      bridge.adaptSlots(i.use, name); hint(null, T('Your own copy: “{n}” – change it as you like.', { n: name }));
    };
    resetBtn.onclick = () => { const i = info(); if (!builtin()) { pending = null; bridge.slotsDo({ op: 'reset', name: i.use }); hint(null, T('Back to the slots of “{n}”.', { n: opts.setLabel(i.from[i.use] || 'standard') })); } };
    removeBtn.onclick = () => { const i = info(); if (!builtin()) { pending = null; bridge.slotsDo({ op: 'delete', name: i.use }); hint(null, T('“{n}” removed.', { n: i.use })); } };

    function choose(t) {
      if (builtin()) { hint(adaptBtn, T('A built-in set can’t be changed – “Adapt” makes your own copy.')); return; }
      const s = cur(), slot = s[t.where][t.i], sources = t.where === 'base' ? BASE : ACCENTS;
      let src = slot ? slot.src : sources.find(x => !s[t.where].some(o => o && o.src === x)) || sources[0];
      dlgHead.textContent = t.where === 'base' ? T('Base movement {n}: which effect?', { n: t.i + 1 }) : T('Accent {n}: which effect?', { n: t.i + 1 });
      srcRow.textContent = '';
      for (const x of sources) {
        const r = el('button', 'ds-chip', opts.label(x)); r.type = 'button'; r.setAttribute('role', 'radio'); r.setAttribute('aria-checked', String(x === src));
        r.onclick = () => { src = x; [...srcRow.children].forEach(c => c.setAttribute('aria-checked', String(c === r))); };
        srcRow.append(r);
      }
      fxGrid.textContent = '';
      for (const [g, list] of Object.entries(M.GROUPS)) {
        const col = el('div', 'ds-group'); col.style.setProperty('--g', COLOURS[g]);
        col.append(el('h4', '', GROUP_NAMES[g]()));
        for (const fx of list) {
          const why = fits(s, t.where, t.i, fx), b = el('button', 'ds-fx' + (slot && slot.fx === fx ? ' on' : ''));
          b.type = 'button'; b.append(el('span', 'ds-icon', icon(fx)), el('span', 'ds-name', fxName(fx)));
          b.firstChild.setAttribute('aria-hidden', 'true');
          if (why) { b.setAttribute('aria-disabled', 'true'); tip(b, fxName(fx) + ' – ' + REASONS[why]()); }
          else b.title = GROUP_NAMES[g]() + ': ' + fxName(fx);
          b.onclick = () => {
            if (why) { hint(b, REASONS[why]()); return; }
            change({ where: t.where, i: t.i, slot: { src, fx, amt: slot ? slot.amt : 0.6 } }); dlg.close(); t.b.focus();
          };
          col.append(b);
        }
        fxGrid.append(col);
      }
      emptyBtn.onclick = () => { change({ where: t.where, i: t.i, slot: null }); dlg.close(); t.b.focus(); };
      dlg.showModal();
      const first = fxGrid.querySelector('.ds-fx.on') || fxGrid.querySelector('.ds-fx:not([aria-disabled])'); if (first) first.focus();
    }

    // ---- drawing: the tiles when the set changed, their light every frame ----
    let lastSets = '', lastGesture = null;
    function draw(force) {
      const i = info(), s = cur(), ro = builtin();
      const key = JSON.stringify([i.sets, i.use]);
      if (key !== lastSets) {
        lastSets = key; sel.textContent = '';
        for (const n of i.sets) { const o = el('option', '', T('Set: {s}', { s: opts.setLabel(n) })); o.value = n; sel.append(o); }
      }
      if (sel.value !== i.use && document.activeElement !== sel) sel.value = i.use;
      lock.hidden = !ro; resetBtn.disabled = removeBtn.disabled = ro; adaptBtn.classList.toggle('on', ro);
      box.classList.toggle('ds-ro', ro);
      for (const t of tiles) {
        const slot = s[t.where][t.i], shape = JSON.stringify([slot, ro]);
        if (shape === t.drawn && !force) continue;
        t.drawn = shape;
        const g = slot ? GROUP_OF[slot.fx] : null;
        t.wrap.style.setProperty('--g', g ? COLOURS[g] : 'var(--muted)');
        t.wrap.classList.toggle('empty', !slot);
        t.src.textContent = slot ? opts.label(slot.src) : (t.where === 'base' ? T('Base {n}', { n: t.i + 1 }) : T('Accent {n}', { n: t.i + 1 }));
        t.ic.textContent = slot ? icon(slot.fx) : '＋'; t.nm.textContent = slot ? fxName(slot.fx) : T('Empty');
        const what = slot ? T('{m} → {e} ({g})', { m: opts.label(slot.src), e: fxName(slot.fx), g: GROUP_NAMES[g]() }) : T('Empty slot');
        tip(t.b, what + ' – ' + (ro ? T('built-in: “Adapt” to change') : T('choose another effect')));
        t.amt.hidden = !slot; t.amt.disabled = ro;
        if (slot && document.activeElement !== t.amt) t.amt.value = slot.amt;
        t.amt.setAttribute('aria-label', T('Strength: {e}', { e: slot ? fxName(slot.fx) : '' }));
        t.amt.title = T('Strength – even at the lowest the effect is clearly seen');
      }
      for (const ht of handTiles) {
        const on = (s.hands || []).includes(ht.h), why = on ? null : handFits(s, ht.h), shape = JSON.stringify([on, why, ro]);
        if (shape === ht.drawn && !force) continue;
        ht.drawn = shape;
        ht.b.setAttribute('aria-pressed', String(on)); ht.b.classList.toggle('on', on);
        if (why) ht.b.setAttribute('aria-disabled', 'true'); else ht.b.removeAttribute('aria-disabled');
        ht.b.title = HAND_NAMES[ht.h]() + ': ' + HAND_WHAT[ht.h]() + (why ? ' – ' + REASONS[why]() : '') + (ro ? ' – ' + T('built-in: “Adapt” to change') : '');
      }
    }
    // every frame of the page: the light of the tiles, the accent's flash, the hands' glow, the traffic light
    let figAt = 0;
    function tick(now = performance.now()) {
      if (box.hidden) return;
      draw(false);
      let live = null; try { live = bridge.live(); } catch (e) { return; }
      const s = cur(), st = bridge.state();
      for (const t of tiles) {
        const slot = s[t.where][t.i], k = slot ? level(live, t.id, 'fx.' + slot.fx) : 0, q = Math.round(k * 50) / 50;
        if (q !== t.lvl) { t.lvl = q; t.bar.style.transform = `scaleX(${q})`; t.glowEl.style.opacity = String(Math.min(1, q * 1.6)); }
      }
      const g = live && live.gesture;
      if (g && g !== lastGesture) for (const t of tiles) {
        const slot = s[t.where][t.i];
        if (t.where === 'accents' && slot && slot.src === 'g.' + g) { t.flash.classList.remove('go'); void t.flash.offsetWidth; t.flash.classList.add('go'); }
      }
      lastGesture = g;
      for (const ht of handTiles) {
        const on = (s.hands || []).includes(ht.h), k = on && live ? clamp(Math.abs(live.out['touch.' + ht.h] || 0), 0, 1) : 0, q = Math.round(k * 20) / 20;
        if (q !== ht.lvl) { ht.lvl = q; ht.glowEl.style.opacity = String(q * 0.6); }
      }
      const L = light(st, live), set = (e, state, ok, block, none) => {
        e.dataset.state = state; const text = state === 'ok' ? ok : state === 'block' ? block : none;
        if (e.title !== text) tip(e, text);
      };
      set(symClutch, L.clutch, T('Clutch engaged – your dance steers (click or key K to release)'), T('Clutch released – your dance does nothing yet (click or key K)'));
      set(symPerson, L.person, T('Someone is detected'), T('Nobody detected – step into the camera’s view'));
      set(symMarker, L.marker, T('LED markers are seen'), T('LED markers chosen, but none is seen'), T('No LED markers chosen'));
      lamp.dataset.state = L.green ? 'go' : 'stop';
      tip(lamp, L.green ? T('Green: nothing blocks – your dance steers the dream') : T('Something blocks the dance – see the symbols'));
      if (now - figAt > 33) { figAt = now; drawFig(s, live); }
    }
    const sizes = { w: 0, h: 0 };
    new ResizeObserver(es => es.forEach(e => { sizes.w = e.contentRect.width; sizes.h = e.contentRect.height; })).observe(fig);
    function drawFig(s, live) {
      if (!sizes.w) return;
      const dpr = Math.min(2, root.devicePixelRatio || 1), w = Math.round(sizes.w * dpr), h = Math.round(sizes.h * dpr);
      if (fig.width !== w || fig.height !== h) { fig.width = w; fig.height = h; }
      const c = fig.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, sizes.w, sizes.h);
      const f = opts.frame && opts.frame();
      if (f && opts.figure) opts.figure(c, sizes.w, sizes.h, f, glow(s, live));
    }
    return { tick, draw: () => draw(true), set hidden(v) { box.hidden = v; }, get hidden() { return box.hidden; } };
  }

  const api = { mount, fits, handFits, place, level, glow, light, copyName, BASE, ACCENTS, HANDS, MAX_HANDS, COLOURS, GROUP_OF, EFFECTS, REASONS };
  if (node) module.exports = api;
  else root.DanceSlots = api;
})(typeof window !== 'undefined' ? window : globalThis);
