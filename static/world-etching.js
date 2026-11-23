/* Dream – the style world "engraving" (#225): an old engraved plate that comes alive, with the long lines of Art
   Nouveau. There is only line – but line with weight: strokes that swell and thin like a burin's cut, hatching that
   carries the shade, stipple. Bone-coloured ink with verdigris, old rose and a little gold light that now and then runs
   along a line. Things appear by being drawn: a fern unrolls, a vine draws itself and its leaves open behind the tip.

   The dream itself is engraved: in an iris, a medallion, the faces of an impossible shape, its picture becomes lines as
   thick as it is bright there, in its own colours – by compositing alone (`etch`: a pattern of greys burnt into the
   picture), no pixel is read. A window's sky and the night behind the eyes are stipple.

   What today's look shows as signs has its own form here: a bud instead of a heart, a seed head and its drifting seeds
   instead of stars, a poppy head nodding instead of letters, the eye in a glory of engraved rays instead of the
   triangle. Of a face there is what the face rule lets through (static/dreamvis.js) – the nose, in the rare moment,
   as one side cut with a swelling line and hatched in its shade, the other only stippled.

   A line is never finer than FINE (hairlines vanish on coarse outputs). Everything is a few paths of many lines each
   and lights stamped from sprites – no blur, no shadow, no filter: old phones. Registers itself with the style layer
   (static/dreamstyle.js). */
