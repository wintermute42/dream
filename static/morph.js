// #215: the motion between the AI pictures (#194) as one continuous camera, as plain numbers – shared by the stage
// (index.html), the output windows (output.html) and their drawings (fx.js, gl-stage.js); tests/js/morph.test.mjs
// runs it in Node.
//
// A phase says how far the dream has moved: {r: turned, in degrees; l: zoomed, as ln(scale)} – both add up from
// picture to picture. Every AI picture has the phase of the picture its input was built from plus the step that
// feedback() painted into that input (step()). The camera runs through these phases at the pace the pictures
// really advance (arrive()), and a picture is shown moved by camera − its own phase (record(), moved()). So a
// picture that comes late, or one of several requests on their way at once, joins the motion where it belongs
// instead of starting it anew – nothing on the stage ever moves back.
(function (root) {
  'use strict';
  const AXES = ['r', 'l'];
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const zero = () => ({ r: 0, l: 0 });
  const WINDOW = 5;                                    // pictures the pace is read from (four gaps: up to four requests at once)
  const LIMIT = { r: 20, l: 0.25 };                    // further than this from where it should be, the camera is set right
  const AHEAD = 0.3;                                   // the camera keeps this share of a picture's way ahead: a picture that comes early still joins it
  // for one and a half times the expected time until the next picture the motion runs evenly (a picture that is a
  // little late joins a camera that never slowed down); past that it eases out, half a period more at most, instead
  // of running away when the pictures stop
  const ease = k => (k <= 0 ? 0 : k <= 1.5 ? k : 1.5 + 0.5 * (1 - Math.exp(-(k - 1.5) * 2)));
  const run = (period, dt) => ease(dt / period) * period;   // the way after dt ms, in ms at full pace

  // the phase of a picture whose input is the picture at `base`, zoomed by 1 + zoom and turned by rot degrees
  const step = (base, zoom, rot) => ({ r: base.r + rot, l: base.l + Math.log(Math.max(0.05, 1 + zoom)) });
  // where the camera {t0, period, c0, v} is at `now`
  function at(cam, now) {
    const k = run(cam.period, now - cam.t0);
    return { r: cam.c0.r + cam.v.r * k, l: cam.c0.l + cam.v.l * k };
  }
  // A picture with phase c arrives at `now` (c null: it builds on no picture before it – a fresh start, an input
  // passed through); period: the expected time until the next one. st: what the call before returned (null at the
  // start). Returns the camera from now on: {cam, hist, w, phase (of this picture), lead (camera − phase: how far
  // the picture is shown moved right now)}.
  // The pace w is how fast the phases of the last pictures really advanced – with two requests at once two dreams
  // alternate, and each picture brings only half a step. The camera aims at the line of that pace through the
  // picture that is furthest ahead (plus AHEAD), and closes what it is off by over two periods: it never jumps and
  // never turns back.
  function arrive(st, c, now, period) {
    period = Math.round(clamp(+period || 400, 80, 3000));
    const was = st && st.cam ? at(st.cam, now) : null;
    if (!c || !was) {
      const p = c || was || zero();
      return { cam: { t0: now, period, c0: p, v: zero() }, hist: [{ t: now, c: p }], w: zero(), phase: p, lead: zero() };
    }
    const last = st.hist[st.hist.length - 1];
    const hist = (last && now - last.t > 4 * period ? [] : st.hist.slice(1 - WINDOW)).concat([{ t: now, c }]);   // a pause: start reading anew
    const c0 = {}, v = {}, w = {}, lead = {}, span = now - hist[0].t;
    if (hist.length > 1 && span > 0) period = Math.round(clamp(span / (hist.length - 1), 80, 3000));   // as the pictures really came
    for (const a of AXES) {
      w[a] = hist.length > 1 && span > 0 ? (c[a] - hist[0].c[a]) / span : st.w[a];
      let line = c[a];                                 // where the camera should be now
      for (const h of hist) { const x = h.c[a] + w[a] * (now - h.t); line = w[a] > 0 ? Math.max(line, x) : w[a] < 0 ? Math.min(line, x) : line; }
      line += AHEAD * w[a] * period;
      c0[a] = line + clamp(was[a] - line, -LIMIT[a], LIMIT[a]);
      v[a] = w[a] - (c0[a] - line) / (2 * period);
      if (w[a] && v[a] * w[a] < 0) v[a] = 0;           // too far ahead: it waits, it does not turn back
      lead[a] = c0[a] - c[a];
    }
    return { cam: { t0: now, period, c0, v }, hist, w, phase: c, lead };
  }
  // What a picture element is told: it is shown moved by {r0, l0} now and goes on at {vr, vl} per ms (eased like the
  // camera), around the pivot (px, py; 0…1). gain: how much of the motion shows (the "motion between the pictures"
  // slider times the dream's share of the picture). null: the picture rests.
  function record(arrival, gain, px, py) {
    const g = +gain || 0, { lead, cam } = arrival;
    const m = { r0: +(g * lead.r).toFixed(4), l0: +(g * lead.l).toFixed(6), vr: +(g * cam.v.r).toFixed(7), vl: +(g * cam.v.l).toFixed(9),
      period: cam.period, px: +clamp(px, 0, 1).toFixed(3), py: +clamp(py, 0, 1).toFixed(3) };
    return m.r0 || m.l0 || m.vr || m.vl ? m : null;
  }
  // a record as it came over a line: only numbers that can be drawn
  const valid = m => !!m && typeof m === 'object' && ['r0', 'l0', 'vr', 'vl', 'period', 'px', 'py'].every(k => Number.isFinite(m[k])) && m.period > 0;
  // how far a picture with record m is moved dt ms after it was told: {r (degrees), l (ln scale)}. A picture that is
  // ahead of the camera waits for it rather than being shown smaller than the stage (its edges would show).
  function moved(m, dt) {
    const k = run(m.period, dt), l = m.l0 + m.vl * k;
    return { r: m.r0 + m.vr * k, l: (m.vl > 0 && l < 0) || (m.vl < 0 && l > 0) ? 0 : l };
  }

  const api = { step, at, arrive, record, valid, moved, ease, zero };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamMorph = api;
})(typeof window !== 'undefined' ? window : globalThis);
