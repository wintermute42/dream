/* Dream – how Dreamy Eyes find fire in their camera picture and what they feel about it (#162, #218). Pure computation,
   no DOM: eyes.html hands over the small camera sample (RGBA) and draws what comes back; the Node tests
   (tests/js/fire.test.mjs) hand over painted test pictures the same way.

   look(): flame light is warm (red ≥ green > blue), bright and saturated – and it flickers. Every pixel gets a share
   between 0 and 1 (soft edges, so a lamp that only shifts by a fraction of a pixel keeps its sum). The picture is cut
   into cells; the warm light of a cell and its neighbours is added up, and only where that sum jumps up and down from
   picture to picture, again and again, it is fire. A still orange lamp does not jump, a face that moves carries its
   light along smoothly (and inside a face the phone has found, the stricter rule of #162 holds).
   think(): what the fire does to them – one of a few moods that take turns, and getting used to a fire that only
   burns on. */
(function (root) {
  'use strict';
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const ramp = (x, a, b) => clamp01((x - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (dt, tau) => 1 - Math.exp(-dt / tau);

  // which light counts as warm: each pair is where a pixel's share starts and where it is full. LOOSE is #218's rule
  // (dimmer, paler and less orange than before: small and distant flames count), STRICT is #162's, kept inside a face
  const LOOSE = { red: [150, 190], sat: [0.28, 0.42], warm: [18, 36], gb: 1.08 };
  const STRICT = { red: [205, 225], sat: [0.40, 0.46], warm: [32, 40], gb: 1.15 };
  const MAX_BLOBS = 48;        // patches of warm light looked at in one picture
  const REACH = 0.35;          // how far a patch may have moved since the last picture (picture widths): a swung flame is fast
  const FLOOR = 14;            // warm pixels a patch needs before its jumps count in full
  const JUMP = 0.08;           // a jump: the patch's warm light changes its course by this share from one picture to the next
  const HITS = [0.6, 3.0];     // jumps lately (each fades by an eighth per picture): a patch is fire above the second number and
                               // stays fire down to the first – a lamp switched on makes three jumps, a fire many
  const E_MIN = 2;             // flickering warm pixels that make a flame (of 96×72: 0.03 % of the picture)
  const FULL = 0.03;           // the share of the picture that is a full fire
  const ON = 0.6, OFF = 0.15, OFF_MS = 1500;   // on at once, off only after 1.5 s without: flames dip for a moment
  const FLARE = 1.6, FLARE_MS = 2500;          // flaring up: this much more than lately, at most this often
  const MOVING = 0.3;          // the flame moves: picture widths a second

  // how warm one pixel is, 0–1
  function warm(r, g, b, rule) {
    const q = rule || LOOSE;
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
    let any = 0;
    for (let y = 0, i = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4, p++) {
      warmth[p] = 0; id[p] = 0;
      const r = d[i];
      if (r <= LOOSE.red[0]) continue;
      const g = d[i + 1], b = d[i + 2];
      if (r < g || g <= b * LOOSE.gb) continue;
      let rule = LOOSE;
      if (face) { const u = (x - fx) / fa, v = (y - fy) / fb; if (u * u + v * v < 1) rule = STRICT; }
      if ((warmth[p] = warm(r, g, b, rule)) > 0) any++;
    }
    // the patches of warm light, each with its sum: light that only moves keeps its sum, light that flickers does not
    const before = c.blobs, blobs = c.blobs = [];
    let fire = 0, sx = 0, sy = 0;
    for (let p0 = 0; any > 0 && p0 < w * h && blobs.length < MAX_BLOBS; p0++) {
      if (!(warmth[p0] > 0) || id[p0]) continue;
      const b = { e: 0, x: 0, y: 0, e1: 0, hits: 0, age: 0, lit: false }, mark = blobs.length + 1;
      let top = 0; stack[top++] = p0; id[p0] = mark;
      while (top) {
        const p = stack[--top], x = p % w, y = (p - x) / w, k = warmth[p];
        b.e += k; b.x += k * x; b.y += k * y; any--;
        for (let yy = y > 0 ? y - 1 : 0; yy <= y + 1 && yy < h; yy++) for (let xx = x > 0 ? x - 1 : 0; xx <= x + 1 && xx < w; xx++) {
          const q = yy * w + xx;
          if (warmth[q] > 0 && !id[q]) { id[q] = mark; stack[top++] = q; }
        }
      }
      b.x /= b.e; b.y /= b.e;
      let old = null, near = REACH * w;                // the patch it was a moment ago: the nearest one
      for (const o of before) { const dist = Math.hypot(o.x - b.x, o.y - b.y); if (dist < near) { near = dist; old = o; } }
      if (old) {
        const turn = Math.abs(b.e - 2 * old.e + old.e1), mean = (b.e + old.e + old.e1) / 3;
        b.e1 = old.e; b.age = old.age + 1;
        b.hits = old.hits * 0.88 + (b.age > 1 && turn / (mean + FLOOR) > JUMP ? 1 : 0);
        b.lit = b.hits > (old.lit ? HITS[0] : HITS[1]);
      }
      blobs.push(b);
      if (b.lit) { fire += b.e; sx += b.e * b.x; sy += b.e * b.y; }
    }
    const dt = s.at ? Math.min(500, Math.max(1, t - s.at)) : 66; s.at = t;
    const seen = fire >= E_MIN, prev = s.e;
    s.e = fire;
    if (seen) {
      const nx = (sx / fire + 0.5) / w, ny = (sy / fire + 0.5) / h;
      if (s.sure < 0.05) { s.x = nx; s.y = ny; s.move = 0; }             // a new flame: there at once
      else {
        const k = ease(dt, 45), px = s.x, py = s.y;
        s.x = lerp(s.x, nx, k); s.y = lerp(s.y, ny, k);
        s.move = lerp(s.move, Math.hypot(s.x - px, s.y - py) / dt * 1000, ease(dt, 350));
      }
    } else s.move = lerp(s.move, 0, ease(dt, 350));
    s.sure = lerp(s.sure, seen ? 1 : 0, ease(dt, seen ? 110 : 400));
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
      m.mood = m.last = name; m.until = t + a + rnd() * (b - a); m.changes++;
    }
    return m;
  }
  // the mood cannot be shown (the fire spirit found no way through): the next one, now
  function skip(m, t) { m.until = t; }

  const api = { LOOSE, STRICT, E_MIN, FULL, MOODS, MOOD_MS, SPIRIT_MS, USED_MS, WAKE_MS, MOVING, warm, sense, look, mind, think, skip };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamFire = api;
})(typeof window !== 'undefined' ? window : globalThis);