(function (root) {
  'use strict';
  const { DreamBrush, DreamVis, DreamLife, DreamEye, DreamStyle } = root;
  const { TAU, clamp, lerp, smooth, rng, hash, curve, sprite, softLight, stamp, lids, faceFrame, skeleton, canvas, kaleido, night, cover, tile } = DreamBrush;
  const PI = Math.PI, ease = x => 1 - Math.pow(1 - clamp(x), 3), seg = (x, a, b) => clamp((x - a) / (b - a));

  // ---------- the materials ----------
  const INK = '#eadfc4', VERD = '#86bca6', ROSE = '#cf9197', GOLD = '#e6bd6a', PLATE = '#060504';
  const PAL = { ink: INK, verd: VERD, rose: ROSE, gold: GOLD, mono: false };
  const MONO = { ink: '#fff', verd: '#fff', rose: '#fff', gold: '#fff', mono: true };   // without colours: where the dream shines through
  const FINE = 1.2;                                    // the finest line, in pixels of the canvas
  // whatever hue is asked for becomes one of the plate's three tints
  const tintOf = hue => [ROSE, GOLD, VERD, VERD, VERD, ROSE][Math.floor((((hue + 30) % 360) + 360) % 360 / 60)];
  const gold = () => sprite('etch-gold', () => softLight([[0, 'rgba(255,225,150,1)'], [0.3, 'rgba(240,180,90,.4)'], [1, 'rgba(230,160,70,0)']], 64));
  const puff = () => sprite('etch-puff', () => softLight([[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']], 128));
  const shade = () => sprite('etch-shade', () => softLight([[0, 'rgba(6,5,4,0)'], [0.66, 'rgba(6,5,4,0)'], [1, 'rgba(6,5,4,.9)']], 256));   // an iris, a medallion: dark towards its rim
  const scratch = (key, w, h = w) => { const c = sprite(key, () => canvas(2)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c; };

  // a swelling line along P, added to the path being built: half as wide as wide(u) at u (0–1 along it), never finer
  // than FINE, drawn up to m (0–1) of its length
  function swell(c, P, wide, m = 1) {
    const n = P.length, k = Math.max(2, Math.min(n, Math.ceil((n - 1) * clamp(m)) + 1));
    for (const s of [1, -1]) for (let j = 0; j < k; j++) {
      const i = s > 0 ? j : k - 1 - j, p = P[Math.max(0, i - 1)], q = P[Math.min(n - 1, i + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const w = Math.max(FINE / 2, wide(i / (n - 1)) * (i === k - 1 && k < n ? 0.4 : 1)) * s, x = P[i][0] - (q[1] - p[1]) / l * w, y = P[i][1] + (q[0] - p[0]) / l * w;
      if (s > 0 && j === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }
  const belly = w => typeof w === 'function' ? w : u => w * Math.sin(PI * Math.pow(u, 0.8));   // thin – full – thin, as a burin cuts
  // many such lines in one colour: one path, one fill
  function lines(c, list, w, al, col = INK, m = 1) {
    if (al <= 0.004 || m <= 0 || !list.length) return;
    const f = belly(w);
    c.fillStyle = col; c.globalAlpha = Math.min(1, al); c.beginPath();
    for (const P of list) if (P.length > 1) swell(c, P, f, m);
    c.fill(); c.globalAlpha = 1;
  }
  const line = (c, P, w, al, col, m) => lines(c, [P], w, al, col, m);
  // hairlines: every line of `list` in one stroke, w wide (never finer than FINE), each drawn up to m of its length
  function hair(c, list, w, al, col = INK, m) {
    if (al <= 0.004 || !list.length || m <= 0) return;
    c.strokeStyle = col; c.globalAlpha = Math.min(1, al); c.lineWidth = Math.max(FINE, w); c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
    for (const P of list) { const n = m === undefined ? P.length : Math.max(2, Math.ceil(P.length * m)); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < n && i < P.length; i++) c.lineTo(P[i][0], P[i][1]); }
    c.stroke(); c.globalAlpha = 1;
  }
  // stipple: dots [[x, y, r], …] in one path
  function dots(c, list, al, col = INK) {
    if (al <= 0.004 || !list.length) return;
    c.fillStyle = col; c.globalAlpha = Math.min(1, al); c.beginPath();
    for (const [x, y, r] of list) if (r > 0.35) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
    c.fill(); c.globalAlpha = 1;
  }
  const ring = (x, y, r, n = 48, a0 = 0, a1 = TAU) => Array.from({ length: n + 1 }, (_, k) => { const an = a0 + (a1 - a0) * k / n; return [x + Math.cos(an) * r, y + Math.sin(an) * r]; });
  const spiral = (x, y, a0, r0, turns, dir, n = 22) => Array.from({ length: n + 1 }, (_, k) => { const u = k / n, an = a0 + dir * u * turns * TAU, r = r0 * (1 - u * 0.92); return [x + Math.cos(an) * r, y + Math.sin(an) * r]; });
  const ticks = (x, y, n, r1, r2, a0 = 0, a1 = TAU, long = 5) => Array.from({ length: n }, (_, k) => { const an = a0 + (a1 - a0) * k / n, e = k % long ? 0 : (r2 - r1) * 0.35; return [[x + Math.cos(an) * (r1 - e), y + Math.sin(an) * (r1 - e)], [x + Math.cos(an) * (r2 + e), y + Math.sin(an) * (r2 + e)]]; });
  // now and then a gold light runs along a line
  function glint(c, P, T, speed, ph, r, al) {
    const u = (((T * speed + ph) % 1.6) + 1.6) % 1.6;
    if (u > 1 || al <= 0.004) return;
    const p = P[Math.min(P.length - 1, u * (P.length - 1) | 0)], op = c.globalCompositeOperation;
    c.globalCompositeOperation = 'lighter'; stamp(c, gold(), p[0], p[1], r, al * Math.sin(PI * u)); c.globalAlpha = 1; c.globalCompositeOperation = op;
  }
  const light = (c, x, y, r, al) => { if (al > 0.004) { const op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; stamp(c, gold(), x, y, r, al); c.globalAlpha = 1; c.globalCompositeOperation = op; } };

  // ---------- the plate's plants ----------
  // leaves [[x, y, angle, length], …], grown as far as k: two swelling edges, a tint between them, a midrib, veins as hatching
  function leaves(c, list, al, col = VERD, k = 1, ink = INK) {
    if (al <= 0.004 || k <= 0.02 || !list.length) return;
    const E = [], V = [];
    c.fillStyle = col; c.globalAlpha = (ink === '#fff' ? 0.07 : 0.17) * Math.min(1, al); c.beginPath();
    for (const [x, y, ang, l0] of list) {
      const len = l0 * k, dx = Math.cos(ang), dy = Math.sin(ang), A = [], B = [];
      for (let i = 0; i <= 8; i++) { const u = i / 8, w = len * 0.24 * Math.sin(PI * Math.pow(u, 0.75)), px = x + dx * len * u, py = y + dy * len * u; A.push([px - dy * w, py + dx * w]); B.push([px + dy * w, py - dx * w]); }
      c.moveTo(A[0][0], A[0][1]); for (let i = 1; i <= 8; i++) c.lineTo(A[i][0], A[i][1]); for (let i = 7; i > 0; i--) c.lineTo(B[i][0], B[i][1]); c.closePath();
      E.push(A, B); V.push([[x, y], [x + dx * len, y + dy * len]]);
      if (len > 16) for (let i = 2; i < 7; i++) { const u = (i - 0.7) / 8, mx = x + dx * len * u, my = y + dy * len * u; V.push([[mx, my], [lerp(mx, A[i][0], 0.85), lerp(my, A[i][1], 0.85)]], [[mx, my], [lerp(mx, B[i][0], 0.85), lerp(my, B[i][1], 0.85)]]); }
    }
    c.fill(); c.globalAlpha = 1;
    lines(c, E, list[0][3] * k * 0.014, 0.9 * al, ink); hair(c, V, 0, 0.45 * al, ink);
  }
  // a vine: a whiplash stem that draws itself (grown 0–1), leaves opening behind the tip, a curl at its end. Returns its line.
  function vine(c, x, y, ang, len, grown, seed, al, bend, q = PAL) {
    const r = rng(seed), P = [[x, y]], n = 26, L = [[], []];
    let a2 = ang;
    for (let i = 1; i <= n; i++) { a2 = ang + bend * Math.sin(i / n * PI * 1.5) + Math.sin(i * 0.5 + seed) * 0.12; P.push([P[i - 1][0] + Math.cos(a2) * len / n, P[i - 1][1] + Math.sin(a2) * len / n]); }
    const e = P[n], dir = bend > 0 ? 1 : -1, mx = e[0] - Math.sin(a2) * len * 0.09 * dir, my = e[1] + Math.cos(a2) * len * 0.09 * dir;
    const all = P.concat(spiral(mx, my, Math.atan2(e[1] - my, e[0] - mx), len * 0.09, 1.3, dir, 16).slice(1));
    line(c, all, u => len * 0.012 * (1.15 - u), 0.95 * al, q.ink, grown);
    for (let j = 0; j < 7; j++) {
      const i = 3 + j * 3, u = i / all.length, p = P[i], pn = P[i + 1], an = Math.atan2(pn[1] - p[1], pn[0] - p[0]) + (j % 2 ? 1 : -1) * (0.8 + 0.3 * r()), k = ease(seg(grown, u, u + 0.2));
      if (k > 0.02) L[j % 3 === 2 ? 1 : 0].push([p[0], p[1], an, len * (0.17 - j * 0.01) * k]);
    }
    leaves(c, L[0], al, q.verd, 1, q.ink); leaves(c, L[1], al, q.gold, 1, q.ink);
    return all;
  }
  // a fern: its crozier unrolls (open 0–1), the fronds open behind it; fine: with the fronds' own small fronds
  function crozier(c, x, y, s, open, dir, al, q = PAL, fine = false) {
    const n = 30, P = [[x, y]], fr = [[], []], pin = [];
    let an = -PI / 2 - dir * 0.25;
    for (let i = 1; i <= n; i++) { const u = i / n; an += dir * (0.02 + Math.pow(u, 2.2) * lerp(1.1, 0.09, open)); const st = s * 2.4 / n * lerp(0.55, 1, open) * (1 - 0.5 * u * (1 - open)); P.push([P[i - 1][0] + Math.cos(an) * st, P[i - 1][1] + Math.sin(an) * st]); }
    line(c, P, u => s * 0.03 * (1.1 - u), 0.95 * al, q.ink);
    for (let i = 3; i < n - 1; i++) {
      const u = i / n, p = P[i], pn = P[i + 1], a0 = Math.atan2(pn[1] - p[1], pn[0] - p[0]), l = s * 0.5 * Math.sin(PI * Math.pow(u, 0.7)) * ease(seg(open, u * 0.7, u * 0.7 + 0.3));
      if (l >= 1.5) for (const sd of [-1, 1]) fr[sd > 0 ? 0 : 1].push([p, [p[0] + Math.cos(a0 + sd * 1.1) * l * 0.5, p[1] + Math.sin(a0 + sd * 1.1) * l * 0.5], [p[0] + Math.cos(a0 + sd * 0.8) * l, p[1] + Math.sin(a0 + sd * 0.8) * l]]);
    }
    lines(c, fr[0], u => s * 0.034 * Math.sin(PI * Math.pow(u, 0.6)), 0.8 * al, q.ink); lines(c, fr[1], u => s * 0.034 * Math.sin(PI * Math.pow(u, 0.6)), 0.8 * al, q.verd);
    if (fine) {                                        // a large one: every frond a small fern again
      for (const F of fr[0].concat(fr[1])) { const dx = F[2][0] - F[0][0], dy = F[2][1] - F[0][1]; for (const u of [0.3, 0.5, 0.7, 0.88]) for (const sd of [-1, 1]) { const px = lerp(F[0][0], F[2][0], u), py = lerp(F[0][1], F[2][1], u), k = 0.3 * (1.1 - u); pin.push([[px, py], [px + dx * k * 0.6 - sd * dy * k, py + dy * k * 0.6 + sd * dx * k]]); } }
      hair(c, pin, s * 0.005, 0.5 * al, q.ink);
    }
    return P;
  }
  // seeds on the air [[x, y, length, tilt], …]: a grain, a stalk, a tuft of hairs
  function seeds(c, list, al, q = PAL) {
    const H = [], D = [];
    for (const [x, y, len, tilt] of list) {
      const tx = x + Math.sin(tilt) * len, ty = y - Math.cos(tilt) * len;
      H.push([[x, y], [tx, ty]]); D.push([x, y, Math.max(0.7, len * 0.09)]);
      for (let j = -2; j <= 2; j++) H.push([[tx, ty], [tx + Math.sin(tilt + j * 0.5) * len * 0.55, ty - Math.cos(tilt + j * 0.5) * len * 0.55]]);
    }
    hair(c, H, 0, 0.75 * al, q.ink); dots(c, D, al, q.gold);
  }
  // a seed head: a clock of fine rays on a stalk; after a while its seeds leave on the air (age in seconds)
  function seedHead(c, x, y, s, age, al, seed, T, q = PAL) {
    const r = rng(seed), g2 = ease(age / 2.5), top = [x + Math.sin(T * 0.7 + seed) * s * 0.06, y - s * 0.4], rays = [], tufts = [];
    line(c, curve([[x + s * 0.15, y + s * 1.3], [x - s * 0.05, y + s * 0.5], top], 8), u => s * 0.016 * (1.2 - u), 0.9 * al, q.ink, g2);
    for (let k = 0; k < 34; k++) {
      const an = k * 2.39996, rr = s * 0.55 * (0.75 + 0.25 * r()) * g2, fly = Math.max(0, age - 3.5 - r() * 5), gone = r() < 0.45 ? fly : 0;
      const ox = gone * s * 0.25 + Math.sin(gone * 1.5 + k) * s * 0.08 * Math.min(1, gone), oy = -gone * s * 0.14;
      const e = [top[0] + Math.cos(an) * rr + ox, top[1] + Math.sin(an) * rr + oy], b0 = gone ? [e[0] - Math.cos(an) * rr * 0.4, e[1] - Math.sin(an) * rr * 0.4 + s * 0.1] : top;
      rays.push([b0, e]); for (let j = -2; j <= 2; j++) tufts.push([e, [e[0] + Math.cos(an + j * 0.5) * s * 0.09, e[1] + Math.sin(an + j * 0.5) * s * 0.09]]);
    }
    hair(c, rays, 0, 0.75 * al, q.ink); hair(c, tufts, 0, 0.5 * al, q.ink);
    if (!q.mono) light(c, top[0], top[1], s * 0.3, 0.3 * al);
  }
  // a moth as in a naturalist's plate: hatched wings that open and close (flap 0–1), a ring on each; fore, hind: where
  // its wings point (at rest they lie back along the body)
  function moth(c, x, y, s, flap, tilt, al, q = PAL, fore = -0.55, hind = 0.55) {
    c.save(); c.translate(x, y); c.rotate(tilt);
    for (const sd of [-1, 1]) {
      c.save(); c.scale(sd * Math.max(0.12, flap), 1);
      for (const [ang, len, col] of [[fore, s * 0.85, q.ink], [hind, s * 0.6, q.rose]]) {
        const tip = [Math.cos(ang) * len, Math.sin(ang) * len], up = curve([[0, 0], [len * 0.45 * Math.cos(ang - 0.6), len * 0.45 * Math.sin(ang - 0.6)], tip], 6), dn = curve([[0, 0], [len * 0.5 * Math.cos(ang + 0.75), len * 0.5 * Math.sin(ang + 0.75)], tip], 6), hs = [];
        c.fillStyle = col; c.globalAlpha = 0.14 * Math.min(1, al); c.beginPath(); up.forEach((p, i) => c[i ? 'lineTo' : 'moveTo'](p[0], p[1])); for (let i = dn.length - 1; i >= 0; i--) c.lineTo(dn[i][0], dn[i][1]); c.fill(); c.globalAlpha = 1;
        lines(c, [up, dn], s * 0.014, 0.95 * al, q.ink);
        for (let i = 2; i < up.length - 1; i++) hs.push([[up[i][0] * 0.25, up[i][1] * 0.25], [lerp(up[i][0], dn[i][0], 0.5), lerp(up[i][1], dn[i][1], 0.5)]]);
        hair(c, hs, 0, 0.55 * al, col); hair(c, [ring(tip[0] * 0.68, tip[1] * 0.68 + len * 0.03, len * 0.08, 12)], 0, 0.8 * al, q.gold);
      }
      c.restore();
    }
    c.fillStyle = q.ink; c.globalAlpha = Math.min(1, al); c.beginPath(); c.ellipse(0, s * 0.05, Math.max(1, s * 0.04), s * 0.2, 0, 0, TAU); c.fill(); c.globalAlpha = 1;
    hair(c, [curve([[0, -s * 0.12], [-s * 0.1, -s * 0.3], [-s * 0.22, -s * 0.36]], 5), curve([[0, -s * 0.12], [s * 0.1, -s * 0.3], [s * 0.22, -s * 0.36]], 5)], 0, 0.8 * al, q.ink);
    c.restore();
  }
  // a lily seen from the side, opening (open 0–1) towards dir: petals of old rose fanning out, two sepals, stamens of gold
  function lily(c, x, y, s, open, dir, al, q = PAL) {
    if (open <= 0.02 || al <= 0.004) return;
    const pet = [], st = [], an = [];
    for (let k = -2; k <= 2; k++) pet.push([x, y, dir + k * 0.52 * (0.25 + 0.75 * open), s * (1 - 0.13 * k * k) * (0.6 + 0.4 * open)]);
    leaves(c, [[x, y, dir - 1.75, s * 0.42], [x, y, dir + 1.75, s * 0.42]], al, q.verd, 1, q.ink); leaves(c, pet, al, q.rose, 1, q.ink);
    for (let k = -2; k <= 2; k++) { const d = dir + k * 0.2 * open, e = [x + Math.cos(d) * s * 0.72 * open, y + Math.sin(d) * s * 0.72 * open]; st.push([[x, y], e]); an.push([e[0], e[1], Math.max(0.8, s * 0.035)]); }
    hair(c, st, 0, 0.8 * al * open, q.gold); dots(c, an, al * open, q.gold);
    if (!q.mono) light(c, x + Math.cos(dir) * s * 0.4, y + Math.sin(dir) * s * 0.4, s * 0.6, 0.22 * al * open);
  }
  // a pod – a bud, a poppy's head: two full edges, hatching along its belly, a small crown at its tip
  function pod(c, x, y, ang, len, al, col, q = PAL) {
    if (al <= 0.004) return;
    const dx = Math.cos(ang), dy = Math.sin(ang), at = (u, w) => [x + dx * len * u - dy * len * w, y + dy * len * u + dx * len * w], side = s => Array.from({ length: 11 }, (_, i) => at(i / 10, s * 0.34 * Math.pow(Math.sin(PI * Math.pow(i / 10, 0.62)), 0.8)));
    const A = side(1), B = side(-1), H = [];
    c.fillStyle = col; c.globalAlpha = 0.2 * Math.min(1, al); c.beginPath(); A.forEach((p, i) => c[i ? 'lineTo' : 'moveTo'](p[0], p[1])); for (let i = 9; i > 0; i--) c.lineTo(B[i][0], B[i][1]); c.fill(); c.globalAlpha = 1;
    lines(c, [A, B], len * 0.03, 0.95 * al, q.ink);
    for (const s of [-0.55, 0, 0.55]) H.push(Array.from({ length: 7 }, (_, i) => { const u = 0.12 + i * 0.12; return at(u, s * 0.34 * Math.pow(Math.sin(PI * Math.pow(u, 0.62)), 0.8)); }));
    hair(c, H, 0, 0.55 * al, col);
    hair(c, [-0.5, -0.25, 0, 0.25, 0.5].map(s => [at(1, 0), at(1.1, s * 0.22)]), 0, 0.8 * al, q.ink);
  }
  // drops [[x, y, r], …]: an outline that swells below, a crescent of hatching, a glint
  function drops(c, list, al, q = PAL) {
    const O = [], H = [], G = [];
    for (const [x, y, r] of list) {
      O.push(Array.from({ length: 25 }, (_, k) => { const an = -PI / 2 + k / 24 * TAU, tip = Math.pow(Math.max(0, -Math.sin(an)), 6) * 0.45; return [x + Math.cos(an) * r * (1 - tip * 0.6), y + Math.sin(an) * r * (1 + tip)]; }));
      for (const [k, a0, a1] of [[0.74, 0.02, 0.62], [0.52, 0.1, 0.52], [0.3, 0.18, 0.42]]) H.push(ring(x, y, r * k, 8, PI * a0, PI * a1));
      G.push(ring(x, y, r * 0.62, 5, PI * 1.12, PI * 1.36));
    }
    lines(c, O, u => (list[0][2] * 0.07) * (0.35 + 0.65 * Math.pow(Math.sin(PI * u), 2)), 0.95 * al, q.ink);
    hair(c, H, 0, 0.6 * al, q.verd); hair(c, G, list[0][2] * 0.08, 0.9 * al, q.ink);
  }

  // ---------- the dream, engraved ----------
  // Patterns of greys, drawn once: white on the middle of a line, falling to black between two lines (`tone`: a line
  // never closes up and never breaks off). Burnt into a picture, the lines come out as wide as the picture is bright.
  const tone = v => clamp(1.16 * v - 0.03), saw = x => 1 - Math.abs(x - Math.floor(x) - 0.5) * 2;
  function greys(n, f) {
    const c = canvas(n), x = c.getContext('2d'), im = x.createImageData(n, n), d = im.data;
    for (let j = 0, i = 0; j < n; j++) for (let k = 0; k < n; k++, i += 4) { d[i] = d[i + 1] = d[i + 2] = 255 * f(k, j); d[i + 3] = 255; }
    x.putImageData(im, 0, 0);
    return c;
  }
  // burin strokes from the pupil to the rim of an iris, each beginning at its own distance: 72 of them, fewer in a
  // small iris (r: its radius in pixels), so that they stay lines
  const RAYS = r => { const n = r < 26 ? 24 : r < 40 ? 36 : r < 62 ? 48 : 72; return sprite('etch-rays' + n, () => greys(288, (x, y) => { const dx = x - 143.5, dy = y - 143.5, q = (Math.atan2(dy, dx) / TAU + 1) * n, k = Math.round(q) % n; return Math.hypot(dx, dy) / 144 < 0.16 + 0.16 * hash(9, k) ? 0 : tone(saw(q + 0.5) * (0.82 + 0.18 * hash(3, k))); })); };
  // rows of long waves, repeating at the square's edges: 32 lines to the square
  const ROWS = () => sprite('etch-rows', () => greys(256, (x, y) => tone(saw(y / 8 + 0.5 + 0.9 * Math.sin(TAU * (2 * x + y) / 256) + 0.3 * Math.sin(TAU * (5 * x - 2 * y) / 256)))));
  // a rosette as on a banknote: rings that wave twelve times around
  const ROSETTE = () => sprite('etch-rosette', () => greys(640, (x, y) => { const dx = x - 319.5, dy = y - 319.5, r = Math.hypot(dx, dy) / 320, an = Math.atan2(dy, dx); return tone(saw(r * 30 + 0.55 * Math.sin(an * 12) * Math.min(1, r * 3) + 0.25 * Math.sin(an * 5 + r * 9))); }));
  // stipple: a cone of greys around every dot of a loose grid, repeating at the square's edges
  const DOTS = () => sprite('etch-dots', () => {
    const N = 16, P = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) P.push([i + (j % 2) * 0.5 + (hash(21, j * N + i) - 0.5) * 0.6, j + (hash(22, j * N + i) - 0.5) * 0.6, 0.75 + 0.5 * hash(23, j * N + i)]);
    return greys(256, (x, y) => {
      const u = x / 16, v = y / 16, i0 = Math.floor(u), j0 = Math.floor(v);
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -2; di <= 1; di++) {
        const p = P[((j0 + dj + N) % N) * N + (i0 + di + N) % N];
        let ex = Math.abs(p[0] - u), ey = Math.abs(p[1] - v);
        ex = Math.min(ex, N - ex); ey = Math.min(ey, N - ey); best = Math.max(best, 1 - Math.hypot(ex, ey) / (0.62 * p[2]));
      }
      return clamp(best * 1.1);
    });
  });
  // The engraving itself is one way of mixing, 'color-burn': a colour of the picture stays where the pattern is lighter
  // than that colour is dark, and goes black elsewhere – lines as wide as the picture is bright, without reading a pixel.
  const BURN = () => sprite('etch-burn', () => { const x = canvas(1).getContext('2d'); x.globalCompositeOperation = 'color-burn'; return { ok: x.globalCompositeOperation === 'color-burn' }; }).ok;
  const MUTE = 'rgba(128,128,128,.42)';                // the picture's colours a little muted first: inks, not lights
  // In place: inside the clip set on c, what put() draws (the picture, covering box [x, y, w, h]) becomes lines of the
  // pattern pat() draws, in the picture's colours, on black. gain: a shaded face has thinner lines. (A browser that
  // cannot mix this way lays the pattern over the picture: lines all of one width.)
  function etch(c, box, put, pat, gain = 1) {
    const [x, y, w, h] = box, fill = (mode, col) => { c.globalCompositeOperation = mode; c.fillStyle = col; c.fillRect(x, y, w, h); };
    c.globalAlpha = 1; fill('source-over', '#000'); c.globalAlpha = 0.86 * gain; put(); c.globalAlpha = 1;
    if (BURN()) fill('saturation', MUTE);
    c.globalCompositeOperation = BURN() ? 'color-burn' : 'multiply'; pat();
    if (BURN()) fill('color-dodge', '#484848');        // … and what is left a little lighter again
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  }
  // The same for an iris, whose picture the page has just drawn on g (clipped to it)
  function etchIris(g, ix, iy, R, rot) {
    const m = g.getTransform ? g.getTransform() : { a: 1, b: 0 }, fill = (mode, col) => { g.globalCompositeOperation = mode; g.fillStyle = col; g.fillRect(ix - R, iy - R, R * 2, R * 2); };
    g.globalAlpha = 1; fill('source-over', 'rgba(0,0,0,.14)');
    if (BURN()) fill('saturation', MUTE);
    g.save(); g.translate(ix, iy); g.rotate(rot); g.globalCompositeOperation = BURN() ? 'color-burn' : 'multiply'; g.drawImage(RAYS(R * Math.hypot(m.a, m.b)), -R, -R, R * 2, R * 2); g.restore();
    if (BURN()) fill('color-dodge', '#484848');
    g.globalCompositeOperation = 'source-over';
  }
  // a pattern laid around (x, y), its lines `pitch` apart, turned by rot
  const lay = (c, tex, per, x, y, r, pitch, rot, ox = 0, oy = 0) => { c.save(); c.translate(x - r, y - r); tile(c, tex, r * 2, r * 2, r * 2 / (pitch * per), ox, oy, rot); c.restore(); };

  // ---------- the eye ----------
  function eye(g, cx, cy, a, b, mirror, p) {
    const up = Math.max(0.02, p.open * (1 - p.blink) * (1 - 0.25 * p.squint)), lo = (0.82 + 0.1 * p.open) * (1 - 0.35 * p.squint);
    const L = lids(cx, cy, a, b, mirror, up, lo), o = L.o, T = performance.now() / 1000, idx = mirror ? 1 : 0, hint = p.crease || 0, look = p.look;
    const R = Math.min(a * 0.5, b * 1.02), ix = cx + p.gx * a * 0.34 * (mirror ? 0.96 : 1), iy = cy + p.gy * b * 0.32;
    const U = [], Lo = [], tint = tintOf(look.hue);
    for (let k = 0; k <= 28; k++) { U.push(L.upper(k / 28)); Lo.push(L.lower(k / 28)); }
    g.save();
    if (p.browAl > 0.01) {                             // the brow, when it comes: single hairs along the arch – it moves with what they feel
      const E = p.brow, hs = [];
      let by0 = cy - b * 1.6 + b * E.inner, by2 = cy - b * 1.7 + b * E.outer, bpy = cy - b * (1.95 + 0.35 * look.arch) + b * E.peak;
      const room = Math.min(by0, by2, bpy) - b * 0.32;
      if (room < 0) { by0 -= room; by2 -= room; bpy -= room; }
      const P = curve([[cx - o * a * 0.8, by0], [cx + o * a * 0.38, bpy], [cx + o * a * 1.02, by2]], 13);
      for (let i = 0; i < P.length - 2; i++) { const q = P[i], q2 = P[i + 1], u = i / P.length, l = (a * 0.17 * Math.sin(PI * Math.pow(u, 0.6)) + a * 0.03) * look.brow; hs.push([[q[0], q[1] + a * 0.04], [q[0] + (q2[0] - q[0]) * 2.6, q[1] + (q2[1] - q[1]) * 2.6 - l * (0.8 - u * 0.6)]]); }
      hair(g, hs, a * 0.007, 0.85 * p.browAl);
    }
    g.save(); L.path(g); g.clip();
    g.fillStyle = PLATE; g.fillRect(cx - a, cy - b * 1.6, 2 * a, 3.2 * b);
    // the white of the eye: fine lines following the ball, thinning into the lid's shadow
    const nr = clamp(Math.round(b * (up + lo) * 1.15 / (FINE * 2.9)), 5, 18), gap = nr * FINE * 1.05;
    g.fillStyle = INK; g.globalAlpha = 0.72; g.beginPath();
    for (let j = 1; j < nr; j++) {
      const f = j / nr, P = [];
      for (let k = 1; k <= 27; k++) if (Lo[k][1] - U[k][1] > gap * (0.3 + 1.6 * Math.abs(f - 0.5))) P.push([U[k][0], lerp(U[k][1], Lo[k][1], f)]);   // towards a corner only the middle ones go on
      if (P.length > 2) swell(g, P, u => a * 0.0085 * Math.sqrt(Math.sin(PI * u)) * (0.25 + 0.75 * smooth(f * 2.2)) * (0.7 + 0.3 * Math.sin(u * 40 + f * 30)));
    }
    g.fill(); g.globalAlpha = 1;
    g.save(); g.beginPath(); g.arc(ix, iy, R, 0, TAU); g.clip();
    g.fillStyle = PLATE; g.fillRect(ix - R, iy - R, R * 2, R * 2);
    p.iris(ix, iy, R);                                 // the dream, a world of its own, and whoever is mirrored in it …
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    etchIris(g, ix, iy, R, T * 0.04 * (mirror ? -1 : 1));   // … engraved: strokes as thick as it is bright
    g.drawImage(shade(), ix - R, iy - R, R * 2, R * 2);
    const pr = R * p.pupil;
    if (p.pupilMix < 0.99) { g.globalAlpha = 1 - p.pupilMix; g.fillStyle = '#030302'; g.beginPath(); g.arc(ix, iy, pr, 0, TAU); g.fill(); hair(g, [ring(ix, iy, pr * 1.1, 28)], a * 0.005, 0.7 * (1 - p.pupilMix)); }
    if (p.pupilMix > 0.01) { g.globalAlpha = p.pupilMix; p.pupilShape(ix, iy, pr, R); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (p.reflect) p.reflect(ix, iy, R);
    g.globalAlpha = 0.95; g.globalCompositeOperation = 'source-over'; g.fillStyle = INK; g.beginPath(); g.ellipse(ix - R * 0.36, iy - R * 0.4, R * 0.17, R * 0.1, -0.6, 0, TAU); g.fill(); g.globalAlpha = 1;
    g.restore();
    hair(g, [ring(ix, iy, R, 48), ring(ix, iy, R * 0.93, 48)], a * 0.008, 0.9);
    g.restore();
    // the lid: one swelling line that ends in a tendril; the fold and its hatching with the hints; lashes one by one
    const [wx, wy] = U[28], wing = look.wing > 0.05 ? U.concat(spiral(wx + o * a * 0.2, wy - b * 0.2, o > 0 ? PI * 0.75 : PI * 0.25, a * 0.24 * (0.55 + 0.45 * look.wing), 0.85, -o, 24).slice(3)) : U;
    line(g, wing, u => a * 0.034 * Math.sqrt(look.liner) * Math.pow(Math.sin(PI * Math.pow(u, 1.5)), 0.7), 1);
    line(g, Lo.slice(3), a * 0.011, 0.85);
    if (hint > 0.01) {
      const fold = [], hatch = [];
      for (let k = 2; k <= 26; k++) fold.push([U[k][0], U[k][1] - b * (0.22 + 0.22 * Math.sin(PI * k / 28) * (0.4 + 0.6 * up))]);
      for (let k = 2; k <= 22; k++) { const q = fold[k], l = b * (0.1 + 0.16 * Math.sin(PI * (k + 2) / 28)); hatch.push([[q[0], q[1] - b * 0.04], [q[0] + o * l * 0.5, q[1] - l]]); }
      line(g, fold, a * 0.008, 0.8 * hint); hair(g, hatch, 0, 0.5 * hint, tint);
    }
    const lash = [], low = [];
    for (let i = 0; i < 17; i++) {
      const k = i / 16, base = L.upper(0.2 + i * 0.049), len = a * (0.07 + 0.25 * Math.pow(k, 1.2)) * look.lashes * (0.7 + 0.6 * hash(i, idx + 3)) * (0.35 + 0.65 * up), dx = o * (0.1 + 1.15 * look.curl * k * k + (hash(i, 7) - 0.5) * 0.3), P = [];
      for (let q = 0; q <= 6; q++) { const v = q / 6; P.push([base[0] + dx * len * (0.2 * v * (1 - v) + v * v), base[1] - len * (1.5 * v * (1 - v) + 0.85 * v * v)]); }
      lash.push(P);
    }
    for (let i = 0; i < 7; i++) { const base = L.lower(0.45 + i * 0.075), len = a * (0.03 + 0.012 * i) * look.lower; low.push([base, [base[0] + o * len * 0.3, base[1] + len * 0.6], [base[0] + o * len * 0.8, base[1] + len]]); }
    lines(g, lash, v => a * 0.009 * (1 - v), 0.95); lines(g, low, v => a * 0.005 * (1 - v), 0.9);
    glint(g, wing, T, 0.05 + 0.05 * p.energy, idx * 0.5, a * 0.3, 0.5);
    g.restore();
    return [ix, iy];
  }
  // What is in an iris: the dream as every world shows it (static/dreameye.js; the eye engraves it) – but a fire is
  // drawn here: flames as engraved lines of gold and rose over the dream, dim and warm
  function irisWorld(g, style, ix, iy, R, mirror, al, o) {
    if (style !== 'fire' && style !== 'embers') { DreamEye.irisWorld(g, style, ix, iy, R, mirror, al, o); return; }
    const T = performance.now() / 1000, heat = o.heat === undefined ? 1 : o.heat, fire = style === 'fire', A = [], B = [], S = [];
    g.save(); g.translate(ix, iy);
    g.globalAlpha = al; g.fillStyle = '#1a0a04'; g.fillRect(-R, -R, R * 2, R * 2);
    o.pic(0, 0, R * 2.3, al * 0.3);
    g.globalAlpha = al * 0.4; g.fillStyle = '#7a2a08'; g.fillRect(-R, -R, R * 2, R * 2); g.globalAlpha = 1;
    light(g, 0, R, R * (0.8 + 0.5 * heat), al * (fire ? 0.9 : 0.6));
    for (let k = 0; k < (fire ? 9 : 4); k++) {         // tongues: two lines that meet in a licking tip
      const x0 = (k / (fire ? 8 : 3) - 0.5) * R * 1.5, h = R * (0.75 + 0.5 * Math.sin(T * 5.3 + k * 2)) * heat * (fire ? 1.25 : 0.7), sw = Math.sin(T * 4 + k) * R * 0.14, w = R * 0.16;
      const tip = [x0 + sw * 1.6, R - h];
      (k % 2 ? A : B).push(curve([[x0 - w, R], [x0 - w * 1.1 + sw * 0.4, R - h * 0.45], tip], 6), curve([[x0 + w, R], [x0 + w * 1.1 + sw * 0.4, R - h * 0.45], tip], 6));
    }
    for (let k = 0; k < (fire ? 8 : 14); k++) { const u = (T / (1.6 + (k % 5) * 0.4) + k * 0.37) % 1, x = Math.sin(k * 2.4 + T * 0.9 + u * 3) * R * 0.7, y = R * (0.95 - 1.9 * u); S.push([[x, y], [x + Math.sin(T * 3 + k) * R * 0.03, y - R * 0.09]]); }
    lines(g, A, R * 0.03, al, GOLD); lines(g, B, R * 0.024, al * 0.9, ROSE); hair(g, S, R * 0.012, al * 0.9, GOLD);
    g.restore();
  }
  // A pupil that is not round. The soft shimmers and the cat's slit are every world's (static/dreameye.js); what
  // today's look draws as a sign is a plant here: for 'heart' a bud, breathing a little light, for 'star' a seed head
  // seen from above, for 'spiral' a crozier that keeps rolling in.
  function pupilShape(g, shape, x, y, pr, R, mirror, o) {
    if (shape !== 'heart' && shape !== 'star' && shape !== 'spiral') { DreamEye.pupilShape(g, shape, x, y, pr, R, mirror, o); return; }
    const al = g.globalAlpha, T = (o.now === undefined ? performance.now() : o.now) / 1000, beat = o.beat || 0, dir = mirror ? -1 : 1;
    g.save();
    g.fillStyle = '#030302'; g.beginPath(); g.arc(x, y, pr * 1.04, 0, TAU); g.fill();
    hair(g, [ring(x, y, pr * 1.1, 28)], 0, 0.7 * al);
    if (shape === 'heart') {
      const s = pr * (0.94 + 0.06 * Math.sin(T * (o.fire ? 7 : 3.2)) + 0.05 * beat);
      light(g, x, y - s * 0.1, s * 1.1, al * (0.45 + 0.25 * Math.sin(T * (o.fire ? 7 : 3.2))));
      leaves(g, [[x, y + s * 0.78, -PI / 2 - 0.75, s * 0.7], [x, y + s * 0.78, -PI / 2 + 0.75, s * 0.7]], al, VERD);
      pod(g, x, y + s * 0.8, -PI / 2, s * 1.55, al, o.fire ? GOLD : ROSE);
    } else if (shape === 'star') {
      const rays = [], tufts = [], rot = T * 0.3 * dir;
      for (let k = 0; k < 21; k++) {
        const an = k * 2.39996 + rot, rr = pr * (0.5 + 0.42 * hash(31, k)) * (1 + 0.06 * Math.sin(T * 5 + k * 2.1)), e = [x + Math.cos(an) * rr, y + Math.sin(an) * rr];
        rays.push([[x, y], e]); for (let j = -1; j <= 1; j++) tufts.push([e, [e[0] + Math.cos(an + j * 0.6) * pr * 0.16, e[1] + Math.sin(an + j * 0.6) * pr * 0.16]]);
      }
      hair(g, rays, 0, 0.85 * al); hair(g, tufts, 0, 0.6 * al); light(g, x, y, pr * (0.5 + 0.25 * beat), 0.7 * al);
    } else {
      const P = [];
      for (let k = 0; k <= 44; k++) { const u = k / 44, an = T * 3.2 * dir + u * PI * 5.5, rr = pr * (0.98 - 0.94 * u); P.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr]); }
      line(g, P, u => pr * 0.075 * (1.08 - u) * (1 + 0.4 * beat), al, INK);
      dots(g, P.filter((_, k) => k % 4 === 2 && k < 34).map((q, k) => [x + (q[0] - x) * 1.13, y + (q[1] - y) * 1.13, pr * 0.04 * (1 - k / 12)]), 0.8 * al, VERD);
      light(g, x, y, pr * 0.4, 0.6 * al);
    }
    g.restore(); g.globalAlpha = al;
  }

  // ---------- what lives around the eyes and drifts through the windows ----------
  // One living thing d at age ms, faded in and out by env, drawn at size s, its drifting height y (static/dreamlife.js
  // describes d and o). 'lighter' is set by the caller.
  function life(g, d, age, env, s, y, o) {
    const T = age / 1000, seed = ((d.born || 0) * 7 + (d.spin || 1) * 101 + (d.wob || 0) * 977 + (d.side || 0) * 31) | 0, r = rng(seed), x = d.x, kind = d.kind, tint = tintOf(d.hue), turn = d.spin > 0 ? 1 : -1;
    if (kind === 'cloud') {                            // a cloud of stipple: dots set like the seeds of a flower head, breathing
      const A = [], B = [], n = 130;
      for (let k = 1; k < n; k++) {
        const an = k * 2.39996, far = Math.sqrt(k / n), edge = 0.8 + 0.22 * Math.sin(an * 3 + T * 0.5 + seed) + 0.12 * Math.sin(an * 5 - T * 0.3), f = smooth((edge - far) / 0.55);
        (k % 6 ? A : B).push([x + Math.cos(an + T * 0.02 * turn) * far * s * 1.35, y + Math.sin(an + T * 0.02 * turn) * far * s * 0.85, s * 0.05 * f * (0.5 + hash(seed, k)) * (0.85 + 0.15 * Math.sin(T * 1.3 + k))]);
      }
      dots(g, A, 0.85 * env, INK); dots(g, B, 0.9 * env, tint);
    } else if (kind === 'bloom') {                     // a lily opening
      const open = ease(age / 3200), dir = -PI / 2 + turn * (0.35 + 0.08 * Math.sin(T * 0.8)), stem = curve([[x - turn * s * 0.35, y + s * 1.0], [x - turn * s * 0.3, y + s * 0.45], [x, y]], 8);
      line(g, stem, u => s * 0.022 * (1.2 - u), 0.95 * env, INK, ease(age / 1200));
      leaves(g, [[stem[5][0], stem[5][1], -PI / 2 - turn * 1.1, s * 0.4]], env, VERD, ease(age / 2000));
      lily(g, x, y, s * 0.75, open * ease(age / 1200), dir, env);
    } else if (kind === 'mandala') {                   // a seed head whose seeds leave on the air
      seedHead(g, x, y, s * 0.9, T, env, seed, T);
    } else if (kind === 'tree') {                      // a fern: the crozier unrolls
      crozier(g, x, y + s * 0.5, s * 0.42, ease(age / 4500), turn, env);
    } else if (kind === 'moth') {                      // a moth on a looping path
      const k = T * 0.6;
      moth(g, x + Math.sin(k * 1.3) * s * 1.1, y + Math.sin(k * 2.1) * s * 0.5, s * 0.7, 0.55 + 0.45 * Math.sin(T * 2.6 + seed), Math.sin(k * 1.3 + 1) * 0.3, env);
    } else if (kind === 'bubbles') {                   // drops of dew rising and wobbling, each hatched
      for (let j = 0; j < 7; j++) {
        const ph = (T + j * 0.7) % 4.5;
        drops(g, [[x + Math.sin(ph * 2 + j) * s * 0.35 + (j - 3) * s * 0.12, y + s * 0.6 - ph * s * 0.5, s * (0.07 + 0.04 * (j % 3))]], env * Math.min(1, ph * 2, (4.5 - ph) * 1.5));
      }
    } else if (kind === 'aurora') {                    // a long vine drawing itself across
      const grown = ease(age / 5000), P = vine(g, x - turn * s * 1.9, y + s * 0.35, turn > 0 ? -0.3 : PI + 0.3, s * 3.8, grown, seed, env, turn * 0.9);
      if (grown >= 1) glint(g, P, T, 0.12, seed * 0.1, s * 0.4, 0.5 * env);
    } else if (kind === 'orbit') {                     // winged seeds circling one eye, spinning as they fall
      const [ex, ey, ea] = o.anchor || [x, y, s * 0.6], W = [], wake = [], D = [];
      for (let j = 0; j < 3; j++) {
        const at = q => { const an = (age - q * 70) / (900 + j * 400) * (j % 2 ? -1 : 1) + j * 2.1; return [ex + Math.cos(an) * ea * (1.15 + j * 0.12), ey + Math.sin(an) * ea * (0.75 + j * 0.08)]; }, p0 = at(0);
        W.push([p0[0], p0[1], T * 2.2 * (j % 2 ? -1 : 1) + j * 2, ea * 0.3]); D.push([p0[0], p0[1], ea * 0.03]); wake.push([1, 2, 3, 4, 5].map(at));
      }
      hair(g, wake, 0, 0.3 * env, INK); leaves(g, W, env, tint); dots(g, D, env, GOLD);
    } else if (kind === 'tear') {                      // a hatched drop falls – and comes apart into stipple
      const p = age / d.life, fall = Math.min(1, p / 0.55), ty = d.y + fall * fall * s * 9;
      if (p < 0.6) {
        hair(g, [[[x, ty - s * 2.4 * fall], [x + Math.sin(T * 3) * s * 0.08, ty - s * 1.3 * fall], [x, ty - s * 0.7]]], 0, 0.5);
        drops(g, [[x, ty, s * 0.45]], 0.95);
      } else {
        const q = (p - 0.6) / 0.4, D = [];
        for (let j = 0; j < 12; j++) { const an = j * 0.55 + r() * 0.5, rr = q * s * (1.5 + 3 * r()); D.push([x + Math.cos(an) * rr, d.y + s * 9 + Math.sin(an) * rr * 0.5 + q * s * 1.5, s * 0.13 * (1 - q) * (0.6 + r())]); }
        dots(g, D, 1 - q, INK);
      }
    } else if (kind === 'stars') {                     // where today's look bursts into stars: seeds fly up around an eye
      const q = age / d.life, list = [];
      for (const [an, rr, ph] of d.puffs) { const r2 = d.size * rr * (0.7 + 0.5 * q); list.push([x + Math.cos(an) * r2 + Math.sin(age / 400 + ph * 9) * d.size * 0.03, d.y + Math.sin(an) * r2 * 0.7 - q * d.size * 0.2, d.size * 0.11 * (d.big || 1) * (0.6 + ph), Math.sin(age / 500 + ph * 30) * 0.4]); }
      seeds(g, list, 1 - q);
      for (const [sx, sy, len] of list) stamp(g, gold(), sx, sy, len * 0.6, (1 - q) * 0.45); g.globalAlpha = 1;
    } else if (kind === 'ember') {                     // a stroke of gold rising, flickering like a small flame
      const q = age / d.life, px = x + Math.sin(age / 300 + d.spin * 9) * d.size * 6, py = d.y - q * o.H * 0.75, w = Math.sin(age / 160 + d.spin * 5) * d.size * 1.2, len = d.size * 5;
      line(g, curve([[px, py], [px + w, py - len * 0.35], [px - w * 0.6, py - len * 0.7], [px + w * 0.3, py - len]], 5), d.size * 0.5, 1 - q, GOLD);
      stamp(g, gold(), px, py - len * 0.3, d.size * 3, (1 - q) * 0.8); g.globalAlpha = 1;
    } else if (kind === 'fireheart') {                 // where today's look lets a heart rise: a bud, glowing
      const q = age / d.life, px = x + Math.sin(age / 500 + d.spin * 7) * d.size, py = d.y - q * o.H * 0.7, sz = d.size * 1.6, tilt = Math.sin(age / 700 + d.spin * 3) * 0.25;
      stamp(g, gold(), px, py - sz * 0.5, sz * 1.1, (1 - q) * 0.6); g.globalAlpha = 1;
      leaves(g, [[px, py, -PI / 2 + tilt - 0.8, sz * 0.45], [px, py, -PI / 2 + tilt + 0.8, sz * 0.45]], (1 - q) * 0.95, VERD);
      pod(g, px, py, -PI / 2 + tilt, sz, (1 - q) * 0.95, d.hue < 40 || d.hue > 300 ? ROSE : GOLD);
    } else if (kind === 'sparks') {                    // a shower of short gold strokes flying in from where a fire flared up
      const q = age / d.life, out = 1 - (1 - q) * (1 - q), list = [];
      for (const [an, sp, ph] of d.puffs) {
        const far = d.size * sp * out, dx = Math.cos(d.dir + an), dy = Math.sin(d.dir + an), px = x + dx * far, py = d.y + dy * far + d.size * 0.3 * q * q, len = d.size * 0.06 * (0.5 + ph) * (1.2 - q);
        list.push([[px - dx * len, py - dy * len], [px, py]]);
        stamp(g, gold(), px, py, d.size * 0.035 * (0.5 + ph) * (1.2 - q), (1 - q) * (0.55 + 0.45 * Math.sin(age / 55 + ph * 40)));
      }
      g.globalAlpha = 1; hair(g, list, d.size * 0.004, (1 - q) * 0.9, GOLD);
    } else if (kind === 'zzz') {                       // asleep: a poppy's head nods lower and lower, and lets a few seeds go
      const q = age / d.life, sz = d.size, al = Math.min(1, age / 500) * (1 - smooth((q - 0.75) / 0.25)), nod = smooth(q * 1.5) * 0.9 + 0.07 * Math.sin(T * 1.6);
      const top = [x + sz * 0.15, d.y - sz * 1.7], neck = [x + sz * (0.75 + 0.2 * nod), d.y - sz * (1.75 - 0.5 * nod)], D = [];
      line(g, curve([[x - sz * 0.25, d.y + sz * 1.5], [x - sz * 0.1, d.y - sz * 0.3], top, neck], 8), u => sz * 0.07 * (1.15 - u), 0.95 * al, INK, ease(age / 700));
      pod(g, neck[0], neck[1], 0.35 + nod * 1.1, sz * 1.25 * ease(age / 900), al, VERD);
      for (let j = 0; j < 5; j++) { const qj = (q * 1.6 + j * 0.23) % 1, an = 0.35 + nod * 1.1; D.push([neck[0] + Math.cos(an) * sz * 1.35 + Math.sin(qj * 6 + j) * sz * 0.2 + qj * sz * 0.3, neck[1] + Math.sin(an) * sz * 1.35 + qj * sz * 2.2, sz * 0.08 * Math.sin(PI * qj) * smooth(q * 4)]); }
      dots(g, D, al, INK);
    } else {                                           // whatever else: a few seeds drifting on the air
      const list = [];
      for (let j = 0; j < 6; j++) { const f1 = 0.2 + r() * 0.3, p1 = r() * 9, rad = s * (0.25 + 0.7 * r()); list.push([x + Math.sin(T * f1 + p1) * rad, y + Math.cos(T * f1 * 0.8 + p1 * 2) * rad * 0.6, s * (0.2 + 0.14 * r()), Math.sin(T * 0.9 + p1) * 0.35]); }
      seeds(g, list, env);
    }
  }

  // ---------- the faces of light ----------
  // Three beings of the plate whose eyes these may be. v is the face rule's word: the sign on the forehead comes with
  // the hints; hair, the halo, the jaw, the nose and the hatched, closed lips only in the rare moment, clearly then.
  // The brow is the eye's own. Drawn twice by the page: without `ink` into the
  // mask the dream shines through (so: without colours), with it as the plate's own drawing over that.
  const FACES = ['lily', 'fern', 'moth'];
  const HINT = 1.2;                                    // the sign on the forehead: a little stronger than it was first drawn
  function face(c, mode, t, geo, v, ink, inkAl = 1) {
    const mono = ink === undefined, K = mono ? 0.5 : Math.min(0.9, inkAl * 4), q = mono ? MONO : PAL;
    const mark = DreamVis.of(v, 'mark') * HINT * K, hairAl = DreamVis.of(v, 'hair') * 1.1 * K, outline = DreamVis.of(v, 'outline') * K, mouth = DreamVis.of(v, 'mouth') * 1.15 * K, nose = DreamVis.of(v, 'nose') * 1.1 * K;
    if (mark + hairAl + outline + mouth + nose <= 0.004) return;
    const T = t / 1000, F = faceFrame(geo.cx, geo.ey, geo.half), a = F.u * 1.3, S = skeleton(geo.cx, geo.ey, geo.half, t);
    const strands = S.filter(k => k.name === 'strand').map(k => k.pts), jaws = S.filter(k => k.name === 'jaw').map(k => k.pts), lip = n => S.find(k => k.name === n).pts;
    const pr = (s, e) => smooth(seg(v.fullForm, s, e)), pH = (s, e) => smooth(seg(v.hintForm, s, e)), mk = F(0, -2.6);
    // a ring behind the head, in the face's own measure, open below
    const A0 = PI * 0.76, A1 = PI * 2.24, AM = (A0 + A1) / 2, arc = (r, a0, a1, n = 44) => Array.from({ length: n + 1 }, (_, k) => { const an = lerp(a0, a1, k / n); return F(Math.cos(an) * r, 0.2 + Math.sin(an) * r); });
    const beside = (P, off, n) => P.map((p, i) => { const p0 = P[Math.max(0, i - 1)], p1 = P[Math.min(P.length - 1, i + 1)], l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, f = Math.sin(PI * Math.min(1, i / n)); return [p[0] - (p1[1] - p0[1]) / l * off * f, p[1] + (p1[0] - p0[0]) / l * off * f]; });
    c.save();
    if (mode === 'lily') {
      // an open halo: two rings, ticks between them, small leaves around
      const k0 = pr(0, 0.45), R0 = 5.3;
      if (k0 > 0 && hairAl > 0.004) {
        const lo = lerp(AM, A0, k0), hi = lerp(AM, A1, k0), tk = [], L = [[], []];
        hair(c, [arc(R0, lo, hi), arc(R0 * 1.085, lo, hi)], a * 0.014, 0.8 * hairAl, q.ink);
        for (let k = 0; k <= 50; k++) { const an = lerp(A0, A1, k / 50); if (Math.abs(k - 25) <= 25 * k0) tk.push([F(Math.cos(an) * R0 * (k % 5 ? 1.03 : 1.015), 0.2 + Math.sin(an) * R0 * (k % 5 ? 1.03 : 1.015)), F(Math.cos(an) * R0 * (k % 5 ? 1.055 : 1.07), 0.2 + Math.sin(an) * R0 * (k % 5 ? 1.055 : 1.07))]); }
        hair(c, tk, 0, 0.6 * hairAl, q.ink);
        for (let k = 0; k < 13; k++) { const an = lerp(A0, A1, (k + 0.5) / 13), p = F(Math.cos(an) * R0 * 1.1, 0.2 + Math.sin(an) * R0 * 1.1), g = pr(0.15 + k * 0.012, 0.5 + k * 0.012); if (g > 0.02) L[k % 3 ? 0 : 1].push([p[0], p[1], an + 0.5 * (k % 2 ? 1 : -1), a * 0.36 * g]); }
        leaves(c, L[0], hairAl, q.verd, 1, q.ink); leaves(c, L[1], hairAl, q.gold, 1, q.ink);
        if (!mono) glint(c, arc(R0 * 1.04, A0, A1), T, 0.07, 0, a * 0.9, 0.5 * hairAl);
      }
      // hair: bundles of parallel lines in long whiplash curves, each ending in a curl
      strands.forEach((P0, n) => {
        const i = n % 5, o = n < 5 ? -1 : 1, m = pr(0.2 + i * 0.07, 0.7 + i * 0.07);
        if (m <= 0 || hairAl <= 0.004) return;
        const e = P0[P0.length - 1], P = P0.concat(spiral(e[0] + o * a * 0.42, e[1], o > 0 ? PI : 0, a * 0.42, 1.2, -o, 18).slice(1));
        line(c, P, a * 0.022, 0.9 * hairAl, q.ink, m); hair(c, [-2, -1, 1, 2].map(k => beside(P, k * a * 0.055, P0.length)), a * 0.012, 0.55 * hairAl, q.ink, m);
        if (m >= 1 && !mono) glint(c, P, T, 0.05, n * 0.37, a * 0.5, 0.45 * hairAl);
      });
      jaws.forEach((P, k) => line(c, P, u => a * 0.022 * Math.pow(Math.sin(PI * Math.pow(u, 0.6)), 0.8), 0.9 * outline, q.ink, pr(0.25 + k * 0.08, 0.7 + k * 0.08)));
      for (const o of [-1, 1]) { const fp = F(3.75 * o, -2.3); lily(c, fp[0], fp[1], a * 0.8, pr(0.6, 1), -PI / 2 + o * (1.0 + 0.06 * Math.sin(T * 0.7 + o)), hairAl, q); }   // a lily at each temple
      const jk = pH(0.2, 1);                           // the sign: a gem on the brow, hung from a chain as fine as stipple – the plate's one steady light
      if (jk > 0 && mark > 0.004) {
        const D = [], gem = [mk[0], mk[1] + a * 0.2];
        for (const o of [-1, 1]) for (let k = 1; k <= 13 * jk; k++) { const u = k / 13, p = F(o * u * 1.75, -2.6 - 0.5 * Math.pow(u, 1.6)); D.push([p[0], p[1], a * 0.026 * (1.1 - 0.5 * u) + 0.4]); }
        dots(c, D, 0.9 * mark, q.ink); hair(c, [[mk, [gem[0], gem[1] - a * 0.14]]], 0, 0.8 * mark, q.gold);
        drops(c, [[gem[0], gem[1], a * 0.15 * jk]], mark, { ink: q.gold, verd: q.gold });
        if (!mono) light(c, gem[0], gem[1], a * 0.7, 0.5 * mark * jk * (0.7 + 0.3 * Math.sin(T * 1.7)));
      }
    } else if (mode === 'fern') {
      // a wreath of leaves over the head
      const k0 = pr(0, 0.5), R0 = 4.7;
      if (k0 > 0 && hairAl > 0.004) {
        const lo = lerp(PI * 1.5, PI * 1.08, k0), hi = lerp(PI * 1.5, PI * 1.92, k0), stem = arc(R0, lo, hi), L = [[], []];
        hair(c, [stem], a * 0.016, 0.8 * hairAl, q.ink);
        for (let k = 2; k < stem.length - 2; k += 2) { const p = stem[k], p1 = stem[k + 1], an = Math.atan2(p1[1] - p[1], p1[0] - p[0]), sd = (k / 2) % 2 ? 1 : -1; L[k % 6 ? 0 : 1].push([p[0], p[1], an + sd * 1.0 + 0.1 * Math.sin(T * 0.8 + k), a * 0.5]); }
        leaves(c, L[0], hairAl, q.verd, k0, q.ink); leaves(c, L[1], hairAl, q.gold, k0, q.ink);
      }
      // hair: vines that fall in long curves, leaves opening along them
      strands.forEach((P0, n) => {
        const i = n % 5, o = n < 5 ? -1 : 1, m = pr(0.15 + i * 0.07, 0.65 + i * 0.07), L = [[], []];
        if (m <= 0 || hairAl <= 0.004) return;
        const e = P0[P0.length - 1], P = P0.concat(spiral(e[0] + o * a * 0.3, e[1], o > 0 ? PI : 0, a * 0.3, 1.3, -o, 14).slice(1));
        line(c, P, u => a * 0.02 * (1.1 - u * 0.7), 0.9 * hairAl, q.ink, m);
        for (let j = 5 + i; j < P0.length - 2; j += 5) { const u = j / P.length, p = P[j], p1 = P[j + 1], g = ease(seg(m, u, u + 0.15)); if (g > 0.02) L[(j + i) % 3 ? 0 : 1].push([p[0], p[1], Math.atan2(p1[1] - p[1], p1[0] - p[0]) + ((j + i) % 2 ? 1 : -1) * 0.9, a * 0.4 * g]); }
        leaves(c, L[0], hairAl, q.verd, 1, q.ink); leaves(c, L[1], hairAl, q.gold, 1, q.ink);
      });
      // the jaw: stipple, heavier where the cheek turns
      jaws.forEach((P, k) => { const m = pr(0.25 + k * 0.08, 0.75 + k * 0.08), D = []; for (let i = 0; i < P.length * m; i++) D.push([P[i][0], P[i][1], a * 0.035 * Math.sin(PI * Math.pow(i / P.length, 0.6)) + 0.6]); dots(c, D, 0.9 * outline, q.ink); });
      // the sign: a young crozier on the brow, unrolling a little, a seed of gold at its foot
      const jk = pH(0.2, 1);
      if (jk > 0 && mark > 0.004) {
        const base = F(0.12, -2.05);
        crozier(c, base[0], base[1], a * 0.5 * (0.5 + 0.5 * jk), 0.42 + 0.25 * jk + 0.04 * Math.sin(T * 1.1), -1, mark, q);
        dots(c, [[base[0], base[1] + a * 0.04, a * 0.055]], mark, q.gold);
        if (!mono) light(c, base[0] - a * 0.05, base[1] - a * 0.4, a * 0.6, 0.4 * mark * jk * (0.7 + 0.3 * Math.sin(T * 1.7)));
      }
    } else {
      // a halo of stipple: two rings of dots, swelling towards the crown – a moon's ring
      const k0 = pr(0, 0.5);
      if (k0 > 0 && hairAl > 0.004) {
        const D = [];
        for (const [R0, n, w] of [[5.0, 56, 0.05], [5.38, 60, 0.032]]) arc(R0, lerp(AM, A0, k0), lerp(AM, A1, k0), n).forEach((p, i) => D.push([p[0], p[1], a * w * (0.35 + 0.65 * Math.sin(PI * i / n)) + 0.5]));
        dots(c, D, 0.85 * hairAl, q.ink);
      }
      // hair: a veil of fine lines falling straight, a seed at the end of each
      const ends = [];
      strands.forEach((P0, n) => {
        const i = n % 5, m = pr(0.15 + i * 0.07, 0.65 + i * 0.07);
        if (m <= 0 || hairAl <= 0.004) return;
        hair(c, [P0, beside(P0, a * 0.07, P0.length * 2), beside(P0, -a * 0.07, P0.length * 2)], a * 0.012, 0.7 * hairAl, q.ink, m);
        if (m >= 1) { const e = P0[P0.length - 1]; ends.push([e[0], e[1] + a * 0.2, a * 0.3, PI + 0.3 * Math.sin(T * 0.9 + n)]); }
      });
      seeds(c, ends, hairAl * pr(0.8, 1), q);
      jaws.forEach((P, k) => { const m = pr(0.25 + k * 0.08, 0.7 + k * 0.08); line(c, P, u => a * 0.018 * Math.pow(Math.sin(PI * Math.pow(u, 0.6)), 0.8), 0.9 * outline, q.ink, m); hair(c, [beside(P, a * 0.09, P.length * 2)], 0, 0.45 * outline, q.ink, m); });
      // the sign: a moth at rest on the brow, its wings breathing
      const jk = pH(0.2, 1);
      if (jk > 0 && mark > 0.004) {
        moth(c, mk[0], mk[1] - a * 0.22, a * 0.85 * (0.6 + 0.4 * jk), 0.9 + 0.1 * Math.sin(T * 1.3), 0, mark, q, 0.5 + 0.05 * Math.sin(T * 1.3), 1.12);
        if (!mono) light(c, mk[0], mk[1], a * 0.75, 0.3 * mark * jk * (0.7 + 0.3 * Math.sin(T * 1.7)));
      }
    }
    const nk = pr(0.45, 0.85);                         // the nose: one side cut with a swelling line and hatched in its shade, the other only stippled
    if (nk > 0 && nose > 0.004) {
      const sides = S.filter(k => k.name === 'nose side').map(k => k.pts), nh = [], nd = [];
      line(c, sides[0], u => a * 0.016 * Math.pow(Math.sin(PI * Math.pow(u, 0.7)), 0.8), 0.9 * nose, q.ink, nk);
      line(c, lip('nose base'), a * 0.011, 0.8 * nose, q.ink, nk);
      for (let i = 2; i < sides[0].length - 1; i += 2) { const p = sides[0][i]; nh.push([[p[0] - a * 0.03, p[1]], [p[0] - a * 0.2, p[1] + a * 0.09]]); }
      hair(c, nh, 0, 0.5 * nose * nk, q.ink);
      for (let i = 1; i < sides[1].length; i += 2) nd.push([sides[1][i][0], sides[1][i][1], a * 0.014 + 0.5]);
      dots(c, nd, 0.8 * nose * nk, q.ink);
    }
    const lk = pr(0.55, 0.9);                          // the mouth: closed lips, hatched, a tint of old rose
    if (lk > 0 && mouth > 0.004) {
      const up = lip('upper lip'), mid = lip('lips'), lw = lip('lower lip'), lh = [];
      c.fillStyle = q.rose; c.globalAlpha = 0.22 * mouth * lk; c.beginPath(); up.forEach((p, i) => c[i ? 'lineTo' : 'moveTo'](p[0], p[1])); for (let i = lw.length - 1; i >= 0; i--) c.lineTo(lw[i][0], lw[i][1]); c.fill(); c.globalAlpha = 1;
      line(c, mid, a * 0.018, 0.95 * mouth, q.ink, lk); line(c, up, a * 0.01, 0.85 * mouth, q.ink, lk); line(c, lw, a * 0.012, 0.85 * mouth, q.ink, lk);
      for (let i = 3; i < lw.length - 3; i++) { const p = lw[i], m2 = mid[Math.round(i * (mid.length - 1) / (lw.length - 1))]; lh.push([[p[0], p[1] - a * 0.02], [lerp(p[0], m2[0], 0.6), lerp(p[1], m2[1], 0.6)]]); }
      hair(c, lh, 0, 0.5 * mouth * lk, q.rose);
    }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- the large motifs of a dream window (world-classic.js describes m and o) ----------
  // the frame of a medallion: rings, the ticks of an engraver's dividing circle, a gold light going round
  function frame(c, cx, cy, R, T, tier) {
    hair(c, [ring(cx, cy, R, 96), ring(cx, cy, R * 1.1, 96)], R * 0.008, 0.95); hair(c, [ring(cx, cy, R * 1.03, 96)], R * 0.004, 0.6);
    hair(c, ticks(cx, cy, tier ? 120 : 60, R * 1.05, R * 1.075), R * 0.003, 0.65);
    glint(c, ring(cx, cy, R * 1.07, 60), T, 0.06, 0.3, R * 0.3, 0.6);
  }
  // vines grow round a frame, fade, and grow again elsewhere
  function vinesRound(c, cx, cy, R, T, count, seed) {
    for (let k = 0; k < count; k++) {
      const span = 26, tt = T + k * 6.5 + 14, age = tt % span, n = Math.floor(tt / span), an = k / count * TAU + 0.6 + n * 0.8 + seed + hash(k, n) * 0.9, dir = hash(k, n + 1) < 0.5 ? 1 : -1;
      const P = vine(c, cx + Math.cos(an) * R * 1.1, cy + Math.sin(an) * R * 1.1, an + dir * (0.8 + 0.7 * hash(k, n + 3)), R * (1.05 + 0.6 * hash(k, n + 5)), ease(age / 9), 500 + k + n * 9, smooth(age) * smooth((span - age) / 5), -dir * (0.6 + 0.5 * hash(k, n + 7)));
      if (age > 9) glint(c, P, T, 0.1, k * 0.3, R * 0.25, 0.5);
    }
  }
  // --- the third eye: the eye in the middle of a seed head – a medallion, the clock of fine rays around it, a seed
  // leaving now and then. In trance it opens in every window
  function third(c, m, t, dt, o) {
    const [cx, cy] = o.mid, R = Math.min(o.W, o.H) * 0.27 * (1 + 0.02 * o.pulse), T = t / 1000, n = o.tier ? 68 : 36, rays = [], tufts = [];
    night(c, cx, cy, R * 2.2, 0.6);
    for (let k = 0; k < n; k++) {
      const an = k * 2.39996 + T * 0.012, len = R * (1.4 + 0.32 * hash(61, k)) * (1 + 0.02 * Math.sin(T * 0.9 + k * 1.9)), e = [cx + Math.cos(an) * len, cy + Math.sin(an) * len];
      rays.push([[cx + Math.cos(an) * R * 1.12, cy + Math.sin(an) * R * 1.12], e]);
      for (let j = -2; j <= 2; j++) tufts.push([e, [e[0] + Math.cos(an + j * 0.5) * R * 0.1, e[1] + Math.sin(an + j * 0.5) * R * 0.1]]);
    }
    hair(c, rays, R * 0.005, 0.75); hair(c, tufts, 0, 0.5);
    for (let k = 0; k < (o.tier ? 5 : 2); k++) {       // seeds leaving on the air
      const run = T * 0.05 + k * 0.23, u = run % 1, an = k * 1.9 + Math.floor(run) * 2.4, far = R * (1.7 + 1.2 * u);
      seeds(c, [[cx + Math.cos(an) * far + Math.sin(u * 5 + k) * R * 0.08, cy + Math.sin(an) * far - u * R * 0.4, R * 0.15, Math.sin(T * 0.8 + k) * 0.4]], Math.sin(PI * u));
    }
    c.fillStyle = PLATE; c.beginPath(); c.arc(cx, cy, R * 1.1, 0, TAU); c.fill();
    hair(c, [1, 2, 3, 4, 5, 6].map(k => ring(cx, cy, R * (0.99 - k * 0.022), 72)), 0, 0.22, VERD);   // the plate inside: rings, ever fainter
    frame(c, cx, cy, R, T, o.tier);
    m.mirror = false;
    o.eye(c, m, dt, cx, cy + R * 0.03, R * 0.74, DreamEye.LOOKS.nymph);
  }
  // --- a mandala: the dream folded and engraved as a rosette in a medallion, vines growing round its frame
  function mandala(c, m, t, dt, o) {
    const [cx, cy] = o.mid, R = Math.min(o.W, o.H) * 0.31 * (1 + 0.03 * o.pulse), T = t / 1000, ph = (m.seed % 628) / 100, n = o.tier > 1 ? 384 : 288;
    const K = scratch('etch-fold', n), kx = K.getContext('2d');
    night(c, cx, cy, R * 2, 0.55);
    kx.setTransform(1, 0, 0, 1, 0, 0); kx.globalAlpha = 1; kx.globalCompositeOperation = 'source-over'; kx.clearRect(0, 0, n, n); kaleido(kx, o.pic, n, t, ph, o.tier ? 12 : 8);
    c.fillStyle = PLATE; c.beginPath(); c.arc(cx, cy, R * 1.1, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip();
    etch(c, [cx - R, cy - R, R * 2, R * 2], () => c.drawImage(K, cx - R * 1.02, cy - R * 1.02, R * 2.04, R * 2.04),
      () => { c.save(); c.translate(cx, cy); c.rotate(-T * 0.015); c.drawImage(ROSETTE(), -R * 1.02, -R * 1.02, R * 2.04, R * 2.04); c.restore(); });
    c.drawImage(shade(), cx - R, cy - R, R * 2, R * 2);
    c.restore();
    frame(c, cx, cy, R, T, o.tier);
    vinesRound(c, cx, cy, R, T, o.tier ? 4 : 2, m.seed % 7);
  }
  // --- impossible shapes (DreamLife.impossible): every face the dream engraved, its lines running another way and
  // thinner where the face lies in shade; the edges swelling lines; a seed climbs the stairs
  function shape(c, m, t, dt, o) {
    const sh = DreamLife.impossible(m.kind), [cx, cy] = o.mid, S = Math.min(o.W, o.H) * 0.485 * (1 + 0.025 * o.pulse), T = t / 1000, pitch = Math.max(FINE * 4, S * 0.019);
    const path = f => { c.beginPath(); for (const [x, y] of f.pts) c.lineTo(x * S, y * S); c.closePath(); }, strong = [], faint = [];
    night(c, cx, cy, S * 1.15, 0.6);
    c.save(); c.translate(cx, cy); c.rotate((m.seed & 1 ? 1 : -1) * T * TAU / 150 + m.seed % 7);
    sh.faces.forEach((f, i) => {
      c.save(); path(f); c.clip();
      const n = S * 3.1, u = 0.5 + 0.14 * Math.sin(i * 2.1 + t / 9000), v = 0.5 + 0.14 * Math.cos(i * 1.3 + t / 11000);
      etch(c, [-S * 1.1, -S * 1.1, S * 2.2, S * 2.2], () => c.drawImage(o.pic, -u * n, -v * n, n, n), () => lay(c, ROWS(), 32, 0, 0, S * 1.1, pitch, i * 1.05 + 0.3, T * 0.004),
        f.fade ? 0.45 : f.glass ? 0.3 : clamp(1.12 - f.shade * 0.62, 0.45, 1));
      c.restore();
      const edge = [...f.pts, f.pts[0]].map(([x, y]) => [x * S, y * S]);
      if (f.fade || f.glass || f.wall) faint.push(edge); else for (let k = 0; k < edge.length - 1; k++) strong.push(Array.from({ length: 7 }, (_, j) => [lerp(edge[k][0], edge[k + 1][0], j / 6), lerp(edge[k][1], edge[k + 1][1], j / 6)]));
    });
    lines(c, strong, u => S * 0.0065 * (0.45 + 0.55 * Math.sin(PI * u)), 0.95); hair(c, faint, 0, 0.3);
    if (sh.path) {                                     // a seed climbs the stairs, hop by hop – always upwards, never arriving
      const n = sh.path.length, u = (t / 620) % n, k = u | 0, fr = u - k, e = fr < 0.5 ? 2 * fr * fr : 1 - (-2 * fr + 2) ** 2 / 2, [ax, ay] = sh.path[k], [bx, by] = sh.path[(k + 1) % n];
      const x = lerp(ax, bx, e) * S, y = (lerp(ay, by, e) - 0.03 - 0.07 * Math.sin(fr * PI)) * S;
      light(c, x, y, S * 0.11, 0.8); seeds(c, [[x, y, S * 0.09, Math.sin(fr * TAU) * 0.3 - (m.seed & 1 ? 1 : -1) * T * TAU / 150 - m.seed % 7]], 1);
    }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- the night behind Dreamy Eyes: the dream shows in stipple and in line (white into bk where it shows) ----------
  const grid = (w, h, pitch) => sprite(`etch-grid${w}x${h}`, () => {
    const P = [];
    for (let j = 0, y = 0; y < h + pitch; j++, y = j * pitch * 0.866) for (let i = 0, x = (j % 2) * pitch / 2; x < w + pitch; i++, x = (j % 2) * pitch / 2 + i * pitch) P.push([x + (hash(5, j * 977 + i) - 0.5) * pitch * 0.55, y + (hash(6, j * 977 + i) - 0.5) * pitch * 0.55, hash(7, j * 977 + i)]);
    return P;
  });
  function backMask(bk, mode, t, w, h, al, o) {
    const m = Math.min(w, h), T = t / 1000, D = [];
    bk.save();
    if (mode === 'clouds') {                           // fields of stipple drifting: dots that swell where the cloud is thick
      const pitch = m * 0.03;
      for (const [x, y, j] of grid(w, h, pitch)) {
        const u = x / m, v = y / m, f = 0.5 + 0.28 * Math.sin(u * 3.1 + T * 0.05 + 1.6 * Math.sin(v * 2.3 - T * 0.031)) + 0.22 * Math.sin(v * 4.3 - T * 0.043 + 1.3 * Math.sin(u * 1.9 + T * 0.023));
        const calm = 0.4 + 0.6 * smooth((Math.hypot((x - w / 2) / w, (y - h * 0.47) / h) * 2 - 0.3) / 0.6);   // finer around the eyes
        if (f > 0.56) D.push([x, y, pitch * 0.42 * smooth((f - 0.56) / 0.3) * (0.55 + 0.45 * j) * calm]);
      }
      dots(bk, D, al * 0.68, '#fff');
    } else if (mode === 'fractal') {                   // great ferns behind the eyes, every frond a fern again; they unroll and roll in, slowly
      bk.globalAlpha = 1;
      for (let k = 0; k < 4; k++) {
        const sd = k % 2 ? 1 : -1, low = k < 2, open = 0.62 + 0.3 * Math.sin(T * 0.11 + k * 1.7) + 0.05 * Math.sin(T * 0.5 + k);
        bk.save(); bk.translate(w / 2 + sd * w * (low ? 0.47 : 0.2), low ? h * 1.04 : -h * 0.04); bk.rotate(low ? sd * -0.5 : PI + sd * 0.75 + 0.04 * Math.sin(T * 0.3 + k));
        crozier(bk, 0, 0, m * (low ? 0.4 : 0.3), clamp(open), low ? -sd : sd, al * 0.8, MONO, true);
        bk.restore();
      }
    } else {                                           // long whiplash lines in bundles, swaying – the plate's ornament
      const list = [];
      for (let k = 0; k < 5; k++) {
        const y0 = h * (0.1 + 0.2 * k), ph = k * 1.7, sd = k % 2 ? 1 : -1;
        for (let j = -3; j <= 3; j++) {                // a bundle opens and closes along its way, like combed hair
          const P = [];
          for (let i = 0; i <= 36; i++) { const u = i / 36; P.push([w * (u * 1.2 - 0.1), y0 + m * (0.13 * Math.sin(u * 5.2 + ph + T * 0.11) + 0.07 * Math.sin(u * 11 - ph + T * 0.07)) * sd + j * m * 0.011 * (0.25 + 0.75 * Math.pow(Math.sin(u * 7 + ph * 2 + T * 0.05), 2))]); }
          list.push(P);
        }
      }
      hair(bk, list, m * 0.0035, al * (o.upright ? 0.5 : 0.7), '#fff');
    }
    bk.restore();
  }

  // ---------- the sky of a dream window: the dream in stipple – dots as large as it is bright, thinning out with distance ----------
  function skyClouds(cg, t, o) {
    const { w, h } = o, T = t / 1000 + o.drift * 40, m = Math.min(w, h), R = m * 0.3, S = scratch('etch-sky', w, h), x = S.getContext('2d'), P = puff();
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    o.dream(x, 0, 0, w, h, 1.2 + 0.1 * Math.sin(T / 19 + o.index), 0.5 + 0.2 * Math.sin(T / 26 + o.index * 1.7), 0.5 + 0.2 * Math.cos(T / 33 + o.index * 2.3));
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    cg.fillStyle = '#000'; cg.fillRect(0, 0, w, h);
    cg.globalCompositeOperation = 'lighter';           // where the cloud is, and how thick: it breathes and drifts round the middle
    for (let k = 0; k < (o.tier ? 16 : 10); k++) {
      const an = k * 2.4 + T * 0.02 + o.index, rad = R * (0.5 + 0.95 * hash(8, k)) * (1 + 0.12 * o.swell);
      stamp(cg, P, w / 2 + Math.cos(an) * rad * w / m + Math.sin(T * 0.13 + k) * R * 0.15, h / 2 + Math.sin(an) * rad * h / m + Math.cos(T * 0.11 + k * 2) * R * 0.15, R * (0.55 + 0.55 * hash(9, k)), 0.42 + 0.2 * o.swell);
    }
    cg.globalAlpha = 1;
    cg.globalCompositeOperation = 'multiply'; cg.drawImage(S, 0, 0);   // the dream there, never quite white …
    cg.fillStyle = '#dcdcdc'; cg.fillRect(0, 0, w, h);
    if (BURN()) {
      cg.globalCompositeOperation = 'saturation'; cg.fillStyle = MUTE; cg.fillRect(0, 0, w, h);                                      // … cut into dots: stipple
      cg.globalCompositeOperation = 'color-burn'; tile(cg, DOTS(), w, h, Math.max(w, h) / Math.max(4.2, m * 0.034) / 16, T * 0.0015, 0, 0.3);
      cg.globalCompositeOperation = 'color-dodge'; cg.fillStyle = '#8c8c8c'; cg.fillRect(0, 0, w, h);   // … each dot with a clear edge
    }
    cg.globalCompositeOperation = 'source-over';
  }

  // ---------- what fills the night: pollen on the air, a grain of gold now and then ----------
  function air(g, t, o) {
    const T = t / 1000, n = [10, 18, 28][o.tier], m = Math.min(o.W, o.H), A = [], B = [];
    for (let i = 0; i < n; i++) {
      const z = 0.4 + 0.6 * hash(41, i), x = (((hash(42, i) + T * 0.004 * z + 0.012 * Math.sin(T * 0.21 + i)) % 1) + 1) % 1, y = (((hash(43, i) - T * 0.006 * z + 0.012 * Math.cos(T * 0.17 + i * 2)) % 1) + 1) % 1;
      (i % 4 ? A : B).push([x * o.W, y * o.H, (m * 0.0022 * z + 0.6) * (0.7 + 0.3 * Math.sin(T * 1.3 + i * 4))]);
    }
    g.save(); g.globalCompositeOperation = 'lighter'; dots(g, A, 0.3, INK); dots(g, B, 0.5, GOLD); g.restore();
  }

  // ---------- fire: engraved flames – tongues of two swelling lines each, hatched, gold within ----------
  function flames(g, t, k, side, o) {
    const { W, H } = o, T = t / 1000, n = (W > H ? 9 : 6) * (o.perf > 30 ? 1 : 0.7) | 0, m = Math.min(W, H), al = Math.min(1, k), outer = [], inner = [], hatch = [], sparks = [];
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) stamp(g, gold(), W * (side + (i - 2) * 0.22), H * 1.04, Math.max(W, H) * 0.3 * (0.6 + 0.4 * k), 0.32 * k);
    g.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n + 0.03 * Math.sin(i * 7.1), near = (u - side) / 0.3, hh = H * 0.52 * k * (0.5 + 0.5 * hash(51, i)) * (0.7 + 0.6 * Math.exp(-near * near)) * (0.85 + 0.15 * Math.sin(T * 3 + i * 2));
      const x = u * W, hw = W / n * 0.42, base = H + 6, sw = Math.sin(T * 2.1 + i * 1.7) * hw * 0.9, lick = Math.sin(T * 3.3 + i * 2.9) * hw * 0.6;
      const tongue = (s, hk, wk) => curve([[x + s * hw * wk, base], [x + s * hw * wk * 1.15 + sw * 0.3, base - hh * hk * 0.3], [x + s * hw * wk * 0.5 + sw * 0.8, base - hh * hk * 0.66], [x + sw + lick, base - hh * hk]], 6);
      outer.push(tongue(-1, 1, 1), tongue(1, 1, 1)); inner.push(tongue(-1, 0.62, 0.5), tongue(1, 0.62, 0.5));
      for (const s of [-0.5, 0, 0.5]) hatch.push(curve([[x + s * hw, base - hh * 0.08], [x + s * hw * 0.9 + sw * 0.35, base - hh * 0.3], [x + s * hw * 0.5 + sw * 0.7, base - hh * (0.52 + 0.1 * (1 - Math.abs(s) * 2))]], 4));
      for (let j = 0; j < 2; j++) { const q = (T / (1.4 + 0.5 * hash(52, i * 2 + j)) + hash(53, i * 2 + j)) % 1, sx = x + sw + Math.sin(q * 5 + i + j * 2) * hw, sy = base - hh * (0.9 + 0.7 * q); sparks.push([[sx, sy], [sx + Math.sin(q * 9 + i) * m * 0.004, sy - m * 0.018 * (1 - q)]]); }
    }
    lines(g, outer, m * 0.007, 0.9 * al, INK); lines(g, inner, m * 0.006, 0.95 * al, GOLD);
    hair(g, hatch, m * 0.0025, 0.6 * al, ROSE); hair(g, sparks, m * 0.003, 0.8 * al, GOLD);
    g.restore();
  }

  // ---------- the trance (world-classic.js describes p and o) ----------
  function tranceBack(g, t, p, o) {                    // the plate darkens; dividing circles fly towards the eye; wreaths turn round it; strokes are drawn in
    const { W, H } = o, T = t / 1000, R = Math.hypot(W, H) * 0.55, few = o.perf <= 45;
    g.fillStyle = `rgba(5,4,3,${0.6 * p.dim})`; g.fillRect(0, 0, W, H);
    g.save(); g.globalCompositeOperation = 'lighter';
    if (p.tun > 0.01) for (let j = 0; j < 7; j++) {
      const s = (T / 1.5 + j / 7) % 1, r = R * (1 - s) ** 1.6 + p.A * 0.6, al = 0.6 * p.tun * Math.sin(s * PI), col = [INK, VERD, INK, GOLD][j % 4];
      g.save(); g.translate(p.ex, p.ey); g.rotate(T / 4 + j); g.scale(1, 0.92);
      hair(g, [ring(0, 0, r, 56), ring(0, 0, r * 1.06, 56)], 1 + 2.5 * (1 - s), al, col); hair(g, ticks(0, 0, few ? 30 : 60, r * 1.015, r * 1.045), 0, al * 0.8, col);
      g.restore();
    }
    if (p.mand > 0.01) for (let i = 0; i < (few ? 2 : 3); i++) {
      const r = p.A * (1.3 + i * 0.75) * (1 + 0.05 * Math.sin(T * 1.1)) * (0.6 + 0.4 * p.mand), n = 12 + i * 6, rot = T / (5 + i * 1.3) * (i % 2 ? -1 : 1), L = [];
      for (let k = 0; k < n; k++) { const an = rot + k / n * TAU; L.push([p.ex + Math.cos(an) * r, p.ey + Math.sin(an) * r, an + (i % 2 ? 0.9 : -0.9), p.A * (0.42 + 0.1 * i)]); }
      leaves(g, L, 0.85 * p.mand, [VERD, ROSE, GOLD][i]); hair(g, [ring(p.ex, p.ey, r, 64)], p.A * 0.008, 0.45 * p.mand);
    }
    if (p.pull > 0.01) {
      const A = [], B = [];
      for (let k = 0; k < 44; k++) { const s = (T / 1.3 + k / 44 * 3.7) % 1, r = R * (1 - s), an = k * 2.399 + s * 5 + T / 1.5; (k % 3 ? A : B).push(Array.from({ length: 5 }, (_, q) => [p.ex + Math.cos(an - q * 0.07) * r * (1 + q * 0.03), p.ey + Math.sin(an - q * 0.07) * r * (1 + q * 0.03)])); }
      hair(g, A, p.A * 0.012, 0.6 * p.pull); hair(g, B, p.A * 0.016, 0.7 * p.pull, GOLD);
    }
    g.restore();
  }
  function tranceEye(g, t, p, o) {                     // the third eye: standing upright, engraved – two swelling lids, the dream in its iris, lashes like rays
    const { ex, ey, A } = p, B = A * 0.5 * p.eo, { W, H } = o, T = t / 1000;
    g.save();
    if (p.dot > 0.01) {                                // closed: a gem on the forehead that fades
      drops(g, [[ex, ey, A * 0.09]], p.dot, { ink: GOLD, verd: GOLD }); hair(g, [ring(ex, ey, A * 0.2, 28)], 0, 0.4 * p.dot);
      light(g, ex, ey, A * 0.5, p.dot);
    }
    if (p.eo > 0.01) {
      const side = s => curve([[ex, ey - A], [ex + s * B * 1.02, ey - A * 0.45], [ex + s * B * 1.02, ey + A * 0.45], [ex, ey + A]], 10), l = side(-1), r = side(1), ir = A * 0.4, rows = [], lash = [];
      const almond = () => { g.beginPath(); g.moveTo(ex, ey - A); g.quadraticCurveTo(ex + B * 2, ey, ex, ey + A); g.quadraticCurveTo(ex - B * 2, ey, ex, ey - A); };
      light(g, ex, ey, A * 1.4, 0.2 * p.eo);
      g.save(); almond(); g.clip();
      g.fillStyle = PLATE; g.fillRect(ex - A, ey - A, A * 2, A * 2);
      for (let j = 1; j < 12; j++) rows.push(l.map((q, i) => [lerp(q[0], r[i][0], j / 12), q[1]]).slice(2, -2));
      lines(g, rows, u => A * 0.008 * Math.sqrt(Math.sin(PI * u)), 0.7);
      g.save(); g.beginPath(); g.arc(ex, ey, ir, 0, TAU); g.clip();
      etch(g, [ex - ir, ey - ir, ir * 2, ir * 2], () => { if (o.dream) cover(g, o.dream, ex - ir, ey - ir, ir * 2, ir * 2); else { g.fillStyle = VERD; g.fillRect(ex - ir, ey - ir, ir * 2, ir * 2); } },
        () => { g.save(); g.translate(ex, ey); g.rotate(T / 6); g.drawImage(RAYS(ir), -ir, -ir, ir * 2, ir * 2); g.restore(); });
      g.drawImage(shade(), ex - ir, ey - ir, ir * 2, ir * 2);
      g.restore();
      hair(g, [ring(ex, ey, ir, 40), ring(ex, ey, ir * 0.93, 40)], A * 0.008, 0.9);
      g.fillStyle = '#030302'; g.beginPath(); g.arc(ex, ey, ir * (0.38 + 0.5 * p.pull), 0, TAU); g.fill();
      g.fillStyle = INK; g.globalAlpha = 0.95; g.beginPath(); g.ellipse(ex - ir * 0.36, ey - ir * 0.4, ir * 0.17, ir * 0.1, -0.6, 0, TAU); g.fill(); g.globalAlpha = 1;
      g.restore();
      lines(g, [l, r], u => A * 0.03 * Math.pow(Math.sin(PI * u), 0.7), 0.95 * p.eo);
      for (const [P, s] of [[l, -1], [r, 1]]) for (let i = 3; i < P.length - 3; i += 2) { const u = i / (P.length - 1), len = A * (0.1 + 0.2 * Math.sin(PI * u)) * p.eo, up = (u - 0.5) * 1.2; lash.push([P[i], [P[i][0] + s * len * 0.6, P[i][1] + up * len * 0.5], [P[i][0] + s * len, P[i][1] + up * len * 1.3]]); }
      lines(g, lash, v => A * 0.01 * (1 - v), 0.9 * p.eo);
      for (const P of [l, r]) glint(g, P, T, 0.25, P === l ? 0 : 0.5, A * 0.3, 0.6 * p.eo);
    }
    if (p.view > 0.01 && o.dream) {                    // through the wide pupil: the dream, large and clear, in a medallion
      const R = Math.min(W, H) * 0.46 * p.view, Ri = R / 1.12;
      g.globalAlpha = Math.min(1, p.view * 1.2); g.fillStyle = PLATE; g.beginPath(); g.arc(ex, ey, R, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.arc(ex, ey, Ri, 0, TAU); g.clip(); cover(g, o.dream, ex - Ri, ey - Ri, Ri * 2, Ri * 2); g.drawImage(shade(), ex - Ri, ey - Ri, Ri * 2, Ri * 2); g.restore();
      g.globalAlpha = 1; frame(g, ex, ey, Ri, T, o.perf > 30 ? 1 : 0);
    }
    g.restore();
  }

  // ---------- "you in the dream", and a painted face coming through the pupils: what is drawn around the picture ----------
  const you = {
    FRAMES: ['halo', 'wreath', 'vines'],
    behind: {
      halo(c, n, t, hue, al) {                         // an open halo behind the head: two rings, ticks, small leaves
        const T = t / 1000, x = n / 2, y = n * 0.46, R = n * 0.31, a0 = PI * 0.8, a1 = PI * 2.2, L = [[], []];
        c.save();
        hair(c, [ring(x, y, R, 60, a0, a1), ring(x, y, R * 1.085, 60, a0, a1)], n * 0.005, 0.85 * al); hair(c, ticks(x, y, 50, R * 1.02, R * 1.06, a0, a1), 0, 0.6 * al);
        for (let k = 0; k < 13; k++) { const an = lerp(a0, a1, (k + 0.5) / 13); L[k % 3 ? 0 : 1].push([x + Math.cos(an) * R * 1.1, y + Math.sin(an) * R * 1.1, an + 0.5 * (k % 2 ? 1 : -1) + 0.06 * Math.sin(T + k), n * 0.055]); }
        leaves(c, L[0], al, VERD); leaves(c, L[1], al, GOLD); glint(c, ring(x, y, R * 1.04, 60, a0, a1), T, 0.08, 0, n * 0.09, 0.6 * al);
        c.restore();
      },
    },
    front: {
      wreath(c, n, t, hue, al) {                       // a wreath of leaves turning slowly round them, a lily in it here and there
        const T = t / 1000, R = n * 0.345, L = [[], []];
        c.save();
        hair(c, [ring(n / 2, n / 2, R, 72)], n * 0.005, 0.7 * al);
        for (let k = 0; k < 28; k++) { const an = k / 28 * TAU + T * 0.035; if (k % 7) L[k % 5 ? 0 : 1].push([n / 2 + Math.cos(an) * R, n / 2 + Math.sin(an) * R, an + PI / 2 + (k % 2 ? 0.75 : -0.75) + 0.08 * Math.sin(T * 0.9 + k), n * (0.05 + 0.012 * (k % 3))]); }
        leaves(c, L[0], al, VERD); leaves(c, L[1], al, GOLD);
        for (let k = 0; k < 28; k += 7) { const an = k / 28 * TAU + T * 0.035; lily(c, n / 2 + Math.cos(an) * R, n / 2 + Math.sin(an) * R, n * 0.062, 0.75 + 0.25 * Math.sin(T * 0.6 + k), an, al); }
        c.restore();
      },
      vines(c, n, t, hue, al) {                        // vines growing up both sides before the shoulders, again and again
        const T = t / 1000;
        c.save();
        for (let k = 0; k < 4; k++) {
          const span = 22, tt = T + k * 5.5 + 12, age = tt % span, sd = k % 2 ? 1 : -1, low = k < 2;
          const P = vine(c, n / 2 + sd * n * (low ? 0.2 : 0.4), n * (low ? 0.99 : 0.8), -PI / 2 + sd * (low ? 0.75 : 0.15), n * (low ? 0.42 : 0.5), ease(age / 8), 70 + k + Math.floor(tt / span) * 5, al * smooth(age) * smooth((span - age) / 4), sd * (low ? 0.8 : -0.9));
          if (age > 8) glint(c, P, T, 0.1, k * 0.3, n * 0.05, 0.5 * al);
        }
        c.restore();
      },
    },
    tints: (hue, t) => ({ glow: 'rgb(214,170,96)', halo: 'rgb(234,223,196)', rim: `hsl(${22 + 14 * Math.sin(t / 2300)},62%,76%)` }),
    spark(c, x, y, r, hue, tw, al, k) {                // a seed on the air, a grain of gold in it
      stamp(c, gold(), x, y, r * 1.8, 0.7 * tw * al); c.globalAlpha = 1;
      seeds(c, [[x, y + r * 0.5, r * 1.6, Math.sin(k * 2.1 + tw * 2) * 0.4]], (0.4 + 0.6 * tw) * al);
    },
    cloud(c, cx, cy, size, t, al) {                    // what a picture comes in: whole in the middle, coming apart into stipple around
      const T = t / 1000, P = puff(), D = [], n = 260;
      c.globalCompositeOperation = 'lighter';
      stamp(c, P, cx, cy, size * (0.45 + 0.02 * Math.sin(T / 1.3)), al); stamp(c, P, cx, cy, size * 0.36, al);
      for (let k = 0; k < 10; k++) { const an = k / 10 * TAU + 0.25 * Math.sin(T / 3.7 + k) + T / 21 * (k % 2 ? 1 : -1), rr = size * (0.25 + 0.05 * Math.sin(T / 1.9 + k * 1.9)); stamp(c, P, cx + Math.cos(an) * rr * 1.05, cy + Math.sin(an) * rr * 1.2, size * (0.2 + 0.04 * Math.sin(T / 1.5 + k * 2.3)), al * 0.9); }
      c.globalAlpha = 1;
      for (let k = 0; k < n; k++) {
        const an = k * 2.39996 + T * 0.01, far = 0.3 + 0.28 * Math.sqrt(k / n), edge = 0.5 + 0.06 * Math.sin(an * 3 + T * 0.4) + 0.04 * Math.sin(an * 7 - T * 0.3);
        D.push([cx + Math.cos(an) * far * size * 1.05, cy + Math.sin(an) * far * size * 1.18, size * 0.016 * smooth((edge - far) / 0.2) * (0.6 + 0.8 * hash(71, k))]);
      }
      dots(c, D, al, '#fff');
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    },
    rings(g, pupils, r, t, hue, p, mist) {             // a dividing circle at the edge of each window the picture comes through
      const T = t / 1000, al = 0.8 * (1 - p) * (1 - 0.6 * mist);
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const [px, py] of pupils) {
        hair(g, [ring(px, py, r, 48), ring(px, py, r * 1.09, 48)], (1.2 + 3 * (1 - p)) * (1 - 0.5 * mist), al); hair(g, ticks(px, py, 40, r * 1.025, r * 1.065, T * 0.2, T * 0.2 + TAU), 0, al * 0.8, GOLD);
        glint(g, ring(px, py, r * 1.045, 40), T, 0.3, px * 0.01, r * 0.5, al);
      }
      g.restore();
    },
  };

  DreamStyle.register('etching', {
    eye: { draw: eye, irisWorld, pupilShape },
    life: { draw: life },
    face: { draw: face, MODES: FACES },
    motif: { third, mandala, penrose: shape, stairs: shape, fork: shape, cube: shape },
    back: { mask: backMask },
    sky: { clouds: skyClouds },
    fire: { flames },
    trance: { back: tranceBack, eye: tranceEye },
    you,
    air: { draw: air },
  });
})(typeof window !== 'undefined' ? window : globalThis);
