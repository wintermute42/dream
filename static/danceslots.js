/* Dream – the sentences of Dream Dance (#265): what the dancer's movements do, as a few fixed places read as
   sentences – the only controls of the dance (the engine's table is compiled from them, dance.py).

   Every slot is a sentence that says what will happen: "When I [throw my arms up] → [trails follow] [light|medium|
   strong]". The pill of the movement and the pill of the effect are buttons – each half of a sentence is changed with
   a click (a choice with a pictogram per movement; effects that do not fit beside the others are greyed, with the
   reason). Three lanes keep them apart: the base movement (2 slots: a continuous value sets one effect, as long as you
   move – a built-in one or, #267, a base movement of one's own, "f.<id>", taught in faderteach.js), the accents (4 slots: a gesture or a move of one's own sets off one effect for a short moment – each with its
   tolerance, how sure the detection must be, and a bar of how sure it is right now with the threshold marked) and the
   hands in the picture (paint, stir, impulses, light as switches, at most 2). A strength is one of three steps; the
   panel's "Strength" of the movement tunes them all together. Dream picks curve, ranges and smoothing (dance.py
   compiles the slots into rows of the dance table, the engine keeps every effect visible: dancemap.js).

   New sentences are made by showing: tap an effect, show a movement for a few seconds, and Dream says what it saw –
   "That was: Throw → Trails?" [Yes] [Again] [Another]; a movement Dream does not know is taught then (moveteach.js).
   What acts is seen without reading: a band of the signal's way (detection → movements → clutch → effects →
   strength) whose links glow while they let it through, sentences that glow with a level while they act, accents
   that flash when their gesture is recognised, the skeleton's hands glowing in the colour of the effect, and a
   traffic light of three symbols (clutch released, nobody detected, markers not seen – movecard.js `lamp`, the panel
   shows it too) – text only on hover.
   Sets are a row of cards: the built-in ones with a lock; a change makes a draft ("● changed", played at once), and a
   bar offers to save it – a built-in set always as a new set under a name the dancer gives – or to throw it away. An
   own set is renamed and deleted on its card; a deletion can be undone.

   `fits`, `handFits`, `place`, `level`, `glow`, `phrase`, `stepOf`, `suggestName`, `nameProblem`, `chain`,
   `strongest`, `assign` are pure (tests/js/danceslots.test.mjs). Looks: danceslots.css – only transform and opacity
   move. A global `DanceSlots`. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./dancemap.js') : root.DreamDanceMap;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const BASE = ['energy', 'open', 'turn', 'height'];
  const ACCENTS = ['g.throw', 'g.accordion', 'g.push', 'g.circle', 'g.wave'];
  const OWN = /^g\.m[0-9a-f]{8}$/;                    // a move the dancer taught (#236)
  const OWN_BASE = /^f\.f[0-9a-f]{8}$/;               // a base movement the dancer taught (#267)
  const HANDS = ['paint', 'warp', 'impulse', 'light'];
  const MAX_HANDS = 2, SLOTS = { base: 2, accents: 4 };
  const STEPS = [0, 0.5, 1];                           // light, medium, strong (dance.py STEPS)
  const TOLS = ['tight', 'normal', 'loose'];           // dance.py TOLERANCES, dance.js TOL
  const GROUP_OF = Object.fromEntries(Object.entries(M.GROUPS).flatMap(([g, list]) => list.map(e => [e, g])));
  const EFFECTS = Object.values(M.GROUPS).flat();
  const COLOURS = { symmetry: '#c78bff', space: '#5bb8ff', afterglow: '#ffc857', disturbance: '#ff7a8a', colour: '#7fe3a0' };
  const GROUP_NAMES = { symmetry: () => T('Symmetry'), space: () => T('Space'), afterglow: () => T('Afterglow'), disturbance: () => T('Disturbance'), colour: () => T('Colour') };
  const STEP_NAMES = [() => T('mild'), () => T('medium'), () => T('strong')];   // “mild”: “light” is the light in the dark
  const TOL_NAMES = { tight: () => T('tight'), normal: () => T('normal'), loose: () => T('loose') };
  const TOL_WHAT = { tight: () => T('Tight: only a clear movement counts – fewer false alarms'), normal: () => T('Normal: as Dream detects it out of the box'),
    loose: () => T('Loose: a hint of the movement counts – it comes more easily, now and then by mistake') };
  // what the dancer does, as the sentence says it ("When I … →")
  const MOVE_PHRASE = { energy: () => T('move a lot'), open: () => T('open my arms'), turn: () => T('circle my hands'), height: () => T('raise my arms'),
    'g.throw': () => T('throw my arms up'), 'g.accordion': () => T('play the accordion'), 'g.push': () => T('push forward'), 'g.circle': () => T('draw a circle'), 'g.wave': () => T('make a wave') };
  // what happens in the picture: while you move (base) and for a moment (accent)
  const FX_GROW = { kaleido: () => T('the kaleidoscope unfolds'), mandala: () => T('the mandala grows'), mirror: () => T('the picture mirrors itself'), tunnel: () => T('the tunnel opens'),
    waves: () => T('the waves grow stronger'), feedback: () => T('the feedback grows'), trails: () => T('the afterglow lasts longer'), pixel: () => T('the picture falls into pixels'),
    raster: () => T('the grid comes through'), rgb: () => T('the colours drift apart'), glitch: () => T('the picture stutters'), hue: () => T('the colours turn') };
  const FX_FLASH = { kaleido: () => T('a kaleidoscope flashes up'), mandala: () => T('a mandala blooms'), mirror: () => T('the picture jumps into a mirror'), tunnel: () => T('a tunnel tears open'),
    waves: () => T('a wave rolls through the picture'), feedback: () => T('the picture echoes'), trails: () => T('trails follow'), pixel: () => T('the picture bursts into pixels'),
    raster: () => T('a grid flashes up'), rgb: () => T('the colours jump apart'), glitch: () => T('a glitch strikes'), hue: () => T('the colours flip') };
  const HAND_PHRASE = { paint: () => T('paint trails of light'), warp: () => T('stir the picture'), impulse: () => T('send impulses'), light: () => T('light up the dark') };
  const HAND_ICONS = { paint: '🖌️', warp: '🫧', impulse: '💥', light: '💡' };
  const REASONS = {
    taken: () => T('Already in another sentence'),
    group: () => T('Same group as the other base movement – the two would cancel each other out'),
    base: () => T('Same group as a base movement – it would only replace it for a moment'),
    hands: () => T('At most 2 at once – switch another one off first'),
  };
  const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N}_ .+\-–]{0,31}$/u;   // dance.py SLOT_NAME

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
  // The index of the step a strength is nearest to (0 light, 1 medium, 2 strong).
  const stepOf = amt => STEPS.reduce((best, s, i) => (Math.abs(s - amt) < Math.abs(STEPS[best] - amt) ? i : best), 0);
  // The slots after a hand changed one: {where, i, slot: {src, fx, amt, tol} | null} or {hand, on}. A strength is one of
  // the three steps, an accent has its tolerance (normal unless it says one).
  function place(slots, ch) {
    const next = { base: (slots.base || []).slice(), accents: (slots.accents || []).slice(), hands: (slots.hands || []).slice() };
    if (ch.hand) {
      next.hands = next.hands.filter(h => h !== ch.hand);
      if (ch.on && next.hands.length < MAX_HANDS) next.hands = HANDS.filter(h => h === ch.hand || next.hands.includes(h));
      return next;
    }
    const s = ch.slot;
    next[ch.where][ch.i] = s ? { src: s.src, fx: s.fx, amt: STEPS[stepOf(clamp(+s.amt, 0, 1))], ...(ch.where === 'accents' ? { tol: TOLS.includes(s.tol) ? s.tol : 'normal' } : {}) } : null;
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
  // The words of a sentence: {lead, move, fx} – where: 'base' | 'accents'; names: {move id → the name the dancer gave it};
  // faders (#267): {base movement id → {name, to: the name of its state at 1}}.
  function phrase(where, slot, names = {}, faders = {}) {
    const own = OWN.test(slot.src) ? names[slot.src.slice(2)] || T('a move of yours') : null;
    const fd = OWN_BASE.test(slot.src) ? faders[slot.src.slice(2)] || null : null;
    const move = own ? T('dance “{n}”', { n: own }) : OWN_BASE.test(slot.src) ? (fd ? T('go towards “{n}”', { n: fd.to || fd.name }) : T('a base movement of yours'))
      : (MOVE_PHRASE[slot.src] || (() => slot.src))();
    return { lead: T('When I'), move,
      fx: ((where === 'base' ? FX_GROW : FX_FLASH)[slot.fx] || (() => slot.fx))() };
  }
  // A name for a new set made of this one: "<shown name> – mine" (the dancer changes it as they like); with a number
  // only when that one is taken already – shown in the field, never added silently.
  // taken: the names a new set may not have – compared without regard to case (dance.py does the same)
  const has = (taken, n) => taken.some(t => String(t).toLowerCase() === n.toLowerCase());
  function suggestName(shown, taken) {
    const base = T('{s} – mine', { s: String(shown).replace(/[^\p{L}\p{N}_ .+\-–]/gu, '').trim().slice(0, 24) || 'Set' });
    if (!has(taken, base)) return base;
    for (let n = 2; n < 100; n++) if (!has(taken, `${base} ${n}`)) return `${base} ${n}`;
    return base;
  }
  // What is wrong with a name for a new set: null, 'chars' (letters, digits, spaces and . + - –, at most 32) or 'taken'.
  function nameProblem(name, taken) {
    const n = String(name || '').trim().replace(/\s+/g, ' ');
    return !NAME_OK.test(n) ? 'chars' : has(taken, n) ? 'taken' : null;
  }
  // The band of the signal's way – which link lets it through right now: {detect, moves, clutch, effects, strength}.
  // st: the bridge's state (clutch, strength); live: the bridge's live(); acting: the strongest slot's level now.
  function chain(st, live, acting) {
    const detect = !!live && !!live.running && !!live.seen;
    const moves = detect && (!!live.gesture || (live.v && (live.v.energy || 0) > 0.08));
    const clutch = !!st && !!st.clutch;
    return { detect, moves, clutch, effects: acting > 0.05, strength: acting > 0.05 && !!st && st.strength > 0 };
  }
  // What the dancer showed while Dream listened: samples [{g: {gesture: how sure}, v: {feature: value}}] → {src, where,
  // sure} for the clearest movement – a gesture (an accent) when Dream was at least `sure` of one, else the continuous
  // value that changed most (a base movement) – or null when nothing was clear.
  // base: the continuous values that count (#267: the built-in ones and the base movements of one's own, "f.<id>")
  function strongest(samples, { sure = 0.45, swing = 0.25, gestures = null, base = BASE } = {}) {
    let g = null;
    for (const s of samples || []) for (const [name, c] of Object.entries((s && s.g) || {})) {
      if (gestures && !gestures.includes(name)) continue;
      if (c >= sure && (!g || c > g.sure)) g = { src: 'g.' + name, where: 'accents', sure: c };
    }
    if (g) return g;
    let b = null;
    for (const k of base) {
      const vs = (samples || []).map(s => s && s.v && s.v[k]).filter(Number.isFinite);
      if (vs.length < 2) continue;
      const d = k === 'turn' ? Math.max(...vs.map(Math.abs)) : Math.max(...vs) - Math.min(...vs);
      if (d >= swing && (!b || d > b.sure)) b = { src: k, where: 'base', sure: d };
    }
    return b;
  }
  // The slots after a new sentence "src → fx" came: into the first empty slot of its lane, or in place of the lane's
  // last one when it is full; an effect that was in another sentence leaves it (it moves to the new one). → {slots, i,
  // replaced (the slot it took the place of, or null), moved (the sentence the effect left, or null), why (null, or the
  // reason the effect does not fit there)}.
  function assign(slots, where, src, fx) {
    let from = null;
    for (const w of ['base', 'accents']) (slots[w] || []).forEach((s, j) => { if (s && s.fx === fx && !(w === where && s.src === src)) from = { where: w, i: j, slot: s }; });
    const base = from ? place(slots, { where: from.where, i: from.i, slot: null }) : slots;
    const lane = base[where] || [], same = lane.findIndex(s => s && s.src === src);
    let i = same >= 0 ? same : lane.findIndex(s => !s);
    if (i < 0) i = SLOTS[where] - 1;
    const why = fits(base, where, i, fx), was = lane[i] || null;
    if (why) return { slots, i, replaced: null, moved: null, why };
    return { slots: place(base, { where, i, slot: { src, fx, amt: was ? was.amt : 0.5, tol: was && was.tol } }), i, replaced: was, moved: from, why: null };
  }

  // ---------- pictograms: what the dancer does, as a small figure ----------
  // arms: [left hand, right hand] from the shoulder (-6, -10) / (6, -10); more: a sign of the movement
  const POSE = { energy: [[-16, -2], [16, -20], 'M-20 -22 l-5 -4 M20 -24 l5 -4 M-23 6 h-6 M23 6 h6'], open: [[-22, -12], [22, -12], 'M-27 -16 l-4 4 l4 4 M27 -16 l4 4 l-4 4'],
    turn: [[-20, -14], [20, -14], 'M-28 -20 a8 8 0 1 0 8 -2 M-22 -24 l2 2 l-3 2 M28 -20 a8 8 0 1 1 -8 -2 M22 -24 l-2 2 l3 2'],   // #266: the hands circling
    height: [[-12, -28], [12, -28], 'M0 -34 v-4'],
    'g.throw': [[-8, 4], [12, -30], 'M14 -38 v-6 M10 -40 l4 -4 l4 4'], 'g.accordion': [[-12, -8], [12, -8], 'M-20 -8 h-6 M20 -8 h6 M-24 -11 l-3 3 l3 3 M24 -11 l3 3 l-3 3'],
    'g.push': [[18, -10], [20, -6], 'M26 -14 h7 M30 -18 l4 4 l-4 4'], 'g.circle': [[-10, 4], [16, -14], ''], 'g.wave': [[-20, -18], [20, 0], 'M-28 -26 q4 -6 8 0 t8 0'],
    hands: [[-16, -14], [16, -14], ''], own: [[-14, -14], [16, -4], 'M18 -26 l2 4 l4 1 l-3 3 l1 4 l-4 -2 l-4 2 l1 -4 l-3 -3 l4 -1 z'],
    // #267: a base movement of one's own – the placeholder: a figure beside a fader with its knob
    fader: [[-14, -2], [14, -2], 'M27 -34 V30 M21 -4 h12'] };
  function pictogram(src) {
    const k = OWN.test(src) ? 'own' : OWN_BASE.test(src) ? 'fader' : src in POSE ? src : 'hands', [l, r, more] = POSE[k];
    const circle = k === 'g.circle' ? '<circle cx="18" cy="-20" r="8"/>' : k === 'hands' ? '<circle cx="-16" cy="-14" r="3.5"/><circle cx="16" cy="-14" r="3.5"/>'
      : k === 'fader' ? '<circle cx="27" cy="-4" r="4"/>' : '';
    return `<svg class="ds-pict" viewBox="-36 -46 72 86" aria-hidden="true" focusable="false"><circle cx="0" cy="-24" r="7"/><path d="M0 -17 V12 M-6 -10 L${l[0]} ${l[1]} M6 -10 L${r[0]} ${r[1]} M-6 -10 H6 M0 12 L-9 34 M0 12 L9 34"/>${more ? `<path d="${more}"/>` : ''}${circle}</svg>`;
  }

  // ---------- the page part ----------
  // opts: {bridge, fxNames, fxIcons, label(src) → short name, setLabel(name) → shown name, frame, figure,
  //        names() → {move id: name} (#236), learn({src?, fx?, quick?}) – start teaching a movement (moveteach.js),
  //        measure() – start measuring the dancer (#266, dancecal.js),
  //        faders() → {base movement id: {name, to}} (#267), learnBase({fx?, i?}) – teach a base movement (faderteach.js)}
  function mount(box, opts) {
    const { bridge } = opts, fxName = e => (opts.fxNames && opts.fxNames[e]) || e, icon = e => (opts.fxIcons && opts.fxIcons[e]) || '✦';
    const names = () => (opts.names ? opts.names() : {});
    const faders = () => (opts.faders ? opts.faders() : {});
    const fadersSrc = () => Object.keys(faders()).map(id => 'f.' + id);
    const shortName = src => (OWN.test(src) ? names()[src.slice(2)] || src : OWN_BASE.test(src) ? (faders()[src.slice(2)] || {}).name || src : opts.label(src));
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const tip = (e, text) => { e.title = text; e.setAttribute('aria-label', text); };
    const btn = (text, title, cls = '') => { const b = el('button', 'btn ' + cls, text); b.type = 'button'; if (title) b.title = title; return b; };
    box.classList.add('ds'); box.textContent = '';

    // ---- the signal's way and the traffic light ----
    const top = el('div', 'ds-top'), band = el('ol', 'ds-chain');
    band.setAttribute('aria-label', T('The way of the signal: each link glows while it lets your movement through'));
    const LINKS = [['detect', T('Detection'), T('What the camera sees of you')], ['moves', T('Movements'), T('Base movement, accents, hands')],
      ['clutch', T('Clutch'), T('Released, nothing gets through')], ['effects', T('Effects'), T('One per sentence, at most 3 groups at once')],
      ['strength', T('Strength'), T('“Strength” in the panel’s Movement card: everything together')]];
    const link = {};
    for (const [k, name, what] of LINKS) {
      const li = el('li', 'ds-link'), b = el('b', '', name), s = el('span', '', what);
      li.dataset.k = k; li.append(b, s); band.append(li); link[k] = { li, s };
    }
    const MC = node ? require('./movecard.js') : root.MoveCard;    // the traffic light is the movement card's (the panel shows it too)
    const lampBox = el('div'), lamp = MC.lamp(lampBox, { clutch: () => { const st = bridge.state(); bridge.setClutch(!st.clutch); } });
    top.append(band, lampBox);

    // ---- the sets: a row of cards, the bar of a changed one ----
    const setBar = el('div', 'ds-sets'); setBar.setAttribute('role', 'group'); setBar.setAttribute('aria-label', T('Sets'));
    const dirtyBar = el('div', 'ds-dirty'); dirtyBar.hidden = true; dirtyBar.setAttribute('role', 'region'); dirtyBar.setAttribute('aria-label', T('Unsaved changes'));
    const dirtyText = el('span', 'ds-dirty-text'), nameLab = el('label', 'ds-namefield'), nameIn = el('input'), nameWhy = el('span', 'ds-namewhy');
    nameIn.type = 'text'; nameIn.maxLength = 32; nameIn.autocomplete = 'off'; nameIn.id = 'ds-newname';
    nameLab.htmlFor = 'ds-newname'; nameLab.append(el('span', '', T('Name of the new set')), nameIn);
    nameWhy.setAttribute('role', 'status'); nameWhy.setAttribute('aria-live', 'polite');
    const saveAsBtn = btn(T('Save as a new set'), T('Keep the changes as a new set of your own – the built-in sets stay as they are'), 'on');
    const saveBtn = btn(T('Save'), T('Keep the changes in this set'), 'on'), discardBtn = btn(T('Discard'), T('Throw the changes away: the set as it was kept'));
    dirtyBar.append(dirtyText, nameLab, saveAsBtn, saveBtn, discardBtn, nameWhy);

    // ---- making a sentence by showing it ----
    const actions = el('div', 'ds-actions');
    const showBtn = btn(T('＋ New sentence: show it'), T('Tap what should happen, then show the movement – Dream says what it saw'), 'ds-show');
    const learnBtn = btn(T('🎓 Teach a movement …'), T('Teach Dream a movement (a built-in one more exactly, or one of your own): show it five times, dance freely, confirm each hit'), 'ds-learn');
    // #266: measuring the dancer's calm and wild per base movement (dancecal.js)
    const measureBtn = btn(T('📏 Measure me …'), T('Measure your calm and your wild for each base movement (about 45 seconds, key M)'), 'ds-measure');
    measureBtn.hidden = !opts.measure; measureBtn.onclick = () => opts.measure && opts.measure();
    actions.append(showBtn, learnBtn, measureBtn);
    const wiz = el('div', 'ds-wiz'); wiz.hidden = true; wiz.setAttribute('role', 'region'); wiz.setAttribute('aria-label', T('New sentence by showing'));

    // ---- the lanes: the figure beside them ----
    const body = el('div', 'ds-body'), liveBox = el('div', 'ds-live'), fig = el('canvas', 'ds-fig');
    fig.setAttribute('role', 'img'); fig.setAttribute('aria-label', T('Live: your skeleton – each hand glows in the colour of the effect that acts'));
    const figNote = el('div', 'ds-fignote', T('Your skeleton appears here as soon as the camera sees you.'));
    liveBox.append(fig, figNote);
    const lanes = el('div', 'ds-lanes');
    const lane = (cls, title, sub) => {
      const s = el('section', 'ds-lane ' + cls), h = el('h3'), list = el('div', 'ds-rows'), more = el('div', 'ds-more');
      h.append(el('span', '', title), el('small', '', sub)); s.append(h, list, more); lanes.append(s); return { s, list, more };
    };
    const L = { base: lane('ds-base', T('Base movement'), T('as long as you move')), accents: lane('ds-acc', T('Accents'), T('a short moment')),
      hands: lane('ds-hands', T('Hands in the picture'), T('where your hands are')) };
    body.append(liveBox, lanes);
    // the choice of one half of a sentence: movements or effects
    const dlg = el('dialog', 'ds-choice'), dlgHead = el('h3', 'ds-dlg-title'), dlgList = el('div', 'ds-choices'), dlgBtns = el('div', 'btns');
    dlgHead.id = 'ds-dlg-title'; dlg.setAttribute('aria-labelledby', 'ds-dlg-title');
    const closeBtn = btn(T('Close'), T('Close without a change (Esc)'));
    dlgBtns.append(closeBtn); dlg.append(dlgHead, dlgList, dlgBtns);
    closeBtn.onclick = () => dlg.close();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // a click beside it
    const toast = el('div', 'ds-toast'), toastText = el('span'), toastBtn = btn(T('Undo'), '');
    toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toastBtn.hidden = true; toast.append(toastText, toastBtn);
    box.append(top, setBar, dirtyBar, actions, wiz, body, dlg, toast);
    let toastTimer = 0;
    function hint(text, undo = null, near = null) {
      toastText.textContent = text; toastBtn.hidden = !undo; toastBtn.onclick = undo ? () => { undo(); toast.classList.remove('on'); } : null;
      toast.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('on'), undo ? 8000 : 3200);
      if (near) { near.classList.remove('ds-nudge'); void near.offsetWidth; near.classList.add('ds-nudge'); }
    }

    // ---- state: what Dream says, and a hand's change on its way ----
    let pending = null, timer = 0, renaming = null, popped = '';
    const info = () => bridge.slots() || { use: 'standard', sets: ['standard', 'waves', 'fire'], own: [], data: {}, drafts: {}, from: {}, rows: [], tol: {} };
    const builtin = n => !info().own.includes(n);
    // the names a new name may not be: every set's, and what the built-in ones are called here (but: a set's own)
    const takenNames = (self = null) => info().sets.filter(n => n !== self).flatMap(n => [n, opts.setLabel(n)]);
    const drafts = () => info().drafts || {};
    const empty = { base: [null, null], accents: [null, null, null, null], hands: [] };
    const cur = () => pending || drafts()[info().use] || info().data[info().use] || empty;
    const send = op => bridge.slotsDo(op);
    function change(next, wait = 120) {
      pending = next; draw(true);
      clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; send({ op: 'draft', name: info().use, slots: pending }); setTimeout(() => { if (!timer) pending = null; }, 400); }, wait);
    }

    // ---- the sets ----
    function drawSets() {
      const i = info(), d = drafts(), key = JSON.stringify([i.sets, i.use, Object.keys(d), renaming, i.own]);
      if (key === setBar.dataset.key) return;
      const had = setBar.contains(document.activeElement) ? document.activeElement.dataset.set + '|' + document.activeElement.dataset.part : '';
      setBar.dataset.key = key; setBar.textContent = '';
      for (const n of i.sets) {
        const card = el('div', 'ds-set' + (n === i.use ? ' on' : '') + (popped === n ? ' ds-pop' : '')), own = !builtin(n);
        if (renaming === n) {
          const inp = el('input', 'ds-rename'); inp.type = 'text'; inp.maxLength = 32; inp.value = n; inp.dataset.set = n; inp.dataset.part = 'rename';
          inp.setAttribute('aria-label', T('New name for “{n}”', { n }));
          inp.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.stopPropagation(); renaming = null; drawSets(); return; }
            if (e.key !== 'Enter') return;
            const v = inp.value.trim().replace(/\s+/g, ' ');
            if (v === n) { renaming = null; drawSets(); return; }
            const why = nameProblem(v, takenNames(n));
            if (why) { hint(why === 'taken' ? T('“{n}” exists already – choose another name.', { n: v }) : T('A name: letters, digits, spaces and . + - –, at most 32 characters.'), null, inp); return; }
            send({ op: 'rename', name: n, as: v }); renaming = null; popped = v; hint(T('Renamed: “{n}”.', { n: v }));
          });
          card.append(inp); setBar.append(card); setTimeout(() => inp.focus(), 0);
          continue;
        }
        const pick = el('button', 'ds-setbtn'); pick.type = 'button'; pick.dataset.set = n; pick.dataset.part = 'pick';
        pick.setAttribute('aria-pressed', String(n === i.use));
        if (!own) { const lk = el('span', 'ds-lock', '🔒'); lk.setAttribute('aria-hidden', 'true'); pick.append(lk); }
        pick.append(el('span', 'ds-setname', opts.setLabel(n)));
        if (d[n]) { const dt = el('span', 'ds-changed', '●'); dt.setAttribute('aria-hidden', 'true'); pick.append(dt); }
        tip(pick, (own ? T('Your set “{n}”', { n: opts.setLabel(n) }) : T('Built-in set “{n}” – stays as it is; a change is saved as a new set', { n: opts.setLabel(n) }))
          + (d[n] ? ' – ' + T('changed, not saved') : '') + (n === i.use ? ' – ' + T('in use') : ''));
        pick.onclick = () => choose(n);
        card.append(pick);
        if (own && n === i.use) {
          const ren = btn('✎', '', 'ds-mini'), del = btn('🗑', '', 'ds-mini');
          ren.dataset.set = del.dataset.set = n; ren.dataset.part = 'ren'; del.dataset.part = 'del';
          tip(ren, T('Rename “{n}”', { n })); tip(del, T('Delete “{n}” (can be undone)', { n }));
          ren.onclick = () => { renaming = n; drawSets(); };
          del.onclick = () => remove(n);
          card.append(ren, del);
        }
        setBar.append(card);
      }
      popped = '';
      if (had) { const [n, part] = had.split('|'), again = setBar.querySelector(`[data-set="${CSS.escape(n)}"][data-part="${part}"]`) || setBar.querySelector(`[data-set="${CSS.escape(info().use)}"][data-part="pick"]`); if (again) again.focus(); }
    }
    function choose(n) {
      const i = info();
      if (n === i.use) return;
      if (drafts()[i.use]) hint(T('Your changes to “{n}” stay marked (●) – come back to save or discard them.', { n: opts.setLabel(i.use) }));
      pending = null; bridge.setSet(n);
    }
    function remove(n) {
      const i = info(), kept = i.data[n], from = i.from[n] || 'standard';
      send({ op: 'delete', name: n });
      hint(T('“{n}” deleted.', { n }), () => { send({ op: 'save_as', name: n, slots: kept, from }); popped = n; });
    }
    function drawDirty() {
      const i = info(), d = !!(pending || drafts()[i.use]), own = !builtin(i.use);
      if (dirtyBar.hidden === !d && dirtyBar.dataset.use === i.use + own) return;
      dirtyBar.hidden = !d; dirtyBar.dataset.use = i.use + own;
      if (!d) return;
      dirtyText.textContent = own ? T('“{n}” ● changed.', { n: opts.setLabel(i.use) }) : T('“{n}” ● changed. Built-in sets stay as they are – save your changes as a new set.', { n: opts.setLabel(i.use) });
      nameLab.hidden = saveAsBtn.hidden = own; saveBtn.hidden = !own; nameWhy.textContent = '';
      if (!own && document.activeElement !== nameIn) nameIn.value = suggestName(opts.setLabel(i.use), takenNames());
    }
    function saveAs() {
      const i = info(), name = nameIn.value.trim().replace(/\s+/g, ' '), why = nameProblem(name, takenNames());
      if (why) { nameWhy.textContent = why === 'taken' ? T('“{n}” exists already – choose another name.', { n: name }) : T('A name: letters, digits, spaces and . + - –, at most 32 characters.'); nameIn.focus(); return; }
      clearTimeout(timer); timer = 0;
      send({ op: 'save_as', name, slots: cur(), from: i.use }); pending = null; popped = name;
      hint(T('Saved as “{n}” – your new set is in use.', { n: name }));
    }
    saveAsBtn.onclick = saveAs;
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') saveAs(); });
    saveBtn.onclick = () => { clearTimeout(timer); timer = 0; const i = info(); if (pending) send({ op: 'draft', name: i.use, slots: pending }); send({ op: 'save', name: i.use }); pending = null; popped = i.use; hint(T('“{n}” saved.', { n: opts.setLabel(i.use) })); };
    discardBtn.onclick = () => { clearTimeout(timer); timer = 0; const i = info(); send({ op: 'discard', name: i.use }); pending = null; hint(T('Changes to “{n}” discarded.', { n: opts.setLabel(i.use) })); draw(true); };

    // ---- the sentences ----
    const rows = [];                                   // {where, i, row, meter, conf, mark, flash, id, dst, src}
    let handRow = null, drawnKey = '', focusAfter = null;   // focusAfter: [where, i, pill class] – where focus goes after a choice
    // a pill is named by the words it shows (they are half of the sentence); what a click does is its description
    function pill(cls, text, title, onclick) { const b = el('button', 'ds-pill ' + cls, text); b.type = 'button'; b.title = title; b.onclick = onclick; return b; }
    function steps(group, names, current, label, onpick) {
      const g = el('span', 'ds-steps ' + group); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
      names.forEach((n, k) => {
        const b = el('button', '', n.text); b.type = 'button'; b.setAttribute('aria-pressed', String(k === current)); if (n.title) b.title = n.title;
        b.onclick = () => onpick(k); g.append(b);
      });
      return g;
    }
    function sentence(where, i, s) {
      const row = el('div', 'ds-row ds-' + where), ph = phrase(where, s, names(), faders()), meter = el('span', 'ds-meter'), bar = el('i');
      meter.setAttribute('aria-hidden', 'true'); meter.append(bar);
      const pict = el('span', 'ds-pictbox'); pict.innerHTML = pictogram(s.src);
      const flash = el('i', 'ds-flash'); flash.setAttribute('aria-hidden', 'true');
      const what = el('span', 'ds-what');
      const mv = pill('ds-mv', ph.move, T('Movement: {m} – choose another', { m: shortName(s.src) }), () => chooseMove(where, i));
      const fx = pill('ds-fxp', ph.fx, T('Effect: {e} ({g}) – choose another', { e: fxName(s.fx), g: GROUP_NAMES[GROUP_OF[s.fx]]() }), () => chooseFx(where, i));
      fx.style.setProperty('--g', COLOURS[GROUP_OF[s.fx]]);
      what.append(el('span', 'ds-w', ph.lead), mv, el('span', 'ds-w', '→'), fx);
      const st = steps('ds-amt', STEP_NAMES.map(f => ({ text: f() })), stepOf(s.amt), T('Strength'), k => change(place(cur(), { where, i, slot: { ...cur()[where][i], amt: STEPS[k] } })));
      const x = btn('✕', '', 'ds-x'); tip(x, T('Remove this sentence'));
      x.onclick = () => { change(place(cur(), { where, i, slot: null })); hint(T('Sentence removed.'), () => change(place(cur(), { where, i, slot: s }))); };
      row.append(flash, pict, what, st, meter, x);
      const r = { where, i, row, bar, flash, id: (where === 'base' ? 'base' : 'accent') + i, dst: 'fx.' + s.fx, src: s.src, lvl: -1 };
      if (where === 'accents') {
        const tolBox = el('span', 'ds-tol'), conf = el('span', 'ds-conf'), cf = el('i'), mark = el('b');
        conf.setAttribute('aria-hidden', 'true'); conf.append(cf, mark);
        tolBox.append(el('span', 'ds-w', T('detect')), steps('ds-tols', TOLS.map(t => ({ text: TOL_NAMES[t](), title: TOL_WHAT[t]() })), TOLS.indexOf(s.tol || 'normal'), T('Tolerance'),
          k => change(place(cur(), { where, i, slot: { ...cur()[where][i], tol: TOLS[k] } }))), conf);
        tip(conf, T('How sure Dream is of the movement right now – above the mark it counts'));
        conf.removeAttribute('aria-label'); row.append(tolBox); Object.assign(r, { cf, mark, conf: -1, thr: -1 });
      }
      rows.push(r); return row;
    }
    function drawLanes() {
      const s = cur(), key = JSON.stringify([s, names(), faders()]);
      if (key === drawnKey) return;
      const had = lanes.contains(document.activeElement) ? [document.activeElement.closest('.ds-row, .ds-more, .ds-handrow'), [...(document.activeElement.closest('.ds-row, .ds-more, .ds-handrow') || box).querySelectorAll('button')].indexOf(document.activeElement)] : null;
      const hadIdx = had && had[0] ? [had[0].dataset.where, had[0].dataset.i, had[1]] : null;
      drawnKey = key; rows.length = 0;
      for (const where of ['base', 'accents']) {
        const { list, more } = L[where]; list.textContent = ''; more.textContent = '';
        s[where].forEach((slot, i) => { if (slot) { const r = sentence(where, i, slot); r.dataset.where = where; r.dataset.i = i; list.append(r); } });
        if (!s[where].some(Boolean)) list.append(el('div', 'ds-none', where === 'base' ? T('No base movement – the picture rests while you move.') : T('No accent – your gestures set nothing off.')));
        more.dataset.where = where; more.dataset.i = 'more';
        const free = s[where].findIndex(x => !x);
        const add = btn(T('＋ Sentence'), free < 0 ? T('All {n} sentences of this lane are there – remove one first', { n: SLOTS[where] }) : T('Add a sentence – then choose its movement and effect'), 'ds-add');
        add.disabled = free < 0; add.onclick = () => addSentence(where);
        more.append(add);
        if (where === 'accents') {
          const own = btn(T('＋ A move of your own …'), T('Teach Dream a move of your own: it becomes an accent'), 'ds-add');
          own.onclick = () => opts.learn && opts.learn({ fresh: true });
          more.append(own);
        } else if (opts.learnBase) {
          const own = btn(T('＋ A base movement of your own …'), T('Teach Dream a base movement of your own: show two or more states of your body, it becomes a fader'), 'ds-add');
          own.onclick = () => opts.learnBase({});
          more.append(own);
        }
      }
      // the hands: one sentence of switches
      const { list } = L.hands; list.textContent = '';
      const row = el('div', 'ds-row ds-handrow'), pict = el('span', 'ds-pictbox'), meter = el('span', 'ds-meter'), bar = el('i');
      row.dataset.where = 'hands'; row.dataset.i = 0;
      pict.innerHTML = pictogram('hands'); meter.setAttribute('aria-hidden', 'true'); meter.append(bar);
      const what = el('span', 'ds-what'); what.append(el('span', 'ds-w', T('My hands')));
      for (const h of HANDS) {
        const on = s.hands.includes(h), why = on ? null : handFits(s, h), b = el('button', 'ds-pill ds-hand' + (on ? ' on' : ''));
        b.type = 'button'; b.setAttribute('aria-pressed', String(on));
        const ic = el('span', 'ds-hic', HAND_ICONS[h]); ic.setAttribute('aria-hidden', 'true'); b.append(ic, el('span', '', HAND_PHRASE[h]()));
        if (why) b.setAttribute('aria-disabled', 'true');
        b.title = (on ? T('On – click to switch it off') : why ? REASONS[why]() : T('Off – click to switch it on'));
        b.onclick = () => { if (why) { hint(REASONS[why](), null, b); return; } change(place(cur(), { hand: h, on: !on })); };
        what.append(b);
      }
      row.append(pict, what, meter); list.append(row);
      handRow = { row, bar, lvl: -1 };
      if (hadIdx) {
        const scope = lanes.querySelector(`[data-where="${hadIdx[0]}"][data-i="${hadIdx[1]}"]`) || L[hadIdx[0] === 'hands' ? 'hands' : hadIdx[0] || 'base'].more;
        const bs = scope ? [...scope.querySelectorAll('button')] : [];
        (bs[hadIdx[2]] || bs[0] || showBtn).focus();
      }
    }
    function refocus() {
      const [where, i, cls] = focusAfter || [], b = lanes.querySelector(`.ds-row[data-where="${where}"][data-i="${i}"] .${cls}`);
      focusAfter = null; if (b) b.focus();
    }
    dlg.addEventListener('close', () => { if (focusAfter) refocus(); });   // back to the pill it came from (a change keeps it there)
    function addSentence(where) {
      const s = cur(), i = s[where].findIndex(x => !x);
      if (i < 0) return;
      const used = new Set(s[where].filter(Boolean).map(x => x.src)), src = (where === 'base' ? BASE : ACCENTS).find(x => !used.has(x)) || (where === 'base' ? BASE[0] : ACCENTS[0]);
      const fx = EFFECTS.find(e => !fits(s, where, i, e));
      if (!fx) { hint(T('No effect fits beside the others any more – change a sentence first.')); return; }
      change(place(s, { where, i, slot: { src, fx, amt: 0.5 } }));
      setTimeout(() => { const r = lanes.querySelector(`.ds-row[data-where="${where}"][data-i="${i}"] .ds-mv`); if (r) { r.focus(); r.closest('.ds-row').classList.add('ds-new'); } }, 0);
    }
    // the choice of a movement for a sentence: each with its pictogram; for accents the moves of one's own too
    function chooseMove(where, i) {
      const s = cur(), slot = s[where][i];
      focusAfter = [where, i, 'ds-mv'];
      dlgHead.textContent = where === 'base' ? T('When I … – which movement? (as long as you move)') : T('When I … – which movement? (a short moment)');
      dlgList.textContent = ''; dlgList.className = 'ds-choices ds-moves';
      const own = Object.keys(names()).map(id => 'g.' + id);
      for (const src of where === 'base' ? [...BASE, ...fadersSrc()] : [...ACCENTS, ...own]) {
        const taken = s[where].some((o, j) => o && j !== i && o.src === src), b = el('button', 'ds-opt' + (slot && slot.src === src ? ' on' : ''));
        b.type = 'button'; const p = el('span', 'ds-pictbox'); p.innerHTML = pictogram(src);
        b.append(p, el('span', 'ds-optname', shortName(src)), el('span', 'ds-optsub', phrase(where, { src, fx: slot.fx }, names(), faders()).move));
        if (taken) { b.setAttribute('aria-disabled', 'true'); tip(b, shortName(src) + ' – ' + T('Already in another sentence')); }
        b.onclick = () => { if (taken) { hint(T('Already in another sentence'), null, b); return; } dlg.close(); change(place(cur(), { where, i, slot: { ...slot, src } })); };
        dlgList.append(b);
      }
      if (where === 'accents' && opts.learn) {
        const b = el('button', 'ds-opt ds-optnew'); b.type = 'button';
        b.append(el('span', 'ds-optname', T('＋ A move of your own …')), el('span', 'ds-optsub', T('show it, Dream learns it')));
        b.onclick = () => { dlg.close(); opts.learn({ fresh: true, fx: slot.fx, i }); };
        dlgList.append(b);
      }
      if (where === 'base' && opts.learnBase) {
        const b = el('button', 'ds-opt ds-optnew'); b.type = 'button';
        b.append(el('span', 'ds-optname', T('＋ A base movement of your own …')), el('span', 'ds-optsub', T('show its states, Dream learns the fader')));
        b.onclick = () => { dlg.close(); opts.learnBase({ fx: slot.fx, i }); };
        dlgList.append(b);
      }
      dlg.showModal();
      (dlgList.querySelector('.ds-opt.on') || dlgList.querySelector('.ds-opt')).focus();
    }
    // the choice of an effect: by group; what does not fit beside the others is greyed, with the reason
    function chooseFx(where, i) {
      const s = cur(), slot = s[where][i];
      focusAfter = [where, i, 'ds-fxp'];
      dlgHead.textContent = T('When I {m} → what happens?', { m: phrase(where, slot, names()).move });
      dlgList.textContent = ''; dlgList.className = 'ds-choices ds-fxs';
      for (const [g, list] of Object.entries(M.GROUPS)) {
        const col = el('div', 'ds-group'); col.style.setProperty('--g', COLOURS[g]); col.append(el('h4', '', GROUP_NAMES[g]()));
        for (const fx of list) {
          const why = fits(s, where, i, fx), b = el('button', 'ds-opt ds-fx' + (slot.fx === fx ? ' on' : ''));
          b.type = 'button'; const ic = el('span', 'ds-icon', icon(fx)); ic.setAttribute('aria-hidden', 'true');
          b.append(ic, el('span', 'ds-optname', fxName(fx)), el('span', 'ds-optsub', ((where === 'base' ? FX_GROW : FX_FLASH)[fx])()));
          if (why) { b.setAttribute('aria-disabled', 'true'); tip(b, fxName(fx) + ' – ' + REASONS[why]()); }
          b.onclick = () => { if (why) { hint(REASONS[why](), null, b); return; } dlg.close(); change(place(cur(), { where, i, slot: { ...slot, fx } })); };
          col.append(b);
        }
        dlgList.append(col);
      }
      dlg.showModal();
      (dlgList.querySelector('.ds-opt.on') || dlgList.querySelector('.ds-opt:not([aria-disabled])')).focus();
    }

    // ---- a new sentence by showing it: the effect, the movement shown, "that was …?" ----
    const LISTEN = 4;                                  // seconds Dream watches
    let flow = null;                                   // {step, fx, at, samples, got, raf}
    function wizShow(step) {
      wiz.hidden = false; wiz.textContent = ''; showBtn.setAttribute('aria-expanded', 'true');
      const steps3 = el('ol', 'ds-steps3');
      const box3 = [T('1 · What should happen?'), T('2 · Show it'), T('3 · Is that right?')].map((t, k) => { const li = el('li', 'ds-step' + (k === step ? ' cur' : k < step ? ' done' : '')); li.append(el('span', 'ds-stepn', t)); steps3.append(li); return li; });
      const close = btn('✕', '', 'ds-x ds-wizclose'); tip(close, T('Close (Esc)')); close.onclick = endFlow;
      wiz.append(steps3, close);
      return box3;
    }
    function startFlow() {
      flow = { step: 0, fx: null, samples: [], got: null };
      const [b1] = wizShow(0), list = el('div', 'ds-fxchips');
      b1.append(el('b', 'ds-big', T('Tap an effect')));
      const s = cur();
      for (const fx of EFFECTS) {
        const b = el('button', 'ds-pill ds-fxp'); b.type = 'button'; b.style.setProperty('--g', COLOURS[GROUP_OF[fx]]);
        const ic = el('span', 'ds-hic', icon(fx)); ic.setAttribute('aria-hidden', 'true'); b.append(ic, el('span', '', fxName(fx)));
        const inUse = ['base', 'accents'].some(w => s[w].some(x => x && x.fx === fx));
        if (inUse) b.title = T('{e} is in a sentence already – the movement you show takes it over', { e: fxName(fx) });
        b.onclick = () => { flow.fx = fx; listen(); };
        list.append(b);
      }
      b1.append(list); list.firstChild.focus();
    }
    function listen() {
      flow.step = 1; flow.samples = []; flow.at = performance.now();
      const [b1, b2] = wizShow(1);
      b1.append(el('b', 'ds-big', fxName(flow.fx)));
      const big = el('b', 'ds-big', T('Move now …')), bar = el('span', 'ds-meter ds-listen'), fill = el('i');
      bar.setAttribute('aria-hidden', 'true'); bar.append(fill);
      b2.append(big, el('span', 'hint', T('Dream watches for {n} seconds and takes what was clearest.', { n: LISTEN })), bar);
      flow.fill = fill;
      (wiz.querySelector('.ds-wizclose')).focus();
    }
    function heard() {
      const all = Object.keys(names()), got = strongest(flow.samples, { gestures: [...ACCENTS.map(g => g.slice(2)), ...all], base: [...BASE, ...fadersSrc()] });
      flow.step = 2; flow.got = got;
      const [b1, b2, b3] = wizShow(2);
      b1.append(el('b', 'ds-big', fxName(flow.fx))); b2.append(el('b', 'ds-big', T('✓ seen')));
      const btns = el('div', 'btns'), again = btn(T('Again'), T('Show it once more')), other = btn(T('Another'), T('Choose the movement yourself'));
      again.onclick = listen; other.onclick = () => pickOther(b3);
      if (got) {
        const r = assign(cur(), got.where, got.src, flow.fx);
        b3.append(el('b', 'ds-big', T('That was: {m} → {e}?', { m: shortName(got.src), e: fxName(flow.fx) })));
        b3.append(el('span', 'hint', r.why ? REASONS[r.why]() : [got.where === 'base' ? T('A base movement: it acts as long as you move.') : T('An accent: it acts for a short moment.'),
          r.replaced ? T('It takes the place of “{m} → {e}”.', { m: shortName(r.replaced.src), e: fxName(r.replaced.fx) }) : '',
          r.moved && r.moved.slot.src !== got.src ? T('{e} leaves “{m} → {e}”.', { m: shortName(r.moved.slot.src), e: fxName(flow.fx) }) : ''].filter(Boolean).join(' ')));
        const yes = btn(T('Yes, like that'), '', 'on'); yes.disabled = !!r.why;
        yes.onclick = () => { change(r.slots); hint(T('New sentence: {m} → {e}. Engage the clutch and try it.', { m: shortName(got.src), e: fxName(flow.fx) })); endFlow(); };
        btns.append(yes, again, other); b3.append(btns); yes.disabled ? again.focus() : yes.focus();
      } else {
        b3.append(el('b', 'ds-big', T('Nothing clear – a new movement?')), el('span', 'hint', T('Dream knows none of its movements in it. Show it again, choose one yourself – or teach Dream this one (show it three times).')));
        const teach = btn(T('Teach it (3×)'), T('Show the movement three times in a row – it becomes a move of your own'), 'on');
        teach.onclick = () => { const fx = flow.fx; endFlow(); if (opts.learn) opts.learn({ fresh: true, quick: true, fx }); };
        btns.append(teach, again, other); b3.append(btns); teach.focus();
      }
    }
    function pickOther(b3) {
      b3.textContent = ''; b3.append(el('span', 'ds-stepn', T('3 · Is that right?')), el('b', 'ds-big', T('Which movement?')));
      const list = el('div', 'ds-choices ds-moves ds-inline'), own = Object.keys(names()).map(id => 'g.' + id);
      for (const src of [...BASE, ...fadersSrc(), ...ACCENTS, ...own]) {
        const where = BASE.includes(src) || OWN_BASE.test(src) ? 'base' : 'accents', r = assign(cur(), where, src, flow.fx), b = el('button', 'ds-opt');
        b.type = 'button'; const p = el('span', 'ds-pictbox'); p.innerHTML = pictogram(src); b.append(p, el('span', 'ds-optname', shortName(src)));
        if (r.why) { b.setAttribute('aria-disabled', 'true'); tip(b, shortName(src) + ' – ' + REASONS[r.why]()); }
        b.onclick = () => { if (r.why) { hint(REASONS[r.why](), null, b); return; } change(r.slots); hint(T('New sentence: {m} → {e}.', { m: shortName(src), e: fxName(flow.fx) })); endFlow(); };
        list.append(b);
      }
      const teach = el('button', 'ds-opt ds-optnew'); teach.type = 'button'; teach.append(el('span', 'ds-optname', T('＋ A move of your own …')));
      teach.onclick = () => { const fx = flow.fx; endFlow(); if (opts.learn) opts.learn({ fresh: true, quick: true, fx }); };
      list.append(teach); b3.append(list); list.querySelector('.ds-opt').focus();
    }
    function endFlow() { flow = null; wiz.hidden = true; wiz.textContent = ''; showBtn.setAttribute('aria-expanded', 'false'); showBtn.focus(); }
    showBtn.setAttribute('aria-expanded', 'false');
    showBtn.onclick = () => (flow ? endFlow() : startFlow());
    learnBtn.onclick = () => opts.learn && opts.learn({});
    wiz.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); endFlow(); } });

    // ---- drawing: the sets and sentences when they changed, their light every frame ----
    function draw(force) {
      if (force) drawnKey = '';
      drawSets(); drawDirty(); drawLanes();
    }
    let lastGesture = null, figAt = 0;
    function tick(now = performance.now()) {
      if (box.hidden) return;
      draw(false);
      let live = null; try { live = bridge.live(); } catch (e) { return; }
      const s = cur(), st = bridge.state();
      let acting = 0;
      for (const r of rows) {
        const k = level(live, r.id, r.dst), q = Math.round(k * 50) / 50;
        acting = Math.max(acting, k);
        if (q !== r.lvl) { r.lvl = q; r.bar.style.transform = `scaleX(${q})`; r.row.classList.toggle('live', q > 0.12); }
        if (r.cf && live) {
          const name = r.src.slice(2), c = Math.round(clamp((live.g && live.g[name]) || 0, 0, 1) * 50) / 50, thr = live.thr ? live.thr(name) : 0.6;
          if (c !== r.conf) { r.conf = c; r.cf.style.transform = `scaleX(${c})`; }
          if (thr !== r.thr) { r.thr = thr; r.mark.style.left = (thr * 100).toFixed(1) + '%'; }   // moves only with the tolerance
        }
      }
      if (handRow) {
        const k = live ? Math.max(0, ...s.hands.map(h => clamp(Math.abs(live.out['touch.' + h] || 0), 0, 1))) : 0, q = Math.round(k * 20) / 20;
        if (q !== handRow.lvl) { handRow.lvl = q; handRow.bar.style.transform = `scaleX(${q})`; handRow.row.classList.toggle('live', q > 0.12); }
      }
      const g = live && live.gesture;
      if (g && g !== lastGesture) for (const r of rows) if (r.where === 'accents' && r.src === 'g.' + g) { r.flash.classList.remove('go'); void r.flash.offsetWidth; r.flash.classList.add('go'); }
      lastGesture = g;
      if (flow && flow.step === 1 && live) {
        flow.samples.push({ g: { ...(live.g || {}) }, v: { ...(live.v || {}) } });
        const t = (now - flow.at) / 1000;
        flow.fill.style.transform = `scaleX(${clamp(t / LISTEN, 0, 1).toFixed(3)})`;
        if (t >= LISTEN) heard();
      }
      // the signal's way and the traffic light
      const c = chain(st, live, acting);
      for (const [k, on] of Object.entries(c)) if (link[k].li.classList.contains('on') !== on) link[k].li.classList.toggle('on', on);
      const stTxt = T('×{v} in the panel', { v: (+(st.strength ?? 1)).toFixed(2) });
      if (link.strength.s.textContent !== stTxt) link.strength.s.textContent = stTxt;
      const cTxt = st.clutch ? T('Engaged: your movement gets through') : T('Released, nothing gets through');
      if (link.clutch.s.textContent !== cTxt) link.clutch.s.textContent = cTxt;
      lamp.show(st, live);
      if (now - figAt > 33) { figAt = now; drawFig(s, live); }
    }
    const sizes = { w: 0, h: 0 };
    new ResizeObserver(es => es.forEach(e => { sizes.w = e.contentRect.width; sizes.h = e.contentRect.height; })).observe(fig);
    function drawFig(s, live) {
      if (!sizes.w) return;
      const dpr = Math.min(2, root.devicePixelRatio || 1), w = Math.round(sizes.w * dpr), h = Math.round(sizes.h * dpr);
      if (fig.width !== w || fig.height !== h) { fig.width = w; fig.height = h; }
      const c = fig.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, sizes.w, sizes.h);
      const f = opts.frame && opts.frame(), body = !!(f && f.p && f.p.b);
      if (figNote.hidden !== body) figNote.hidden = body;
      if (f && opts.figure) opts.figure(c, sizes.w, sizes.h, f, glow(s, live));
    }
    return { tick, draw: () => draw(true), slots: cur, change, hint, label: shortName, set hidden(v) { box.hidden = v; }, get hidden() { return box.hidden; } };
  }

  const api = { mount, fits, handFits, place, level, glow, phrase, stepOf, suggestName, nameProblem, chain, strongest, assign, pictogram,
    BASE, ACCENTS, OWN_BASE, HANDS, MAX_HANDS, STEPS, TOLS, COLOURS, GROUP_OF, EFFECTS, REASONS, SLOTS };
  if (node) module.exports = api;
  else root.DanceSlots = api;
})(typeof window !== 'undefined' ? window : globalThis);
