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
//   light.dance(out, rec, now);   // #270: every frame, the dance's targets (`led.…`) and the stream's record
//
// #270: the dance lights the chain too (wled.py's layers). Its flash and its running pulse are sentences of accents:
// when their target rises (a gesture came) the stage tells Dream – {"led": {"dflash": 0…1}}, {"led": {"chase": 0…1,
// "dir": ±1}} with the way the hands went just now – at the target's peak (its rise is over, or after PEAK ms: the
// sentence's strength, not the first moment of the rise), then once more every AGAIN ms while the gesture goes on (a
// circle drawn again and again runs one light after the other) and anew only after the target was back at rest – never
// a stroboscope. The brightness (how far the chain is dimmed, 0…1) travels with the colour.
(function (root) {
  'use strict';
  const SIDE = 16;           // 256 points of the picture: enough for its average, nothing for the graphics card
  const EVERY = 80;          // ms between two looks (12.5 a second; Dream glides between them)
  const RISE = 0.08, REST = 0.03;   // #270: an accent's target above RISE sets one off, below REST the next may come
  const PEAK = 120, AGAIN = 700;    // #270: ms – the longest wait for an accent's peak; while it goes on, one more every AGAIN
  const SWING = 0.25;        // s: how long the way of the hands is averaged over for the pulse's direction

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

  // #270: which way the hands go (along the camera's left–right, as the stage shows the dancer): the sideways speed
  // of the faster hand, averaged over SWING seconds. hands: the stream's {l: [u, v] | null, r: …}; → -1, 1 or 0
  function sway() {
    const was = {}, vel = { l: 0, r: 0 };
    let t = null;
    return {
      step(hands, now) {
        const dt = t == null ? 0 : Math.min(0.2, Math.max(0, (now - t) / 1000)); t = now;
        for (const h of ['l', 'r']) {
          const p = hands && hands[h], u = p && Number.isFinite(p[0]) ? p[0] : null;
          if (u == null) { was[h] = null; vel[h] *= dt ? Math.exp(-dt / SWING) : 1; continue; }
          if (was[h] != null && dt > 0) vel[h] += ((u - was[h]) / dt - vel[h]) * (1 - Math.exp(-dt / SWING));
          was[h] = u;
        }
      },
      get dir() {
        const v = Math.abs(vel.l) > Math.abs(vel.r) ? vel.l : vel.r;
        return Math.abs(v) < 0.05 ? 0 : Math.sign(v);
      },
    };
  }

  function create({ pixels, send }) {
    let at = -1e9, on = false, cost = 0, looks = 0, dim = 0, dimSaid = 0, lastDir = 1;
    const round = v => Math.round(Math.min(1, Math.max(0, +v || 0)) * 1000) / 1000;
    const acc = { 'led.flash': { st: 'rest' }, 'led.chase': { st: 'rest' } }, hands = sway();   // rest → rising → sent
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
        // the brightness of the dance with the colour – and once more when it is gone, so Dream lets go of it at once
        const d = round(dim), led = d > 0 || dimSaid > 0 ? { rgb, dim: d } : { rgb };
        dimSaid = d;
        send({ led });
        return true;
      },
      dance(out, rec, now) {
        out = out || {};
        hands.step(rec && rec.hands, now);
        if (hands.dir) lastDir = hands.dir;
        dim = Math.min(1, Math.max(0, -(+out['led.level'] || 0)));
        const fire = (k, v) => send({ led: k === 'led.flash' ? { dflash: round(v) } : { chase: round(v), dir: lastDir } });
        for (const [k, a] of Object.entries(acc)) {
          const v = Math.max(0, +out[k] || 0);
          if (!on || v < REST) { a.st = 'rest'; continue; }
          if (a.st === 'rest') { if (v > RISE) Object.assign(a, { st: 'rising', top: v, at: now }); continue; }
          a.top = Math.max(a.top, v);
          if (a.st === 'rising' ? v < a.top * 0.97 || now - a.at >= PEAK : now - a.at >= AGAIN && v > RISE) {
            fire(k, a.top);
            Object.assign(a, { st: 'sent', top: 0, at: now });
          }
        }
      },
      beat(v) { if (on && +v > 0) send({ led: { beat: round(v) } }); },
      flash(v = 1) { if (on && +v > 0) send({ led: { flash: round(v) } }); },
    };
  }

  const api = { create, mean, sway, SIDE, EVERY, RISE, REST, PEAK, AGAIN };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamRoomLight = api;
})(typeof window !== 'undefined' ? window : globalThis);
