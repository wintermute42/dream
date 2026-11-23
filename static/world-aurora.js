/* Dream – the style world "aurora" (#226): curtains of northern light over a field of stars. The calmest world: slow,
   luminous, cold greens and violets with a warm lower edge. Its one material is the ray: a curtain is a line with rays
   standing on it – one small ray of light (a few colours, drawn once) stamped side by side, each ray's height and
   brightness from slow noise travelling along the line. Around a point the rays stream outwards: a corona, as when the
   light stands overhead. With them: halos (a thin ring of light with its two mock moons), light pillars, ice dust that
   glitters, and the stars – points of light, drawn once.

   The eye is a piece of night sky: light stands on its lower lid, the lashes are rays rising from the upper one, a thin
   corona rings the iris, a warm line lies under the lower lid. What today's look shows as signs has its own form here:
   a small warm sun dog instead of a heart, ice dust glittering instead of stars, slow snow under dimming pillars instead
   of letters, an auroral corona instead of the triangle. Of a face there is what the face rule lets through
   (static/dreamvis.js) – the nose, in the rare moment, as a slim pillar of light with a star on its tip.

   Everything is stamped lights and rays (drawn once, static/dreambrush.js), additive – no blur, no shadow, no filter:
   old phones. On a weak device the rays stand wider apart. Registers itself with the style layer (static/dreamstyle.js). */
