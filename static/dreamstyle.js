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
   the eyes and the windows, which never set it. Pure, no DOM (tests/js/style.test.mjs). A global `DreamStyle`. */
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
  // the world to draw in from now on; a name nobody registered is today's look. Returns the world in use.
  function use(name) { current = worlds.has(name) ? name : FIRST; return current; }
  // a part of the world in use – or of the first world, where this one has none of its own
  function part(kind) {
    const w = worlds.get(current), own = w && w[kind];
    return own || (worlds.get(FIRST) || {})[kind];
  }
  // one large motif of a dream window, by its kind – the world's own, or the first world's
  function motif(kind) {
    const own = (worlds.get(current) || {}).motif, first = (worlds.get(FIRST) || {}).motif || {};
    return (own && Object.prototype.hasOwnProperty.call(own, kind) && own[kind]) || (Object.prototype.hasOwnProperty.call(first, kind) ? first[kind] : undefined);
  }
  const motifs = () => Object.keys((worlds.get(FIRST) || {}).motif || {});   // the kinds of motif a world can draw

  const api = { FIRST, register, names, use, part, motif, motifs, get name() { return current; },
    eye: () => part('eye'), life: () => part('life'), face: () => part('face') };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DreamStyle = api;
})(typeof window !== 'undefined' ? window : globalThis);
