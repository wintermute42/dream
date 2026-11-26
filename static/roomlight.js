// #212: the room light dreams along – the stage's part. What the audience sees is composed here (gl-stage.js), so the
// stage looks at it tiny (SIDE × SIDE pixels, a copy of its own without the master fader, read back without making the
// graphics card wait) about a dozen times a second and tells Dream its average colour; a beat and a flash it tells the
// moment they come. Dream (wled.py) smooths the colour, adds the beat, the strength, the master and its blackout and
// sends it on to the WLED device – the stage never talks to the device and never waits for it.
//
//   const light = DreamRoomLight.create({ pixels: (w, h) => RGBA bytes or null, send: msg => … });
//   light.on = true;          // the setting "wled"
//   light.tick(now);          // every frame, after drawing: looks only every EVERY ms
//   light.beat(0.8); light.flash(1);
(function (root) {
  'use strict';
  const SIDE = 16;           // 256 points of the picture: enough for its average, nothing for the graphics card
  const EVERY = 80;          // ms between two looks (12.5 a second; Dream glides between them)

  // the average colour of RGBA pixels, [r, g, b] 0–255 – or null when nothing is drawn there (all transparent: the
  // first look, before a copy has come back, or no picture yet)
  function mean(px) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i + 3 < px.length; i += 4) {
      if (!px[i + 3]) continue;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
  }

  function create({ pixels, send }) {
    let at = -1e9, on = false, cost = 0, looks = 0;
    const round = v => Math.round(Math.min(1, Math.max(0, +v || 0)) * 1000) / 1000;
    return {
      get on() { return on; },
      set on(v) { on = !!v; },
      // the time one look took on average (ms), for a measurement
      get cost() { return looks ? cost / looks : 0; },
      reset() { cost = 0; looks = 0; },
      tick(now) {
        if (!on || now - at < EVERY) return false;
        at = now;
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        const px = pixels(SIDE, SIDE), rgb = px ? mean(px) : null;
        if (typeof performance !== 'undefined') { cost += performance.now() - t0; looks++; }
        if (!rgb) return false;
        send({ led: { rgb } });
        return true;
      },
      beat(v) { if (on && +v > 0) send({ led: { beat: round(v) } }); },
      flash(v = 1) { if (on && +v > 0) send({ led: { flash: round(v) } }); },
    };
  }

  const api = { create, mean, SIDE, EVERY };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamRoomLight = api;
})(typeof window !== 'undefined' ? window : globalThis);
