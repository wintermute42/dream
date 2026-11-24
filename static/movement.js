// #249: the movement engine. One engine for everything that moves the dream: every source feeds the one feature stream
// (dance.js), every effect runs through the one mapping table (dancemap.js), and a mode – off, mood, flowtrack, dance;
// one at a time – is only a preset: which kinds of sources it listens to, whether it needs the Mac's camera, and its
// table (Dream keeps the tables: dance.py; the modes are the same list as movement.py's). Pure computation, no DOM, no
// camera, no network: the stage feeds it frame by frame, the Node tests the same way (tests/js/movement.test.mjs).
//
// What it does:
// - the register of sources: the Mac's camera (hands, pose and fingers, fire and LEDs, LED markers), Dreamy Eyes
//   (their front camera – the energy is worked out on the phone, `sight` below, and only that number travels), a
//   phone that lends its motion (Dream Control) and a wristband or glove over OSC. Each with its name, its kind and
//   its state (active, values a second, confidence); a kind can be switched off. Dream windows are no source.
// - the room's energy: the mean of all sources the mode listens to, weighted by how sure each one is, written into
//   the stream's record (`energy`, `still`) together with `present` (someone is there at all).
// - the mode: its table is applied to the record; a change of mode fades the old table's effect out while the new
//   one's fades in (FADE seconds, eased) – never a jolt.
// - the clutch of the dance (#251): what the hands and the controllers set is the base, the dance acts on top of it
//   (`onTop`) – and only while the clutch is engaged. Engaging and releasing fades the dance's part in and out in
//   CLUTCH seconds; released, only the base is left.
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const KINDS = ['camera', 'eyes', 'phone', 'band'];
  const MODES = {
    off: { sources: [], camera: false },
    mood: { sources: ['eyes', 'phone', 'band', 'camera'], camera: false },   // the camera only when asked for
    flowtrack: { sources: ['camera', 'band', 'phone'], camera: true },
    dance: { sources: ['camera', 'band', 'phone'], camera: true },
  };
  const TABLES = Object.keys(MODES).filter(m => m !== 'off');
  const FADE = 0.6;                                    // seconds a change of mode takes
  const CLUTCH = 0.3;                                  // seconds the dance takes to come in or go out with its clutch
  const ease = x => x * x * (3 - 2 * x);
  const modeOf = m => (Object.prototype.hasOwnProperty.call(MODES, m) ? m : 'off');
  const offSet = off => new Set(String(off || '').split('+').filter(k => KINDS.includes(k)));

  // Does the mode listen to this kind of source right now? opts: {off: "eyes+band" (kinds switched off), cam: the
  // mood also takes the Mac's camera}
  function uses(mode, kind, opts = {}) {
    const m = MODES[modeOf(mode)];
    if (!m.sources.includes(kind) || offSet(opts.off).has(kind)) return false;
    return kind !== 'camera' || m.camera || !!opts.cam;
  }
  // the Mac's camera runs only for a mode that needs it
  const cameraOn = (mode, opts) => uses(mode, 'camera', opts);
  // What the Mac's camera detects in a mode ('hand' | 'on' | 'marker'): the dance has its own choice (hands or LED
  // markers – never light: a lamp or a bright window would stand in for the hands), every other mode the camera's.
  // kinds: {flow, dance} – the settings flow_kind and dance_kind.
  const DANCE_KINDS = ['hand', 'marker'];
  function camKind(mode, kinds = {}) {
    if (modeOf(mode) === 'dance') return DANCE_KINDS.includes(kinds.dance) ? kinds.dance : 'hand';
    return ['hand', 'on', 'marker'].includes(kinds.flow) ? kinds.flow : 'hand';
  }

  // The room's energy from many sources: [{energy, conf}] → {energy, conf}. A mean weighted by confidence, so one
  // lively device does not rule a quiet room; how sure the room is rises with every source that agrees to be there.
  function room(list) {
    let sum = 0, weight = 0, unsure = 1;
    for (const s of list) {
      if (!(s.conf > 0) || !Number.isFinite(s.energy)) continue;
      sum += clamp(s.energy, 0, 1) * s.conf; weight += s.conf; unsure *= 1 - clamp(s.conf, 0, 1);
    }
    return weight > 0 ? { energy: sum / weight, conf: 1 - unsure } : { energy: 0, conf: 0 };
  }

  // The base and the dance on top of it: what a slider, a button or a MIDI controller set stays, the movement adds its
  // part – a controller moved while dancing shifts the base, the dance stays on top. Held inside the target's range.
  const onTop = (base, dance, lo = 0, hi = 1) => clamp((Number.isFinite(+base) ? +base : 0) + (Number.isFinite(+dance) ? +dance : 0), lo, hi);

  // ---------- Dreamy Eyes: how much moves in front of a camera, from two small pictures ----------
  // look(data, w, h): RGBA pixels of a small sample of the camera (the same size every time) → {e, c}: the share of
  // the picture that changed since the last look as an energy 0 … 1 (rises at once, falls in about half a second) and
  // how sure that is (a dark picture is mostly noise). Only the brightness of the last sample is kept, for the next
  // comparison – no picture is stored or sent.
  function sight() {
    let was = null, e = 0, at = null;
    return {
      look(data, w, h, t) {
        const n = w * h, now = new Uint8Array(n);
        let changed = 0, light = 0;
        for (let i = 0, p = 0; i < n; i++, p += 4) {
          const y = (data[p] * 3 + data[p + 1] * 6 + data[p + 2]) / 10;
          now[i] = y; light += y;
          if (was && Math.abs(y - was[i]) > 18) changed++;
        }
        const fresh = was && was.length === n, dt = at == null || t == null ? 1 / 15 : clamp(t - at, 0.01, 1);
        was = now; at = t == null ? null : t;
        const raw = fresh ? clamp((changed / n - 0.01) / 0.24, 0, 1) : 0;
        e += (raw - e) * (raw > e ? Math.min(1, dt / 0.08) : Math.min(1, dt / 0.5));
        return { e: +e.toFixed(3), c: fresh ? +clamp(light / n / 40, 0.2, 1).toFixed(2) : 0 };
      },
      reset() { was = null; e = 0; at = null; },
    };
  }

  // ---------- the engine ----------
  // maps: the mapping module (DreamDanceMap). One mapping per mode keeps that mode's smoothing while it fades.
  function create({ maps }) {
    const map = Object.fromEntries(TABLES.map(m => [m, maps.create()]));
    const gain = Object.fromEntries(TABLES.map(m => [m, 0]));
    let still = 0, frame = null, list = [], mixed = { energy: 0, conf: 0 }, started = false, hold = 1;

    // The record the tables read: the stream's (or an empty one), with the room's energy in place of the stream's own.
    // rec: the feature stream's record or null; cam: {energy, conf} of the camera when the stream has none (a kind of
    // detection that knows no hands); remote: Dream's list of the sources outside the stage.
    function blend(rec, cam, remote, dt) {
      const parts = [], srcs = [];
      if (rec && rec.c.energy > 0) { parts.push({ energy: rec.v.energy, conf: rec.c.energy }); srcs.push(rec.src.energy); }
      else if (cam && cam.conf > 0) { parts.push(cam); srcs.push('camera'); }
      // phones and wristbands are in the stream already (dance.js weighs them against the camera); the eyes join here
      for (const s of remote) if (s.kind === 'eyes' && s.active && s.used && s.conf > 0) { parts.push(s); if (!srcs.includes('eyes')) srcs.push('eyes'); }
      mixed = room(parts);
      // (#253: a record fitted to a performer's profile carries that person's energy – its stillness is worked out here)
      const only = parts.length === 1 && rec && rec.c.energy > 0 && !rec.fit;
      const calm = 1 - clamp((mixed.energy - 0.03) / 0.09, 0, 1);       // as the stream's own stillness, for the room
      still = mixed.conf > 0 ? still + (calm - still) * Math.min(1, dt / (calm > still ? 0.5 : 0.08)) : 0;
      const base = rec || { t: 0, v: {}, c: {}, src: {}, bpm: 0, gesture: null, gc: 0, size: 0, g: {}, hands: { l: null, r: null }, events: [] };
      const src = srcs.filter(Boolean).join('+');
      return { ...base,
        v: { ...base.v, energy: +mixed.energy.toFixed(4), still: only ? base.v.still : +still.toFixed(4), present: mixed.conf > 0 ? 1 : 0 },
        c: { ...base.c, energy: +mixed.conf.toFixed(3), still: +mixed.conf.toFixed(3), present: 1 },
        src: { ...base.src, energy: src, still: src, present: src } };
    }

    // One frame of the stage. in: {mode, tables: {mode: rows}, rec, cam, remote, strength (how strongly the mood
    // acts, 1 = as its table says), clutch (the dance's: engaged or not), dt (s)}. Returns {target: value} – what every
    // target of the one interface is at.
    function step({ mode, tables = {}, rec = null, cam = null, remote = [], strength = 1, clutch = true, dt = 1 / 60 }) {
      mode = modeOf(mode); list = remote;
      const fading = TABLES.some(m => m !== mode && gain[m] > 0);
      frame = mode === 'off' && !fading ? null : blend(rec, cam, remote, dt);
      if (!frame) { still = 0; mixed = { energy: 0, conf: 0 }; }
      hold = started ? clamp(hold + (clutch ? dt : -dt) / CLUTCH, 0, 1) : clutch ? 1 : 0;
      const out = {};
      for (const m of TABLES) {
        // the first frame starts in its mode (a page that loads does not fade in); afterwards every change glides
        gain[m] = started ? clamp(gain[m] + (m === mode ? dt : -dt) / FADE, 0, 1) : m === mode ? 1 : 0;
        if (gain[m] <= 0) { map[m].reset(); continue; }
        // a mode on its way out still reads the stream – its effect leaves with its gain, not in one frame
        const got = map[m].apply(tables[m] || [], frame, dt), k = ease(gain[m]) * (m === 'mood' ? clamp(strength, 0, 3) : m === 'dance' ? ease(hold) : 1);
        for (const dst of Object.keys(got)) out[dst] = clamp((out[dst] || 0) + k * got[dst], -1, 1);
      }
      started = true;
      return out;
    }

    // The register as the panel shows it: the Mac's camera first (camera: {name, rate, conf, energy, running} – what
    // the stage knows of it), then Dream's list. opts as in `uses`.
    function sources(mode, opts, camera) {
      const c = camera || {}, on = !offSet(opts && opts.off).has('camera'), active = !!c.running && c.rate > 0;
      return [{ id: 'camera', kind: 'camera', name: c.name || 'Mac camera', on, used: uses(mode, 'camera', opts), active,
        rate: active ? Math.round(c.rate) : 0, conf: active ? +clamp(c.conf || 0, 0, 1).toFixed(2) : 0, energy: active ? +clamp(c.energy || 0, 0, 1).toFixed(3) : 0 },
      ...list.map(s => ({ ...s }))];
    }
    return { step, sources, of: (m, id) => (map[m] ? map[m].of(id) : 0), gain: m => gain[m] || 0,
      get frame() { return frame; }, get room() { return mixed; }, get hold() { return hold; } };
  }

  // the kinds of the register in one line each, for a short display: [{kind, n, on, used, active}]
  function byKind(list) {
    return KINDS.map(kind => {
      const mine = list.filter(s => s.kind === kind);
      return { kind, n: mine.length, on: mine.length ? mine.every(s => s.on) : null, used: mine.some(s => s.used), active: mine.some(s => s.active) };
    });
  }

  const api = { create, uses, cameraOn, camKind, DANCE_KINDS, room, sight, byKind, onTop, modeOf, MODES, TABLES, KINDS, FADE, CLUTCH };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamMove = api;
})(typeof window !== 'undefined' ? window : globalThis);
