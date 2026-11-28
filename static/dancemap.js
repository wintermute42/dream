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
// and its wild words ("ai.prompt") and the push of the movement's speed on the AI sliders ("ai.react").
// #236: … and the piece of prompt a taught move brings along ("ai.piece": blended in by as much as the row says).
// Whether a target is fast or slow the mapping knows (`kind`); the stage only asks what each target is at.
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  // #265: "v" – both ways alike: a source that goes both ways (turning, its input range -1 … 1) acts by how far it is
  // from its rest in the middle, whichever way
  const CURVES = { lin: x => x, soft: x => Math.sqrt(x), hard: x => x * x, s: x => x * x * (3 - 2 * x), v: x => Math.abs(2 * x - 1) };
  // a value bent by the curve of that name – one of the table above, whatever a row says
  const bend = (name, x) => (name === 'soft' ? CURVES.soft(x) : name === 'hard' ? CURVES.hard(x) : name === 's' ? CURVES.s(x) : name === 'v' ? CURVES.v(x) : CURVES.lin(x));
  const AI = ['strength', 'mix', 'zoom', 'rot', 'hue'];
  const MORE = { instant: ['stage.calm', 'touch.paint', 'touch.warp', 'touch.impulse', 'touch.light', 'touch.shape'], slow: ['ai.prompt', 'ai.react', 'ai.piece'] };
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

  // ---------- #265: the rules that keep every effect visible ----------
  // Effects of one group cancel each other out or wash the picture out when they act together (three symmetries over
  // each other, afterglow and feedback, pixel, grid and glitch). With the rules on – the dance's table, compiled from its sentences – the
  // engine enforces, whatever the table says (an old file, a hand-made row):
  // - one effect per group: of a group only the strongest acts strongly, the others are held back to a hint (WEAK);
  // - a budget: at most BUDGET groups act strongly at once – when one more comes in (an accent), the weakest of the
  //   others steps back for as long as it lasts (in DUCK_IN seconds) and comes back softly (DUCK_OUT);
  // - a minimum: a row that moves an effect reaches at least MIN at its peak – a sentence is there or not, never
  //   "almost nothing".
  const GROUPS = { symmetry: ['kaleido', 'mandala', 'mirror'], space: ['tunnel', 'waves'], afterglow: ['trails', 'feedback'],
    disturbance: ['rgb', 'glitch', 'pixel', 'raster'], colour: ['hue'] };
  const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, list]) => list.map(e => ['fx.' + e, g])));
  const RULES = { BUDGET: 3, STRONG: 0.2, WEAK: 0.12, MIN: 0.35, DUCK_IN: 0.12, DUCK_OUT: 0.8, FRESH: 1.5, SWAP: 0.05 };
  const groupOf = dst => GROUP_OF[dst] || null;
  // a row as the rules let it act: an effect's peak at least MIN (the same row when it already is)
  function floored(row) {
    if (!groupOf(row.dst) || !Array.isArray(row.out)) return row;
    const peak = row.out[1];
    return Math.abs(peak) >= RULES.MIN ? row : { ...row, out: [row.out[0], peak < 0 ? -RULES.MIN : RULES.MIN] };
  }
  // the group and budget rules over one frame's targets – with a memory: who leads a group, since when a group acts
  // strongly, how far each effect stepped back
  function governor() {
    const lead = new Map(), since = new Map(), duck = new Map();
    let t = 0;
    function step(out, dt) {
      t += dt;
      const cap = {}, strong = [];
      for (const [g, list] of Object.entries(GROUPS)) {
        const here = list.map(e => 'fx.' + e).filter(d => out[d] > 0);
        if (!here.length) { lead.delete(g); since.delete(g); continue; }
        // the one that leads stays leading until another is clearly stronger (no flicker between two equal ones)
        let first = lead.get(g);
        const best = here.reduce((a, d) => (out[d] > out[a] ? d : a));
        if (!here.includes(first) || out[best] > out[first] + RULES.SWAP) first = best;
        lead.set(g, first);
        for (const d of here) if (d !== first && out[d] > RULES.WEAK) cap[d] = RULES.WEAK;
        if (out[first] > RULES.STRONG) { if (!since.has(g)) since.set(g, t); strong.push({ g, d: first, v: out[first], at: since.get(g) }); }
        else since.delete(g);
      }
      if (strong.length > RULES.BUDGET) {
        // what has just come in keeps its place (the accent is the point), then the strongest; the rest steps back
        const fresh = s => t - s.at < RULES.FRESH;
        strong.sort((a, b) => (fresh(a) !== fresh(b) ? (fresh(a) ? -1 : 1) : fresh(a) ? b.at - a.at : b.v - a.v));
        for (const s of strong.slice(RULES.BUDGET)) cap[s.d] = RULES.WEAK;
      }
      for (const d of new Set([...Object.keys(out).filter(groupOf), ...duck.keys()])) {
        const v = out[d] || 0, want = cap[d] != null && v > 0 ? cap[d] / v : 1, was = duck.has(d) ? duck.get(d) : 1;
        const k = was + (want - was) * (1 - Math.exp(-dt / (want < was ? RULES.DUCK_IN : RULES.DUCK_OUT)));
        if (k > 0.999 && want === 1) duck.delete(d); else duck.set(d, k);
        if (v) out[d] = v * k;
      }
      return out;
    }
    return { step, of: d => (duck.has(d) ? duck.get(d) : 1), reset() { lead.clear(); since.clear(); duck.clear(); t = 0; } };
  }

  // ---------- #266: a dancer's own measures ----------
  // The base movements as one dancer moves them: their calm and their wild, measured on the page of Dream Dance
  // (dancecal.js) and kept per person (danceprofiles.py). cal: {feature: {from: [lo, hi], to: [lo, hi]}} – the dancer's
  // range and the standard range of the same base movement; turning goes both ways, its ranges are how far. A frame
  // read through it has the dancer's calm where the standard calm is and their wild where the standard wild is: every
  // row (the sentences, the beat's push, the prompt) acts on the dancer's 0 … 100 %. Only the four base movements are
  // read so – gestures, hands, the beat stay as the stream says; null (the standard measures): the frame as it is.
  const BASE = { energy: [0, 1], open: [0, 1], height: [0, 1], turn: [-1, 1] };   // where each base movement lives
  function calibrate(frame, cal) {
    if (!frame || !cal || !frame.v) return frame;
    let v = null;
    for (const k of Object.keys(BASE)) {
      const c = cal[k], x = frame.v[k];
      if (!c || !Array.isArray(c.from) || !Array.isArray(c.to) || !Number.isFinite(x)) continue;
      const [a, b] = c.from, [p, q] = c.to;
      if (!(b - a > 1e-6) || !Number.isFinite(p + q)) continue;
      const y = p + (q - p) * ((k === 'turn' ? Math.abs(x) : x) - a) / (b - a);
      v = v || { ...frame.v };
      v[k] = k === 'turn' ? Math.sign(x) * clamp(y, 0, 1) : clamp(y, BASE[k][0], BASE[k][1]);
    }
    return v ? { ...frame, v } : frame;
  }
  // The reading for `calibrate` from a profile's bounds ({feature: [lo, hi]}) and the standard ranges (the same shape):
  // a base movement measured as the standard is not read anew. No bounds: null.
  function calOf(bounds, std) {
    if (!bounds || !std) return null;
    const out = {};
    for (const k of Object.keys(BASE)) {
      const f = bounds[k], t = std[k];
      if (Array.isArray(f) && Array.isArray(t) && (f[0] !== t[0] || f[1] !== t[1])) out[k] = { from: f.slice(0, 2), to: t.slice(0, 2) };
    }
    return Object.keys(out).length ? out : null;
  }

  function create() {
    const held = new Map();                            // row id → its smoothed value
    const rules = governor();
    // rows: the table; frame: a record of the feature stream (or null: nothing known); dt: seconds since the last call;
    // opts.rules (#265): the groups, the budget and the minimum apply. Returns {target: value}: per target the row that
    // asks for most; a target nobody asks for is absent.
    function apply(rows, frame, dt, opts = {}) {
      const out = {}, live = new Set();
      for (const r of rows) {
        const row = opts.rules ? floored(r) : r;
        live.add(row.id);
        const want = row.on && frame ? shape(row, frame.v[row.src], frame.c[row.src]) : 0;
        const tau = Math.max(row.smooth || 0, kind(row.dst) === 'slow' ? SLOW_MIN : 0), was = held.get(row.id) || 0;
        const now = tau > 0 ? was + (want - was) * (1 - Math.exp(-dt / tau)) : want;
        held.set(row.id, Math.abs(now) < 1e-4 && want === 0 ? 0 : now);
        const v = held.get(row.id);
        if (v !== 0 && (out[row.dst] === undefined || Math.abs(v) > Math.abs(out[row.dst]))) out[row.dst] = v;
      }
      for (const id of held.keys()) if (!live.has(id)) held.delete(id);
      if (opts.rules) rules.step(out, dt); else rules.reset();
      return out;
    }
    return { apply, of: id => held.get(id) || 0, duck: d => rules.of(d), reset: () => { held.clear(); rules.reset(); } };
  }

  const api = { create, shape, targets, kind, floored, governor, groupOf, calibrate, calOf, CURVES, BIPOLAR, AI, SLOW_MIN, GROUPS, RULES, BASE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamDanceMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
