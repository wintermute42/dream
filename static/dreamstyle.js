/* Dream – the style layer (#221). Dreamy Eyes (eyes.html) and the dream windows (window.html) decide the scene: what
   appears, when and where. How it is drawn is a style world: one file `static/world-<name>.js` that registers itself
   here with the parts it draws –

     eye    { draw(g, cx, cy, a, b, mirror, p), irisWorld(g, style, ix, iy, R, mirror, al, o),
              pupilShape(g, shape, x, y, pr, R, mirror, o) }               the eye (see static/dreameye.js for p and o)
     life   { draw(g, d, age, env, s, y, o) }                              what lives around the eyes and drifts through
                                                                           the windows (static/dreamlife.js)
     face   { draw(c, mode, t, geo, vis, ink, inkAl), MODES }              the faces of light around the eyes (MODES:
                                                                           their names); vis is the face rule's word
                                                                           (static/dreamvis.js)
     motif  { <kind>(c, m, t, dt, o) }                                     the large motifs of a dream window
     back   { mask(bk, mode, t, w, h, al, o) }                             the night behind the eyes: where the dream
                                                                           shines through ('clouds', 'fractal', 'pattern')
     sky    { clouds(cg, t, o) }                                           a dream window's sky: the dream seen in clouds
     fire   { flames(g, t, k, side, o) }                                   the flames while the eyes see fire
     trance { back(g, t, p, o), eye(g, t, p, o) }                          the trance of the eyes: what is behind them,
                                                                           and the third eye
     you    { FRAMES, behind, front, tints(hue, t), spark(…), cloud(…),    what is drawn around "you in the dream" and a
              rings(…) }                                                   painted face coming through the pupils – never
                                                                           the picture itself (static/dreamyou.js)
     air    { draw(g, t, o) }                                              what fills the night of the world, in both
                                                                           pages (the first world has none)

   (the parts from `back` on: #222; world-classic.js describes what each is handed)

   – with the shared brushes (static/dreambrush.js). The pages ask for a part of the world in use (`DreamStyle.eye()`);
   a part a world does not draw itself comes from the first world, today's look ('classic'), and so does everything
   when a world is named that does not exist. The setting "world" (settings.py) names the world; Dream tells it to
   the eyes and the windows, which never set it.

   #224: two worlds can be crossfaded. Dream names them and how far the picture is on its way from the first to the
   second (the settings "world", "world_to", "world_mix"); a page hands that on (`blend`), asks before every frame what
   to draw (`plan` → one or two worlds, each with its weight), draws the whole frame once per world (`paint(name)`
   before each) and adds the pictures up by their weights. A device that does not keep up never draws two worlds for
   long: it shows the nearer world and changes over in a short fade ('fade'), the weakest through black with one
   picture at any time ('dip'). Pure, no DOM (tests/js/style.test.mjs, blend.test.mjs). A global `DreamStyle`. */
