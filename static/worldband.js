/* Dream – the band of worlds: how the style worlds of Dreamy Eyes and the dream windows are chosen in the panel
   (index.html) and in Dream Control (remote.html). One small picture per world Dream knows (`settings.WORLDS`, told
   over /ctl), drawn once by the world itself – its eye; a tap fades over to that world. Under it where the crossfade
   stands (a display: the MIDI knob and the drift move it), a switch for the drift – Dream wandering from world to
   world by itself – with its pace, and one line that says what is going on.

   The page hands over what Dream says (`set` the settings, `drift` the drift's clock, `worlds` the list) and gets the
   settings a hand asks for (`send`). What is shown follows from that alone: `view`, `tap`, `auto` and `status` are
   pure (tests/js/worldband.test.mjs). Looks: worldband.css – only transform and opacity move. A global `WorldBand`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  // the worlds' names – a new world gets its line here (and its German in static/i18n/de.json); SHORT: under its picture
  const NAMES = {
    classic: () => T('Classic'),
    deepsea: () => T('Bioluminescence'),
    ink: () => T('Ink & watercolour'),
    etching: () => T('Engraving'),
    aurora: () => T('Aurora'),
  };
  const SHORT = { ink: () => T('Ink') };
  const ABOUT = {                                      // … and what it looks like, in a few words
    classic: () => T('Classic – glowing lines and soft light'),
    deepsea: () => T('Bioluminescence – lights of the deep sea, no outlines'),
    ink: () => T('Ink & watercolour – light pigment on black paper, brushed lines'),
    etching: () => T('Engraving – an old engraved plate come alive, Art Nouveau lines'),
    aurora: () => T('Aurora – curtains of northern light over a field of stars'),
  };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const plain = w => String(w).charAt(0).toUpperCase() + String(w).slice(1);   // a world without a line of its own: its name as it is
  const name = w => (has(NAMES, w) ? NAMES[w]() : plain(w));
  const short = w => (has(SHORT, w) ? SHORT[w]() : name(w));
  const about = w => (has(ABOUT, w) ? ABOUT[w]() : name(w));
  // the drift's paces: seconds per world (the setting "world_auto"; 0 is off)
  const PACES = [[300, () => T('slow')], [120, () => T('calm')], [45, () => T('lively')]];
  const PACE = 120;
  const clamp01 = x => Math.min(1, Math.max(0, +x || 0));
  const clock = secs => { const s = Math.max(0, Math.ceil(secs)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // What the settings mean: the two worlds (a → b), how far (mix), whether both show (mixing), the one that shows
  // most (cur) and the one it is blended with (next, or null)
  function view(st) {
    const a = st.world, b = st.world_to == null ? a : st.world_to, mix = a === b ? 0 : clamp01(st.world_mix);
    const mixing = mix > 0 && mix < 1, cur = mix >= 0.5 ? b : a;
    return { a, b, mix, mixing, cur, next: mixing ? (cur === a ? b : a) : null };
  }
  // A tap on a world: the settings that fade over to it – that world alone, the one after it in Dream's list as the
  // next target (as the drift leaves them, so a MIDI knob on the crossfade goes on from there). Dream's pages change
  // over in a short fade, and the drift waits three minutes after a hand.
  function tap(worlds, w) {
    const i = worlds.indexOf(w);
    return i < 0 ? null : { world: w, world_to: worlds[(i + 1) % worlds.length], world_mix: 0 };
  }
  // The switch and the pace: the setting "world_auto" to ask for. `last`: the pace it had when it was last on.
  const auto = (on, last) => (on ? (last > 0 ? last : PACE) : 0);
  // The line that says what is going on. drift: Dream's word on the drift – { wait, next, idle }: seconds it still
  // waits after a hand, seconds until the next world begins to come (null: not counting), nobody is looking –
  // `since` seconds ago.
  function status(st, drift, since) {
    const v = view(st), d = drift || {}, ago = Math.max(0, +since || 0);
    if (!(st.world_auto > 0)) return T('{a} · wandering off', { a: name(v.cur) });
    const wait = (+d.wait || 0) - ago;
    if (wait > 0) return T('{a} chosen · wandering paused for another {t}', { a: name(v.cur), t: clock(wait) });
    if (v.mixing) return T('now: {a} → {b} · {n} %', { a: name(v.a), b: name(v.b), n: Math.round(v.mix * 100) });
    if (d.idle) return T('now: {a} · wandering rests while no Dreamy Eyes and no dream window are on', { a: name(v.cur) });
    if (d.next == null) return T('now: {a}', { a: name(v.cur) });
    return T('now: {a} · next world in {t}', { a: name(v.cur), t: clock(d.next - ago) });
  }
  // … and the same without its clock: said aloud only when something changes, not every second
  function spoken(st, drift) {
    const v = view(st), d = drift || {};
    if (!(st.world_auto > 0)) return T('{a} · wandering off', { a: name(v.cur) });
    if (d.wait > 0) return T('{a} chosen · wandering paused', { a: name(v.cur) });
    if (v.mixing) return T('now: {a} → {b}', { a: name(v.a), b: name(v.b) });
    return T('now: {a}', { a: name(v.cur) });
  }

  // ---------- the small pictures: each world draws its own eye, once ----------
  const NEEDS = ['dreambrush', 'dreamvis', 'dreamlife', 'dreameye', 'dreamstyle'];
  const WORLD = /^[a-z][a-z0-9-]*$/;
  const loaded = new Map();
  function load(file) {
    if (!loaded.has(file)) loaded.set(file, new Promise((done, fail) => {
      const s = document.createElement('script');
      s.src = `/static/${file}.js`; s.onload = done; s.onerror = () => fail(new Error('not loaded: ' + file));
      document.head.append(s);
    }));
    return loaded.get(file);
  }
  let kit = null;                                      // an invented dream for the irises, and what an eye is made of
  function eyeKit() {
    if (kit) return kit;
    const { DreamBrush, DreamEye } = root, pic = DreamBrush.canvas(128), pg = pic.getContext('2d'), bands = pg.createLinearGradient(0, 0, 128, 128);
    [[0, '#14306e'], [0.3, '#1fa0a8'], [0.55, '#f0c060'], [0.8, '#e05a78'], [1, '#5a2a96']].forEach(([at, col]) => bands.addColorStop(at, col));
    pg.fillStyle = bands; pg.fillRect(0, 0, 128, 128);
    const look = DreamBrush.brightness(pg.getImageData(0, 0, 128, 128).data, 128, 128);
    kit = { pic, col: look.col, hue: DreamBrush.hueOf(look.col), fib: DreamEye.fibres(), stars: DreamEye.stars() };
    return kit;
  }
  // one world's picture into a canvas: its eye, open, looking a little aside
  function paint(canvas, world) {
    const { DreamStyle, DreamEye } = root, k = eyeKit(), g = canvas.getContext('2d'), w = canvas.width, h = canvas.height, was = DreamStyle.name;
    DreamStyle.paint(world);
    try {
      const style = DreamStyle.eye(), a = w * 0.37, io = { rot: 0.7, hue: k.hue, stars: k.stars, heat: 0.7, pic: (x, y, n, al) => { g.globalAlpha = al; g.drawImage(k.pic, x - n / 2, y - n / 2, n, n); } };
      g.save(); g.clearRect(0, 0, w, h);
      style.draw(g, w / 2, h * 0.56, a, a * 0.56, false, { open: 0.92, blink: 0, squint: 0, col: k.col, energy: 0.4, look: DreamEye.LOOKS.rose,
        brow: DreamEye.EMO.curious[0], browAl: 0, crease: 0, fib: k.fib, gx: 0.18, gy: 0, pupil: 0.45, pupilMix: 0, pupilShape: () => {},
        iris: (ix, iy, R) => { style.irisWorld(g, 'dream', ix, iy, R, false, 1, io); g.globalAlpha = 1; } });
      g.restore(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    } finally { DreamStyle.paint(was); }
  }
  // the pictures of these worlds into their canvases ({ world: canvas }); a world that cannot draw keeps its plain tile
  async function pictures(canvases) {
    try { for (const file of NEEDS) await load(file); } catch (e) { return; }
    for (const [world, canvas] of Object.entries(canvases)) {
      if (!WORLD.test(world)) continue;
      try { await load('world-' + world); paint(canvas, world); canvas.classList.add('wb-drawn'); } catch (e) { /* its plain tile stays */ }
    }
  }

  // ---------- the controls ----------
  let count = 0;
  // root: an empty element; o.send(changes): the settings a hand asks for; o.pictures === false: no small pictures
  function mount(el, o = {}) {
    const id = 'wb' + (++count), st = { world: 'classic', world_to: 'classic', world_mix: 0, world_auto: 0 };
    let worlds = [], drift = { wait: 0, next: null, idle: false }, heard = performance.now(), last = PACE, said = '';
    let watch = null;
    const send = changes => { if (changes && o.send) o.send(changes); };
    const make = (tag, cls, attrs = {}, text) => { const n = document.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
    el.classList.add('wb'); el.textContent = '';
    const head = make('div', 'wb-head');
    head.append(make('span', 'wb-title', { id: id + '-t' }, T('Style world')), make('span', 'wb-sub', {}, T('Dreamy Eyes & dream windows')));
    const strip = make('div', 'wb-strip', { role: 'radiogroup', 'aria-labelledby': id + '-t' });
    const flow = make('div', 'wb-flow', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': T('Crossfade from the style world to the second one') });
    const from = make('span', 'wb-from'), to = make('span', 'wb-to'), fill = make('i', 'wb-fill');
    const labs = make('div', 'wb-labs', { 'aria-hidden': 'true' }), bar = make('div', 'wb-bar');
    labs.append(from, make('span', 'wb-arrow', {}, '→'), to); bar.append(fill); flow.append(labs, bar);
    const sw = make('button', 'wb-switch', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': id + '-s' });
    const autoRow = make('div', 'wb-auto');
    autoRow.append(sw, make('span', 'wb-autolabel', { id: id + '-s' }, T('Wander through the worlds by itself')));
    const pace = make('div', 'wb-pace', { role: 'radiogroup', 'aria-label': T('Pace of the wandering') });
    for (const [secs, label] of PACES) pace.append(make('button', '', { type: 'button', role: 'radio', 'data-v': secs, 'aria-checked': 'false' }, label()));
    const line = make('div', 'wb-status', { 'aria-hidden': 'true' }), live = make('div', 'wb-live', { role: 'status', 'aria-live': 'polite' });
    el.append(head, strip, flow, autoRow, pace, line, live);

    // a group of radio buttons: the arrows move the focus, Space or Enter (a click) chooses
    function roving(group) {
      group.addEventListener('keydown', ev => {
        const all = [...group.querySelectorAll('[role=radio]')], i = all.indexOf(document.activeElement);
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
        const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? all.length - 1 : step && i >= 0 ? (i + step + all.length) % all.length : -1;
        if (j < 0 || !all.length) return;
        ev.preventDefault(); all.forEach((b, k) => { b.tabIndex = k === j ? 0 : -1; }); all[j].focus();
      });
    }
    roving(strip); roving(pace);
    strip.addEventListener('click', ev => { const b = ev.target.closest('[role=radio]'); if (b) send(tap(worlds, b.dataset.world)); });
    pace.addEventListener('click', ev => { const b = ev.target.closest('[role=radio]'); if (b && st.world_auto > 0) send({ world_auto: +b.dataset.v }); });
    sw.addEventListener('click', () => send({ world_auto: auto(!(st.world_auto > 0), last) }));

    function chips() {
      strip.textContent = '';
      const canvases = {};
      for (const w of worlds) {
        const b = make('button', 'wb-chip', { type: 'button', role: 'radio', 'data-world': w, 'aria-checked': 'false', 'aria-label': name(w), title: about(w) });
        const pic = make('canvas', 'wb-pic', { width: 192, height: 128, 'aria-hidden': 'true' });
        b.append(pic, make('span', 'wb-name', { 'aria-hidden': 'true' }, short(w)));
        strip.append(b); canvases[w] = pic;
      }
      strip.style.setProperty('--n', Math.max(1, worlds.length));
      // the pictures only once somebody can see them: a guest's phone or a stage without its panel never loads a world
      if (watch) watch.disconnect();
      watch = null;
      if (o.pictures === false || !worlds.length) return;
      if (typeof IntersectionObserver !== 'function') { pictures(canvases); return; }
      watch = new IntersectionObserver(seen => { if (seen.some(x => x.isIntersecting)) { watch.disconnect(); watch = null; pictures(canvases); } });
      watch.observe(strip);
    }
    function show() {
      const v = view(st), on = st.world_auto > 0;
      let focusable = false;
      for (const b of strip.children) {
        const cur = b.dataset.world === v.cur;
        b.setAttribute('aria-checked', cur ? 'true' : 'false'); b.classList.toggle('wb-next', b.dataset.world === v.next);
        b.tabIndex = cur ? 0 : -1; focusable = focusable || cur;
      }
      if (!focusable && strip.firstElementChild) strip.firstElementChild.tabIndex = 0;
      from.textContent = name(v.a); to.textContent = name(v.b);
      labs.classList.toggle('wb-one', v.a === v.b);
      fill.style.transform = `scaleX(${v.mix.toFixed(4)})`;
      flow.setAttribute('aria-valuenow', Math.round(v.mix * 100));
      flow.setAttribute('aria-valuetext', v.a === v.b ? name(v.a) : `${name(v.a)} → ${name(v.b)} · ${Math.round(v.mix * 100)} %`);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      pace.classList.toggle('wb-off', !on);
      const chosen = [...pace.children].find(b => +b.dataset.v === st.world_auto);
      [...pace.children].forEach((b, i) => { b.setAttribute('aria-checked', b === chosen ? 'true' : 'false'); b.disabled = !on; b.tabIndex = (chosen ? b === chosen : i === 0) ? 0 : -1; });
      tick();
      const say = spoken(st, drift);
      if (say !== said) { said = say; live.textContent = say; }
    }
    function tick() { line.textContent = status(st, drift, (performance.now() - heard) / 1000); }
    const timer = setInterval(() => { if (el.isConnected && el.offsetParent !== null) tick(); }, 500);

    chips(); show();
    return {
      // Dream's settings, all or some of them
      set(changes) {
        for (const k of ['world', 'world_to', 'world_mix', 'world_auto']) if (k in changes) st[k] = k === 'world_mix' || k === 'world_auto' ? +changes[k] || 0 : String(changes[k]);
        if (st.world_auto > 0) last = st.world_auto;
        show();
      },
      // Dream's list of worlds
      worlds(list) {
        const next = (Array.isArray(list) ? list : []).filter(w => typeof w === 'string' && WORLD.test(w));
        if (next.join() === worlds.join()) return;
        worlds = next; chips(); show();
      },
      // Dream's word on the drift
      drift(d) { drift = { wait: +d.wait || 0, next: d.next == null ? null : +d.next, idle: !!d.idle }; heard = performance.now(); show(); },
      get state() { return { ...st, worlds: [...worlds], drift: { ...drift }, status: line.textContent }; },
      stop() { clearInterval(timer); if (watch) watch.disconnect(); },
    };
  }

  const api = { NAMES, SHORT, ABOUT, PACES: PACES.map(p => p[0]), PACE, name, short, about, clock, view, tap, auto, status, spoken, mount, pictures };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorldBand = api;
})(typeof window !== 'undefined' ? window : globalThis);
