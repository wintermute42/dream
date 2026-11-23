/* Dream – how much of a face shows (#220). One rule for everything face-like that is drawn in Dreamy Eyes (eyes.html)
   and the dream windows (window.html): the faces of light around the eyes, the eye's brow. (Not for the faces painted
   by the AI, nor for "you in the dream": those are pictures and stay whole.)

   Mostly there are only the eyes (level 0). Now and then – every one to two minutes – hints come for a few seconds:
   brows, the lid's crease, the sign on the forehead (level 1). Rarely – every five to ten minutes, inside such a
   moment – mouth, nose and outline join them, clearly to be seen while they are there, yet never as solid as the eyes:
   never stronger than RARE_MAX (level 2). What a drawing wants to show names its part (`of(vis, 'mouth')`) and gets
   how visible that is right now, 0–1; a part the rule does not know gets 0 (there is no grin, and no teeth).

   Pure computation, no DOM and no memory: `at(clock, seed)` follows from the clock and a seed alone, so the two
   windows of a pair of eyes raise their brows together (tests/js/vis.test.mjs). */
(function (root) {
  'use strict';
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
  const ramp = (x, a, b) => clamp01((x - a) / (b - a));
  // one random number (0–1) for a seed and a number: the same everywhere
  function hash(seed, k) {
    let a = ((seed >>> 0) ^ Math.imul((k | 0) + 1, 0x9E3779B1)) >>> 0;
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const SLOT = 90000;          // ms: one moment of hints in each slot …
  const LEAD = [20000, 50000]; // … beginning this long after the slot did, so two of them begin 60–120 s apart
  const HINT = { come: 3000, stay: 4000, go: 3500 };   // ms: the hints fade in, stay, fade out
  const ROUND = 5;             // slots: in each round one moment also brings mouth, nose and outline (4–11 min apart) …
  const RARE = { wait: 3500, come: 3000, stay: 3000, go: 4000 };   // … which come after the hints and go before them
  const RARE_MAX = 0.8;        // … clearly, but never stronger than this
  const RARE_HINT_STAY = RARE.wait + RARE.come + RARE.stay + RARE.go - HINT.come;   // the hints stay until they are gone

  // what belongs to which level. Whatever a style world draws of a face is one of these – or it is not drawn.
  const PARTS = {
    eyes: 0, lids: 0, lashes: 0, shadow: 0,
    brows: 1, crease: 1, mark: 1,
    mouth: 2, nose: 2, outline: 2, hair: 2,
  };

  const make = (hint, full, hintForm, fullForm, round) => ({ level: full > 0.02 ? 2 : hint > 0.02 ? 1 : 0, hint, full, hintForm, fullForm, round });
  const EYES_ONLY = Object.freeze(make(0, 0, 0, 0, -1));
  // a level held (to look at it, and for what is rare by itself): 0 the eyes, 1 with hints, 2 with mouth, nose and outline
  const held = level => make(level >= 1 ? 1 : 0, level >= 2 ? RARE_MAX : 0, 1, 1, -1);
  // the level a page's address asks to hold (`?face=0|1|2`), or -1: none, the rule runs
  const asked = search => { const m = /[?&]face=([012])(?:&|$)/.exec(search || ''); return m ? +m[1] : -1; };

  // Is the slot's moment one of the rare ones? One slot of each round, never the first or the last of it.
  const rare = (slot, seed) => ((slot % ROUND) + ROUND) % ROUND === 1 + Math.floor(hash(seed, 7000 + Math.floor(slot / ROUND)) * (ROUND - 2));

  // What shows at `clock` (ms) for `seed`: { level, hint, full (0–1, full never above RARE_MAX), hintForm, fullForm
  // (0–1: how far drawn in – for a world whose lines are drawn rather than faded), round (the number of the moment:
  // a face picks what it shows per round) }
  function at(clock, seed) {
    if (!Number.isFinite(clock)) return EYES_ONLY;     // no clock, nothing to decide by: only the eyes
    const slot = Math.floor(clock / SLOT), p = clock - slot * SLOT - (LEAD[0] + hash(seed, slot) * (LEAD[1] - LEAD[0]));
    if (p < 0) return EYES_ONLY;
    const more = rare(slot, seed), stay = more ? RARE_HINT_STAY : HINT.stay;
    const hint = smooth(p / HINT.come) * (1 - smooth((p - HINT.come - stay) / HINT.go));
    if (hint <= 0) return EYES_ONLY;
    const q = p - RARE.wait;
    const full = more ? RARE_MAX * smooth(q / RARE.come) * (1 - smooth((q - RARE.come - RARE.stay) / RARE.go)) : 0;
    return make(hint, full, ramp(p, 0, HINT.come * 1.5), more ? ramp(q, 0, RARE.come + RARE.stay / 2) : 0, slot);
  }

  // the same, calmer: the hints and the rare level each scaled (0–1) – no face while something else takes the screen,
  // no mouth while the eyes are not calm
  function damp(vis, hintK, fullK) {
    const hk = clamp01(hintK), fk = clamp01(fullK === undefined ? hintK : fullK);
    return hk >= 1 && fk >= 1 ? vis : make(vis.hint * hk, Math.min(vis.full * fk, vis.hint * hk * RARE_MAX), vis.hintForm, vis.fullForm, vis.round);
  }

  // how visible a part is right now, 0–1
  function of(vis, part) {
    const level = Object.prototype.hasOwnProperty.call(PARTS, part) ? PARTS[part] : -1;
    return level === 0 ? 1 : level === 1 ? clamp01(vis.hint) : level === 2 ? Math.min(RARE_MAX, clamp01(vis.full)) : 0;
  }

  const api = { SLOT, LEAD, HINT, ROUND, RARE, RARE_MAX, PARTS, EYES_ONLY, hash, at, held, asked, damp, of };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamVis = api;
})(typeof window !== 'undefined' ? window : globalThis);