(function (root) {
  'use strict';
  const FIRST = 'classic';
  const worlds = new Map();
  let current = FIRST;
  // a world makes itself known: its name (as in settings.WORLDS) and the parts it draws
  function register(name, world) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name) || !world || typeof world !== 'object') throw new Error('not a style world: ' + name);
    worlds.set(name, world);
  }
  const names = () => [...worlds.keys()];
  const known = name => (worlds.has(name) ? name : FIRST);
  // the world to draw in from now on, at once; a name nobody registered is today's look. Returns the world in use.
  function use(name) {
    current = known(name);
    Object.assign(asked, { a: current, b: current, k: 0 });
    Object.assign(shown, { a: current, b: null, k: 0, dim: 0, near: current });
    return current;
  }
  // the world the next strokes are drawn in: one pass of a frame (#224). The crossfade stays as it is.
  function paint(name) { current = known(name); return current; }

  // ---------- #224: the crossfade ----------
  const SWITCH = 1.4;       // seconds of the short fade from one world to another
  const DIP = 0.45;         // seconds to black, and as long back, on the weakest devices
  const FOLLOW = 6, SWEEP = 0.5;   // a hand on the mix is followed softly; the whole way takes at least SWEEP seconds
  const FLIP = 0.08;        // a device that shows one world changes over this far past the middle (no see-saw at 50 %)
  const SLOW_FPS = 33, FINE_FPS = 40, SLOW_SECS = 3, BACK_SECS = 90, BACK_MAX = 900;
  const asked = { a: FIRST, b: FIRST, k: 0 };                       // what Dream asked for
  const shown = { a: FIRST, b: null, k: 0, dim: 0, near: FIRST };   // what is drawn: a, or a and b with b's weight k
  const device = { mode: 'mix', slow: 0, clock: 0, downAt: 0, tried: Infinity, wait: BACK_SECS, dip: false };   // tried: seconds of mixing since it last went back to it
  const clamp01 = x => Math.min(1, Math.max(0, +x || 0));
  // Dream's word: from world a to world b, k of the way. `now`: no fade towards it (the first word a page hears).
  function blend(a, b, k, now) {
    Object.assign(asked, { a: known(a), b: known(b == null ? a : b), k: clamp01(k) });
    if (asked.a === asked.b) asked.k = 0;
    if (now) {
      const { a: A, b: B, k: K } = asked;
      Object.assign(shown, K <= 0 ? { a: A, b: null, k: 0 } : K >= 1 ? { a: B, b: null, k: 0 } : { a: A, b: B, k: K }, { dim: 0, near: K < 0.5 ? A : B });
    }
  }
  // how this device mixes: 'mix' while it keeps up with two worlds; else 'fade', the weakest 'dip'. It is judged by
  // the frame rate while two worlds are drawn and by the page's own tier (2 all detail … 0 the least) while one is;
  // back to mixing only after a while, and after a longer while when that did not hold. `real`: the seconds since the
  // last frame as they were – a device that manages three frames a second is found out in three seconds, not thirty.
  function pace(real, o) {
    const d = device, pair = !!shown.b, tier = o.tier == null ? 2 : o.tier, fps = o.fps || 60, dt = Math.min(1, real);
    d.clock += dt;
    const down = () => { if (d.tried < 30) d.wait = Math.min(BACK_MAX, d.wait * 2); d.mode = 'fade'; d.downAt = d.clock; d.slow = 0; };
    if (pair) {
      d.tried += dt;
      d.slow = fps < SLOW_FPS || dt > 2 / SLOW_FPS ? d.slow + dt : fps > FINE_FPS ? 0 : d.slow;
      if (d.mode === 'mix' && d.slow > SLOW_SECS) down();
    } else {
      d.slow = 0; d.dip = tier <= 0;
      if (d.mode === 'mix' && tier < 2) down();
      else if (d.mode !== 'mix' && tier >= 2 && d.clock - d.downAt > d.wait) { d.mode = 'mix'; d.tried = 0; }
    }
    return d.mode === 'mix' ? 'mix' : d.dip ? 'dip' : 'fade';
  }
  // one frame further (the seconds since the last one, as they were) → what to draw: [[world, weight]] or [[world,
  // weight], [world, weight]]; the weights of two add up to 1. o: { fps, tier } of the page, or { hold: 'mix' | 'fade'
  // | 'dip' } to look at one way.
  function plan(real, o = {}) {
    real = Math.max(0, +real || 0);
    const dt = Math.min(0.1, real);                    // (a fade never leaps, however long a frame took)
    const mode = MODES.includes(o.hold) ? o.hold : pace(real, o), s = shown, A = asked.a, B = asked.b, K = asked.k;
    // the nearer world, with a little hold, for a device that shows one
    if (s.near !== A && s.near !== B) s.near = K < 0.5 ? A : B;
    else if (s.near === A && K > 0.5 + FLIP) s.near = B;
    else if (s.near === B && A !== B && K < 0.5 - FLIP) s.near = A;
    const one = mode !== 'mix' || K <= 0 || K >= 1, X = mode !== 'mix' ? s.near : K <= 0 ? A : B;   // one world asked: X
    if (!s.b) {
      if (one && s.a !== X && mode === 'dip') { s.dim += dt / DIP; if (s.dim >= 1) { s.dim = 1; s.a = X; } }
      else if (s.dim > 0) s.dim = Math.max(0, s.dim - dt / DIP);
      else if (one) { if (s.a !== X) s.b = X; }
      else if (s.a === A) s.b = B;
      else if (s.a === B) Object.assign(s, { a: A, b: B, k: 1 });
      else s.b = K < 0.5 ? A : B;                      // from a third world: over to the nearer of the two first
    }
    if (s.b) {
      if (s.a === B && s.b === A && A !== B) Object.assign(s, { a: A, b: B, k: 1 - s.k });
      if (mode === 'mix' && s.a === A && s.b === B) {  // the asked pair: follow the mix
        const cap = dt / SWEEP, step = (K - s.k) * (1 - Math.exp(-FOLLOW * dt));
        s.k += Math.max(-cap, Math.min(cap, step));
        if (Math.abs(K - s.k) < 0.002) s.k = K;
      } else {                                         // on the way to one world: the short fade
        const here = n => (one ? n === X : n === A || n === B);
        const to = here(s.b) && !(here(s.a) && s.k < 0.5) ? 1 : here(s.a) ? 0 : s.k < 0.5 ? 0 : 1;
        s.k = to ? Math.min(1, s.k + dt / SWITCH) : Math.max(0, s.k - dt / SWITCH);
      }
      if (s.k <= 0) Object.assign(s, { b: null, k: 0 }); else if (s.k >= 1) Object.assign(s, { a: s.b, b: null, k: 0 });
    }
    lastMode = mode;
    return s.b ? [[s.a, 1 - s.k], [s.b, s.k]] : [[s.a, 1 - s.dim]];
  }
  const MODES = ['mix', 'fade', 'dip'];
  let lastMode = 'mix';
  // What only one world may show at a time – a face of light: two faces never lie over each other. Of a plan, the
  // world that carries it: the one that did (`cur`) while it still shows clearly, else the one that shows most. The
  // page lets the face go completely before the other world's comes (static/dreamvis.js, `step`).
  function lead(plan, cur) {
    const mine = plan.find(p => p[0] === cur);
    return mine && mine[1] >= 0.5 - FLIP ? cur : plan.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }
  // a part of the world in use (or of the world named) – or of the first world, where this one has none of its own
  function part(kind, name) {
    const w = worlds.get(name === undefined ? current : known(name)), own = w && w[kind];
    return own || (worlds.get(FIRST) || {})[kind];
  }
  // one large motif of a dream window, by its kind – the world's own, or the first world's
  function motif(kind) {
    const own = (worlds.get(current) || {}).motif, first = (worlds.get(FIRST) || {}).motif || {};
    return (own && Object.prototype.hasOwnProperty.call(own, kind) && own[kind]) || (Object.prototype.hasOwnProperty.call(first, kind) ? first[kind] : undefined);
  }
  const motifs = () => Object.keys((worlds.get(FIRST) || {}).motif || {});   // the kinds of motif a world can draw

  const api = { FIRST, register, names, use, paint, blend, plan, lead, part, motif, motifs, get name() { return current; },
    get mixing() { return { a: shown.a, b: shown.b, k: shown.k, dim: shown.dim, mode: lastMode, asked: { ...asked } }; },   // (to look at, and for the tests)
    BLEND: { MODES, SWITCH, DIP, SWEEP, FLIP, SLOW_FPS, SLOW_SECS, BACK_SECS },
    eye: () => part('eye'), life: () => part('life'), face: () => part('face') };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DreamStyle = api;
})(typeof window !== 'undefined' ? window : globalThis);
