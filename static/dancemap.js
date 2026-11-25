// #235: the dance mapping – what a movement does, as data. A table of rows, each "source → target" with a curve, an
// input range, an output range and a smoothing time; kept in one file by the server (dance.py). The built-in
// gestures, gestures taught later and anything learned by showing only fill this table – nothing else decides what a
// movement steers. Pure computation: the stage runs it every frame, the Node tests the same way.
//
// A source is a name in the feature stream's record (dance.js: "energy", "open", "g.throw", "l.palm" …).
// A target is a name of the one target interface: the instant layer ("fx.<effect>": that effect's amount, "fx.amt":
// all effects, "fx.pulse": the beat's push, "fx.spin": turning, either way) and the slow AI sliders ("ai.strength",
// "ai.mix", "ai.zoom", "ai.rot", "ai.hue": added on top of the slider). #249: also the tempo of the picture's own motion
// ("fx.speed"), how calm the dream is ("stage.calm"), the direct interaction ("touch.paint", "touch.warp",
// "touch.impulse", "touch.light", "touch.shape": movement shapes the effects) and, slow, the prompt between its calm
// and its wild words ("ai.prompt") and the push of the movement's speed on the AI sliders ("ai.react"). Whether a
// target is fast or slow the mapping knows (`kind`); the stage only asks what each target is at.
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const CURVES = { lin: x => x, soft: x => Math.sqrt(x), hard: x => x * x, s: x => x * x * (3 - 2 * x) };
  // a value bent by the curve of that name – one of the table above, whatever a row says
  const bend = (name, x) => (name === 'soft' ? CURVES.soft(x) : name === 'hard' ? CURVES.hard(x) : name === 's' ? CURVES.s(x) : CURVES.lin(x));
  const AI = ['strength', 'mix', 'zoom', 'rot', 'hue'];
  const MORE = { instant: ['stage.calm', 'touch.paint', 'touch.warp', 'touch.impulse', 'touch.light', 'touch.shape'], slow: ['ai.prompt', 'ai.react'] };
  const BIPOLAR = new Set(['fx.spin', 'ai.rot', 'ai.zoom']);     // targets that go both ways around their rest at 0
  const SLOW_MIN = 0.5;                                // seconds: an AI slider is never moved faster than the AI paints
  // every target there is, given the effects of the instant layer (DreamFx.ALL): name → 'instant' | 'slow'
  function targets(fx) {
    return Object.fromEntries([...['amt', 'pulse', 'spin', 'speed'].map(k => ['fx.' + k, 'instant']), ...fx.filter(e => e !== 'invert').map(e => ['fx.' + e, 'instant']),
      ...MORE.instant.map(k => [k, 'instant']), ...AI.map(k => ['ai.' + k, 'slow']), ...MORE.slow.map(k => [k, 'slow'])]);
  }
  const kind = dst => (dst.startsWith('ai.') ? 'slow' : 'instant');

  // what one row makes of its source right now, before smoothing: 0 while the source is not known (confidence low)
  function shape(row, value, conf) {
    if (!(conf >= 0.25) || !Number.isFinite(value)) return 0;
    const [lo, hi] = row.in, [a, b] = row.out;
    const n = hi === lo ? (value >= hi ? 1 : 0) : clamp((value - lo) / (hi - lo), 0, 1);
    return a + (b - a) * bend(row.curve, n);
  }

  function create() {
    const held = new Map();                            // row id → its smoothed value
    // rows: the table; frame: a record of the feature stream (or null: nothing known); dt: seconds since the last call.
    // Returns {target: value}: per target the row that asks for most; a target nobody asks for is absent.
    function apply(rows, frame, dt) {
      const out = {}, live = new Set();
      for (const row of rows) {
        live.add(row.id);
        const want = row.on && frame ? shape(row, frame.v[row.src], frame.c[row.src]) : 0;
        const tau = Math.max(row.smooth || 0, kind(row.dst) === 'slow' ? SLOW_MIN : 0), was = held.get(row.id) || 0;
        const now = tau > 0 ? was + (want - was) * (1 - Math.exp(-dt / tau)) : want;
        held.set(row.id, Math.abs(now) < 1e-4 && want === 0 ? 0 : now);
        const v = held.get(row.id);
        if (v !== 0 && (out[row.dst] === undefined || Math.abs(v) > Math.abs(out[row.dst]))) out[row.dst] = v;
      }
      for (const id of held.keys()) if (!live.has(id)) held.delete(id);
      return out;
    }
    return { apply, of: id => held.get(id) || 0, reset: () => held.clear() };
  }

  const api = { create, shape, targets, kind, CURVES, BIPOLAR, AI, SLOW_MIN };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamDanceMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
