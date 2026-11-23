/* Dream – the style world "bioluminescence" (#222): the deep sea. Every form is a translucent body that gives off its
   own light, and nothing has an outline: lines are soft filaments (three passes of light over each other), surfaces
   are thin membranes, light sits in beads that pulse in waves travelling along a line. Marine snow drifts through
   everything. The eye is a dark chamber lit from its rim, with an anemone's crown around the iris and cilia for lashes.

   What today's look shows as signs has its own form here: a warm lure instead of a heart, plankton flashing instead of
   stars, bubbles of light instead of letters, a medusa instead of the triangle. Of a face there is what the face rule
   lets through (static/dreamvis.js) – the nose, in the rare moment, as two fine rows of lights and a glow on its tip.

   Everything is stamped lights (drawn once, static/dreambrush.js) and a few paths of many lines each – no blur, no
   shadow, no filter: old phones. Registers itself with the style layer (static/dreamstyle.js). */
(function (root) {
  'use strict';
  const { DreamBrush, DreamVis, DreamLife, DreamEye, DreamStyle } = root;
  const { TAU, clamp, lerp, smooth, rng, hash, noise2, curve, trace, ribbon, sprite, softLight, stamp, lids, faceFrame, skeleton, canvas, kaleido, night } = DreamBrush;
  const PI = Math.PI, ease = x => 1 - Math.pow(1 - clamp(x), 3), seg = (x, a, b) => clamp((x - a) / (b - a));

  // ---------- the materials ----------
  // a light of the deep: a bright heart, a wide soft halo – one per 15° of hue, drawn once
  const glow = hue => { const k = ((Math.round(hue / 15) % 24) + 24) % 24; return sprite('sea-glow' + k, () => softLight([[0, `hsla(${k * 15},95%,86%,1)`], [0.22, `hsla(${k * 15},90%,62%,.55)`], [1, `hsla(${k * 15},90%,50%,0)`]], 64)); };
  const pale = () => sprite('sea-pale', () => softLight([[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']], 64));   // the same light without a colour: where the dream shines through
  const white = () => sprite('sea-white', () => softLight([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(220,245,255,.5)'], [1, 'rgba(200,240,255,0)']], 64));
  const vign = () => sprite('sea-vign', () => softLight([[0, 'rgba(2,8,20,0)'], [0.62, 'rgba(2,8,20,0)'], [1, 'rgba(2,8,20,.92)']], 256));   // an iris, a bell: dark towards its rim
  const pupil = () => sprite('sea-pupil', () => softLight([[0, 'rgba(1,3,8,1)'], [0.78, 'rgba(1,3,8,1)'], [1, 'rgba(1,3,8,0)']], 128));
  const puff = () => sprite('sea-puff', () => softLight([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']], 128));
  // the sea's own colours: whatever hue is asked for becomes one of them (cyan, blue, sea green, violet, magenta)
  const SEA = [185, 205, 160, 285, 320];
  const sea = hue => SEA[Math.floor((((hue % 360) + 360) % 360) / 72)];
  // soft filaments: every line of `list` in three passes – a wide faint one, a middle one, a fine bright core; drawn up
  // to m (0–1) of their length; mono: without a colour
  function fils(c, list, hue, w, al, m, mono) {
    if (al <= 0.004 || !list.length) return;
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [k, a, l] of [[10, 0.06, 55], [4.5, 0.15, 62], [1.7, 0.42, 78]]) {
      c.strokeStyle = mono ? `rgba(255,255,255,${a * al * 1.6})` : `hsla(${hue},85%,${l}%,${a * al})`; c.lineWidth = Math.max(0.6, w * k); c.beginPath();
      for (const P of list) { const n = m === undefined ? P.length : Math.max(2, Math.ceil(P.length * m)); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < n && i < P.length; i++) c.lineTo(P[i][0], P[i][1]); }
      c.stroke();
    }
  }
  // beads of light along a line, pulsing in a wave that travels along it; o.shift: how far the hue turns from end to end
  function beads(c, P, hue, r, al, T, o = {}, mono) {
    if (al <= 0.004) return;
    const step = o.step || 2, n = o.m === undefined ? P.length : Math.ceil(P.length * o.m);
    for (let i = 0; i < n; i += step) {
      const p = Math.pow(0.5 + 0.5 * Math.sin(i * (o.freq || 0.55) - T * (o.speed || 2.4) + (o.ph || 0)), 3), k = 0.3 + 0.7 * p;
      stamp(c, mono ? pale() : glow(hue + (o.shift || 0) * i / P.length), P[i][0], P[i][1], r * (0.6 + 0.9 * p), al * k);
    }
    c.globalAlpha = 1;
  }
  // a tentacle: from (x, y) towards ang, len long in n pieces, swaying in the current
  function tentacle(x, y, ang, len, n, T, ph, sway = 0.35) {
    const P = [[x, y]];
    for (let i = 1; i <= n; i++) { const a = ang + Math.sin(T * 1.1 - i * 0.55 + ph) * sway * (i / n) * 1.6 + Math.sin(T * 0.37 + ph * 2) * 0.2 * (i / n); P.push([P[i - 1][0] + Math.cos(a) * len / n, P[i - 1][1] + Math.sin(a) * len / n]); }
    return P;
  }
  const tips = (c, list, hue, r, al, mono) => { if (al > 0.004) for (const P of list) { const p = P[P.length - 1]; stamp(c, mono ? pale() : glow(hue), p[0], p[1], r, al); } c.globalAlpha = 1; };
  const ring = (x, y, r, n = 40, a0 = 0, a1 = TAU) => Array.from({ length: n + 1 }, (_, k) => { const an = a0 + (a1 - a0) * k / n; return [x + Math.cos(an) * r, y + Math.sin(an) * r]; });
  // a slow current (sums of sines): where something drifting goes at (x, y)
  const flow = (x, y, T) => [Math.cos(y * 1.3 + T * 0.21) * 0.6 + Math.cos(y * 2.9 - T * 0.13 + x * 0.7) * 0.4, -Math.cos(x * 1.1 - T * 0.17) * 0.6 - Math.cos(x * 2.3 + T * 0.11 + y * 0.9) * 0.4];

  // ---------- the eye: a dark chamber lit from its rim ----------
  function eye(g, cx, cy, a, b, mirror, p) {
    const up = Math.max(0.02, p.open * (1 - p.blink) * (1 - 0.25 * p.squint)), lo = (0.82 + 0.1 * p.open) * (1 - 0.35 * p.squint);
    const L = lids(cx, cy, a, b, mirror, up, lo), o = L.o, T = performance.now() / 1000, idx = mirror ? 1 : 0, hint = p.crease || 0, look = p.look;
    const R = Math.min(a * 0.5, b * 1.02), ix = cx + p.gx * a * 0.34 * (mirror ? 0.96 : 1), iy = cy + p.gy * b * 0.32;
    const U = [], Lo = [], Cc = [];
    for (let k = 0; k <= 26; k++) { const u = k / 26, q = L.upper(u); U.push(q); Lo.push(L.lower(u)); Cc.push([q[0], q[1] - b * (0.1 + 0.42 * Math.sin(PI * u) * (0.35 + 0.65 * up))]); }
    g.save();
    g.globalCompositeOperation = 'lighter'; stamp(g, glow(195), cx, cy, a * 1.8, 0.14 + 0.12 * p.energy); g.globalAlpha = 1;
    if (p.browAl > 0.01) {                             // the brow, when it comes: a row of photophores – it moves with what they feel
      const E = p.brow;
      let by0 = cy - b * 1.6 + b * E.inner, by2 = cy - b * 1.7 + b * E.outer, bpy = cy - b * (1.95 + 0.35 * look.arch) + b * E.peak;
      const room = Math.min(by0, by2, bpy) - b * 0.25;
      if (room < 0) { by0 -= room; by2 -= room; bpy -= room; }
      beads(g, curve([[cx - o * a * 0.8, by0], [cx + o * a * 0.38, bpy], [cx + o * a * 1.02, by2]], 7), 255, a * 0.06 * look.brow, 0.75 * p.browAl, T, { step: 1, freq: 0.4, speed: 1.2, ph: idx });
    }
    const memb = 235 + 30 * Math.sin(look.hue / 57.3);  // the lid: a membrane with ribs – nearly nothing, more with the hints
    g.fillStyle = `hsla(${memb},75%,62%,${0.03 + 0.11 * hint})`; g.beginPath(); U.forEach((q, i) => g[i ? 'lineTo' : 'moveTo'](q[0], q[1])); for (let i = Cc.length - 1; i >= 0; i--) g.lineTo(Cc[i][0], Cc[i][1]); g.fill();
    fils(g, U.filter((_, i) => i % 2 === 1).map((q, i) => [q, Cc[i * 2 + 1]]), 215, a * 0.004, 0.1 + 0.4 * hint);
    g.globalCompositeOperation = 'source-over'; g.save(); L.path(g); g.clip();
    g.fillStyle = 'rgba(1,8,18,.94)'; g.fillRect(cx - a, cy - b * 1.6, 2 * a, 3.2 * b);
    g.globalCompositeOperation = 'lighter'; g.lineJoin = 'round';
    for (const [w, al] of [[0.42, 0.07], [0.2, 0.1], [0.08, 0.14]]) { g.strokeStyle = `hsla(188,90%,62%,${al * (0.8 + 0.5 * p.energy)})`; g.lineWidth = a * w; L.path(g); g.stroke(); }
    const an = [];                                     // an anemone's crown around the iris
    for (let k = 0; k < 34; k++) { const q = k / 34 * TAU; an.push(tentacle(ix + Math.cos(q) * R * 0.97, iy + Math.sin(q) * R * 0.97, q, R * (0.3 + 0.2 * noise2(k, idx + 4)), 5, T, k * 1.3 + idx, 0.5)); }
    fils(g, an, 170, a * 0.006, 0.6); tips(g, an, 160, a * 0.022, 0.6);
    g.globalCompositeOperation = 'source-over';
    g.save(); g.beginPath(); g.arc(ix, iy, R, 0, TAU); g.clip();
    g.fillStyle = '#01060e'; g.fillRect(ix - R, iy - R, R * 2, R * 2);
    p.iris(ix, iy, R);                                 // the dream, a world of its own, and whoever is mirrored in it
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.drawImage(vign(), ix - R, iy - R, R * 2, R * 2);
    const pr = R * p.pupil;
    if (p.pupilMix < 0.99) { g.globalAlpha = 1 - p.pupilMix; g.drawImage(pupil(), ix - pr * 1.18, iy - pr * 1.18, pr * 2.36, pr * 2.36); }
    if (p.pupilMix > 0.01) { g.globalAlpha = p.pupilMix; p.pupilShape(ix, iy, pr, R); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (p.reflect) p.reflect(ix, iy, R);
    g.globalCompositeOperation = 'lighter'; stamp(g, white(), ix - R * 0.36, iy - R * 0.38, R * 0.3, 0.8); stamp(g, white(), ix + R * 0.3, iy + R * 0.27, R * 0.1, 0.5); g.globalAlpha = 1;
    g.restore(); g.restore();
    g.globalCompositeOperation = 'lighter';
    fils(g, [U], 188, a * 0.011, 0.75); fils(g, [Lo], 200, a * 0.007, 0.4); fils(g, [Cc], 240, a * 0.005, 0.3 * hint);
    beads(g, U, 170, a * 0.03, 0.75, T, { step: 1, shift: 150, freq: 0.5, speed: 3, ph: idx * 2 });   // a comb jelly's shimmer runs along the lid
    beads(g, Lo, 200, a * 0.018, 0.4, T, { step: 2, shift: 60, speed: -2 });
    const la = [], lb = [];                            // lashes: cilia swaying in the current, a light at each tip
    for (let i = 0; i < 13; i++) { const k = i / 12, q = L.upper(0.2 + i * 0.064); la.push(tentacle(q[0], q[1], -PI / 2 + o * (0.1 + 0.95 * look.curl * k * k), a * (0.1 + 0.4 * Math.pow(k, 1.2)) * look.lashes * (0.75 + 0.5 * noise2(i, idx + 9)) * (0.35 + 0.65 * up), 6, T, i * 0.8 + idx, 0.3)); }
    for (let i = 0; i < 6; i++) { const q = L.lower(0.5 + i * 0.085); lb.push(tentacle(q[0], q[1], PI / 2 + o * (0.2 + i * 0.1), a * (0.05 + 0.02 * i) * look.lower, 4, T, i + 5, 0.3)); }
    fils(g, la, 195, a * 0.006, 0.7); fils(g, lb, 205, a * 0.004, 0.4);
    la.forEach((P, i) => { const q = P[P.length - 1]; stamp(g, glow(175 + i * 11), q[0], q[1], a * 0.026, 0.5 + 0.4 * Math.sin(T * 2 + i)); });
    g.restore();
    return [ix, iy];
  }
  // what is in an iris: the dream as every world shows it (static/dreameye.js) – but a fire is a vent glowing in the
  // deep: the dream dim and warm behind it, warm lights rising
  function irisWorld(g, style, ix, iy, R, mirror, al, o) {
    if (style !== 'fire' && style !== 'embers') { DreamEye.irisWorld(g, style, ix, iy, R, mirror, al, o); return; }
    const T = performance.now() / 1000, heat = o.heat === undefined ? 1 : o.heat, n = style === 'fire' ? 16 : 9;
    g.save(); g.translate(ix, iy);
    g.globalAlpha = al; g.fillStyle = '#140604'; g.fillRect(-R, -R, R * 2, R * 2);
    o.pic(0, 0, R * 2.3, al * 0.3);
    g.globalAlpha = al * 0.45; g.fillStyle = '#5a1400'; g.fillRect(-R, -R, R * 2, R * 2);
    g.globalCompositeOperation = 'lighter';
    stamp(g, glow(25), 0, R * 0.95, R * (0.7 + 0.6 * heat), al * (style === 'fire' ? 0.8 : 0.5));
    for (let k = 0; k < n; k++) {
      const u = (T / (1.5 + (k % 5) * 0.4) + k * 0.37) % 1, tw = 0.6 + 0.4 * Math.sin(T * 6 + k * 1.9);
      stamp(g, glow(12 + k * 3), Math.sin(k * 2.4 + T * 0.9 + u * 3) * R * 0.7, R * (0.95 - 1.9 * u * (0.5 + 0.5 * heat)), R * (0.1 + 0.09 * ((k * 7) % 5) / 4), al * Math.sin(PI * u) * tw);
    }
    g.restore();
  }
  // A pupil that is not round. The soft shimmers and the cat's slit are every world's (static/dreameye.js); what
  // today's look draws as a sign is a light of the deep here: for 'heart' a warm lure, beating softly, for 'star'
  // plankton flashing, for 'spiral' lights wandering inward along a spiral.
  function pupilShape(g, shape, x, y, pr, R, mirror, o) {
    if (shape !== 'heart' && shape !== 'star' && shape !== 'spiral') { DreamEye.pupilShape(g, shape, x, y, pr, R, mirror, o); return; }
    const al = g.globalAlpha, T = (o.now === undefined ? performance.now() : o.now) / 1000, beat = o.beat || 0, dir = mirror ? -1 : 1, base = 175 + 35 * Math.sin(o.hue / 57.3);
    g.drawImage(pupil(), x - pr * 1.18, y - pr * 1.18, pr * 2.36, pr * 2.36);
    g.save(); g.globalCompositeOperation = 'lighter';
    if (shape === 'heart') {
      const hue = o.fire ? 22 : 335, b = 0.8 + 0.2 * Math.sin(T * (o.fire ? 7 : 3.2));
      stamp(g, glow(hue), x, y, pr * 1.5 * b, al * 0.75); stamp(g, white(), x, y, pr * 0.42 * b, al * 0.9);
      for (let k = 0; k < 3; k++) { const an = T * 0.9 * dir + k * TAU / 3; stamp(g, glow(hue + 25), x + Math.cos(an) * pr * 0.72, y + Math.sin(an) * pr * 0.72, pr * 0.22, al * 0.6); }
    } else if (shape === 'star') {
      for (let k = 0; k < 11; k++) {
        const tw = Math.pow(0.5 + 0.5 * Math.sin(T * 5 + k * 2.1), 3), an = k * 2.39996 + T * 0.3 * dir, rr = pr * 0.9 * Math.sqrt((k + 0.5) / 11);
        stamp(g, glow(base + k * 12), x + Math.cos(an) * rr, y + Math.sin(an) * rr, pr * (0.14 + 0.2 * tw), al * (0.25 + 0.75 * tw));
      }
    } else {
      const P = [];
      for (let k = 0; k <= 30; k++) { const u = k / 30, an = T * 3.2 * dir + u * PI * 6, rr = u * pr * 0.95; P.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr]); }
      fils(g, [P], base, pr * 0.012, al * 0.5);
      P.forEach((q, k) => { const u = k / 30, w = Math.pow(0.5 + 0.5 * Math.sin(k * 0.55 + T * 5), 2); stamp(g, glow(base + u * 90), q[0], q[1], pr * (0.07 + 0.11 * u) * (1 + 0.5 * beat), al * (0.35 + 0.65 * w)); });
    }
    g.restore(); g.globalAlpha = al;
  }

  // ---------- what lives around the eyes and drifts through the windows ----------
  function plankton(g, x, y, s, hue, env, T, r, n) {   // a loose swarm turning in the current
    for (let k = 0; k < n; k++) {
      const f1 = 0.2 + r() * 0.5, f2 = 0.2 + r() * 0.5, p1 = r() * 9, p2 = r() * 9, rad = s * (0.3 + 1.1 * r()), px = x + Math.sin(T * f1 + p1) * rad, py = y + Math.cos(T * f2 + p2) * rad * 0.8, big = r() < 0.25;
      stamp(g, glow(hue + r() * 80), px, py, s * (big ? 0.14 : 0.06), env * (0.4 + 0.5 * Math.sin(T * 2 + k)));
      if (big) { g.globalAlpha = 0.35 * env; g.strokeStyle = `hsla(${hue},80%,75%,1)`; g.lineWidth = 0.8; g.beginPath(); g.arc(px, py, s * 0.06, 0, TAU); g.stroke(); }
    }
    g.globalAlpha = 1;
  }
  function jelly(g, x, y, s, hue, env, T, ph, r, arms = 7) {   // a small jellyfish: a bell that pulses, tentacles trailing
    const p = Math.sin(T * 2.2 + ph), rx = s * 0.55 * (1 - 0.13 * p), ry = s * 0.5 * (1 + 0.1 * p), bell = [], list = [];
    y -= Math.max(0, p) * s * 0.06;
    for (let k = 0; k <= 20; k++) { const q = PI + k / 20 * PI; bell.push([x + Math.cos(q) * rx, y + Math.sin(q) * ry]); }
    for (let k = 20; k >= 0; k--) bell.push([x + (k / 10 - 1) * rx, y + s * 0.05 * Math.abs(Math.sin(k / 20 * PI * 4))]);
    g.fillStyle = `hsla(${hue},85%,60%,${0.3 * env})`; trace(g, bell); g.fill(); fils(g, [bell], hue, s * 0.014, 0.7 * env);
    for (let k = 0; k < arms; k++) { const u = arms > 1 ? k / (arms - 1) * 2 - 1 : 0; list.push(tentacle(x + u * rx * 0.85, y + s * 0.03, PI / 2 + u * 0.25 * (1 + p * 0.5), s * (1 + 0.6 * r()), 8, T * 1.4, k + ph, 0.3)); }
    fils(g, list, hue + 20, s * 0.012, 0.7 * env); tips(g, list, hue + 60, s * 0.06, 0.7 * env); stamp(g, glow(hue + 40), x, y - ry * 0.4, s * 0.5, 0.6 * env); g.globalAlpha = 1;
  }
  const bubble = (g, x, y, r, hue, al) => {            // a bubble of light: a faint body, a fine rim, a spark on it
    stamp(g, glow(hue), x, y, r * 1.5, al * 0.3); g.globalAlpha = al * 0.6; g.strokeStyle = `hsl(${hue},80%,75%)`; g.lineWidth = Math.max(0.7, r * 0.07); g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
    stamp(g, white(), x - r * 0.4, y - r * 0.45, r * 0.3, al * 0.7); g.globalAlpha = 1;
  };
  // One living thing d at age ms, faded in and out by env, drawn at size s, its drifting height y (static/dreamlife.js
  // describes d and o). 'lighter' is set by the caller.
  function life(g, d, age, env, s, y, o) {
    const T = age / 1000, r = rng(((d.born || 0) * 7 + d.x * 13 + (d.spin || 1) * 101) | 0), x = d.x, hue = sea(d.hue), kind = d.kind;
    if (kind === 'bloom') {                            // an anemone opening
      const grow = ease(age / 2500), list = [], r0 = s * 0.1;
      for (let k = 0; k < 22; k++) { const q = k / 22 * TAU + d.spin * T * 0.05; list.push(tentacle(x + Math.cos(q) * r0, y + Math.sin(q) * r0, q, s * (0.45 + 0.4 * r()) * grow, 6, T, k * 1.7, 0.45)); }
      fils(g, list, hue, s * 0.012, 0.75 * env); tips(g, list, hue + 60, s * 0.06, 0.7 * env); stamp(g, glow(hue + 30), x, y, s * 0.3, 0.5 * env); g.globalAlpha = 1;
    } else if (kind === 'mandala') {                   // a comb jelly: eight rows of combs, a shimmer running down each
      const rx = s * 0.4, ry = s * 0.62, rot = Math.sin(T * 0.4 + d.spin) * 0.35, body = ring(0, 0, 1, 36).map(([px, py]) => [px * rx * (1 - 0.18 * py), py * ry]);
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = `hsla(${hue},80%,60%,${0.1 * env})`; trace(g, body); g.fill(); fils(g, [body], hue, s * 0.008, 0.5 * env);
      for (let j = 0; j < 8; j++) {
        const lam = (j + 0.5) / 8 * PI - PI / 2 + Math.sin(T * 0.3) * 0.15, P = [];
        for (let k = 0; k <= 16; k++) { const lat = (k / 16 - 0.5) * 2.5; P.push([Math.sin(lam) * Math.cos(lat) * rx * (1 - 0.18 * Math.sin(lat)), Math.sin(lat) * ry]); }
        fils(g, [P], hue + 20, s * 0.004, 0.3 * env * Math.cos(lam));
        beads(g, P, hue - 60, s * 0.045 * (0.5 + 0.5 * Math.cos(lam)), 0.9 * env, T, { step: 1, shift: 280, freq: 0.9, speed: 4, ph: j * 0.7 });
      }
      g.restore();
    } else if (kind === 'tree') {                      // a sea fan growing, its tips alight
      const grown = ease(age / 3500) * 4.2, list = [], ends = [];
      const grow = (px, py, ang, len, depth) => {
        const k = clamp(grown - depth); if (k <= 0) return;
        const P = tentacle(px, py, ang, len * k, 4, T * 0.6, depth * 2 + ang * 3, 0.12 + depth * 0.04), e = P[4]; list.push(P);
        if (depth >= 3 || grown - depth < 1) ends.push(e);
        if (depth < 4) { grow(e[0], e[1], ang - 0.42 - 0.2 * r(), len * 0.72, depth + 1); grow(e[0], e[1], ang + 0.38 + 0.2 * r(), len * 0.74, depth + 1); }
      };
      grow(x, d.y + s * 0.6, -PI / 2 + (r() - 0.5) * 0.6, s * 0.4, 0);
      fils(g, list, 335, s * 0.012, 0.8 * env); for (const e of ends) stamp(g, glow(35), e[0], e[1], s * 0.055, 0.75 * env * (0.6 + 0.4 * Math.sin(T * 3 + e[0]))); g.globalAlpha = 1;
    } else if (kind === 'moth') {                      // a small jellyfish pulsing along a looping path
      const k = T * 0.6; jelly(g, x + Math.sin(k * 1.3) * s * 1.1, y + Math.sin(k * 2.1) * s * 0.5, s * 0.5, hue, env, T, d.spin * 9, r);
    } else if (kind === 'bubbles') {                   // bubbles of light rising and wobbling
      for (let j = 0; j < 7; j++) {
        const ph = (T + j * 0.7) % 4.5, bx = x + Math.sin(ph * 2 + j) * s * 0.35 + (j - 3) * s * 0.12, by = d.y + s * 0.6 - ph * s * 0.5;
        bubble(g, bx, by, s * (0.06 + 0.04 * (j % 3)), hue + j * 14, env * Math.min(1, ph * 2, (4.5 - ph) * 1.5));
      }
    } else if (kind === 'aurora') {                    // a siphonophore: a long chain of lights with fine threads
      const P = [], list = [];
      for (let i = 0; i <= 22; i++) { const u = i / 22; P.push([x + (u - 0.5) * s * 4, y + Math.sin(u * 6 + T * 0.9) * s * 0.25 + Math.sin(u * 2.3 + T * 0.35) * s * 0.2]); }
      for (let i = 1; i < 22; i += 2) list.push(tentacle(P[i][0], P[i][1], PI / 2, s * 0.3, 4, T, i, 0.5));
      fils(g, [P], hue, s * 0.008, 0.35 * env); fils(g, list, hue + 30, s * 0.005, 0.35 * env); beads(g, P, hue - 40, s * 0.1, 0.9 * env, T, { step: 1, shift: 200, freq: 0.6, speed: 3 });
    } else if (kind === 'orbit') {                     // little lights circling one eye, each drawing a short wake
      const [ex, ey, ea] = o.anchor || [x, y, s * 0.6];
      for (let j = 0; j < 3; j++) for (let q = 0; q < 5; q++) {
        const an = (age - q * 70) / (900 + j * 400) * (j % 2 ? -1 : 1) + j * 2.1;
        stamp(g, glow(hue + j * 45), ex + Math.cos(an) * ea * (1.15 + j * 0.12), ey + Math.sin(an) * ea * (0.75 + j * 0.08), ea * 0.1 * (1 - q * 0.15), env * (q ? 0.35 * (1 - q / 5) : 0.9));
      }
      g.globalAlpha = 1;
    } else if (kind === 'tear') {                      // a drop of light sinks, and comes apart into drifting snow
      const p = age / d.life, fall = Math.min(1, p / 0.55), ty = d.y + fall * fall * s * 9;
      if (p < 0.6) {
        fils(g, [[[x, ty - s * 2.2 * fall], [x + Math.sin(T * 3) * s * 0.1, ty - s * 1.1 * fall], [x, ty]]], hue, s * 0.07, 0.6);
        stamp(g, glow(hue), x, ty, s * 1.1, 0.95); stamp(g, white(), x, ty, s * 0.35, 0.9);
      } else {
        const q = (p - 0.6) / 0.4;
        for (let j = 0; j < 9; j++) { const an = j * 0.7 + r() * 0.5, rr = q * s * (2 + 3 * r()); stamp(g, glow(hue + j * 12), x + Math.cos(an) * rr + Math.sin(T * 2 + j) * s * 0.3, d.y + s * 9 + Math.sin(an) * rr * 0.5 + q * s * 2, s * 0.32, (1 - q) * 0.9); }
      }
      g.globalAlpha = 1;
    } else if (kind === 'stars') {                     // plankton flashing around an eye, where today's look bursts into stars
      const q = age / d.life;
      for (const [an, rr, ph] of d.puffs) {
        const r2 = d.size * rr * (0.7 + 0.5 * q), tw = Math.pow(0.5 + 0.5 * Math.sin(age / 90 + ph * 40), 2), sz = d.size * 0.06 * (d.big || 1) * (1 - q) * (0.6 + ph);
        stamp(g, glow(hue + ph * 60), x + Math.cos(an) * r2, d.y + Math.sin(an) * r2 * 0.7, sz * (1 + tw), (1 - q) * (0.4 + 0.6 * tw));
      }
      g.globalAlpha = 1;
    } else if (kind === 'ember') {                     // a warm light rising from a vent, swaying
      const q = age / d.life;
      stamp(g, glow(d.hue + 8), x + Math.sin(age / 300 + d.spin * 9) * d.size * 6, d.y - q * o.H * 0.75, d.size * 3.4, 1 - q); g.globalAlpha = 1;
    } else if (kind === 'fireheart') {                 // where today's look lets a heart rise: a tiny warm medusa, its bell beating
      const q = age / d.life;
      jelly(g, x + Math.sin(age / 500 + d.spin * 7) * d.size, d.y - q * o.H * 0.7, d.size * 1.5, d.hue, (1 - q) * 0.95, T * 2.6, d.spin * 9, r, 4);
    } else if (kind === 'sparks') {                    // a shower of warm lights flying in from where a fire flared up
      const q = age / d.life, out = 1 - (1 - q) * (1 - q);
      for (const [an, sp, ph] of d.puffs) {
        const far = d.size * sp * out;
        stamp(g, glow(d.hue + ph * 30), x + Math.cos(d.dir + an) * far, d.y + Math.sin(d.dir + an) * far + d.size * 0.3 * q * q, d.size * 0.022 * (0.5 + ph) * (1.2 - q), (1 - q) * (0.55 + 0.45 * Math.sin(age / 55 + ph * 40)));
      }
      g.globalAlpha = 1;
    } else if (kind === 'zzz') {                       // asleep: slow bubbles of breath rise, each larger than the last
      const q = age / d.life;
      for (let j = 0; j < 3; j++) { const qj = q - j * 0.14; if (qj > 0) bubble(g, x + Math.sin(age / 500 + j * 2) * d.size * 0.6 + qj * d.size * 1.5, d.y - qj * d.size * 5, d.size * (0.22 + 0.5 * qj), hue + 20, 0.8 * (1 - q)); }
    } else plankton(g, x, y, s * 0.9, hue, env, T, r, kind === 'cloud' ? 26 : 18);   // 'cloud', and whatever else: plankton
  }

  // ---------- the faces of light ----------
  // Three beings of the deep whose eyes these may be. v is the face rule's word: the sign on the forehead comes with
  // the hints; what hangs from the head, the jaw's lights, the nose and the mouth only in the rare moment, clearly then. The brow
  // is the eye's own. Drawn twice by the page: without `ink` into the mask the dream shines through (so: without
  // colours), with it as the world's own glow over that.
  const FACES = ['medusa', 'angler', 'anemone'];
  const HINT = 1.2;                                    // the sign on the forehead: a little stronger than it was first drawn
  const RARE = 1.25;                                   // light adds up thinly: what comes in the rare moment is drawn a little above its share
  function face(c, mode, t, geo, v, ink, inkAl = 1) {
    const mono = ink === undefined, K = mono ? 0.5 : Math.min(1, inkAl * 4.5);
    const mark = DreamVis.of(v, 'mark') * HINT * K, hair = DreamVis.of(v, 'hair') * RARE * K, outline = DreamVis.of(v, 'outline') * RARE * K, mouth = DreamVis.of(v, 'mouth') * RARE * K, nose = DreamVis.of(v, 'nose') * RARE * K;
    if (mark + hair + outline + mouth + nose <= 0.004) return;
    const T = t / 1000, F = faceFrame(geo.cx, geo.ey, geo.half), a = F.u, S = skeleton(geo.cx, geo.ey, geo.half, t);
    const strands = S.filter(k => k.name === 'strand').map(k => k.pts), jaws = S.filter(k => k.name === 'jaw').map(k => k.pts), lip = n => S.find(k => k.name === n).pts;
    const pr = (s, e) => smooth(seg(v.fullForm, s, e)), pH = (s, e) => smooth(seg(v.hintForm, s, e));
    const light = (hue, p, r, al) => { if (al > 0.004) stamp(c, mono ? pale() : glow(hue), p[0], p[1], r, al); };
    const fill = (hue, al) => { c.fillStyle = mono ? `rgba(255,255,255,${al})` : `hsla(${hue},85%,60%,${al})`; };
    c.save();
    if (mode === 'medusa') {
      // what hangs from the head: a medusa's bell over the brow, its rim scalloped, ribs carrying light down, and tentacles
      const pulse = 1 + 0.035 * Math.sin(T * 1.3), ba = hair * pr(0, 0.35), rim = [];
      const dome = curve([[-4.0 * pulse, -2.5], [-3.7 * pulse, -3.5], [-2.1 * pulse, -4.4], [0, -4.65], [2.1 * pulse, -4.4], [3.7 * pulse, -3.5], [4.0 * pulse, -2.5]].map(q => F(q[0], q[1])), 8);
      for (let k = 0; k <= 48; k++) { const u = k / 48; rim.push(F(lerp(-4.0, 4.0, u) * pulse, -2.5 - 0.22 * Math.abs(Math.sin(u * PI * 6)) - 0.35 * Math.sin(u * PI) + 0.05 * Math.sin(T * 1.3 + u * 9))); }
      if (ba > 0.004) {
        fill(205, 0.15 * ba); trace(c, dome); for (let k = 48; k >= 0; k--) c.lineTo(rim[k][0], rim[k][1]); c.fill();
        for (const [ux, uy, rr2, hh] of [[-2.2, -3.3, 2.2, 215], [2.2, -3.3, 2.2, 215], [0, -3.7, 2.6, 190], [-3.2, -2.9, 1.4, 260], [3.2, -2.9, 1.4, 260]]) light(hh, F(ux * pulse, uy), a * rr2, 0.16 * ba);
        fils(c, [dome], 195, a * 0.012, 0.55 * ba, undefined, mono); fils(c, [rim], 172, a * 0.008, 0.6 * ba, undefined, mono);
        const top = F(0, -4.55), ribs = [];
        for (let k = 1; k < 12; k++) { const e = rim[k * 4], mid = [lerp(top[0], e[0], 0.55) + (e[0] - top[0]) * 0.12, lerp(top[1], e[1], 0.35)]; ribs.push(curve([top, mid, e], 8)); }
        fils(c, ribs, 200, a * 0.005, 0.35 * ba, undefined, mono); ribs.forEach((P, i) => beads(c, P, 185, a * 0.035, 0.5 * ba, T, { step: 3, freq: 0.5, speed: 2.2, ph: i * 0.6 }, mono));
        for (let k = 0; k <= 48; k += 4) light(165, rim[k], a * 0.06, 0.7 * ba * (0.5 + 0.5 * Math.sin(T * 2.2 - k * 0.3)));
      }
      const ha = hair * pr(0.2, 0.9);
      if (ha > 0.004) strands.forEach((P0, k) => {
        const i = k % 5, o = k < 5 ? -1 : 1, m = pr(0.2 + i * 0.06, 0.7 + i * 0.06), P = P0.map((q, j) => [q[0] + Math.sin(T * 0.9 - j * 0.22 + i * 1.7 + o) * a * 0.16 * (j / P0.length), q[1]]);
        if (i === 1 || i === 3) { fill(i === 1 ? 300 : 265, 0.2 * ha); ribbon(c, P, u => a * 0.24 * Math.sin(PI * Math.pow(u, 0.6)) * (0.6 + 0.4 * Math.sin(u * 26 - T * 2.4 + i)), m); }   // an oral arm: a frilled ribbon of membrane
        fils(c, [P], 190 + i * 14, a * 0.014, 0.6 * ha, m, mono); beads(c, P, 180 + i * 14, a * 0.07, 0.7 * ha, T, { step: 3, m, freq: 0.35, speed: 2, ph: k, shift: 50 }, mono);
      });
      const la = mark * pH(0.4, 1), lure = F(Math.sin(T * 0.8) * 0.1, -2.75 + Math.cos(T * 1.1) * 0.05);   // the sign on the forehead: the lure, one warm light
      fils(c, [curve([F(0.3, -3.5), F(0.35, -3.1), lure], 8)], 40, a * 0.006, 0.4 * la, undefined, mono);
      light(40, lure, a * 0.75, la * (0.55 + 0.3 * Math.sin(T * 2))); if (la > 0.004) stamp(c, white(), lure[0], lure[1], a * 0.14, la * 0.9);
    } else if (mode === 'angler') {
      // an anglerfish: its lure on a long stalk, fin rays standing over the head, rows of photophores along the jaw
      const la = mark * pH(0.2, 1), sw = Math.sin(T * 0.7), lure = F(1.1 + 0.25 * sw, -2.85 + 0.12 * Math.cos(T * 1.3));
      fils(c, [curve([F(-0.2, -3.9), F(0.2, -4.3), F(1.0 + 0.15 * sw, -3.9), lure], 8)], 200, a * 0.008, 0.5 * la, pH(0.2, 0.8), mono);
      light(55, lure, a * 0.85, la * (0.5 + 0.35 * Math.sin(T * 2.4))); if (la > 0.004) stamp(c, white(), lure[0], lure[1], a * 0.16, la * 0.9);
      for (let k = 0; k < 4; k++) { const an = T * 0.8 + k * TAU / 4; light(180, [lure[0] + Math.cos(an) * a * 0.42, lure[1] + Math.sin(an) * a * 0.3], a * 0.09, 0.6 * la); }
      const fa = hair * pr(0, 0.8), rays = [];
      if (fa > 0.004) {
        const room = a * 1.3;                           // how tall they stand over the head
        for (let k = -5; k <= 5; k++) { const b0 = F(k * 0.62, -3.3 + Math.abs(k) * 0.12); rays.push(tentacle(b0[0], b0[1], -PI / 2 + k * 0.17, room * (0.96 - Math.abs(k) * 0.077), 6, T * 0.6, k * 1.3, 0.14)); }
        fill(215, 0.1 * fa); c.beginPath(); rays.forEach((P, i) => c[i ? 'lineTo' : 'moveTo'](P[0][0], P[0][1])); for (let i = rays.length - 1; i >= 0; i--) { const e = rays[i][6]; c.lineTo(e[0], e[1] + a * 0.12 * (i % 2)); } c.fill();   // the fin's skin between them
        fils(c, rays, 200, a * 0.01, 0.6 * fa, pr(0, 0.8), mono); tips(c, rays, 170, a * 0.09, 0.7 * fa * pr(0.5, 1), mono);
      }
      const oa = outline * pr(0.2, 1);
      jaws.forEach((P, k) => { beads(c, P, 215, a * 0.085, 0.8 * oa, T, { step: 2, freq: 0.3, speed: 1.6, ph: k * 3, m: pr(0.2, 0.8) }, mono); beads(c, P.map(q => [geo.cx + (q[0] - geo.cx) * 0.9, q[1] - a * 0.12]), 190, a * 0.045, 0.6 * oa, T, { step: 3, freq: 0.5, speed: -1.4, ph: k, m: pr(0.3, 0.9) }, mono); });
      for (const o of [-1, 1]) for (let q = 0; q < 6; q++) light(180 + q * 8, F(o * (1.5 + q * 0.34), 1.3 + q * q * 0.035), a * 0.09, oa * (0.3 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(T * 1.7 - q * 0.9 + o), 2)));
    } else {
      // an anemone: a small crown on the forehead, long arms swaying where hair would fall
      const la = mark * pH(0.2, 1), mid = F(0, -2.8), crown = [];
      for (let k = 0; k < 16; k++) { const q = k / 16 * TAU; crown.push(tentacle(mid[0] + Math.cos(q) * a * 0.12, mid[1] + Math.sin(q) * a * 0.08, q, a * (0.42 + 0.2 * noise2(k, 3)) * pH(0.2, 1), 5, T, k * 1.4, 0.5)); }
      fils(c, crown, 320, a * 0.009, 0.7 * la, undefined, mono); tips(c, crown, 20, a * 0.07, 0.75 * la, mono); light(300, mid, a * 0.45, 0.45 * la);
      const ha = hair * pr(0, 0.9);
      if (ha > 0.004) strands.forEach((P0, k) => {
        const i = k % 5, m = pr(i * 0.08, 0.6 + i * 0.08), P = P0.map((q, j) => [q[0] + Math.sin(T * 0.7 - j * 0.3 + k * 1.3) * a * 0.22 * (j / P0.length), q[1]]);
        fill(i % 2 ? 320 : 285, 0.16 * ha); ribbon(c, P, u => a * 0.11 * Math.sin(PI * Math.pow(u, 0.5)) * (0.7 + 0.3 * Math.sin(u * 18 - T * 2 + i)), m);
        fils(c, [P], 300 + i * 10, a * 0.01, 0.5 * ha, m, mono);
        const n = Math.max(2, Math.ceil(P.length * m)); light(30, P[n - 1], a * 0.12, 0.8 * ha);
      });
      const oa = outline * pr(0.3, 1);
      fils(c, jaws, 285, a * 0.008, 0.45 * oa, pr(0.3, 0.9), mono); jaws.forEach((P, k) => beads(c, P, 300, a * 0.06, 0.7 * oa, T, { step: 4, freq: 0.3, speed: 1.2, ph: k * 2, m: pr(0.3, 0.9) }, mono));
    }
    if (mode !== 'angler' && mode !== 'anemone') {     // (medusa) the jaw and the cheeks: rows of photophores – dots, not lines
      const fa = outline * pr(0.3, 1), rr = rng(21);
      jaws.forEach((P, k) => beads(c, P, 190, a * 0.075, 0.8 * fa, T, { step: 2, freq: 0.3, speed: 1.6, ph: k * 3, m: pr(0.3, 0.8) }, mono));
      for (const o of [-1, 1]) for (let j = 0; j < 3; j++) for (let q = 0; q < 6; q++) light(175 + j * 25, F(o * (1.5 + q * 0.3 + j * 0.1), 1.2 + j * 0.33 + q * q * 0.018), a * (0.085 - j * 0.012), fa * (0.25 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(T * 1.7 - q * 0.9 + j * 2 + o), 2)) * (0.6 + 0.4 * rr()));
    }
    const na = nose * pr(0.3, 1);                      // the nose: two fine rows of lights down its sides, a few under it, a glow on its tip
    if (na > 0.004) {
      const hue = mode === 'angler' ? 200 : mode === 'anemone' ? 300 : 185;
      S.filter(k => k.name === 'nose side').forEach((k, i) => beads(c, k.pts, hue, a * 0.06, 0.9 * na, T, { step: 3, freq: 0.5, speed: 1.4, ph: i * 2, m: pr(0.3, 0.9) }, mono));
      beads(c, lip('nose base'), hue + 20, a * 0.04, 0.6 * na, T, { step: 4, freq: 0.5, speed: -1.2, ph: 1 }, mono);
      light(hue, lip('nose tip')[0], a * 0.5, 0.32 * na);
    }
    const ma = mouth * pr(0.4, 1);                     // the mouth: closed, a soft membrane with a faint light behind it
    if (ma > 0.004) {
      const hue = mode === 'angler' ? 200 : mode === 'anemone' ? 290 : 322, up = lip('upper lip'), lw = lip('lower lip');
      light(hue, F(0, 2.75), a * 0.9, 0.4 * ma);
      fill(hue, 0.6 * ma); trace(c, up); for (let i = lw.length - 1; i >= 0; i--) c.lineTo(lw[i][0], lw[i][1]); c.fill();
      fils(c, [lip('lips')], hue + 3, a * 0.014, ma, undefined, mono);
    }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- the large motifs of a dream window (world-classic.js describes m and o) ----------
  // --- the third eye: a medusa seen from above, the eye in its bell. In trance it opens in every window
  function medusa(c, cx, cy, R, T, tier, p) {          // her tentacles, arms and scalloped rim around a bell R wide
    const Rb = R * (1 + 0.035 * p), ten = [], arms = [], nT = [20, 32, 46][tier];
    for (let k = 0; k < nT; k++) { const an = k / nT * TAU + T * 0.03; ten.push(tentacle(cx + Math.cos(an) * Rb * 1.03, cy + Math.sin(an) * Rb * 1.03, an + 0.3, R * (0.7 + 0.5 * noise2(k, 2)) * (1 - 0.1 * p), 9, T, k * 0.9, 0.3)); }
    for (let k = 0; k < 10; k++) { const an = k / 10 * TAU - T * 0.02; arms.push(tentacle(cx + Math.cos(an) * Rb, cy + Math.sin(an) * Rb, an - 0.5, R * 0.55, 7, T * 0.8, k * 2.3, 0.5)); }
    for (const P of arms) { c.fillStyle = 'hsla(300,80%,62%,.09)'; ribbon(c, P, u => R * 0.07 * Math.sin(PI * Math.pow(u, 0.6)) * (0.6 + 0.4 * Math.sin(u * 20 - T * 2))); }
    fils(c, ten, 188, R * 0.005, 0.6); fils(c, arms, 300, R * 0.006, 0.35);
    ten.forEach((P, i) => { if (i % 2 === 0) beads(c, P, 180, R * 0.022, 0.6, T, { step: 3, freq: 0.5, speed: 2.5, ph: i * 0.4, shift: 60 }); });
    const rim = []; for (let k = 0; k <= 96; k++) { const an = k / 96 * TAU, rr = Rb * (1.03 + 0.04 * Math.abs(Math.sin(an * 8))); rim.push([cx + Math.cos(an) * rr, cy + Math.sin(an) * rr]); }
    c.fillStyle = 'hsla(198,85%,58%,.12)'; trace(c, rim); c.fill(); fils(c, [rim], 178, R * 0.007, 0.7);
    return Rb;
  }
  function canals(c, cx, cy, Rb, R, T) {               // the bell's canals and the lights on its rim
    const can = []; for (let k = 0; k < 16; k++) { const an = k / 16 * TAU; can.push([[cx + Math.cos(an) * Rb * 0.92, cy + Math.sin(an) * Rb * 0.92], [cx + Math.cos(an) * Rb * 1.05, cy + Math.sin(an) * Rb * 1.05]]); }
    fils(c, can, 190, R * 0.005, 0.5); fils(c, [ring(cx, cy, Rb * 0.92, 72)], 188, R * 0.006, 0.55);
    for (let k = 0; k < 16; k++) { const an = (k + 0.5) / 16 * TAU; stamp(c, glow(165 + k * 9), cx + Math.cos(an) * Rb * 1.07, cy + Math.sin(an) * Rb * 1.07, R * 0.05, 0.3 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(T * 2 - k * 0.8), 2)); }
    c.globalAlpha = 1;
  }
  function third(c, m, t, dt, o) {
    const [cx, cy] = o.mid, R = Math.min(o.W, o.H) * 0.27 * (1 + 0.02 * o.pulse), T = t / 1000;
    night(c, cx, cy, R * 2.1, 0.6);
    c.save(); c.globalCompositeOperation = 'lighter';
    const Rb = medusa(c, cx, cy, R, T, o.tier, Math.sin(T * 1.3));
    c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(1,6,14,.9)'; c.beginPath(); c.arc(cx, cy, Rb * 0.92, 0, TAU); c.fill();
    c.globalCompositeOperation = 'lighter'; canals(c, cx, cy, Rb, R, T);
    c.restore(); c.globalAlpha = 1;
    m.mirror = false;
    o.eye(c, m, dt, cx, cy + R * 0.04, R * 0.7, DreamEye.LOOKS.nymph);
  }
  // --- a mandala: a medusa seen from above, the dream folded in her bell
  function mandala(c, m, t, dt, o) {
    const [cx, cy] = o.mid, R = Math.min(o.W, o.H) * 0.3 * (1 + 0.03 * o.pulse), T = t / 1000, ph = (m.seed % 628) / 100;
    night(c, cx, cy, R * 2, 0.55);
    c.save(); c.globalCompositeOperation = 'lighter';
    const Rb = medusa(c, cx, cy, R, T, o.tier, Math.sin(T * 1.3));
    c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.beginPath(); c.arc(cx, cy, Rb * 0.92, 0, TAU); c.fill();
    o.softPiece(c, t, (sc, n) => kaleido(sc, o.pic, n, t, ph, o.tier ? 12 : 8), cx, cy, Rb * 0.98, 1);
    c.save(); c.beginPath(); c.arc(cx, cy, Rb * 0.92, 0, TAU); c.clip(); c.drawImage(vign(), cx - Rb * 0.92, cy - Rb * 0.92, Rb * 1.84, Rb * 1.84); c.restore();
    c.globalCompositeOperation = 'lighter'; canals(c, cx, cy, Rb, R, T);
    c.restore(); c.globalAlpha = 1;
  }
  // --- impossible shapes (DreamLife.impossible): every face a pane of the dream as in deep water, the edges filaments,
  // a light at every corner
  function shape(c, m, t, dt, o) {
    const sh = DreamLife.impossible(m.kind), [cx, cy] = o.mid, S = Math.min(o.W, o.H) * 0.485 * (1 + 0.025 * o.pulse), T = t / 1000;
    const path = f => { c.beginPath(); for (const [x, y] of f.pts) c.lineTo(x * S, y * S); c.closePath(); };
    night(c, cx, cy, S * 1.15, 0.6);
    c.save(); c.translate(cx, cy); c.rotate((m.seed & 1 ? 1 : -1) * t / 1000 * TAU / 150 + m.seed % 7);
    sh.faces.forEach((f, i) => {
      c.save(); path(f); c.clip();
      const n = S * 3.1, u = 0.5 + 0.14 * Math.sin(i * 2.1 + t / 9000), v = 0.5 + 0.14 * Math.cos(i * 1.3 + t / 11000);
      c.globalAlpha = f.fade ? 0.35 : f.glass ? 0.15 : 0.8; c.drawImage(o.pic, -u * n, -v * n, n, n);
      c.globalAlpha = Math.min(0.9, 0.3 + f.shade * 0.9) * (f.glass ? 0.3 : 1); c.fillStyle = '#01060e'; c.fillRect(-S * 1.1, -S * 1.1, S * 2.2, S * 2.2);
      c.restore();
    });
    c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
    const strong = [], faint = [], seen = new Set(), corners = [];
    for (const f of sh.faces) {
      (f.fade || f.glass || f.wall ? faint : strong).push([...f.pts, f.pts[0]].map(([x, y]) => [x * S, y * S]));
      if (!f.wall && !f.fade) for (const [x, y] of f.pts) { const key = Math.round(x * 40) + ':' + Math.round(y * 40); if (!seen.has(key)) { seen.add(key); corners.push([x * S, y * S]); } }
    }
    fils(c, strong, 188, S * 0.0035, 0.75); fils(c, faint, 215, S * 0.0025, 0.3);
    if (o.tier > 0) corners.forEach((q, i) => stamp(c, glow(170 + (i * 23) % 120), q[0], q[1], S * 0.03, 0.25 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(T * 1.8 - i * 0.7), 2)));
    if (sh.path) {                                     // a warm lure walks the stairs – always upwards, never arriving
      const n = sh.path.length, u = (t / 620) % n, k = u | 0, fr = u - k, e = fr < 0.5 ? 2 * fr * fr : 1 - (-2 * fr + 2) ** 2 / 2, [ax, ay] = sh.path[k], [bx, by] = sh.path[(k + 1) % n];
      const x = lerp(ax, bx, e) * S, y = (lerp(ay, by, e) - 0.06 - 0.07 * Math.sin(fr * PI)) * S;
      stamp(c, glow(40), x, y, S * 0.13, 0.9); stamp(c, white(), x, y, S * 0.03, 0.9);
    }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- the night behind Dreamy Eyes: the dream glows in the water (white into bk where it shows) ----------
  function backMask(bk, mode, t, w, h, al, o) {
    const m = Math.min(w, h), T = t / 1000, P = puff();
    if (mode === 'clouds') {                           // glowing water, drawn out along slow arms – most of the deep stays dark
      for (let k = 0; k < 9; k++) {
        const [vx, vy] = flow(k, k * 0.7, T * 0.5), x = (((hash(7, k) + T * 0.004 * (0.5 + hash(9, k))) % 1.2) - 0.1) * w, y = hash(8, k) * h;
        stamp(bk, P, x + vx * m * 0.08, y + vy * m * 0.08, m * (0.16 + 0.2 * hash(5, k)), al * 0.34);
      }
      for (let k = 0; k < 6; k++) {                    // … and arms of it rising from below, thinning out
        const A = tentacle(w * (0.1 + 0.8 * hash(3, k)), h * 1.05, -PI / 2 + (hash(4, k) - 0.5) * 0.8, h * (0.7 + 0.5 * hash(6, k)), 12, T * 0.4, k * 1.9, 0.3);
        A.forEach((q, i) => stamp(bk, P, q[0], q[1], m * 0.09 * (1 - i / 16), al * 0.2 * (1 - i / 13)));
      }
    } else if (mode === 'fractal') {                   // a bloom of plankton: lights of every size turning slowly around the eyes
      for (let k = 1; k < 90; k++) {
        const u = Math.sqrt(k / 90), ang = k * 2.39996 + T * 0.035 + Math.sin(T * 0.2 + k) * 0.08, rr = Math.hypot(w, h) * 0.58 * u;
        stamp(bk, P, w / 2 + Math.cos(ang) * rr, h / 2 + Math.sin(ang) * rr * 0.85, m * (0.02 + 0.09 * hash(11, k)) * (0.8 + 0.2 * Math.sin(T * 0.9 + k)), al * (0.35 + 0.5 * Math.pow(0.5 + 0.5 * Math.sin(T * 0.7 - k * 0.6), 2)));
      }
    } else {                                           // great medusae passing behind: bells, and tentacles trailing
      bk.strokeStyle = '#fff'; bk.lineCap = 'round'; bk.lineJoin = 'round';
      for (let k = 0; k < 4; k++) {
        const x = w * (0.14 + 0.24 * k + 0.05 * Math.sin(T * 0.11 + k * 2)), y = h * (((0.2 + 0.31 * k - T * 0.012) % 1.5 + 1.5) % 1.5 - 0.2), R = m * (0.15 + 0.07 * hash(13, k)), p = Math.sin(T * 1.1 + k * 2);
        stamp(bk, P, x, y, R * (1.25 - 0.1 * p), al * 0.55);
        const ten = [];
        for (let j = 0; j < 6; j++) ten.push(tentacle(x + (j / 2.5 - 1) * R * 0.8, y + R * 0.25, PI / 2 + (j / 2.5 - 1) * 0.2, R * (2 + hash(15, k * 9 + j)), 7, T, j + k * 3, 0.3));
        for (const [lw, a2] of [[0.03, 0.12], [0.012, 0.3]]) { bk.globalAlpha = al * a2; bk.lineWidth = m * lw; bk.beginPath(); for (const A of ten) { bk.moveTo(A[0][0], A[0][1]); for (let i = 1; i < A.length; i++) bk.lineTo(A[i][0], A[i][1]); } bk.stroke(); }
      }
    }
  }

  // ---------- the sky of a dream window: the dream glows in the water along slow arms ----------
  function skyClouds(cg, t, o) {
    const { w, h } = o, T = t / 1000 + o.drift * 40, m = Math.min(w, h), cx = w / 2, cy = h / 2, R = m * 0.3, P = puff();
    for (let k = 0; k < 20; k++) {
      const an = k * 2.4 + T * 0.02 + o.index, rad = R * (0.6 + 1.1 * noise2(k, 5)) * (1 + 0.12 * o.swell), [vx, vy] = flow(k, k * 0.7, T * 0.6);
      stamp(cg, P, cx + Math.cos(an) * rad * w / m + vx * R * 0.15, cy + Math.sin(an) * rad * h / m + vy * R * 0.15, R * (0.55 + 0.5 * noise2(k, 8)), 0.34 + 0.2 * o.swell);
    }
    cg.globalAlpha = 0.1; cg.strokeStyle = '#fff'; cg.lineCap = 'round'; cg.lineJoin = 'round'; cg.lineWidth = R * 0.3;
    if (o.tier > 0) for (let k = 0; k < 9; k++) { const an = k / 9 * TAU + T * 0.03; trace(cg, tentacle(cx + Math.cos(an) * R, cy + Math.sin(an) * R, an + 0.5, R * 1.7, 8, T * 0.5, k * 1.9, 0.35)); cg.stroke(); }
    cg.globalAlpha = 1; cg.globalCompositeOperation = 'source-in';
    o.dream(cg, 0, 0, w, h, 1.2 + 0.1 * Math.sin(T / 19 + o.index), 0.5 + 0.2 * Math.sin(T / 26 + o.index * 1.7), 0.5 + 0.2 * Math.cos(T / 33 + o.index * 2.3));
  }

  // ---------- what fills the night: marine snow, drifting through everything ----------
  function air(g, t, o) {
    const T = t / 1000, n = [50, 95, 150][o.tier], m = Math.min(o.W, o.H);
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const z = 0.3 + 0.7 * hash(41, i), x0 = hash(42, i), y0 = hash(43, i), [vx, vy] = flow(x0 * 6, y0 * 4, T * 0.3);
      const x = (((x0 + T * 0.002 * z + vx * 0.012) % 1) + 1) % 1, y = (((y0 - T * 0.008 * z + vy * 0.012) % 1) + 1) % 1;
      stamp(g, glow(170 + 60 * hash(44, i)), x * o.W, y * o.H, m * 0.006 * z + 1, 0.14 + 0.3 * z * (0.5 + 0.5 * Math.sin(T * 1.3 + x0 * 40)));
    }
    g.restore();
  }

  // ---------- fire: a vent glowing in the deep – warm plumes rising from below, lights carried up in them ----------
  function flames(g, t, k, side, o) {
    const { W, H } = o, T = t / 1000, n = (W > H ? 9 : 6) * (o.perf > 30 ? 1 : 0.7) | 0, list = [];
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) stamp(g, glow(18), W * (side + (i - 2) * 0.22), H * 1.04, Math.max(W, H) * 0.3 * (0.6 + 0.4 * k), 0.3 * k);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n + 0.03 * Math.sin(i * 7.1), near = (u - side) / 0.3, hh = H * 0.5 * k * (0.5 + 0.5 * hash(51, i)) * (0.7 + 0.6 * Math.exp(-near * near)) * (0.85 + 0.15 * Math.sin(T * 3 + i * 2));
      const P = tentacle(u * W, H + 6, -PI / 2 + (hash(52, i) - 0.5) * 0.3, hh, 10, T * 2.2, i * 1.7, 0.22); list.push(P);
      beads(g, P, 14, Math.min(W, H) * 0.02, 0.8 * Math.min(1, k), T, { step: 1, freq: 0.9, speed: 6, ph: i, shift: 34 });
    }
    fils(g, list, 20, Math.min(W, H) * 0.006, 0.8 * Math.min(1, k)); tips(g, list, 45, Math.min(W, H) * 0.03, 0.6 * Math.min(1, k));
    g.restore();
  }

  // ---------- the trance (world-classic.js describes p and o) ----------
  function tranceBack(g, t, p, o) {                    // the water darkens; rings of lights fly towards the eye; crowns open around it; everything is drawn in
    const { W, H } = o, T = t / 1000, R = Math.hypot(W, H) * 0.55, few = o.perf <= 45;
    g.fillStyle = `rgba(1,5,12,${0.6 * p.dim})`; g.fillRect(0, 0, W, H);
    g.save(); g.globalCompositeOperation = 'lighter';
    if (p.tun > 0.01) for (let j = 0; j < 7; j++) {
      const s = (T / 1.5 + j / 7) % 1, r = R * (1 - s) ** 1.6 + p.A * 0.6, n = few ? 10 : 16;
      for (let k = 0; k < n; k++) { const an = k / n * TAU + T / 4 + j; stamp(g, glow(180 + j * 22), p.ex + Math.cos(an) * r, p.ey + Math.sin(an) * r * 0.92, p.A * (0.05 + 0.12 * (1 - s)), 0.6 * p.tun * Math.sin(s * PI)); }
    }
    if (p.mand > 0.01) for (let i = 0; i < (few ? 2 : 3); i++) {
      const r = p.A * (1.25 + i * 0.8) * (1 + 0.05 * Math.sin(T * 1.1)) * (0.6 + 0.4 * p.mand), n = 14 + i * 8, list = [];
      for (let k = 0; k < n; k++) { const an = k / n * TAU + T / (5 + i * 1.3) * (i % 2 ? -1 : 1); list.push(tentacle(p.ex + Math.cos(an) * r, p.ey + Math.sin(an) * r, an, p.A * (0.5 + 0.12 * i), 5, T, k * 1.3 + i, 0.4)); }
      fils(g, list, [188, 285, 320][i], p.A * 0.012, 0.6 * p.mand); tips(g, list, [160, 300, 30][i], p.A * 0.07, 0.6 * p.mand);
    }
    if (p.pull > 0.01) for (let k = 0; k < 44; k++) {
      const s = (T / 1.3 + k / 44 * 3.7) % 1, r = R * (1 - s), an = k * 2.399 + s * 5 + T / 1.5;
      for (let q = 0; q < 3; q++) stamp(g, glow(175 + k * 5), p.ex + Math.cos(an - q * 0.07) * r * (1 + q * 0.05), p.ey + Math.sin(an - q * 0.07) * r * (1 + q * 0.05), p.A * 0.07 * (1 - q * 0.25) * (0.5 + s), 0.7 * p.pull * s * (1 - q * 0.3));
    }
    g.restore();
  }
  function tranceEye(g, t, p, o) {                     // the third eye: a chamber standing upright, lit from its rim, cilia all around
    const { ex, ey, A } = p, B = A * 0.5 * p.eo, { W, H } = o, T = t / 1000;
    g.save();
    if (p.dot > 0.01) { g.globalCompositeOperation = 'lighter'; stamp(g, glow(40), ex, ey, A * 0.5, p.dot); stamp(g, white(), ex, ey, A * 0.1, p.dot); g.globalAlpha = 1; }
    if (p.eo > 0.01) {
      const side = s => curve([[ex, ey - A], [ex + s * B * 1.02, ey - A * 0.45], [ex + s * B * 1.02, ey + A * 0.45], [ex, ey + A]], 10), l = side(-1), r = side(1);
      const almond = () => { g.beginPath(); g.moveTo(ex, ey - A); g.quadraticCurveTo(ex + B * 2, ey, ex, ey + A); g.quadraticCurveTo(ex - B * 2, ey, ex, ey - A); };
      g.globalCompositeOperation = 'lighter'; stamp(g, glow(195), ex, ey, A * 1.5, 0.25 * p.eo); g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over'; g.save(); almond(); g.clip();
      g.fillStyle = 'rgba(1,8,18,.95)'; g.fillRect(ex - A, ey - A, A * 2, A * 2);
      const ir = A * 0.4;
      g.save(); g.beginPath(); g.arc(ex, ey, ir, 0, TAU); g.clip();
      g.translate(ex, ey); g.rotate(T / 6); g.translate(-ex, -ey);
      if (o.dream) DreamBrush.cover(g, o.dream, ex - ir, ey - ir, ir * 2, ir * 2); else { g.fillStyle = 'hsl(190,70%,35%)'; g.fill(); }
      g.restore();
      g.save(); g.beginPath(); g.arc(ex, ey, ir, 0, TAU); g.clip(); g.drawImage(vign(), ex - ir, ey - ir, ir * 2, ir * 2); g.restore();
      const pr = ir * (0.38 + 0.5 * p.pull) * 1.18; g.drawImage(pupil(), ex - pr, ey - pr, pr * 2, pr * 2);
      g.globalCompositeOperation = 'lighter'; stamp(g, white(), ex - ir * 0.3, ey - ir * 0.34, ir * 0.3, 0.8); g.globalAlpha = 1;
      g.restore();
      g.globalCompositeOperation = 'lighter';
      fils(g, [l, r], 188, A * 0.014, 0.8 * p.eo); beads(g, l, 170, A * 0.04, 0.7 * p.eo, T, { step: 2, shift: 150, speed: 3 }); beads(g, r, 170, A * 0.04, 0.7 * p.eo, T, { step: 2, shift: 150, speed: 3, ph: 2 });
      const cil = [];
      for (const [P, s] of [[l, -1], [r, 1]]) for (let i = 3; i < P.length - 3; i += 3) cil.push(tentacle(P[i][0], P[i][1], s > 0 ? 0 : PI, A * 0.22 * p.eo * (0.7 + 0.5 * noise2(i, 3 + s)), 5, T, i + s, 0.35));
      fils(g, cil, 195, A * 0.007, 0.6 * p.eo); tips(g, cil, 180, A * 0.035, 0.6 * p.eo);
    }
    if (p.view > 0.01 && o.dream) {                    // through the wide pupil: the dream, large and clear, dark towards its rim
      const R = Math.min(W, H) * 0.46 * p.view;
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, p.view * 1.2);
      g.save(); g.beginPath(); g.arc(ex, ey, R * 0.96, 0, TAU); g.clip(); DreamBrush.cover(g, o.dream, ex - R, ey - R, R * 2, R * 2); g.drawImage(vign(), ex - R, ey - R, R * 2, R * 2); g.restore();
      g.globalCompositeOperation = 'lighter'; fils(g, [ring(ex, ey, R * 0.96, 64)], 185, R * 0.008, 0.7 * p.view);
      beads(g, ring(ex, ey, R * 1.02, 40), 170, R * 0.03, 0.7 * p.view, T, { step: 1, shift: 200, speed: 2 });
    }
    g.restore();
  }

  // ---------- "you in the dream", and a painted face coming through the pupils: what is drawn around the picture ----------
  const you = {
    FRAMES: ['anemone', 'plankton', 'veil'],
    behind: {
      anemone(c, n, t, hue, al) {                      // an anemone's arms opening behind the head, a light at every tip
        const T = t / 1000, list = [];
        for (let k = 0; k < 26; k++) { const an = k / 26 * TAU + T * 0.03; list.push(tentacle(n / 2 + Math.cos(an) * n * 0.2, n / 2 + Math.sin(an) * n * 0.2, an, n * (0.2 + 0.07 * noise2(k, 7)), 7, T, k * 1.3, 0.35)); }
        c.save(); c.globalCompositeOperation = 'lighter'; fils(c, list, 300, n * 0.005, 0.8 * al); tips(c, list, 30, n * 0.022, 0.8 * al); c.restore();
      },
    },
    front: {
      plankton(c, n, t, hue, al) {                     // a wreath of plankton turning around them
        const T = t / 1000;
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 40; k++) { const an = k / 40 * TAU + T * 0.05 + hash(61, k) * 0.2, rr = n * (0.33 + 0.05 * hash(62, k) + 0.01 * Math.sin(T * 0.9 + k)); stamp(c, glow(170 + 150 * hash(63, k)), n / 2 + Math.cos(an) * rr, n / 2 + Math.sin(an) * rr, n * (0.012 + 0.022 * hash(64, k)), al * (0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(T * 2 - k * 0.5), 2))); }
        c.restore(); c.globalAlpha = 1;
      },
      veil(c, n, t, hue, al) {                         // veils of glowing water around them, thicker below
        const T = t / 1000;
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 16; k++) { const an = k / 16 * TAU + Math.sin(T / 6 + k) * 0.25 + T / 40, low = 0.5 + 0.5 * Math.sin(an), rr = n * (0.33 + 0.03 * Math.sin(T / 2.7 + k * 2.1)); stamp(c, glow(185 + (k % 4) * 30), n / 2 + Math.cos(an) * rr * 1.05, n / 2 + Math.sin(an) * rr, n * (0.1 + 0.07 * low), (0.2 + 0.3 * low) * al); }
        c.restore(); c.globalAlpha = 1;
      },
    },
    tints: (hue, t) => ({ glow: 'hsl(195,90%,60%)', halo: 'hsl(175,95%,78%)', rim: `hsl(${200 + 60 * Math.sin(t / 2300)},95%,75%)` }),
    spark(c, x, y, r, hue, tw, al, k) { stamp(c, glow(SEA[k % SEA.length]), x, y, r * 2.2, 0.75 * tw * al); stamp(c, white(), x, y, r * 0.8, 0.95 * tw * al); },
    cloud(c, cx, cy, size, t, al) {                    // the water a picture comes in: soft bodies drifting, arms reaching out of them
      const T = t / 1000, P = puff();
      c.globalCompositeOperation = 'lighter';
      stamp(c, P, cx, cy, size * (0.46 + 0.02 * Math.sin(T / 1.3)), al); stamp(c, P, cx, cy, size * 0.36, al);
      for (let k = 0; k < 12; k++) {
        const an = k / 12 * TAU + 0.25 * Math.sin(T / 3.7 + k) + T / 21 * (k % 2 ? 1 : -1), rr = size * (0.27 + 0.06 * Math.sin(T / 1.9 + k * 1.9));
        stamp(c, P, cx + Math.cos(an) * rr * 1.05, cy + Math.sin(an) * rr * 1.2, size * (0.2 + 0.05 * Math.sin(T / 1.5 + k * 2.3)), al * 0.9);
      }
      c.globalAlpha = al * 0.35; c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = size * 0.035;
      for (let k = 0; k < 14; k++) { const an = k / 14 * TAU + T * 0.03; trace(c, tentacle(cx + Math.cos(an) * size * 0.4, cy + Math.sin(an) * size * 0.44, an + 0.3, size * 0.2, 6, T, k * 1.7, 0.4)); c.stroke(); }
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    },
    rings(g, pupils, r, t, hue, p, mist) {             // a ring of lights at the edge of each window the picture comes through
      const T = t / 1000;
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const [px, py] of pupils) beads(g, ring(px, py, r, 28), 170, (3 + 7 * (1 - p)) * (1 - 0.5 * mist), 0.8 * (1 - p) * (1 - 0.6 * mist), T, { step: 1, shift: 180, speed: 3 });
      g.restore();
    },
  };

  DreamStyle.register('deepsea', {
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