(function (root) {
  'use strict';
  const { DreamBrush, DreamVis, DreamLife, DreamEye, DreamStyle } = root;
  const { TAU, clamp, lerp, smooth, rng, hash, curve, trace, sprite, softLight, stamp, lids, faceFrame, skeleton, canvas, kaleido, night } = DreamBrush;
  const PI = Math.PI, ease = x => 1 - Math.pow(1 - clamp(x), 3), seg = (x, a, b) => clamp((x - a) / (b - a));

  // ---------- the materials ----------
  // one ray of light, 16×128: its colours from the foot (a warm edge) to the tip, soft towards both sides
  const RAYS = [
    [[0, 'rgba(255,110,150,0)'], [0.03, 'rgba(255,125,150,.85)'], [0.1, 'rgba(150,255,175,1)'], [0.35, 'rgba(60,230,170,.7)'], [0.65, 'rgba(90,120,255,.35)'], [0.85, 'rgba(170,90,255,.15)'], [1, 'rgba(170,90,255,0)']],   // 0 green, a violet tip
    [[0, 'rgba(255,170,90,0)'], [0.03, 'rgba(255,175,95,.8)'], [0.1, 'rgba(255,120,190,.95)'], [0.4, 'rgba(180,100,255,.6)'], [0.75, 'rgba(90,110,255,.25)'], [1, 'rgba(90,110,255,0)']],   // 1 rose and violet
    [[0, 'rgba(200,255,220,0)'], [0.04, 'rgba(210,255,225,.8)'], [0.2, 'rgba(70,225,215,.75)'], [0.6, 'rgba(60,140,255,.3)'], [1, 'rgba(120,90,255,0)']],   // 2 ice
    [[0, 'rgba(255,255,255,0)'], [0.04, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.75)'], [0.7, 'rgba(255,255,255,.3)'], [1, 'rgba(255,255,255,0)']],   // 3 without a colour: where the dream shines through
    [[0, 'rgba(255,205,130,0)'], [0.03, 'rgba(255,210,135,.9)'], [0.12, 'rgba(255,96,64,1)'], [0.4, 'rgba(232,44,78,.62)'], [0.75, 'rgba(150,44,165,.24)'], [1, 'rgba(120,50,200,0)']],   // 4 the red aurora: fire
  ];
  const ray = k => sprite('aur-ray' + k, () => {
    const c = canvas(16, 128), x = c.getContext('2d'), up = x.createLinearGradient(0, 128, 0, 0), across = x.createLinearGradient(0, 0, 16, 0);
    for (const [at, col] of RAYS[k]) up.addColorStop(at, col);
    x.fillStyle = up; x.fillRect(0, 0, 16, 128); x.globalCompositeOperation = 'destination-in';
    across.addColorStop(0, 'rgba(0,0,0,0)'); across.addColorStop(0.5, 'rgba(0,0,0,1)'); across.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = across; x.fillRect(0, 0, 16, 128);
    return c;
  });
  const soft = (key, stops, size = 64) => () => sprite('aur-' + key, () => softLight(stops, size));
  const white = soft('white', [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(225,245,255,.5)'], [1, 'rgba(200,235,255,0)']]);
  const pale = soft('pale', [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]);
  const green = soft('green', [[0, 'rgba(120,255,190,1)'], [0.3, 'rgba(60,220,170,.4)'], [1, 'rgba(40,160,200,0)']]);
  const violet = soft('violet', [[0, 'rgba(200,150,255,1)'], [0.3, 'rgba(150,100,255,.4)'], [1, 'rgba(90,90,255,0)']]);
  const ice = soft('ice', [[0, 'rgba(200,245,255,1)'], [0.3, 'rgba(90,200,235,.4)'], [1, 'rgba(60,130,255,0)']]);
  const warm = soft('warm', [[0, 'rgba(255,235,190,1)'], [0.25, 'rgba(255,150,110,.5)'], [1, 'rgba(255,80,120,0)']]);
  const puff = soft('puff', [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']], 128);
  const halo = soft('halo', [[0.72, 'rgba(200,255,230,0)'], [0.86, 'rgba(200,255,230,.9)'], [1, 'rgba(160,220,255,0)']], 256);   // a thin ring of light, at 0.86 of its radius
  const haloWarm = soft('halo-warm', [[0.7, 'rgba(255,170,120,0)'], [0.84, 'rgba(255,205,150,.9)'], [1, 'rgba(255,120,150,0)']], 128);
  const haloPale = soft('halo-pale', [[0.7, 'rgba(255,255,255,0)'], [0.86, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']], 256);
  const vign = soft('vign', [[0, 'rgba(2,6,16,0)'], [0.62, 'rgba(2,6,16,0)'], [1, 'rgba(2,6,16,.92)']], 256);   // an iris, a disc: dark towards its rim
  const pupil = soft('pupil', [[0, 'rgba(1,3,8,1)'], [0.78, 'rgba(1,3,8,1)'], [1, 'rgba(1,3,8,0)']], 128);
  const RING = 0.86;                                   // where in a halo's sprite the ring is
  const LIGHTS = [green, violet, ice];
  // the field of stars, drawn once: points of light, the brighter ones remembered – they twinkle
  const stars = () => sprite('aur-stars', () => {
    const N = 1024, c = canvas(N), x = c.getContext('2d'), r = rng(12); c.tw = [];
    for (let i = 0; i < 760; i++) {
      const px = r() * N, py = r() * N, m = r() * r();
      x.fillStyle = `hsla(${190 + r() * 60},60%,${75 + 20 * r()}%,${0.25 + 0.75 * m})`; x.beginPath(); x.arc(px, py, 0.5 + m * 1.4, 0, TAU); x.fill();
      if (m > 0.5 && c.tw.length < 36) c.tw.push([px / N, py / N, r() * 9]);
    }
    return c;
  });
  // slow noise along a line, 0–1 (a table, made once: thousands of rays ask every frame); per: it closes after so many steps
  const NT = Float32Array.from({ length: 256 }, rng(226));
  const n1 = (x, s, per) => {
    const i = Math.floor(x), f = x - i, a = per ? ((i % per) + per) % per : i, b = per ? (a + 1) % per : i + 1;
    return lerp(NT[(a + s * 31) & 255], NT[(b + s * 31) & 255], f * f * (3 - 2 * f));
  };
  let coarse = 1;                                      // how far apart the rays stand: wider on a weak device (the air tells: it is drawn every frame)
  const COARSE = [1.9, 1.35, 1];
  // A curtain: rays standing on the line P. h: their height (a number, or h(u) along the line); T (s): the light moves;
  // seed: a whole number, which curtain; k: which ray; step: how far apart the rays stand; dir(x, y): which way they
  // point (an angle, 0 = up) – without it, up; upTo: drawn in so far (0–1)
  function curtain(c, P, h, T, seed, al, k, step, dir, upTo = 1) {
    if (al <= 0.004 || P.length < 2) return;
    const spr = ray(k), n = P.length, st = Math.max(1.2, step * coarse), w = st * 2.8, dn = st / step, last = upTo >= 1 ? n - 1 : Math.min(n - 1, Math.ceil((n - 1) * clamp(upTo))), fh = typeof h === 'function';
    let no = 0;
    for (let i = 0; i < last; i++) {
      const p = P[i], q = P[i + 1], m = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / st));
      for (let j = 0; j < m; j++, no += dn) {
        const a2 = al * Math.min(1, Math.pow(n1(no * 0.07 - T * 0.33, seed), 1.7) * 2.6) * (0.78 + 0.22 * Math.sin(no * 1.9 + T * 1.4 + seed));
        if (a2 < 0.01) continue;
        const f = j / m, x = lerp(p[0], q[0], f), y = lerp(p[1], q[1], f);
        const hh = (fh ? h((i + f) / (n - 1)) : h) * (0.45 + 0.95 * (0.6 * n1(no * 0.12 - T * 0.11, seed + 5) + 0.4 * n1(no * 0.31 + T * 0.07, seed + 11)));
        c.globalAlpha = a2;
        if (dir) { const an = dir(x, y); c.translate(x, y); c.rotate(an); c.drawImage(spr, -w / 2, -hh, w, hh); c.rotate(-an); c.translate(-x, -y); }
        else c.drawImage(spr, x - w / 2, y - hh, w, hh);
      }
    }
    c.globalAlpha = 1;
  }
  // A corona: n rays streaming out of a circle r0 around (cx, cy), len long, turned by rot – the light standing overhead
  function corona(c, cx, cy, r0, len, n, T, seed, al, k, rot = 0) {
    if (al <= 0.004) return;
    n = Math.max(12, Math.round(n / coarse));
    const spr = ray(k), w = TAU * (r0 + len * 0.22) / n * 2.6, d = TAU / n, per = Math.max(6, Math.round(n * 0.14)), per2 = Math.max(6, Math.round(n * 0.3));
    c.save(); c.translate(cx, cy); c.rotate(rot);
    for (let i = 0; i < n; i++, c.rotate(d)) {
      const u = i / n, a2 = al * Math.min(1, Math.pow(n1(u * per - T * 0.2, seed, per), 1.6) * 2.6) * (0.78 + 0.22 * Math.sin(i * 1.9 + T * 1.4 + seed));
      if (a2 < 0.01) continue;
      c.globalAlpha = a2; const hh = len * (0.4 + 1.0 * n1(u * per2 + T * 0.09, seed + 7, per2));
      c.drawImage(spr, -w / 2, -r0 - hh, w, hh);
    }
    c.restore(); c.globalAlpha = 1;
  }
  // lines of light: every line of `list` in three passes – a wide faint one, a middle one, a fine bright core
  function glowLine(c, list, hue, w, al, mono) {
    if (al <= 0.004 || !list.length) return;
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [k, a, l] of [[7, 0.07, 55], [3, 0.18, 65], [1, 0.8, 88]]) {
      c.strokeStyle = mono ? `rgba(255,255,255,${Math.min(1, a * al * 1.4)})` : `hsla(${hue},85%,${l}%,${a * al})`; c.lineWidth = Math.max(0.6, w * k); c.beginPath();
      for (const P of list) { c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]); }
      c.stroke();
    }
  }
  const oval = (c, img, x, y, rw, rh, al) => { c.globalAlpha = al; c.drawImage(img, x - rw, y - rh, rw * 2, rh * 2); };
  const pillar = (c, k, x, y, w, hh, al) => { if (al > 0.004 && hh > 0.5) { c.globalAlpha = al; c.drawImage(ray(k), x - w / 2, y - hh, w, hh); } };   // one light pillar standing on (x, y)
  // a halo: a thin ring of light r around (x, y), its two mock moons on it, a light in the middle
  function ringOfLight(c, x, y, r, al, mono, moons = 1) {
    if (al <= 0.004) return;
    stamp(c, mono ? haloPale() : halo(), x, y, r / RING, 0.55 * al);
    for (const o of [-1, 1]) { oval(c, mono ? pale() : warm(), x + o * r * 1.02, y, r * 0.2, r * 0.11, 0.8 * al * moons); oval(c, mono ? pale() : violet(), x + o * r * 1.2, y, r * 0.3, r * 0.05, 0.4 * al * moons); }
    c.globalAlpha = 1;
  }
  // ice dust: n small glints around (x, y), each flashing on its own
  function dust(c, x, y, rx, ry, n, T, r, al, size, mono) {
    for (let k = 0; k < n; k++) {
      const px = x + (r() - 0.5) * 2 * rx + Math.sin(T * 0.3 + k) * size, py = y + (r() - 0.5) * 2 * ry, tw = Math.pow(0.5 + 0.5 * Math.sin(T * 2.6 + k * 2.1 + r() * 6), 3);
      stamp(c, mono ? pale() : white(), px, py, size * (0.7 + 0.9 * tw), al * (0.15 + 0.85 * tw));
    }
    c.globalAlpha = 1;
  }
  // a small warm sun dog – where today's look has a heart: a warm light, a fine ring around it, two mock suns
  function sunDog(c, x, y, r, al, beat) {
    stamp(c, warm(), x, y, r * (1.1 + 0.25 * beat), 0.8 * al); stamp(c, white(), x, y, r * 0.3 * (1 + 0.3 * beat), 0.9 * al);
    stamp(c, haloWarm(), x, y, r * 0.95 / 0.84, 0.7 * al);
    for (const o of [-1, 1]) { oval(c, warm(), x + o * r * 0.95, y, r * 0.3, r * 0.16, 0.9 * al); oval(c, warm(), x + o * r * 1.25, y, r * 0.4, r * 0.06, 0.5 * al); }
    c.globalAlpha = 1;
  }
  // which ray a hue of the dream becomes: warm → rose and violet, green → green, blue → ice
  const tone = hue => { const h = ((hue % 360) + 360) % 360; return h < 70 || h >= 290 ? 1 : h < 175 ? 0 : 2; };
  const circle = (x, y, r, n = 48, a0 = 0, a1 = TAU) => Array.from({ length: n + 1 }, (_, k) => { const an = a0 + (a1 - a0) * k / n; return [x + Math.cos(an) * r, y + Math.sin(an) * r]; });
  const outward = (cx, cy) => (x, y) => Math.atan2(y - cy, x - cx) + PI / 2;
  // a piece of the field of stars into the box (x, y, w, h), as large as it is there
  function skyPiece(c, x, y, w, h, al, k = 0) {
    const S = stars(), sw = Math.min(900, Math.max(60, w)), sh = Math.min(900, sw * h / w);
    c.globalAlpha = al; c.drawImage(S, 60 + k * 53, 40 + k * 31, sw, sh, x, y, w, h); c.globalAlpha = 1;
  }

  // ---------- the eye: a piece of night sky ----------
  function eye(g, cx, cy, a, b, mirror, p) {
    const up = Math.max(0.02, p.open * (1 - p.blink) * (1 - 0.25 * p.squint)), lo = (0.82 + 0.1 * p.open) * (1 - 0.35 * p.squint);
    const L = lids(cx, cy, a, b, mirror, up, lo), o = L.o, T = performance.now() / 1000, idx = mirror ? 1 : 0, hint = p.crease || 0, look = p.look;
    const R = Math.min(a * 0.5, b * 1.02), ix = cx + p.gx * a * 0.34 * (mirror ? 0.96 : 1), iy = cy + p.gy * b * 0.32;
    const U = [], Lo = [], Cc = [];
    for (let k = 0; k <= 26; k++) { const u = k / 26, q = L.upper(u); U.push(q); Lo.push(L.lower(u)); Cc.push([q[0], q[1] - b * (0.3 + 0.3 * Math.sin(PI * u)) * (0.4 + 0.6 * up)]); }
    g.save();
    g.globalCompositeOperation = 'lighter'; stamp(g, green(), cx, cy + b * 0.3, a * 1.6, 0.12 + 0.08 * p.energy); g.globalAlpha = 1;
    if (p.browAl > 0.01) {                             // the brow, when it comes: a small arc of rays – it moves with what they feel
      const E = p.brow, tall = a * 0.34 * look.brow;
      let by0 = cy - b * 1.5 + b * E.inner, by2 = cy - b * 1.6 + b * E.outer, bpy = cy - b * (1.85 + 0.35 * look.arch) + b * E.peak;
      const room = Math.min(by0, by2, bpy) - tall * 0.8;
      if (room < 0) { by0 -= room; by2 -= room; bpy -= room; }
      const B = curve([[cx - o * a * 0.8, by0], [cx + o * a * 0.38, bpy], [cx + o * a * 1.02, by2]], 8);
      curtain(g, B, u => tall * (0.55 + 0.6 * Math.sin(PI * u)), T, 60 + idx, 0.9 * p.browAl, 1, a * 0.036);
      glowLine(g, [B], 325, a * 0.004, 0.45 * p.browAl);
    }
    // lashes: rays rising from the lid, taller towards the outer corner
    curtain(g, U, u => a * (0.16 + 0.55 * Math.pow(u, 1.3)) * (0.35 + 0.65 * up) * (0.6 + 0.4 * look.lashes), T, 3 + idx * 7, 0.85, 0, a * 0.03);
    curtain(g, Cc, a * 0.3, T, 9 + idx, 0.5 * hint, 1, a * 0.04);   // the lid's crease, with the hints: a faint second arc
    g.globalCompositeOperation = 'source-over'; g.save(); L.path(g); g.clip();
    g.fillStyle = 'rgba(2,5,14,.96)'; g.fillRect(cx - a, cy - b * 1.6, 2 * a, 3.2 * b);
    skyPiece(g, cx - a, cy - b * 1.6, 2 * a, 3.2 * b, 0.6, idx);
    g.globalCompositeOperation = 'lighter';
    curtain(g, Lo, b * 1.5, T, 5 + idx * 3, 0.5 + 0.2 * p.energy, 2, a * 0.035);   // light standing on the lower lid, inside
    stamp(g, halo(), ix, iy, R * 1.28, 0.55); g.globalAlpha = 1;                   // a thin corona around the iris
    g.globalCompositeOperation = 'source-over';
    g.save(); g.beginPath(); g.arc(ix, iy, R, 0, TAU); g.clip();
    g.fillStyle = '#02050e'; g.fillRect(ix - R, iy - R, R * 2, R * 2);
    p.iris(ix, iy, R);                                 // the dream, a world of its own, and whoever is mirrored in it
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.drawImage(vign(), ix - R, iy - R, R * 2, R * 2);
    const pr = R * p.pupil;
    if (p.pupilMix < 0.99) { g.globalAlpha = 1 - p.pupilMix; g.drawImage(pupil(), ix - pr * 1.18, iy - pr * 1.18, pr * 2.36, pr * 2.36); }
    if (p.pupilMix > 0.01) { g.globalAlpha = p.pupilMix; p.pupilShape(ix, iy, pr, R); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (p.reflect) p.reflect(ix, iy, R);
    g.globalCompositeOperation = 'lighter'; stamp(g, white(), ix - R * 0.36, iy - R * 0.38, R * 0.26, 0.85); stamp(g, white(), ix + R * 0.3, iy + R * 0.27, R * 0.08, 0.5); g.globalAlpha = 1;
    g.restore(); g.restore();
    g.globalCompositeOperation = 'lighter';
    glowLine(g, [U], 150, a * 0.012, 0.9); glowLine(g, [Lo], 175, a * 0.006, 0.45);
    glowLine(g, [Lo.slice(7).map(q => [q[0], q[1] + a * 0.028])], 335, a * 0.005, 0.3 * Math.min(1.4, look.lower));   // the warm edge below
    g.restore(); g.globalAlpha = 1;
    return [ix, iy];
  }
  // what is in an iris: the dream as every world shows it (static/dreameye.js) – but a fire is the red aurora: the
  // dream dim and warm behind it, red rays rising from the iris' lower rim
  function irisWorld(g, style, ix, iy, R, mirror, al, o) {
    if (style !== 'fire' && style !== 'embers') { DreamEye.irisWorld(g, style, ix, iy, R, mirror, al, o); return; }
    const T = performance.now() / 1000, heat = o.heat === undefined ? 1 : o.heat, fire = style === 'fire', n = fire ? 18 : 11, w = R * (fire ? 0.3 : 0.24);
    g.save(); g.translate(ix, iy);
    g.globalAlpha = al; g.fillStyle = '#0c0410'; g.fillRect(-R, -R, R * 2, R * 2);
    o.pic(0, 0, R * 2.3, al * 0.3);
    g.globalAlpha = al * 0.4; g.fillStyle = '#4a0c16'; g.fillRect(-R, -R, R * 2, R * 2);
    g.globalCompositeOperation = 'lighter';
    stamp(g, warm(), 0, R * 1.05, R * (0.6 + 0.5 * heat), al * (fire ? 0.7 : 0.45));
    for (let k = 0; k < n; k++) {
      const x = (k / (n - 1) * 2 - 1) * R * 0.95, base = R * Math.sqrt(Math.max(0.05, 1 - (x / R) * (x / R)));
      pillar(g, 4, x, base, w, R * (0.5 + 1.3 * n1(k * 0.4 - T * 0.5, 3)) * (0.45 + 0.55 * heat) * (fire ? 1 : 0.6), al * (0.3 + 0.65 * n1(k * 0.23 + T * 0.4, 9)));
    }
    g.restore(); g.globalAlpha = 1;
  }
  // A pupil that is not round. The soft shimmers and the cat's slit are every world's (static/dreameye.js); what
  // today's look draws as a sign is a light of the polar night here: for 'heart' a small warm sun dog, for 'star' ice
  // dust glittering, for 'spiral' a corona turning, its rays swelling in a wave that runs around
  function pupilShape(g, shape, x, y, pr, R, mirror, o) {
    if (shape !== 'heart' && shape !== 'star' && shape !== 'spiral') { DreamEye.pupilShape(g, shape, x, y, pr, R, mirror, o); return; }
    const al = g.globalAlpha, T = (o.now === undefined ? performance.now() : o.now) / 1000, beat = o.beat || 0, dir = mirror ? -1 : 1;
    g.drawImage(pupil(), x - pr * 1.18, y - pr * 1.18, pr * 2.36, pr * 2.36);
    g.save(); g.globalCompositeOperation = 'lighter';
    if (shape === 'heart') sunDog(g, x, y, pr * 0.72 * (0.94 + 0.06 * Math.sin(T * (o.fire ? 5 : 2.2))), al, beat);
    else if (shape === 'star') {
      for (let k = 0; k < 13; k++) {
        const tw = Math.pow(0.5 + 0.5 * Math.sin(T * 3.4 + k * 2.1), 3), an = k * 2.39996 + T * 0.12 * dir, rr = pr * 0.88 * Math.sqrt((k + 0.5) / 13), px = x + Math.cos(an) * rr, py = y + Math.sin(an) * rr;
        if (k % 3 === 0) pillar(g, 2, px, py, pr * 0.1, pr * 0.5 * tw, al * 0.7 * tw);   // over the brightest crystals a tiny pillar stands
        stamp(g, k % 4 ? white() : ice(), px, py, pr * (0.07 + 0.13 * tw) * (1 + 0.3 * beat), al * (0.2 + 0.8 * tw));
      }
    } else {
      corona(g, x, y, pr * 0.12, pr * 0.62 * (1 + 0.25 * beat), 26, T * 3, 4, al, tone(o.hue), T * 0.5 * dir);
      corona(g, x, y, pr * 0.1, pr * 0.4, 18, T * 3, 8, al * 0.7, 1, -T * 0.3 * dir);
      stamp(g, white(), x, y, pr * 0.16, al * 0.8);
    }
    g.restore(); g.globalAlpha = al;
  }

  // ---------- what lives around the eyes and drifts through the windows ----------
  // One living thing d at age ms, faded in and out by env, drawn at size s, its drifting height y (static/dreamlife.js
  // describes d and o). 'lighter' is set by the caller.
  function life(g, d, age, env, s, y, o) {
    const T = age / 1000, seed = ((d.born || 0) * 7 + d.x * 13 + (d.spin || 1) * 101) | 0, r = rng(seed), sd = ((seed % 89) + 89) % 89, x = d.x, kind = d.kind, k0 = tone(d.hue);
    if (kind === 'cloud') {                            // a small curtain drifting, folding
      const P = [], Q = [];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24, fold = Math.sin(u * 5 + T * 0.4 + sd) * s * 0.26 + Math.sin(u * 11 - T * 0.3) * s * 0.09;
        P.push([x + (u - 0.5) * s * 3, y + s * 0.5 + fold]); Q.push([x + (u - 0.42) * s * 2.6, y + s * 0.25 - fold * 0.6]);
      }
      curtain(g, Q, s * 1.1, T, sd + 3, 0.4 * env, (k0 + 1) % 3, s * 0.08);
      curtain(g, P, s * 1.5, T, sd, env, k0, s * 0.06);
    } else if (kind === 'bloom') {                     // a halo opening: a ring of light, its mock moons, a pillar through its light
      const grow = ease(age / 2500), rr = s * 0.95 * (0.3 + 0.7 * grow);
      ringOfLight(g, x, y, rr, 0.75 * env, false, grow);
      pillar(g, 2, x, y + s * 0.05, s * 0.2, s * 0.85 * grow, 0.5 * env);
      stamp(g, green(), x, y, s * 0.55, 0.4 * env); stamp(g, white(), x, y, s * 0.15, 0.75 * env); g.globalAlpha = 1;
    } else if (kind === 'mandala') {                   // a small corona: rays streaming out of one point, turning slowly
      const grow = ease(age / 2200);
      corona(g, x, y, s * 0.1, s * 0.85 * grow, 44, T, sd, 0.95 * env, k0, d.spin * T * 0.04);
      corona(g, x, y, s * 0.07, s * 0.5 * grow, 30, T, sd + 4, 0.6 * env, (k0 + 1) % 3, -d.spin * T * 0.03);
      stamp(g, white(), x, y, s * 0.1, 0.6 * env); g.globalAlpha = 1;
    } else if (kind === 'tree') {                      // light pillars growing over ice dust
      const grown = ease(age / 3500), base = d.y + s * 0.6;
      for (let k = 0; k < 7; k++) {
        const px = x + (k - 3) * s * 0.2 + (r() - 0.5) * s * 0.12, hh = s * (0.5 + r() * 0.9) * clamp(grown * 1.6 - k % 3 * 0.2);
        pillar(g, (k + k0) % 3, px, base + (r() - 0.5) * s * 0.1, s * 0.09, hh, env * (0.35 + 0.5 * n1(T * 0.5 + k, sd)));
      }
      dust(g, x, base, s * 0.75, s * 0.12, 16, T, r, env * grown, s * 0.022);
    } else if (kind === 'moth') {                      // a shooting star: a streak now and then, its train fading after it
      const turn = Math.floor(T / 3.6), ph = (T - turn * 3.6) / 1.1, an = 0.35 + hash(seed, turn) * 0.7, side = hash(seed, turn + 50) < 0.5 ? -1 : 1, far = s * 2.6;
      const x0 = x - side * Math.cos(an) * far * 0.5, y0 = y - Math.sin(an) * far * 0.5, at = k => [x0 + side * Math.cos(an) * far * k, y0 + Math.sin(an) * far * k];
      if (ph < 1) {
        const [hx, hy] = at(ph), al = Math.sin(PI * ph) * env;
        for (let q = 0; q < 14; q++) { const [px, py] = at(Math.max(0, ph - q * 0.028)); stamp(g, white(), px, py, s * 0.05 * (1 - q / 16), al * (1 - q / 14)); }
        stamp(g, green(), hx, hy, s * 0.22, al * 0.8);
      }
      const gone = clamp((ph - 0.25) / 1.6);            // the train: a faint line where it flew, fading
      if (ph > 0.25 && gone < 1) glowLine(g, [[at(0.12), at(Math.min(1, ph))]], 160, s * 0.006, 0.35 * env * (1 - gone));
      stamp(g, white(), x0, y0, s * 0.035, 0.5 * env * (0.6 + 0.4 * Math.sin(T * 2))); g.globalAlpha = 1;   // the star it seems to come from
    } else if (kind === 'bubbles') {                   // diamond dust rising: crystals of ice, a tiny pillar over each as it flashes
      for (let j = 0; j < 9; j++) {
        const ph = (T * 0.6 + j * 0.5) % 4.5, bx = x + Math.sin(ph * 1.3 + j) * s * 0.3 + (j - 4) * s * 0.11, by = d.y + s * 0.6 - ph * s * 0.34, al = env * Math.min(1, ph * 2, (4.5 - ph) * 1.5);
        const tw = Math.pow(0.5 + 0.5 * Math.sin(T * 2.2 + j * 1.9), 2);
        pillar(g, (j + k0) % 3, bx, by + s * 0.05, s * 0.08, s * (0.25 + 0.5 * tw), al * (0.25 + 0.6 * tw));
        stamp(g, white(), bx, by, s * (0.03 + 0.035 * tw), al * (0.4 + 0.6 * tw));
      }
      g.globalAlpha = 1;
    } else if (kind === 'aurora') {                    // a quiet arc: a long low bow of rays, a taller faint one behind it
      const P = [];
      for (let i = 0; i <= 30; i++) { const u = i / 30; P.push([x + (u - 0.5) * s * 4.2, y + s * 0.55 - Math.sin(PI * u) * s * 0.5 + Math.sin(u * 7 + T * 0.3 + sd) * s * 0.07]); }
      curtain(g, P, u => s * 1.6 * Math.sin(PI * u), T, sd + 2, 0.35 * env, (k0 + 2) % 3, s * 0.09);
      curtain(g, P, u => s * (0.5 + 0.6 * Math.sin(PI * u)), T, sd, 0.9 * env, k0, s * 0.055);
    } else if (kind === 'orbit') {                     // a halo around one eye, mock moons wandering along it
      const [ex, ey, ea] = o.anchor || [x, y, s * 0.6], rr = ea * 1.32;
      stamp(g, halo(), ex, ey, rr / RING, 0.3 * env);
      for (let j = 0; j < 3; j++) for (let q = 0; q < 5; q++) {
        const an = (age - q * 90) / (1500 + j * 600) * (j % 2 ? -1 : 1) + j * 2.1;
        stamp(g, [warm, white, violet][j](), ex + Math.cos(an) * rr, ey + Math.sin(an) * rr * 0.92, ea * 0.11 * (1 - q * 0.16), env * (q ? 0.3 * (1 - q / 5) : 0.9));
      }
      g.globalAlpha = 1;
    } else if (kind === 'tear') {                      // a drop of light falls as a streak and comes apart into ice dust
      const p = age / d.life, fall = Math.min(1, p / 0.55), ty = d.y + fall * fall * s * 9;
      if (p < 0.6) {
        pillar(g, 2, x, ty, s * 0.9, s * 3.2 * fall, 0.8);
        stamp(g, ice(), x, ty, s * 1.1, 0.9); stamp(g, white(), x, ty, s * 0.4, 0.9);
      } else {
        const q = (p - 0.6) / 0.4;
        for (let j = 0; j < 11; j++) { const an = j * 0.6 + r() * 0.5, rr = q * s * (2 + 3 * r()), tw = Math.pow(0.5 + 0.5 * Math.sin(T * 7 + j * 2.3), 2); stamp(g, j % 3 ? white() : ice(), x + Math.cos(an) * rr, d.y + s * 9 + Math.sin(an) * rr * 0.45 + q * s, s * (0.14 + 0.2 * tw), (1 - q) * (0.3 + 0.7 * tw)); }
      }
      g.globalAlpha = 1;
    } else if (kind === 'stars') {                     // ice dust glittering around an eye, where today's look bursts into stars
      const q = age / d.life;
      for (const [an, rr, ph] of d.puffs) {
        const r2 = d.size * rr * (0.7 + 0.45 * q), tw = Math.pow(0.5 + 0.5 * Math.sin(age / 110 + ph * 40), 2), sz = d.size * 0.05 * (d.big || 1) * (1 - q) * (0.6 + ph), px = x + Math.cos(an) * r2, py = d.y + Math.sin(an) * r2 * 0.7 + q * q * d.size * 0.12;
        if (ph > 0.5) pillar(g, 2, px, py, sz * 1.5, sz * 7 * tw, (1 - q) * tw * 0.8);
        stamp(g, ph > 0.3 ? white() : ice(), px, py, sz * (1 + tw), (1 - q) * (0.35 + 0.65 * tw));
      }
      g.globalAlpha = 1;
    } else if (kind === 'ember') {                     // a red ray rising from the fire, a warm light at its foot
      const q = age / d.life, px = x + Math.sin(age / 400 + d.spin * 9) * d.size * 4, py = d.y - q * o.H * 0.7;
      pillar(g, 4, px, py, d.size * 3, d.size * 12 * Math.sin(PI * Math.min(1, q * 1.4 + 0.15)), 0.9 * (1 - q)); stamp(g, warm(), px, py, d.size * 2.4, 0.8 * (1 - q)); g.globalAlpha = 1;
    } else if (kind === 'fireheart') {                 // where today's look lets a heart rise: a small warm sun dog
      const q = age / d.life;
      sunDog(g, x + Math.sin(age / 600 + d.spin * 7) * d.size * 0.8, d.y - q * o.H * 0.7, d.size * 0.85, (1 - q) * 0.95, 0.5 + 0.5 * Math.sin(T * 5));
    } else if (kind === 'sparks') {                    // a shower of warm glints flying in from where a fire flared up
      const q = age / d.life, out = 1 - (1 - q) * (1 - q);
      for (const [an, sp, ph] of d.puffs) {
        const far = d.size * sp * out;
        stamp(g, ph > 0.5 ? warm() : white(), x + Math.cos(d.dir + an) * far, d.y + Math.sin(d.dir + an) * far + d.size * 0.3 * q * q, d.size * 0.03 * (0.5 + ph) * (1.2 - q), (1 - q) * (0.55 + 0.45 * Math.sin(age / 70 + ph * 40)));
      }
      g.globalAlpha = 1;
    } else if (kind === 'zzz') {                       // asleep: pillars dim one after the other, snow sinks slowly
      const q = age / d.life, z = d.size;
      for (let j = 0; j < 3; j++) pillar(g, [2, 0, 1][j], x + (j - 0.6) * z * 1.1, d.y + z * (0.4 - j * 0.3), z * 0.75, z * (3.2 + j * 1.3) * (1 - 0.3 * q), 0.75 * clamp(1.25 - q * 1.7 + j * 0.28) * Math.min(1, q * 8));
      for (let j = 0; j < 7; j++) {
        const fall = (q * 1.3 + r()) % 1, px = x + (r() - 0.3) * z * 4 + Math.sin(T * 0.8 + j * 2) * z * 0.4;
        stamp(g, pale(), px, d.y - z * 3.5 + fall * z * 5, z * (0.16 + 0.14 * r()), 0.7 * (1 - q) * Math.sin(PI * fall));
      }
      g.globalAlpha = 1;
    } else {                                           // whatever else: night-shining wisps – thin pale streaks high up, rippling
      for (let k = 0; k < 6; k++) {
        const wy = y + (k - 2.5) * s * 0.16 + Math.sin(T * 0.3 + k * 1.7) * s * 0.05, wx = x + Math.sin(T * 0.17 + k * 2.3 + sd) * s * 0.5 + (r() - 0.5) * s * 0.8;
        oval(g, k % 3 ? ice() : violet(), wx, wy, s * (0.9 + 0.7 * r()), s * (0.05 + 0.04 * r()), env * (0.3 + 0.5 * n1(T * 0.4 + k * 3, sd)));
      }
      dust(g, x, y, s * 1.1, s * 0.5, 7, T, r, env * 0.7, s * 0.02);
    }
  }

  // ---------- the faces of light ----------
  // Three skies whose eyes these may be. v is the face rule's word: the sign on the forehead comes with the hints; what
  // falls where hair would, the low light along the jaw, the nose and the mouth only in the rare moment, clearly then. The brow is
  // the eye's own. Drawn twice by the page: without `ink` into the mask the dream shines through (so: without
  // colours), with it as the world's own glow over that.
  const FACES = ['veil', 'crown', 'pillars'];
  const RARE = 1.25;                                   // light adds up thinly: what comes in the rare moment is drawn a little above its share
  function face(c, mode, t, geo, v, ink, inkAl = 1) {
    const mono = ink === undefined, K = mono ? 0.5 : Math.min(1, inkAl * 4.5);
    const mark = DreamVis.of(v, 'mark') * K, hair = DreamVis.of(v, 'hair') * RARE * K, outline = DreamVis.of(v, 'outline') * RARE * K, mouth = DreamVis.of(v, 'mouth') * RARE * K, nose = DreamVis.of(v, 'nose') * RARE * K;
    if (mark + hair + outline + mouth + nose <= 0.004) return;
    const T = t / 1000, F = faceFrame(geo.cx, geo.ey, geo.half), a = F.u, S = skeleton(geo.cx, geo.ey, geo.half, t);
    const strands = S.filter(k => k.name === 'strand').map(k => k.pts), jaws = S.filter(k => k.name === 'jaw').map(k => k.pts), lips = S.find(k => k.name === 'lips').pts;
    const pr = (s, e) => smooth(seg(v.fullForm, s, e)), pH = (s, e) => smooth(seg(v.hintForm, s, e));
    const V = k => mono ? 3 : k, L = spr => mono ? pale() : spr(), m0 = F(0, -2.6), tw = 0.75 + 0.25 * Math.sin(T * 2.3);
    c.save();
    if (mode === 'veil') {
      // veils where hair would fall, a low band of light along the jaw; on the forehead a brighter star in its small corona
      const la = mark * pH(0.2, 1);
      if (la > 0.004) { stamp(c, mono ? haloPale() : halo(), m0[0], m0[1], a * 0.62, 0.55 * la * tw); stamp(c, L(green), m0[0], m0[1], a * 0.85, 0.5 * la); stamp(c, L(white), m0[0], m0[1], a * 0.17, la * tw); c.globalAlpha = 1; }
      const tall = a * 1.2;
      if (hair > 0.004) strands.forEach((P, k) => {
        const i = k % 5; if (i % 2) return;
        const sway = P.map((q, j) => [q[0] + Math.sin(T * 0.5 - j * 0.16 + k) * a * 0.1 * (j / P.length), q[1]]);
        curtain(c, sway, tall * (1 - i * 0.09), T, 20 + k, 0.75 * hair, V(i === 2 ? 1 : 0), a * 0.07, null, pr(i * 0.06, 0.7 + i * 0.06));
      });
      jaws.forEach((P, k) => curtain(c, P, a * 0.45, T, 40 + k, 0.55 * outline, V(2), a * 0.06, null, pr(0.2, 0.9)));
    } else if (mode === 'crown') {
      // the light standing overhead: rays streaming out over the head; a low bow under the chin; on the forehead a halo with its mock moons
      const la = mark * pH(0.2, 1);
      if (la > 0.004) { ringOfLight(c, m0[0], m0[1], a * 0.55 * (0.5 + 0.5 * pH(0.2, 0.9)), la, mono); stamp(c, L(white), m0[0], m0[1], a * 0.12, la * tw); stamp(c, L(ice), m0[0], m0[1], a * 0.5, 0.35 * la); c.globalAlpha = 1; }
      if (hair > 0.004) {
        const mid = F(0, -1.6), arc = [], tall = a * 1.5;
        for (let k = 0; k <= 40; k++) { const an = PI * (0.1 + 0.8 * k / 40); arc.push(F(-3.75 * Math.cos(an), -1.6 - 2.4 * Math.sin(an))); }
        const grow = pr(0, 0.8);
        curtain(c, arc, u => tall * (0.55 + 0.45 * Math.sin(PI * u)) * grow, T, 24, 0.8 * hair, V(0), a * 0.075, outward(mid[0], mid[1]));
        curtain(c, arc, u => tall * 0.55 * grow, T, 27, 0.5 * hair, V(1), a * 0.1, outward(mid[0], mid[1]));
        glowLine(c, [arc], 160, a * 0.006, 0.3 * hair * grow, mono);
      }
      jaws.forEach((P, k) => curtain(c, P.slice(Math.floor(P.length * 0.55)), a * 0.4, T, 44 + k, 0.6 * outline, V(1), a * 0.06, null, pr(0.2, 0.9)));
    } else {
      // light pillars standing where hair would fall, ice dust glittering along the jaw; on the forehead a star with a pillar over it
      const la = mark * pH(0.2, 1);
      if (la > 0.004) { pillar(c, V(2), m0[0], m0[1] + a * 0.1, a * 0.3, a * 1.5 * pH(0.2, 1), 0.7 * la); stamp(c, L(ice), m0[0], m0[1], a * 0.7, 0.5 * la); stamp(c, L(white), m0[0], m0[1], a * 0.17, la * tw); c.globalAlpha = 1; }
      if (hair > 0.004) for (const o of [-1, 1]) for (let j = 0; j < 5; j++) {
        const foot = F(o * (4.05 + j * 0.5), 0.8 + ((j * 3) % 5) * 0.95), top = F(0, -3.9 + ((j * 2) % 5) * 0.5)[1], grow = pr(j * 0.08, 0.6 + j * 0.08);
        pillar(c, V([0, 2, 1][j % 3]), foot[0] + Math.sin(T * 0.3 + j + o) * a * 0.04, foot[1], a * (0.34 - j * 0.03), Math.max(a, foot[1] - top) * grow, hair * (0.5 + 0.4 * n1(T * 0.4 + j * 3, 5 + o)));
        stamp(c, L(white), foot[0], foot[1] - a * 0.04, a * 0.09, hair * grow * 0.8);
      }
      const oa = outline * pr(0.2, 1), rr = rng(31);
      if (oa > 0.004) jaws.forEach((P, k) => { for (let i = 4; i < P.length; i += 3) { const q = P[i], z = Math.pow(0.5 + 0.5 * Math.sin(T * 2.2 + i * 1.7 + k * 3), 2); stamp(c, L(i % 2 ? white : ice), q[0] + (rr() - 0.5) * a * 0.3, q[1] + (rr() - 0.5) * a * 0.3, a * (0.05 + 0.07 * z), oa * (0.3 + 0.7 * z)); } });
      c.globalAlpha = 1;
    }
    const na = nose * pr(0.3, 1);                      // the nose: a slim pillar of light down its ridge, a star on its tip, a low glimmer under it
    if (na > 0.004) {
      const tip = S.find(k => k.name === 'nose tip').pts[0];
      pillar(c, V(2), tip[0], tip[1] + a * 0.14, a * 0.22, a * 1.1 * pr(0.3, 0.9), 0.65 * na);
      curtain(c, S.find(k => k.name === 'nose base').pts, a * 0.14, T, 52, 0.6 * na, V(0), a * 0.03);
      stamp(c, L(ice), tip[0], tip[1], a * 0.42, 0.3 * na); stamp(c, L(white), tip[0], tip[1], a * 0.1, 0.8 * na * tw); c.globalAlpha = 1;
    }
    const ma = mouth * pr(0.4, 1);                     // the mouth: closed, warm – low rays on the line of the lips, a soft warm light
    if (ma > 0.004) {
      curtain(c, lips, a * 0.3, T, 50, 0.85 * ma, V(1), a * 0.035);
      glowLine(c, [lips], 335, a * 0.006, 0.4 * ma, mono);
      const p = F(0, 2.75); stamp(c, L(warm), p[0], p[1], a * 0.8, 0.3 * ma);
    }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- the large motifs of a dream window (world-classic.js describes m and o) ----------
  // an auroral corona: rays streaming out of a disc R around (cx, cy), a ring of light close around it
  function crown(c, cx, cy, R, T, tier) {
    const n = [48, 70, 90][tier];
    for (const [k, al, len, turn] of [[2, 0.7, 1.8, 0.011], [0, 1, 1.3, -0.017], [1, 0.7, 0.8, 0.023]]) corona(c, cx, cy, R * 1.02, R * len, n, T * (1 + k * 0.2), 90 + k * 4, al, k, T * turn);
    stamp(c, halo(), cx, cy, R * 1.27, 0.7); stamp(c, green(), cx, cy, R * 1.7, 0.18); c.globalAlpha = 1;
  }
  // --- the third eye: the light stands overhead, and in its dark middle an eye opens. In trance it opens in every window
  function third(c, m, t, dt, o) {
    const [cx, cy] = o.mid, R = Math.min(o.W, o.H) * 0.25 * (1 + 0.02 * o.pulse), T = t / 1000;
    night(c, cx, cy, R * 2.2, 0.55);
    c.save(); c.globalCompositeOperation = 'lighter'; crown(c, cx, cy, R, T, o.tier);
    c.globalCompositeOperation = 'source-over'; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip();
    c.fillStyle = 'rgba(2,5,14,.94)'; c.fillRect(cx - R, cy - R, R * 2, R * 2); skyPiece(c, cx - R, cy - R, R * 2, R * 2, 0.55, 3);
    c.restore(); c.globalAlpha = 1;
    m.mirror = false;
    o.eye(c, m, dt, cx, cy + R * 0.04, R * 0.72, DreamEye.LOOKS.nymph);
  }
  // --- a mandala: the corona again, the dream folded in its disc
  function mandala(c, m, t, dt, o) {
    const [cx, cy] = o.mid, R = Math.min(o.W, o.H) * 0.27 * (1 + 0.03 * o.pulse), T = t / 1000, ph = (m.seed % 628) / 100;
    night(c, cx, cy, R * 2.1, 0.5);
    c.save(); c.globalCompositeOperation = 'lighter'; crown(c, cx, cy, R, T, o.tier);
    c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    o.softPiece(c, t, (sc, n) => kaleido(sc, o.pic, n, t, ph, o.tier ? 12 : 8), cx, cy, R * 1.06, 1);
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip(); c.drawImage(vign(), cx - R, cy - R, R * 2, R * 2);
    c.restore(); c.globalAlpha = 1;
  }
  // --- impossible shapes (DreamLife.impossible): every face a pane of the dream under the night, the edges lines of
  // light with low rays standing on them, a halo behind
  function shape(c, m, t, dt, o) {
    const sh = DreamLife.impossible(m.kind), [cx, cy] = o.mid, S = Math.min(o.W, o.H) * 0.485 * (1 + 0.025 * o.pulse), T = t / 1000;
    const path = f => { c.beginPath(); for (const [x, y] of f.pts) c.lineTo(x * S, y * S); c.closePath(); };
    night(c, cx, cy, S * 1.15, 0.6);
    c.save(); c.globalCompositeOperation = 'lighter'; stamp(c, halo(), cx, cy, S * 1.02 / RING, 0.22); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.translate(cx, cy); c.rotate((m.seed & 1 ? 1 : -1) * t / 1000 * TAU / 150 + m.seed % 7);
    sh.faces.forEach((f, i) => {
      c.save(); path(f); c.clip();
      const n = S * 3.1, u = 0.5 + 0.14 * Math.sin(i * 2.1 + t / 9000), v = 0.5 + 0.14 * Math.cos(i * 1.3 + t / 11000);
      c.globalAlpha = f.fade ? 0.35 : f.glass ? 0.15 : 0.8; c.drawImage(o.pic, -u * n, -v * n, n, n);
      c.globalAlpha = Math.min(0.9, 0.3 + f.shade * 0.9) * (f.glass ? 0.3 : 1); c.fillStyle = '#02050e'; c.fillRect(-S * 1.1, -S * 1.1, S * 2.2, S * 2.2);
      c.restore();
    });
    c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
    const strong = [], faint = [], seen = new Set(), corners = [];
    for (const f of sh.faces) {
      (f.fade || f.glass || f.wall ? faint : strong).push([...f.pts, f.pts[0]].map(([x, y]) => [x * S, y * S]));
      if (!f.wall && !f.fade) for (const [x, y] of f.pts) { const key = Math.round(x * 40) + ':' + Math.round(y * 40); if (!seen.has(key)) { seen.add(key); corners.push([x * S, y * S]); } }
    }
    if (o.tier > 0) strong.forEach((P, i) => curtain(c, P, S * 0.09, T, 70 + i, 0.45, i % 3, S * 0.02, outward(0, 0)));   // the light leans outwards, off the edges
    glowLine(c, strong, 150, S * 0.004, 0.8); glowLine(c, faint, 265, S * 0.003, 0.35);
    corners.forEach((q, i) => stamp(c, white(), q[0], q[1], S * 0.022, 0.25 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(T * 1.4 - i * 0.7), 2)));
    if (sh.path) {                                     // a small sun dog walks the stairs – always upwards, never arriving
      const n = sh.path.length, u = (t / 620) % n, k = u | 0, fr = u - k, e = fr < 0.5 ? 2 * fr * fr : 1 - (-2 * fr + 2) ** 2 / 2, [ax, ay] = sh.path[k], [bx, by] = sh.path[(k + 1) % n];
      sunDog(c, lerp(ax, bx, e) * S, (lerp(ay, by, e) - 0.06 - 0.07 * Math.sin(fr * PI)) * S, S * 0.05, 0.9, 0);
    }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- the night behind Dreamy Eyes: the dream is seen in the light of the sky (white into bk where it shows) ----------
  const across = (w, y0, amp, T, k, n = 30) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [(u * 1.1 - 0.05) * w, y0 + Math.sin(u * 4 + T * 0.25 + k * 2) * amp + Math.sin(u * 9 - T * 0.2 + k) * amp * 0.35]; });
  function backMask(bk, mode, t, w, h, al, o) {
    const m = Math.min(w, h), T = t / 1000;
    if (mode === 'clouds') {                           // three great curtains across the night – between and above them it stays dark
      for (let k = 0; k < 3; k++) curtain(bk, across(w, h * (0.5 + k * 0.24), m * 0.09, T, k), m * (0.62 - k * 0.1), T, 70 + k, al * (0.62 - k * 0.08), 3, Math.max(w, h) * 0.011);
    } else if (mode === 'fractal') {                   // the light stands overhead: a great corona streaming out from behind the eyes
      const cx = w / 2, cy = h * 0.46, far = Math.hypot(w, h) * 0.5;
      corona(bk, cx, cy, m * 0.3, far * 0.75, 84, T, 81, al * 0.6, 3, T * 0.008);
      corona(bk, cx, cy, m * 0.34, far * 0.4, 60, T, 85, al * 0.45, 3, -T * 0.012);
      stamp(bk, haloPale(), cx, cy, m * 0.3 / RING, al * 0.3); bk.globalAlpha = 1;
    } else {                                           // a great halo with its mock moons, light pillars standing along the horizon – none in the middle,
                                                       // where one would stand between the eyes
      const cx = w / 2, cy = h * 0.46, R = m * (o.upright ? 0.44 : 0.4) * (1 + 0.02 * Math.sin(T * 0.3));
      ringOfLight(bk, cx, cy, R, al * 0.9, true); stamp(bk, haloPale(), cx, cy, R * 2 / RING, al * 0.3);
      const n = o.upright ? 7 : 11;
      for (let k = 0; k < n; k++) if (k !== (n >> 1)) pillar(bk, 3, w * (k + 0.5 + 0.3 * Math.sin(k * 7.1)) / n, h * 1.02, m * 0.09, h * (0.3 + 0.35 * hash(17, k)) * (0.8 + 0.2 * Math.sin(T * 0.4 + k * 2)), al * (0.25 + 0.4 * n1(T * 0.3 + k * 3, 19)));
      bk.globalAlpha = 1;
    }
  }

  // ---------- the sky of a dream window: the dream seen in three great curtains ----------
  function skyClouds(cg, t, o) {
    const { w, h } = o, T = t / 1000 + o.drift * 40, m = Math.min(w, h), R = m * 0.3, step = Math.max(w, h) * [0.02, 0.015, 0.012][o.tier] / coarse;
    const lines = [0, 1, 2].map(k => across(w, h * 0.5 + R * (0.45 + k * 0.72), R * 0.34, T + o.index * 3, k + o.index));
    lines.forEach((P, k) => curtain(cg, P, R * (2.3 - k * 0.3) * (1 + 0.12 * o.swell), T, 70 + k + o.index, 0.75 + 0.2 * o.swell, 3, step));
    cg.globalCompositeOperation = 'source-in';
    o.dream(cg, 0, 0, w, h, 1.2 + 0.1 * Math.sin(T / 19 + o.index), 0.5 + 0.2 * Math.sin(T / 26 + o.index * 1.7), 0.5 + 0.2 * Math.cos(T / 33 + o.index * 2.3));
    cg.globalCompositeOperation = 'lighter';           // … and a breath of the curtains' own colours over it
    lines.forEach((P, k) => curtain(cg, P, R * (2.3 - k * 0.3) * (1 + 0.12 * o.swell), T, 70 + k + o.index, 0.2, k, step));
    cg.globalCompositeOperation = 'source-over';
  }

  // ---------- what fills the night: the field of stars, turning slowly around the pole; the brighter ones twinkle ----------
  function air(g, t, o) {
    const T = t / 1000, { W, H } = o, S = stars(), px = W / 2, py = H * 0.35, R = Math.hypot(W / 2, H * 0.65), n = [8, 20, 36][o.tier];
    coarse = COARSE[o.tier] || 1;
    g.save(); g.globalCompositeOperation = 'lighter'; g.translate(px, py);
    if (o.tier > 0) g.rotate(T * 0.0015);
    g.globalAlpha = 0.8; g.drawImage(S, -R, -R, R * 2, R * 2);
    for (let i = 0; i < n; i++) { const [u, v, ph] = S.tw[i]; stamp(g, white(), (u * 2 - 1) * R, (v * 2 - 1) * R, Math.max(3, R * 0.005), 0.6 * Math.pow(0.5 + 0.5 * Math.sin(T * 1.7 + ph), 4)); }
    g.restore(); g.globalAlpha = 1;
  }

  // ---------- fire: the red aurora – a warm red curtain rising from the horizon, tallest where the flame is ----------
  function flames(g, t, k, side, o) {
    const { W, H } = o, T = t / 1000 * 2.4, kk = Math.min(1, k), step = W / (o.perf > 30 ? 120 : 80) / coarse;
    const near = u => { const d = (u - side) / 0.32; return 0.5 + 0.7 * Math.exp(-d * d); };
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) stamp(g, warm(), W * (side + (i - 2) * 0.22), H * 1.05, Math.max(W, H) * 0.3 * (0.6 + 0.4 * k), 0.3 * kk);
    const P = across(W, H * 1.01, H * 0.012, T, 1, 24), Q = across(W, H * 0.985, H * 0.02, T, 4, 24);
    curtain(g, Q, u => H * 0.8 * k * near(u), T, 31, 0.4 * kk, 1, step * 1.5);
    curtain(g, P, u => H * 0.62 * k * near(u), T, 33, 0.95 * kk, 4, step);
    curtain(g, P, u => H * 0.25 * k * near(u), T * 1.6, 37, 0.5 * kk, 4, step * 1.2);
    g.restore(); g.globalAlpha = 1;
  }

  // ---------- the trance (world-classic.js describes p and o) ----------
  function tranceBack(g, t, p, o) {                    // the sky darkens; halos fly towards the eye; coronas open around it; streaks fall into it
    const { W, H } = o, T = t / 1000, R = Math.hypot(W, H) * 0.55, few = o.perf <= 45;
    g.fillStyle = `rgba(1,3,10,${0.6 * p.dim})`; g.fillRect(0, 0, W, H);
    g.save(); g.globalCompositeOperation = 'lighter';
    if (p.tun > 0.01) for (let j = 0; j < 7; j++) {
      const s = (T / 2.2 + j / 7) % 1, r = R * (1 - s) ** 1.6 + p.A * 0.6;
      stamp(g, halo(), p.ex, p.ey, r / RING, 0.6 * p.tun * Math.sin(s * PI));
      if (!few || j % 2 === 0) for (const sd of [-1, 1]) oval(g, [warm, violet, ice][j % 3](), p.ex + sd * r, p.ey, r * 0.14, r * 0.05, 0.7 * p.tun * Math.sin(s * PI));
    }
    g.globalAlpha = 1;
    if (p.mand > 0.01) for (let i = 0; i < (few ? 2 : 3); i++) {
      const r0 = p.A * (1.2 + i * 0.75) * (1 + 0.04 * Math.sin(T * 0.9)) * (0.6 + 0.4 * p.mand);
      corona(g, p.ex, p.ey, r0, p.A * (0.8 + 0.25 * i), (few ? 30 : 44) + i * 14, T, 11 + i * 5, 0.75 * p.mand, [0, 1, 2][i], T / (9 + i * 3) * (i % 2 ? -1 : 1));
    }
    if (p.pull > 0.01) for (let k = 0; k < (few ? 26 : 40); k++) {
      const s = (T / 1.6 + k / 40 * 3.7) % 1, r = R * (1 - s), an = k * 2.399 + s * 4 + T / 2.5;
      for (let q = 0; q < 4; q++) stamp(g, q ? LIGHTS[k % 3]() : white(), p.ex + Math.cos(an - q * 0.05) * r * (1 + q * 0.06), p.ey + Math.sin(an - q * 0.05) * r * (1 + q * 0.06), p.A * 0.06 * (1 - q * 0.2) * (0.5 + s), 0.7 * p.pull * s * (1 - q * 0.25));
    }
    g.restore(); g.globalAlpha = 1;
  }
  function tranceEye(g, t, p, o) {                     // the third eye: a piece of night sky standing upright, rays streaming from both lids
    const { ex, ey, A } = p, B = A * 0.5 * p.eo, { W, H } = o, T = t / 1000;
    g.save();
    if (p.dot > 0.01) { g.globalCompositeOperation = 'lighter'; stamp(g, halo(), ex, ey, A * 0.42, 0.6 * p.dot); stamp(g, green(), ex, ey, A * 0.55, 0.8 * p.dot); stamp(g, white(), ex, ey, A * 0.11, p.dot); g.globalAlpha = 1; }
    if (p.eo > 0.01) {
      const side = s => curve([[ex, ey - A], [ex + s * B * 1.02, ey - A * 0.45], [ex + s * B * 1.02, ey + A * 0.45], [ex, ey + A]], 10), l = side(-1), r = side(1);
      const almond = () => { g.beginPath(); g.moveTo(ex, ey - A); g.quadraticCurveTo(ex + B * 2, ey, ex, ey + A); g.quadraticCurveTo(ex - B * 2, ey, ex, ey - A); };
      g.globalCompositeOperation = 'lighter'; stamp(g, green(), ex, ey, A * 1.5, 0.22 * p.eo); g.globalAlpha = 1;
      const tall = u => A * 0.5 * p.eo * (0.4 + 0.6 * Math.sin(PI * u));
      curtain(g, l, tall, T, 13, 0.85 * p.eo, 0, A * 0.035, () => -PI / 2); curtain(g, r, tall, T, 17, 0.85 * p.eo, 0, A * 0.035, () => PI / 2);
      g.globalCompositeOperation = 'source-over'; g.save(); almond(); g.clip();
      g.fillStyle = 'rgba(2,5,14,.96)'; g.fillRect(ex - A, ey - A, A * 2, A * 2); skyPiece(g, ex - A, ey - A, A * 2, A * 2, 0.6, 5);
      const ir = A * 0.4;
      g.globalCompositeOperation = 'lighter'; stamp(g, halo(), ex, ey, ir * 1.28, 0.55); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.save(); g.beginPath(); g.arc(ex, ey, ir, 0, TAU); g.clip();
      g.translate(ex, ey); g.rotate(T / 6); g.translate(-ex, -ey);
      if (o.dream) DreamBrush.cover(g, o.dream, ex - ir, ey - ir, ir * 2, ir * 2); else { g.fillStyle = 'hsl(160,60%,30%)'; g.fill(); }
      g.restore();
      g.save(); g.beginPath(); g.arc(ex, ey, ir, 0, TAU); g.clip(); g.drawImage(vign(), ex - ir, ey - ir, ir * 2, ir * 2); g.restore();
      const pr = ir * (0.38 + 0.5 * p.pull) * 1.18; g.drawImage(pupil(), ex - pr, ey - pr, pr * 2, pr * 2);
      g.globalCompositeOperation = 'lighter'; stamp(g, white(), ex - ir * 0.3, ey - ir * 0.34, ir * 0.28, 0.8); g.globalAlpha = 1;
      g.restore();
      g.globalCompositeOperation = 'lighter'; glowLine(g, [l, r], 150, A * 0.012, 0.9 * p.eo);
    }
    if (p.view > 0.01 && o.dream) {                    // through the wide pupil: the dream, large and clear, a corona streaming out of its disc
      const R = Math.min(W, H) * 0.44 * p.view;
      g.globalCompositeOperation = 'lighter';
      corona(g, ex, ey, R, R * 0.55, 80, T, 21, 0.9 * p.view, 0, T * 0.01); corona(g, ex, ey, R, R * 0.3, 60, T, 25, 0.6 * p.view, 1, -T * 0.014);
      stamp(g, halo(), ex, ey, R * 1.24, 0.7 * p.view);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, p.view * 1.2);
      g.save(); g.beginPath(); g.arc(ex, ey, R, 0, TAU); g.clip(); DreamBrush.cover(g, o.dream, ex - R, ey - R, R * 2, R * 2); g.drawImage(vign(), ex - R, ey - R, R * 2, R * 2); g.restore();
    }
    g.restore(); g.globalAlpha = 1;
  }

  // ---------- "you in the dream", and a painted face coming through the pupils: what is drawn around the picture ----------
  const you = {
    FRAMES: ['corona', 'halo', 'veil'],
    behind: {
      corona(c, n, t, hue, al) {                       // the light stands over them: rays streaming out behind the head
        const T = t / 1000;
        c.save(); c.globalCompositeOperation = 'lighter';
        corona(c, n / 2, n / 2, n * 0.2, n * 0.26, 64, T, 61, 0.9 * al, 0, T * 0.01); corona(c, n / 2, n / 2, n * 0.2, n * 0.15, 46, T, 65, 0.6 * al, 1, -T * 0.015);
        c.restore(); c.globalAlpha = 1;
      },
      halo(c, n, t, hue, al) {                         // a halo around the head, its mock moons at both sides, a pillar above
        const T = t / 1000, r = n * (0.36 + 0.006 * Math.sin(T * 0.8));
        c.save(); c.globalCompositeOperation = 'lighter';
        ringOfLight(c, n / 2, n / 2, r, al, false); stamp(c, halo(), n / 2, n / 2, r * 0.93 / RING, 0.3 * al);
        pillar(c, 2, n / 2, n * 0.2, n * 0.08, n * 0.2, 0.6 * al);
        c.restore(); c.globalAlpha = 1;
      },
    },
    front: {
      veil(c, n, t, hue, al) {                         // low curtains drifting before the shoulders
        const T = t / 1000;
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 2; k++) curtain(c, across(n, n * (0.9 + k * 0.1), n * 0.03, T, k + 2, 20), n * (0.26 - k * 0.06), T, 67 + k, (0.6 + 0.3 * k) * al, k ? 0 : 2, n * 0.018);
        c.restore(); c.globalAlpha = 1;
      },
    },
    tints: (hue, t) => ({ glow: 'hsl(155,85%,58%)', halo: 'hsl(165,95%,80%)', rim: `hsl(${290 + 35 * Math.sin(t / 2300)},90%,78%)` }),
    spark(c, x, y, r, hue, tw, al, k) { if (k % 3 === 0) pillar(c, 2, x, y, r * 1.2, r * 5 * tw, 0.6 * tw * al); stamp(c, LIGHTS[k % 3](), x, y, r * 2, 0.6 * tw * al); stamp(c, white(), x, y, r * 0.8, 0.95 * tw * al); },   // ice dust
    cloud(c, cx, cy, size, t, al) {                    // the light a picture comes in: a soft body, rays streaming out of it all around
      const T = t / 1000, P = puff();
      c.globalCompositeOperation = 'lighter';
      stamp(c, P, cx, cy, size * (0.46 + 0.02 * Math.sin(T / 1.3)), al); stamp(c, P, cx, cy, size * 0.38, al);
      for (let k = 0; k < 10; k++) { const an = k / 10 * TAU + 0.2 * Math.sin(T / 3.7 + k), rr = size * 0.26; stamp(c, P, cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * 1.15, size * 0.2, al * 0.85); }
      corona(c, cx, cy, size * 0.36, size * 0.2, 60, T, 71, al * 0.8, 3, T * 0.012);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    },
    rings(g, pupils, r, t, hue, p, mist) {             // a thin corona at the edge of each window the picture comes through
      const T = t / 1000, al = (1 - p) * (1 - 0.6 * mist);
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const [px, py] of pupils) { stamp(g, halo(), px, py, r / RING, 0.8 * al); g.globalAlpha = 1; corona(g, px, py, r * 1.02, r * 0.5, 30, T, 75, 0.8 * al, 0, T * 0.02); }
      g.restore(); g.globalAlpha = 1;
    },
  };

  DreamStyle.register('aurora', {
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
