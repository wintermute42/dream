// #211: soft switches – a new input or a new prompt blends in over about 3 s instead of jumping. Pure computation, no
// DOM: the stage (index.html) keeps the pictures and the prompts and asks here for the shares; the Node tests
// (tests/js/soft.test.mjs) ask the same way.
//
// - input: the stage keeps the last input picture it built before the switch and lays it over the new source with
//   oldShare() – 1 at the new source's first frame, 0 after SECS. A switch during a running blend keeps the mix that
//   was just built, so it goes on from exactly what the AI saw last.
// - prompt: the renderer blends two prompts (prompt, prompt2 and pt, the share of prompt2). A fade is
//   { from, start, dur, p0 }: from the prompt `from` to the current one, starting at share p0. Two prompts cannot
//   hold three: a change during a running fade keeps the stronger of the two at exactly its share and swaps the weaker
//   one for the new prompt (going back to the old prompt keeps both, so that is exact).
(function (root) {
  'use strict';
  const SECS = 3;
  const smooth = t => t * t * (3 - 2 * t);
  const unit = t => Math.min(1, Math.max(0, t));

  /** the share of the old input picture, `ms` after the new source's first frame: 1 → 0 */
  function oldShare(ms, secs = SECS) { return secs > 0 ? 1 - smooth(unit(ms / (secs * 1000))) : 0; }

  /** the share of the current prompt in the fade `f` at `now` (ms): p0 → 1; 1 means no fade is running */
  function promptShare(f, now) {
    if (!f || !f.from || !(f.dur > 0)) return 1;
    const p0 = unit(f.p0 || 0);
    return p0 + (1 - p0) * smooth(unit((now - f.start) / (f.dur * 1000)));
  }

  /** the prompt changed from `was` to `to`: the fade that runs from `now` on, over `secs` (0: a hard cut) */
  function promptSwitch(f, was, to, now, secs = SECS) {
    if (!(secs > 0) || !was || was === to) return { from: '', start: now, dur: 0, p0: 0 };
    const p = promptShare(f, now), fresh = { from: was, start: now, dur: secs, p0: 0 };
    if (p >= 1) return fresh;
    // a fade from f.from to `was` stands at p: back to f.from, or `was` is the stronger one – it stays, at its share
    if (to === f.from || p >= 0.5) return { ...fresh, p0: 1 - p };
    return { ...fresh, from: f.from, p0: p };          // the old prompt is still the stronger one: it stays
  }

  const api = { SECS, oldShare, promptShare, promptSwitch };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamSoft = api;
})(typeof window !== 'undefined' ? window : globalThis);
