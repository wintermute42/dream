/* Dream – how Dreamy Eyes find fire in their camera picture and what they feel about it (#162, #218). Pure computation,
   no DOM: eyes.html hands over the small camera sample (RGBA) and draws what comes back; the Node tests
   (tests/js/fire.test.mjs) hand over painted test pictures the same way.

   look(): flame light is warm (red ≥ green > blue), very bright and saturated – and it flickers. Every pixel gets a
   share between 0 and 1 (soft edges, so a lamp that only shifts by a fraction of a pixel keeps its sum). Warm pixels
   that touch are a patch, followed from picture to picture. A patch is fire when it has a core as bright as the
   camera can show and when, again and again, its summed light, its middle and its outline all change course from one
   picture to the next: a flame changes its size and its shape. A still lamp does none of it; a lamp or a face that
   moves keeps its sum; a dimmed lamp, an LED's beat or the camera's exposure change the sum but not the shape (and
   while the whole picture gets brighter or darker nothing counts at all); a light pulsing with music or a lamp that
   flickers in a phone held in the hand change sum and middle but keep their outline, and a hand waving in warm light
   goes up and down evenly (#233). They believe it only after most of a second.
   think(): what the fire does to them – one of a few moods that take turns, and getting used to a fire that only
   burns on. */
(function (root) {
  'use strict';
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const ramp = (x, a, b) => clamp01((x - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (dt, tau) => 1 - Math.exp(-dt / tau);

  // which light counts as warm: each pair is where a pixel's share starts and where it is full. RULE is close to #162's
  // (bright, saturated, orange to yellow – a little softer at its edges); FACE, inside a face the phone has found, is
  // #162's own. (#218 first tried a much looser rule: in a real room warm walls and lamps then passed for fire.)
  const RULE = { red: [195, 220], sat: [0.36, 0.44], warm: [28, 38], gb: 1.12 };
  const FACE = { red: [205, 225], sat: [0.40, 0.46], warm: [32, 40], gb: 1.15 };
  const CORE = 238;            // a flame's light is so bright that the camera's red is at its end …
  const CORE_SHARE = 0.25;     // … in at least this share of a patch's pixels: skin and walls in warm light are not
  const PAST = 12;             // pictures a patch's light is remembered for
  const EVEN = 0.3;            // a light that goes up and down evenly (an LED's beat with the camera's shutter, even with bands
                               // running through it) is told by this: how little of its course a plain wave leaves unexplained
  const CALM = 0.1;            // … and a light that does so very evenly (#233: skin in warm light that moves, a hand waving – a
                               // flame's light almost never) loses the jumps it made before that was known
  const MAX_BLOBS = 48;        // patches of warm light looked at in one picture
  const REACH = 0.35;          // how far a patch may have moved since the last picture (picture widths): a swung flame is fast
  const FLOOR = 14;            // warm pixels a patch needs before its jumps count in full
  const JUMP = 0.05;           // a jump: the patch's warm light changes its course by this share from one picture to the next
  const WOBBLE = 0.05;         // … and its middle has to change course too, by this share of the patch's radius: a flame
                               // changes its shape – a lamp that only gets brighter and darker (dimmed, an LED's beat, the
                               // camera's exposure) does not
  const BEND = 0.05, BEND_N = 40;   // … and so has its outline (#233: how tall it is against how wide, and which way it leans – both
                               // -1–1, whatever its size and wherever it is), by this much – in a patch of at least BEND_N pixels
                               // (a smaller one's outline is mostly the camera's noise): a flame's tongues rise, fall and sway, a
                               // lamp that pulses with music or flickers while the phone shakes keeps its outline
  const SMALL = 10, SMALL_JUMP = 0.08, SMALL_WAY = 1.5;   // a patch of fewer warm pixels is a small flame: it counts only when
                               // it flickers strongly and travels (sample pixels from one picture to the next: a swung
                               // flame) – small lamps and LEDs in a noisy picture stay where they are
  const SHIFT = 0.04;          // the rest of the picture got brighter or darker by this share: the camera's exposure – no jump counts
  const HITS = [0.8, 4.1];     // jumps lately (each fades by an eighth per picture): a patch is fire above the second number and
                               // stays fire down to the first – a lamp switched on makes three jumps, a fire many
  const E_MIN = 4;             // flickering warm pixels that make a flame (of 96×72: 0.06 % of the picture)
  const FULL = 0.03;           // the share of the picture that is a full fire
  const SURE_MS = 700;         // how slowly they believe it …
  const ON = 0.7, OFF = 0.15, OFF_MS = 1500;   // … on after about 0.85 s of fire, off after 1.5 s without: flames dip for a moment
  const FLARE = 1.6, FLARE_MS = 2500;          // flaring up: this much more than lately, at most this often
  const MOVING = 0.3;          // the flame moves: picture widths a second

  // how much of this light's course a plain wave leaves unexplained, 0–1 (a wave obeys d[t] = c·d[t-1] − d[t-2] around its
  // mean; a flame obeys nothing): below EVEN it goes up and down evenly
  function wave(past) {
    if (past.length < 8) return 1;
    let m = 0; for (const v of past) m += v; m /= past.length;
    let ab = 0, bb = 0;
    for (let i = 2; i < past.length; i++) { const b = past[i - 1] - m; ab += (past[i] - m + past[i - 2] - m) * b; bb += b * b; }
    if (bb < 1e-9) return 0;                           // it does not change at all
    const c = Math.max(-2, Math.min(2, ab / bb));
    let left = 0, all = 0;
    for (let i = 2; i < past.length; i++) { const a = past[i] - m, z = past[i - 2] - m, r = a - c * (past[i - 1] - m) + z; left += r * r; all += a * a + z * z; }
    return all > 0 ? left / all : 0;
  }
  // how warm one pixel is, 0–1
  function warm(r, g, b, rule) {
    const q = rule || RULE;
    if (r <= q.red[0] || r < g || g <= b * q.gb) return 0;
    return ramp(r, q.red[0], q.red[1]) * ramp((r - b) / r, q.sat[0], q.sat[1]) * ramp(g - b, q.warm[0], q.warm[1]);
  }

  // what the eyes know of the fire: on (they see it), level (how strong, 0–1, following it at once), x and y (where in
  // the picture, 0–1), move (how fast it wanders), trend (level against the last seconds: below zero it dies down),
  // flare ({ at, k } – the last flaring up), since and gone (when it came and went)
  function sense() {
    return { on: false, level: 0, sure: 0, x: 0.5, y: 0.5, move: 0, trend: 0, slow: 0, flare: null, since: 0, gone: 0, low: 0,
      e: 0, base: 0, at: 0, cells: null };
  }

  // One camera sample (RGBA, w × h) at time t (ms). face: { x, y, w, h } of a face the phone sees (0–1), or null.
  function look(s, d, w, h, t, face) {
    let c = s.cells;
    if (!c || c.n !== w * h) c = s.cells = { n: w * h, k: new Float32Array(w * h), id: new Int16Array(w * h), stack: new Int32Array(w * h), blobs: [] };
    const warmth = c.k, id = c.id, stack = c.stack;
    // the face as an oval, a little larger than what was found of it
    const fx = face ? face.x * w : 0, fy = face ? face.y * h : 0, fa = face ? face.w * w * 0.62 : 1, fb = face ? face.h * h * 0.68 : 1;
    let any = 0, rest = 0, restN = 0;
    for (let y = 0, i = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4, p++) {
      warmth[p] = 0; id[p] = 0;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      let k = 0;
      if (r > RULE.red[0] && r >= g && g > b * RULE.gb) {
        let rule = RULE;
        if (face) { const u = (x - fx) / fa, v = (y - fy) / fb; if (u * u + v * v < 1) rule = FACE; }
        k = warm(r, g, b, rule);
      }
      if (k > 0) { warmth[p] = r >= CORE ? k + 1 : k; any++; } else { rest += r + g + b; restN++; }   // + 1: a pixel of the core
    }
    // the camera's exposure: the picture beside the warm light gets brighter or darker as a whole
    const dim = restN ? rest / restN / 3 : c.dim || 0, shift = c.dim !== undefined && Math.abs(dim - c.dim) / (c.dim + 8) > SHIFT;
    c.dim = dim; c.shift = shift;
    // the patches of warm light, each with its sum: light that only moves keeps its sum, light that flickers does not
    const before = c.blobs, blobs = c.blobs = [];
    let fire = 0, sx = 0, sy = 0;
    for (let p0 = 0; any > 0 && p0 < w * h && blobs.length < MAX_BLOBS; p0++) {
      if (!(warmth[p0] > 0) || id[p0]) continue;
      const b = { e: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0, tall: 0, lean: 0, tall1: 0, lean1: 0, n: 0, core: 0, e1: 0, x1: 0, y1: 0, hits: 0, age: 0, lit: false, held: 0, past: null, wave: 1, even: false }, mark = blobs.length + 1;
      let top = 0; stack[top++] = p0; id[p0] = mark;
      while (top) {
        const p = stack[--top], x = p % w, y = (p - x) / w;
        let k = warmth[p];
        if (k > 1) { k -= 1; b.core++; }
        b.e += k; b.x += k * x; b.y += k * y; b.xx += k * x * x; b.yy += k * y * y; b.xy += k * x * y; b.n++; any--;
        for (let yy = y > 0 ? y - 1 : 0; yy <= y + 1 && yy < h; yy++) for (let xx = x > 0 ? x - 1 : 0; xx <= x + 1 && xx < w; xx++) {
          const q = yy * w + xx;
          if (warmth[q] > 0 && !id[q]) { id[q] = mark; stack[top++] = q; }
        }
      }
      b.x /= b.e; b.y /= b.e;
      // its outline, as the spread of its light: taller than wide (1) or wider than tall (-1), leaning right or left
      const wide = b.xx / b.e - b.x * b.x + 1 / 12, high = b.yy / b.e - b.y * b.y + 1 / 12;
      b.tall = (high - wide) / (high + wide); b.lean = 2 * (b.xy / b.e - b.x * b.y) / (high + wide);
      let old = null, near = REACH * w, close = 0;     // the patch it was a moment ago: the nearest one
      const reach = Math.sqrt(b.n / Math.PI) + 2;
      for (const o of before) { const dist = Math.hypot(o.x - b.x, o.y - b.y); if (dist < near) { near = dist; old = o; } if (dist < reach + o.r) close++; }
      b.r = reach - 2;
      if (old) {
        b.e1 = old.e; b.x1 = old.x; b.y1 = old.y; b.tall1 = old.tall; b.lean1 = old.lean; b.age = old.age + 1; b.hits = old.hits; b.lit = old.lit; b.held = old.held;
        // a patch that was much larger or smaller a moment ago (#233: a hand that parted from a face) has no course of its own yet
        const same = b.e < 2.5 * old.e + FLOOR && old.e < 2.5 * b.e + FLOOR;
        b.past = !old.past ? [old.e] : same ? old.past.slice(-(PAST - 1)) : []; b.past.push(b.e); b.wave = wave(b.past); b.even = b.wave < EVEN;
        old.heirs = (old.heirs || 0) + 1; b.from = old;
        // a patch that fell apart or grew together with another says nothing this time (a lamp behind bands, a face's edge)
        b.torn = close > 1;
        if (!shift && !b.torn) {
          const mean = (b.e + old.e + old.e1) / 3, turn = Math.abs(b.e - 2 * old.e + old.e1) / (mean + FLOOR);
          const wob = Math.hypot(b.x - 2 * old.x + old.x1, b.y - 2 * old.y + old.y1) / (Math.sqrt(mean / Math.PI) + 0.5);
          const bend = Math.hypot(b.tall - 2 * old.tall + old.tall1, b.lean - 2 * old.lean + old.lean1);
          const small = mean < SMALL && !old.lit;       // a flame they know may get small and stay a flame
          const jump = b.age > 1 && b.core >= CORE_SHARE * b.n && !b.even && (small ? turn > SMALL_JUMP && Math.hypot(b.x - old.x, b.y - old.y) > SMALL_WAY : turn > JUMP && wob > WOBBLE && (b.n < BEND_N || bend > BEND));
          // a light that turned out to go up and down very evenly loses the jumps it made before that was known – unless it
          // has been a flame for a while
          b.hits = b.wave < CALM && old.held < PAST ? 0 : old.hits * 0.88 + (jump ? 1 : 0);
          b.lit = old.lit ? b.hits > HITS[0] : b.hits > HITS[1] && b.past.length >= 8; b.held = b.lit ? old.held + 1 : 0;
        }
      }
      blobs.push(b);
    }
    for (const b of blobs) {
      if (b.from && b.from.heirs > 1 && !b.torn && !shift) { b.hits = b.from.hits; b.lit = b.from.lit; b.held = b.from.held; }   // fallen apart: the jump just counted is taken back
      b.from = null;
      if (b.lit) { fire += b.e; sx += b.e * b.x; sy += b.e * b.y; }
    }
    const dt = s.at ? Math.min(500, Math.max(1, t - s.at)) : 66; s.at = t;
    const seen = fire >= E_MIN, prev = s.e;
    s.e = fire;
    if (seen) {
      const nx = (sx / fire + 0.5) / w, ny = (sy / fire + 0.5) / h;
      if (!s.on && s.sure < 0.05) { s.x = nx; s.y = ny; s.move = 0; }             // a new flame: there at once
      else {
        const k = ease(dt, 45), px = s.x, py = s.y;
        s.x = lerp(s.x, nx, k); s.y = lerp(s.y, ny, k);
        s.move = lerp(s.move, Math.hypot(s.x - px, s.y - py) / dt * 1000, ease(dt, 350));
      }
    } else s.move = lerp(s.move, 0, ease(dt, 350));
    s.sure = lerp(s.sure, seen ? 1 : 0, ease(dt, seen ? SURE_MS : 400));
    const size = seen ? Math.min(1, Math.sqrt(fire / (w * h) / FULL)) : 0;
    s.level = lerp(s.level, size, ease(dt, size > s.level ? 80 : 450));
    const was = s.on;
    if (s.sure > OFF) s.low = 0; else s.low = s.low || t;
    s.on = was ? !(s.low && t - s.low > OFF_MS) : s.sure > ON;
    if (s.on && !was) { s.since = t; s.base = fire; s.slow = size; s.flare = { at: t, k: Math.max(0.5, size) }; }   // it catches fire
    else if (s.on) {
      const quick = (fire + prev) / 2;
      if (quick > s.base * FLARE + E_MIN && fire >= prev && t - s.flare.at > FLARE_MS) {
        s.flare = { at: t, k: clamp01(0.4 + (quick / Math.max(s.base, E_MIN) - FLARE) / 2) };
        s.base = lerp(s.base, quick, 0.6);
      }
      s.base = lerp(s.base, fire, ease(dt, 2500));
    }
    if (!s.on && was) s.gone = t;
    s.slow = lerp(s.slow, s.level, ease(dt, 3000));
    s.trend = s.on ? s.level - s.slow : 0;
    return s;
  }

  // ---------- what the fire does to them ----------
  // the moods that take turns while a fire burns; 'glow' is what is left once they are used to it
  const MOODS = ['spell', 'play', 'dream', 'love', 'spirit'];
  const MOOD_MS = [10000, 20000];
  const GENTLE = [0.3, 0.7];         // the fire's strength from where a mood goes faster than twice that, and where it has the full pace
  const SPIRIT_MS = [10000, 14000];  // the fire spirit comes through the pupils and goes again
  const USED_MS = 30000;             // a fire that only burns on: after this long it is the background
  const FADE_MS = 8000;              // … which it becomes over the last seconds of that time
  const WAKE_MS = 6000;              // flaring up or moving: this long it is all new again, then it fades as before
  function mind() { return { mood: null, last: null, until: 0, steady: null, habit: 0, flareSeen: 0, changes: 0 }; }
  // m.mood for the fire s at time t; rnd: Math.random or a test's own; can.spirit: the fire spirit may come now.
  // m.habit: 0 (all new) – 1 (used to it). Never the same mood twice in a row.
  function think(m, s, t, rnd, can) {
    if (!s.on) { m.mood = null; m.steady = null; m.habit = 0; return m; }
    if (m.steady === null) { m.steady = s.since; m.flareSeen = s.flare ? s.flare.at : 0; }
    const flared = s.flare && s.flare.at !== m.flareSeen;
    if (s.flare) m.flareSeen = s.flare.at;
    if (flared || s.move > MOVING) m.steady = Math.max(m.steady, t - (USED_MS - FADE_MS) + WAKE_MS);
    m.habit = ramp(t - m.steady, USED_MS - FADE_MS, USED_MS);
    if (m.habit >= 1) { m.mood = 'glow'; return m; }
    if (!m.mood || m.mood === 'glow' || (t >= m.until && m.habit < 0.5)) {   // no new mood for the last moments before the background
      const names = MOODS.filter(k => k !== m.last && (k !== 'spirit' || (can && can.spirit)));
      const weight = k => k === 'spirit' ? 0.5 : 1;
      let pick = rnd() * names.reduce((a, k) => a + weight(k), 0), name = names[names.length - 1];
      for (const k of names) { pick -= weight(k); if (pick < 0) { name = k; break; } }
      const [a, b] = name === 'spirit' ? SPIRIT_MS : MOOD_MS;
      // a lone candle is taken gently – a mood lasts up to twice as long; much fire or a flame that dances: the full pace
      const lively = Math.max(ramp(s.level === undefined ? 1 : s.level, GENTLE[0], GENTLE[1]), ramp(s.move, MOVING / 2, MOVING));
      m.mood = m.last = name; m.until = t + (a + rnd() * (b - a)) * (name === 'spirit' ? 1 : 2 - lively); m.changes++;
    }
    return m;
  }
  // the mood cannot be shown (the fire spirit found no way through): the next one, now
  function skip(m, t) { m.until = t; }

  const api = { RULE, FACE, CORE, E_MIN, HITS, FULL, MOODS, MOOD_MS, GENTLE, SPIRIT_MS, USED_MS, WAKE_MS, MOVING, warm, sense, look, mind, think, skip };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamFire = api;
})(typeof window !== 'undefined' ? window : globalThis);
