/* Dream – the dance card (#235): what Dream sees of the dance, and the table that says what a movement does.

   Two parts, mounted into the panel (index.html):
   - the display: the feature stream of dance.js as bars – energy, tempo, phase, opening, hands circling, height, stillness,
     each with the source it came from and paler the less sure it is –, the recognised gesture with its confidence,
     the movement's own tempo and a dot that beats with it; with the fingers switched on, their values per hand.
   - the mapping: one row per "source → target" with its switch and its strength; rows can be added, removed, and
     the built-in table brought back – the mood's and flowtrack's (#265: the dance's is its sentences, `table`). The table itself is Dream's (dance.py): the card sends what a hand changes
     (`send`) and shows what Dream says (`map`).
   #236: a taught move is a source like a gesture, under the name the dancer gave it (`setNames`).
   `label`, `edit` and `add` are pure (tests/js/dancemap.test.mjs). Looks: dancepanel.css – only transform and opacity
   move. A global `DancePanel`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const SRC = {
    energy: () => T('Energy'), tempo: () => T('Tempo'), phase: () => T('Phase'), pulse: () => T('Own beat'), open: () => T('Opening'),
    turn: () => T('Hands circling'), height: () => T('Height'), still: () => T('Stillness'), impulse: () => T('Strike (sensor)'), present: () => T('Someone is there'),
    spin: () => T('Arm rotation (sensor)'), force: () => T('Pull on the arm (sensor)'),
    figure: () => T('A figure of the performer (profile)'), round: () => T('Roundness of the path (profile)'),
    'g.throw': () => T('Throwing up'), 'g.accordion': () => T('Accordion'), 'g.push': () => T('Pushing'), 'g.circle': () => T('Circling'), 'g.wave': () => T('Arm wave'),
    palm: () => T('fist ↔ open hand'), spread: () => T('fingers spread'), pinch: () => T('pinch'), snap: () => T('snap'),
  };
  const DST = {
    'fx.amt': () => T('All effects: strength'), 'fx.pulse': () => T('Push on the beat'), 'fx.spin': () => T('Turning of the effects'),
    'fx.speed': () => T('Tempo of the picture'), 'stage.calm': () => T('Calm the dream'),
    'touch.paint': () => T('Paint: hands draw light trails'), 'touch.warp': () => T('Touch: hands push and swirl'), 'touch.impulse': () => T('Impulses: a wave at the hand'),
    'touch.light': () => T('Light in the dark'), 'touch.shape': () => T('Movement shapes the effects'),
    'ai.prompt': () => T('Content by energy (calm ↔ wild)'), 'ai.react': () => T('Movement pushes the AI sliders'), 'ai.piece': () => T('Prompt piece of the move'),
    'ai.strength': () => T('Transformation'), 'ai.mix': () => T('Dream share'), 'ai.zoom': () => T('Zoom pull'), 'ai.rot': () => T('Rotation'), 'ai.hue': () => T('Colour drift'),
    'led.flash': () => T('Room light: flash'), 'led.chase': () => T('Room light: running light'), 'led.level': () => T('Room light: dimmed while calm'),   // #270
  };
  const HAND = { l: () => T('Left hand'), r: () => T('Right hand') };
  const FROM = { pose: () => T('camera'), marker: () => T('marker'), light: () => T('light'), sensor: () => T('sensor'), hand: () => T('hand AI'), camera: () => T('camera'), eyes: () => 'Dreamy Eyes' };
  // a source's or a target's name as a person reads it; one nobody named yet (a taught gesture): as it is
  // the name a table has for a key, or null: only the table's own entries, whatever the key says
  const texts = new Map([SRC, DST, HAND, FROM].map(t => [t, new Map(Object.entries(t))]));
  const named = (table, key) => { const f = texts.get(table).get(key); return f ? f() : null; };
  // #236: the moves the dancer taught – the source "g.<id>" reads as the name the dancer gave it
  const moveNames = new Map();
  function setNames(moves) { moveNames.clear(); for (const m of Array.isArray(moves) ? moves : []) if (m && typeof m.id === 'string') moveNames.set(m.id, String(m.name || m.id)); }
  function label(name, fxNames = {}) {
    const own = named(SRC, name) || named(DST, name);
    if (own) return own;
    if (name.startsWith('g.') && moveNames.has(name.slice(2))) return moveNames.get(name.slice(2));
    const [a, b] = name.split('.'), hand = named(HAND, a), what = named(SRC, b);
    if (hand && what) return hand + ': ' + what;
    if (a === 'fx' && b) return has(fxNames, b) ? fxNames[b] : b;
    return name;
  }
  const from = src => (src || '').split('+').map(s => named(FROM, s) || s).join(' + ');
  const BIPOLAR_SRC = new Set(['turn', 'spin']);
  // the table after a hand changed one thing of a row: {on}, {src}, {dst}, {amount} (its strength 0 … 1) or {remove}.
  // A source that goes both ways (turning) takes the whole input range and steers both ways; the row is the owner's now.
  function edit(rows, id, change) {
    if (change.remove) return rows.filter(r => r.id !== id);
    return rows.map(r => {
      if (r.id !== id) return r;
      const n = { ...r, ...('on' in change ? { on: !!change.on } : {}), ...(change.dst ? { dst: change.dst } : {}), origin: 'on' in change && Object.keys(change).length === 1 ? r.origin : 'own' };
      if (change.src && change.src !== r.src) { n.src = change.src; n.in = BIPOLAR_SRC.has(change.src) ? [-1, 1] : [0, 1]; }
      const amount = 'amount' in change ? Math.min(1, Math.max(0, +change.amount || 0)) : Math.abs(n.out[1]);
      n.out = BIPOLAR_SRC.has(n.src) ? [-amount, amount] : [Math.max(0, Math.min(n.out[0], amount)), amount];
      return n;
    });
  }
  // … and with one more row: the first source and target, switched on, an id no row has yet
  function add(rows, src, dst) {
    let i = 1; while (rows.some(r => r.id === 'own' + i)) i++;
    return rows.concat({ id: 'own' + i, on: true, src, dst, curve: 'lin', in: BIPOLAR_SRC.has(src) ? [-1, 1] : [0, 1], out: BIPOLAR_SRC.has(src) ? [-0.7, 0.7] : [0, 0.7], smooth: 0.15, origin: 'own' });
  }

  const SHOWN = ['energy', 'tempo', 'phase', 'open', 'turn', 'height', 'still'];
  function mount(box, { send, fx = [], fxNames = {}, sources = [], targets = {} }) {
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    box.classList.add('dp'); box.textContent = '';
    // ---- the display ----
    const see = el('div', 'dp-see'); see.setAttribute('role', 'group'); see.setAttribute('aria-label', T('What Dream sees of the dance'));
    const head = el('div', 'dp-head'), gesture = el('span', 'dp-gesture', T('no gesture')), clock = el('span', 'dp-clock'), beat = el('i', 'dp-beat'), bpm = el('span', 'dp-bpm', '–');
    gesture.setAttribute('role', 'status'); gesture.setAttribute('aria-live', 'polite'); beat.setAttribute('aria-hidden', 'true');
    clock.append(beat, bpm); head.append(gesture, clock); see.append(head);
    const bars = {};
    for (const k of SHOWN) {
      const row = el('div', 'dp-row'), name = el('span', 'dp-name', label(k)), track = el('span', 'dp-bar' + (k === 'turn' ? ' dp-mid' : '')), fill = el('i'), val = el('span', 'dp-val', '–'), src = el('span', 'dp-src');
      track.setAttribute('aria-hidden', 'true'); track.append(fill); row.append(name, track, val, src); see.append(row);
      bars[k] = { fill, val, src, shown: '' };
    }
    const fingers = el('div', 'dp-fingers'); fingers.hidden = true; see.append(fingers);
    // ---- the mapping ----
    const map = el('div', 'dp-map'); map.setAttribute('role', 'group'); map.setAttribute('aria-label', T('What a movement does'));
    const btns = el('div', 'btns compact dp-btns'), plus = el('button', 'btn', T('+ Row')), reset = el('button', 'btn', T('Built-in table'));
    plus.type = reset.type = 'button'; plus.title = T('One more row: a movement and what it steers'); reset.title = T('Back to the built-in table: your rows are removed');
    btns.append(plus, reset); box.append(see, map, btns);
    let rows = [], drawn = '', timer = 0, lastGesture = null;
    const say = next => { rows = next; draw(); clearTimeout(timer); timer = setTimeout(() => { timer = 0; send(rows); }, 150); };
    plus.onclick = () => say(add(rows, sources[0] || 'energy', Object.keys(targets)[0] || 'fx.amt'));
    reset.onclick = () => { clearTimeout(timer); timer = 0; send('reset'); };
    function options(sel, groups, value) {
      for (const [title, names] of groups) {
        const g = document.createElement('optgroup'); g.label = title;
        for (const n of names) { const o = el('option', '', label(n, fxNames)); o.value = n; g.append(o); }
        if (names.length) sel.append(g);
      }
      if (![...sel.options].some(o => o.value === value)) { const o = el('option', '', label(value, fxNames)); o.value = value; sel.append(o); }   // a name this page does not know yet
      sel.value = value;
    }
    const srcGroups = () => [[T('Always on'), sources.filter(s => !s.includes('.'))], [T('Gestures'), sources.filter(s => s.startsWith('g.'))], [T('Your moves'), [...moveNames.keys()].map(id => 'g.' + id)],
      [T('Fingers'), sources.filter(s => /^[lr]\./.test(s))]];
    const dstGroups = () => [[T('Effects (at once)'), Object.keys(targets).filter(t => targets[t] === 'instant')], [T('AI sliders (slow)'), Object.keys(targets).filter(t => targets[t] === 'slow')]];
    // the rows are built anew only when the table's shape changed; a strength being dragged keeps its slider
    function draw() {
      const shape = JSON.stringify(rows.map(r => [r.id, r.src, r.dst, r.on]));
      if (shape === drawn) { rows.forEach(r => { const s = map.querySelector(`[data-id="${r.id}"] input[type=range]`); if (s && document.activeElement !== s) s.value = Math.abs(r.out[1]); }); return; }
      drawn = shape;
      const keep = document.activeElement && map.contains(document.activeElement) ? [document.activeElement.closest('.dp-maprow').dataset.id, document.activeElement.dataset.part] : null;
      map.textContent = '';
      rows.forEach((r, i) => {
        const row = el('div', 'dp-maprow'), n = i + 1; row.dataset.id = r.id; row.classList.toggle('dp-off', !r.on);
        const on = el('input'); on.type = 'checkbox'; on.checked = r.on; on.dataset.part = 'on'; on.setAttribute('aria-label', T('Row {n}: on', { n }));
        const src = el('select'); src.dataset.part = 'src'; src.setAttribute('aria-label', T('Row {n}: movement', { n })); options(src, srcGroups(), r.src);
        const arrow = el('span', 'dp-arrow', '→'); arrow.setAttribute('aria-hidden', 'true');
        const dst = el('select'); dst.dataset.part = 'dst'; dst.setAttribute('aria-label', T('Row {n}: steers', { n })); options(dst, dstGroups(), r.dst);
        const amt = el('input'); amt.type = 'range'; amt.min = 0; amt.max = 1; amt.step = 0.05; amt.value = Math.abs(r.out[1]); amt.dataset.part = 'amount'; amt.setAttribute('aria-label', T('Row {n}: strength', { n }));
        const live = el('i', 'dp-live'); live.setAttribute('aria-hidden', 'true');
        const x = el('button', 'btn dp-x', '✕'); x.type = 'button'; x.dataset.part = 'x'; x.setAttribute('aria-label', T('Row {n}: remove', { n })); x.title = T('Remove this row');
        on.onchange = () => say(edit(rows, r.id, { on: on.checked }));
        src.onchange = () => say(edit(rows, r.id, { src: src.value }));
        dst.onchange = () => say(edit(rows, r.id, { dst: dst.value }));
        amt.oninput = () => say(edit(rows, r.id, { amount: +amt.value }));
        x.onclick = () => say(edit(rows, r.id, { remove: true }));
        row.append(on, src, arrow, dst, amt, live, x); map.append(row);
      });
      if (keep) { const again = map.querySelector(`[data-id="${keep[0]}"] [data-part="${keep[1]}"]`); if (again) again.focus(); }
    }
    const pct = v => Math.round(v * 100) + ' %';
    // frame: a record of the feature stream (null: nothing comes); held(id): what a row asks for right now
    function show(frame, held) {
      const g = frame && frame.gesture, text = g ? T('{g} · {p} % sure', { g: label('g.' + g), p: Math.round(frame.gc * 100) }) : T('no gesture');
      if (g !== lastGesture || g) { if (gesture.textContent !== text) gesture.textContent = text; lastGesture = g; }
      gesture.classList.toggle('dp-on', !!g);
      const locked = frame && frame.bpm > 0;
      bpm.textContent = locked ? T('{n} a minute', { n: Math.round(frame.bpm) }) : '–';
      beat.style.opacity = locked ? (0.25 + 0.75 * frame.v.pulse).toFixed(2) : '0.15';
      beat.style.transform = `scale(${locked ? (0.7 + 0.5 * frame.v.pulse).toFixed(2) : 0.7})`;
      for (const k of SHOWN) {
        const b = bars[k], c = frame ? frame.c[k] : 0, v = frame ? frame.v[k] : 0;
        b.fill.style.transform = `scaleX(${c > 0 ? (k === 'turn' ? v : Math.max(0, v)).toFixed(3) : 0})`;
        b.fill.style.opacity = (0.3 + 0.7 * c).toFixed(2);
        b.val.textContent = !(c > 0) ? '–' : k === 'tempo' ? (frame.bpm ? String(Math.round(frame.bpm)) : '–') : k === 'turn' ? (v > 0.05 ? '↺ ' : v < -0.05 ? '↻ ' : '') + pct(Math.abs(v)) : pct(v);
        const s = c > 0 ? from(frame.src[k]) : '';
        if (s !== b.shown) { b.src.textContent = s; b.shown = s; }
      }
      const hands = frame ? ['l', 'r'].filter(h => frame.c[h + '.palm'] > 0) : [];
      fingers.hidden = !hands.length;
      if (hands.length) fingers.textContent = hands.map(h => `${named(HAND, h)}: ${label('palm')} ${pct(frame.v[h + '.palm'])} · ${label('spread')} ${pct(frame.v[h + '.spread'])}${frame.v[h + '.pinch'] > 0.5 ? ' · ' + label('pinch') : ''}${frame.v[h + '.snap'] > 0.3 ? ' · ' + label('snap') : ''}`).join('\n');
      if (held) for (const r of rows) { const dot = map.querySelector(`[data-id="${r.id}"] .dp-live`); if (dot) dot.style.opacity = Math.min(1, Math.abs(held(r.id)) * 1.5).toFixed(2); }
    }
    // Dream's word on the table – not taken while a hand's change is still on its way (its echo would undo the newer one)
    // table(false) – #265: Dream Dance has its sentences on its page: the card shows only what Dream sees
    function table(on) { map.hidden = btns.hidden = !on; }
    return { map(next) { if (timer) return; rows = next || []; draw(); }, show, table, renamed() { drawn = ''; draw(); }, get busy() { return !!timer; }, get rows() { return rows; } };
  }

  const api = { mount, label, edit, add, setNames };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DancePanel = api;
})(typeof window !== 'undefined' ? window : globalThis);
