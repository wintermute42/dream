/* Dream – the dreaming eye, drawn the same way by Dreamy Eyes (eyes.html) and the dream windows (window.html).
   #214: moved here from eyes.html, so that a window's large eye is the very eye of Dreamy Eyes. The pages keep what
   their eyes feel (where they look, when they blink, their mood) and hand it over with every eye they draw.
   No DOM besides canvases; a global `DreamEye`; needs dreamlife.js (the hue of a colour). */
(function (root) {
  'use strict';
  const { hueOf, softLight, stamp, tinted } = root.DreamLife;
  const lerp = (a, b, k) => a + (b - a) * k;
  // the iris' fibres, drawn once: fine radial strands, light and dark
  function fibres() {
    const fib = document.createElement('canvas'); fib.width = fib.height = 512;
    const f = fib.getContext('2d'), c = 256;
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2, r0 = 70 + Math.random() * 40, r1 = 170 + Math.random() * 86, wob = (Math.random() - 0.5) * 0.25;
      f.strokeStyle = Math.random() < 0.55 ? `rgba(255,255,255,${0.05 + Math.random() * 0.16})` : `rgba(0,0,0,${0.08 + Math.random() * 0.2})`;
      f.lineWidth = 0.6 + Math.random() * 1.6;
      f.beginPath(); f.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      f.quadraticCurveTo(c + Math.cos(a + wob) * (r0 + r1) / 2, c + Math.sin(a + wob) * (r0 + r1) / 2, c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      f.stroke();
    }
    const ring = f.createRadialGradient(c, c, 60, c, c, 256);   // the collarette and the dark limbal ring
    ring.addColorStop(0, 'rgba(255,240,220,.18)'); ring.addColorStop(0.32, 'rgba(255,240,220,0)');
    ring.addColorStop(0.86, 'rgba(10,4,20,0)'); ring.addColorStop(1, 'rgba(10,4,20,.95)');
    f.fillStyle = ring; f.fillRect(0, 0, 512, 512);
    return fib;
  }
  // the stars of the galaxy iris: [radius 0–1, angle, brightness]
  const stars = () => Array.from({ length: 140 }, (_, i) => [Math.sqrt(i / 140), i * 2.39996 + (i % 2) * Math.PI, 0.4 + Math.random() * 0.6]);
  // #157: the eyes' look changes softly now and then – shade, liner, lashes, brows
  const LOOKS = {
    rose:   { hue: 318, sat: 55, light: 48, alpha: 0.5,  glitter: 6,  wing: 1,   liner: 1,   lashes: 1,    curl: 1,   lower: 1,   arch: 1,   brow: 1 },
    smoky:  { hue: 270, sat: 18, light: 30, alpha: 0.62, glitter: 3,  wing: 1.35, liner: 1.5, lashes: 1.1, curl: 1.1, lower: 1.3, arch: 0.8, brow: 1.2 },
    golden: { hue: 40,  sat: 75, light: 55, alpha: 0.48, glitter: 12, wing: 0.7, liner: 0.8, lashes: 1,    curl: 0.9, lower: 0.8, arch: 1.1, brow: 0.9 },
    nymph:  { hue: 175, sat: 60, light: 50, alpha: 0.45, glitter: 16, wing: 0.5, liner: 0.7, lashes: 1.3,  curl: 1.3, lower: 1.1, arch: 1.25, brow: 0.8 },
    doll:   { hue: 340, sat: 65, light: 66, alpha: 0.4,  glitter: 5,  wing: 0,   liner: 0.9, lashes: 1.45, curl: 0.7, lower: 1.5, arch: 1.4, brow: 0.75 },
  };
  // #157: the brows come only for a feeling – surprise, joy, sadness, doubt, a frown, curiosity – then they fade again
  const EMO = {   // offsets in eye heights (negative: up) for the inner end, the peak and the outer end; [left, right]
    surprise: [{ inner: -0.55, peak: -0.6, outer: -0.4 }, { inner: -0.55, peak: -0.6, outer: -0.4 }],
    joy:      [{ inner: -0.1, peak: -0.25, outer: 0.05 }, { inner: -0.1, peak: -0.25, outer: 0.05 }],
    sad:      [{ inner: -0.6, peak: 0, outer: 0.45 }, { inner: -0.6, peak: 0, outer: 0.45 }],
    doubt:    [{ inner: -0.5, peak: -0.55, outer: -0.3 }, { inner: 0.15, peak: 0.1, outer: 0.05 }],
    frown:    [{ inner: 0.6, peak: 0.15, outer: -0.3 }, { inner: 0.6, peak: 0.15, outer: -0.3 }],
    curious:  [{ inner: -0.3, peak: -0.35, outer: -0.15 }, { inner: -0.15, peak: -0.25, outer: -0.2 }],
  };
  function almond(g, cx, cy, a, b, up, lo, yL, yR) {   // the eye's opening: upper and lower lid as two curves
    g.beginPath();
    g.moveTo(cx - a, yL);
    g.bezierCurveTo(cx - a * 0.45, cy - b * 1.32 * up, cx + a * 0.45, cy - b * 1.32 * up, cx + a, yR);
    g.bezierCurveTo(cx + a * 0.45, cy + b * 1.05 * lo, cx - a * 0.45, cy + b * 1.05 * lo, cx - a, yL);
    g.closePath();
  }
  const bez = (p0, p1, p2, p3, u) => { const m = 1 - u; return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3; };
  // One eye into g at (cx, cy), half as wide as a and half as high as b; mirror: the right one of a pair. p is what the
  // page knows of it: open and blink (0–1), grin and squint (0–1), col (the dream's colour) and energy, look (one of
  // LOOKS or between two), brow ({ inner, peak, outer } as in EMO) with browAl, gx and gy (where it looks, -1–1), pupil
  // (its radius in iris radii) with pupilMix (0: round, 1: the shape pupilShape(ix, iy, pr, R) draws), fib (fibres())
  // and iris(ix, iy, R): draws what is in the iris – clipped to it already. Returns where the iris is: [x, y].
  function draw(g, cx, cy, a, b, mirror, p) {
    const up = Math.max(0.02, p.open * (1 - p.blink) * (1 - 0.18 * p.grin) * (1 - 0.25 * p.squint)), lo = (0.82 + 0.1 * p.open) * (1 - 0.38 * p.grin) * (1 - 0.35 * p.squint);   // #157: they smile along; #162: squint
    const [r, gg, bl] = p.col;
    // feminine: the outer corner a little lifted (almond, a touch of cat-eye), the inner one soft and low
    const o = mirror ? 1 : -1, lift = b * 0.17;
    const yL = o < 0 ? cy - lift : cy + lift * 0.2, yR = o > 0 ? cy - lift : cy + lift * 0.2, yOut = cy - lift;
    const hueE = hueOf(p.col);
    const upY = u => bez(yL, cy - b * 1.32 * up, cy - b * 1.32 * up, yR, u), upX = u => bez(cx - a, cx - a * 0.45, cx + a * 0.45, cx + a, u);
    const loY = u => bez(yL, cy + b * 1.05 * lo, cy + b * 1.05 * lo, yR, u);
    // eyeshadow: a soft veil of colour on the lid, rose and the dream's hue, with a little shimmer
    g.save();
    g.beginPath(); g.moveTo(cx - a * 1.02, yL); g.bezierCurveTo(cx - a * 0.45, cy - b * (1.6 + 0.15 * up), cx + a * 0.55, cy - b * (1.65 + 0.15 * up), cx + a * 1.02 + o * a * 0.06, yR - b * 0.1);
    g.bezierCurveTo(cx + a * 0.45, cy - b * 1.32 * up, cx - a * 0.45, cy - b * 1.32 * up, cx - a * 1.08, yL); g.closePath();
    const es = g.createLinearGradient(0, cy - b * 1.2 * up, 0, cy - b * (1.1 + 0.3 * up));   // fades out well below its edge
    const L = p.look, rose = L.hue + 18 * Math.sin(hueE / 57.3);   // the look's shade, only touched by the dream's hue
    es.addColorStop(0, `hsla(${rose},${L.sat}%,${L.light}%,${L.alpha})`); es.addColorStop(0.5, `hsla(${rose + 15},${L.sat}%,${L.light + 10}%,${L.alpha * 0.36})`); es.addColorStop(1, `hsla(${rose + 25},50%,60%,0)`);
    g.fillStyle = es; g.fill();
    g.globalCompositeOperation = 'screen';
    for (let k = 0; k < Math.round(L.glitter); k++) { const u = 0.15 + k * (0.7 / Math.max(1, L.glitter - 1)), sx = upX(u), sy = upY(u) - b * (0.25 + 0.15 * Math.sin(k * 2.1)), tw = 0.5 + 0.5 * Math.sin(performance.now() / 400 + k * 1.7 + o);
      g.fillStyle = `rgba(255,240,255,${0.35 * tw})`; g.beginPath(); g.arc(sx, sy, a * 0.008 * (1 + tw), 0, Math.PI * 2); g.fill(); }
    g.restore();
    // a fine brow – only now and then, for a feeling: inner end, peak and outer end move with the emotion
    const E = p.brow;
    if (p.browAl > 0.01) {
    let by0 = cy - b * 1.6 + b * E.inner, by2 = cy - b * 1.7 + b * E.outer, bpy = cy - b * (1.95 + 0.35 * L.arch) + b * E.peak;
    const room = Math.min(by0, by2, bpy) - b * 0.25;  // raised high, they still stay on the screen
    if (room < 0) { by0 -= room; by2 -= room; bpy -= room; }
    const bx0 = cx - o * a * 0.8, bx2 = cx + o * a * 1.02, bpx = cx + o * a * 0.38;
    g.save(); g.globalAlpha = p.browAl;
    g.fillStyle = 'rgba(42,24,56,.9)'; g.beginPath();
    g.moveTo(bx0, by0); g.quadraticCurveTo(bpx - o * a * 0.25, bpy - b * 0.12, bpx, bpy - b * 0.08); g.quadraticCurveTo(bpx + o * a * 0.35, bpy, bx2, by2);
    g.quadraticCurveTo(bpx + o * a * 0.35, bpy + b * 0.08 * L.brow, bpx, bpy + b * 0.05 * L.brow); g.quadraticCurveTo(bpx - o * a * 0.25, bpy + b * 0.06 * L.brow, bx0, by0 + b * 0.11 * L.brow);
    g.closePath(); g.fill(); g.restore();
    }
    // a glow of the dream's colour behind the eye
    const halo = g.createRadialGradient(cx, cy, a * 0.2, cx, cy, a * 1.5);
    halo.addColorStop(0, `rgba(${r | 0},${gg | 0},${bl | 0},${0.18 + 0.2 * p.energy})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo; g.fillRect(cx - a * 1.6, cy - a * 1.6, a * 3.2, a * 3.2);
    g.save();
    almond(g, cx, cy, a, b, up, lo, yL, yR); g.clip();
    // the white, a little tinted by the dream, shaded where the lid sits
    const sc = g.createRadialGradient(cx, cy + b * 0.2, b * 0.2, cx, cy, a * 1.05);
    sc.addColorStop(0, '#fbf8ff'); sc.addColorStop(0.7, `rgb(${lerp(226, r, 0.15) | 0},${lerp(218, gg, 0.15) | 0},${lerp(236, bl, 0.15) | 0})`); sc.addColorStop(1, '#8f84a6');
    g.fillStyle = sc; g.fillRect(cx - a, cy - b * 1.5, a * 2, b * 3);
    const inner = mirror ? cx - a : cx + a;           // the soft pink of the inner corner (towards the nose)
    const car = g.createRadialGradient(inner, cy, 0, inner, cy, a * 0.32);
    car.addColorStop(0, 'rgba(232,140,160,.75)'); car.addColorStop(1, 'rgba(232,140,160,0)');
    g.fillStyle = car; g.fillRect(inner - a * 0.35, cy - b, a * 0.7, b * 2);
    const low = g.createLinearGradient(0, cy + b * 0.95 * lo, 0, cy + b * 0.2);
    low.addColorStop(0, 'rgba(60,30,80,.35)'); low.addColorStop(1, 'rgba(60,30,80,0)');
    g.fillStyle = low; g.fillRect(cx - a, cy, a * 2, b * 1.2);
    // the iris: the dream itself, curved, with fibres and a dark ring
    const R = Math.min(a * 0.5, b * 1.02), ix = cx + p.gx * a * 0.34 * (mirror ? 0.96 : 1), iy = cy + p.gy * b * 0.32;
    g.save();
    g.beginPath(); g.arc(ix, iy, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = `rgb(${r * 0.6 | 0},${gg * 0.6 | 0},${bl * 0.6 | 0})`; g.fillRect(ix - R, iy - R, R * 2, R * 2);
    p.iris(ix, iy, R);                                 // a world of its own, and whoever is mirrored in it
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.75;
    g.drawImage(p.fib, ix - R, iy - R, R * 2, R * 2);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const limb = g.createRadialGradient(ix, iy, R * 0.72, ix, iy, R);
    limb.addColorStop(0, 'rgba(12,6,24,0)'); limb.addColorStop(1, 'rgba(12,6,24,.9)');
    g.fillStyle = limb; g.fillRect(ix - R, iy - R, R * 2, R * 2);
    // the pupil, wide in the dark, small in the light – and now and then a cat's slit, a heart, a star, a spiral
    const pr = R * p.pupil;
    if (p.pupilMix < 0.99) {
      const pu = g.createRadialGradient(ix, iy, pr * 0.6, ix, iy, pr * 1.08);
      pu.addColorStop(0, '#030207'); pu.addColorStop(0.9, '#06040c'); pu.addColorStop(1, 'rgba(6,4,12,0)');
      g.globalAlpha = 1 - p.pupilMix; g.fillStyle = pu; g.beginPath(); g.arc(ix, iy, pr * 1.08, 0, Math.PI * 2); g.fill();
    }
    if (p.pupilMix > 0.01) { g.globalAlpha = p.pupilMix; p.pupilShape(ix, iy, pr, R); }
    g.globalAlpha = 1;
    // highlights: a soft window and a small spark
    g.globalCompositeOperation = 'screen';
    const hx = ix - R * 0.36, hy = iy - R * 0.38;
    const hl = g.createRadialGradient(hx, hy, 0, hx, hy, R * 0.34);
    hl.addColorStop(0, 'rgba(255,255,255,.95)'); hl.addColorStop(0.45, 'rgba(255,255,255,.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl; g.beginPath(); g.ellipse(hx, hy, R * 0.34, R * 0.24, -0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(ix + R * 0.32, iy + R * 0.26, R * 0.055, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.restore();
    // the lid's shadow on the eye
    const sh = g.createLinearGradient(0, cy - b * 1.3 * up, 0, cy - b * 0.2);
    sh.addColorStop(0, 'rgba(20,8,30,.55)'); sh.addColorStop(1, 'rgba(20,8,30,0)');
    g.fillStyle = sh; g.fillRect(cx - a, cy - b * 1.5, a * 2, b * 1.4);
    g.restore();
    // the lid's fold, a winged liner, full curled lashes above and a few fine ones below
    g.lineCap = 'round';
    g.strokeStyle = `rgba(150,120,190,${0.1 + 0.12 * up})`; g.lineWidth = Math.max(1.5, a * 0.016);
    g.beginPath(); g.moveTo(cx - a * 0.72, (yL + cy) / 2 - b * (0.5 + 0.35 * up));
    g.bezierCurveTo(cx - a * 0.3, cy - b * (1.2 + 0.5 * up), cx + a * 0.3, cy - b * (1.2 + 0.5 * up), cx + a * 0.72, (yR + cy) / 2 - b * (0.5 + 0.35 * up)); g.stroke();
    // the liner: thin at the inner corner, fuller towards the outer one, ending in a little wing
    g.fillStyle = '#1e0f29'; g.beginPath();
    for (let k = 0; k <= 24; k++) { const u = k / 24; g.lineTo(upX(u), upY(u)); }
    for (let k = 24; k >= 0; k--) { const u = k / 24, outerness = o > 0 ? u : 1 - u; g.lineTo(upX(u), upY(u) - a * (0.012 + 0.045 * L.liner * outerness * outerness)); }
    g.closePath(); g.fill();
    const wx = cx + o * a, wu = o > 0 ? 0.8 : 0.2;
    if (L.wing > 0.02) {
      g.beginPath(); g.moveTo(wx - o * a * 0.02, yOut + b * 0.02); g.quadraticCurveTo(wx + o * a * 0.14 * L.wing, yOut - b * 0.12 * L.wing, wx + o * a * 0.3 * L.wing, yOut - b * 0.5 * L.wing);
      g.quadraticCurveTo(wx + o * a * 0.08 * L.wing, yOut - b * 0.3 * L.wing, upX(wu), upY(wu) - a * 0.05 * L.wing); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(36,19,47,.45)'; g.lineWidth = Math.max(1, a * 0.014);
    g.beginPath(); for (let k = 2; k <= 22; k++) { const u = k / 24; g[k > 2 ? 'lineTo' : 'moveTo'](upX(u), loY(u)); } g.stroke();
    // lashes: twelve above, longer and more curled towards the outer corner
    g.fillStyle = '#1e0f29';
    const lash = (x, y, len, w, dx, dy) => {           // a fine blade curling up and outward
      g.beginPath(); g.moveTo(x - w, y);
      g.quadraticCurveTo(x + dx * len * 0.15 - w * 0.3, y + dy * len * 0.75, x + dx * len, y + dy * len * 0.95);
      g.quadraticCurveTo(x + dx * len * 0.35 + w * 0.3, y + dy * len * 0.6, x + w, y);
      g.closePath(); g.fill();
    };
    for (let i = 0; i < 11; i++) {
      const u = 0.24 + i * 0.07, uu = o > 0 ? u : 1 - u, outerness = (u - 0.24) / 0.7;
      const len = a * (0.08 + 0.3 * Math.pow(outerness, 1.3)) * L.lashes * (0.45 + 0.55 * up);
      lash(upX(uu), upY(uu) - a * 0.012, len, a * (0.016 + 0.016 * outerness), o * (0.15 + 1.25 * L.curl * outerness * outerness), -1);
    }
    for (let i = 0; i < 5; i++) {                      // and a few fine ones below, on the outer half
      const u = 0.6 + i * 0.08, uu = o > 0 ? u : 1 - u;
      lash(upX(uu), loY(uu) + a * 0.008, a * (0.04 + 0.03 * i / 4) * L.lower, a * 0.01, o * (0.3 + 0.4 * i / 4), 1);
    }
    return [ix, iy];
  }
  // What is in an iris: the dream itself ('dream'), folded ('kaleido'), a tunnel ('vortex'), a 'galaxy', 'fire' or its
  // 'embers'. o: rot (how far it has turned), hue (the dream's), stars (stars()), heat (how high the flames stand,
  // 0–1; 1 if not given), and pic(x, y, size, al), which draws the dream's picture as a square around (x, y)
  function irisWorld(g, style, ix, iy, R, mirror, al, o) {
    const dir = mirror ? -1 : 1;
    g.save(); g.translate(ix, iy);
    if (style === 'fire') {                            // #162: flames dancing in the iris, the dream glowing warm behind them
      g.globalAlpha = al; g.fillStyle = '#2a0a02'; g.fillRect(-R, -R, R * 2, R * 2);
      g.filter = 'sepia(0.6) saturate(2.2) hue-rotate(-15deg)'; o.pic(0, 0, R * 2.3, al * 0.55); g.filter = 'none';
      const now = performance.now(), heat = o.heat === undefined ? 1 : o.heat;
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 9; k++) {
        const fx0 = (k / 8 - 0.5) * R * 1.6, h = R * (0.7 + 0.5 * Math.sin(now / (130 + k * 17) + k * 2)) * heat, wv = Math.sin(now / 160 + k) * R * 0.12;
        const gr = g.createLinearGradient(0, R, 0, R - h);
        gr.addColorStop(0, `rgba(255,${120 + k * 8},20,${0.7 * al})`); gr.addColorStop(0.6, `rgba(255,200,60,${0.45 * al})`); gr.addColorStop(1, 'rgba(255,240,180,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(fx0 - R * 0.18, R);
        g.quadraticCurveTo(fx0 - R * 0.2 + wv, R - h * 0.5, fx0 + wv * 1.6, R - h); g.quadraticCurveTo(fx0 + R * 0.2 + wv, R - h * 0.5, fx0 + R * 0.18, R); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    } else if (style === 'embers') {                   // #218: embers drifting up in the iris – a fire they dream of, or are used to
      g.globalAlpha = al; g.fillStyle = '#1c0703'; g.fillRect(-R, -R, R * 2, R * 2);
      o.pic(0, 0, R * 2.3, al * 0.22);
      g.globalAlpha = al * 0.4; g.fillStyle = '#7a1e00'; g.fillRect(-R, -R, R * 2, R * 2);   // the dream, warmed (no filter: cheap)
      const now = performance.now();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 14; k++) {
        const u = (now / (2600 + k * 310) + k * 0.37) % 1, tw = 0.6 + 0.4 * Math.sin(now / 170 + k * 1.9);
        g.globalAlpha = al * Math.sin(Math.PI * u) * tw; g.fillStyle = `hsl(${18 + k * 2.5},100%,${55 + 12 * tw}%)`;
        g.beginPath(); g.arc(Math.sin(k * 2.4 + now / 900 + u * 3) * R * 0.75, R * (0.95 - 1.9 * u), R * (0.035 + 0.03 * ((k * 7) % 5) / 4), 0, Math.PI * 2); g.fill();
      }
      const bed = g.createLinearGradient(0, R, 0, R * 0.2);     // the bed of embers below
      bed.addColorStop(0, `rgba(255,110,25,${0.6 * al})`); bed.addColorStop(1, 'rgba(255,80,10,0)');
      g.globalAlpha = 1; g.fillStyle = bed; g.fillRect(-R, R * 0.2, R * 2, R * 0.8);
      g.globalCompositeOperation = 'source-over';
    } else if (style === 'kaleido') {                         // the dream folded eightfold, turning
      for (let k = 0; k < 8; k++) {
        g.save(); g.rotate(k * Math.PI / 4 + o.rot * dir); if (k % 2) g.scale(1, -1);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(R * 1.3, 0); g.lineTo(R * 1.3 * Math.cos(Math.PI / 4), R * 1.3 * Math.sin(Math.PI / 4)); g.closePath(); g.clip();
        o.pic(R * 0.45, R * 0.2, R * 1.6, al); g.restore();
      }
    } else if (style === 'vortex') {                   // a tunnel of the dream: rings turning against each other, a spiral drawing in
      for (let j = 0; j < 5; j++) {
        g.save(); g.rotate(o.rot * dir * (j % 2 ? -2.2 : 1.6) * (1 + j * 0.6)); g.beginPath(); g.arc(0, 0, R * (1 - j * 0.19), 0, Math.PI * 2); g.clip();
        o.pic(0, 0, R * 2.4 * (1 - j * 0.19), al); g.restore();
      }
      const turn = performance.now() / 700 * dir;
      g.strokeStyle = `hsla(${o.hue + 180},90%,70%,${0.55 * al})`; g.lineWidth = R * 0.05;
      for (const arm of [0, Math.PI]) { g.beginPath(); for (let k = 0; k <= 50; k++) { const u = k / 50, an = turn + arm + u * Math.PI * 4, rr = u * R; g[k ? 'lineTo' : 'moveTo'](Math.cos(an) * rr, Math.sin(an) * rr); } g.stroke(); }
    } else if (style === 'galaxy') {                   // a spiral galaxy in the dream's colours, the dream shining through
      g.globalAlpha = al; g.fillStyle = '#0a0618'; g.fillRect(-R, -R, R * 2, R * 2);
      g.rotate(o.rot * dir * 0.6); o.pic(0, 0, R * 2.3, al * 0.18);
      const hue = o.hue;
      const core = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.55);
      core.addColorStop(0, `hsla(${hue + 30},90%,85%,${0.8 * al})`); core.addColorStop(1, `hsla(${hue},90%,50%,0)`);
      g.globalAlpha = 1; g.fillStyle = core; g.fillRect(-R, -R, R * 2, R * 2);
      for (const [rr, ang, b] of o.stars) {
        const sp = ang + rr * 4.2, x = Math.cos(sp) * rr * R * 0.98, y = Math.sin(sp) * rr * R * 0.98;
        g.globalAlpha = al * b * (0.5 + 0.5 * Math.sin(performance.now() / 300 + ang * 7));
        g.fillStyle = `hsl(${hue + rr * 120},90%,${70 + 25 * (1 - rr)}%)`;
        g.beginPath(); g.arc(x, y, R * (0.02 + 0.03 * (1 - rr)), 0, Math.PI * 2); g.fill();
      }
    } else {                                           // the dream itself, curved (larger than the iris)
      g.rotate(o.rot * dir); o.pic(0, 0, R * 2.3, al);
    }
    g.restore();
  }
  // #218: what a hypnotic pupil shows – nearly always the spiral, one time in four another shimmer, and of those
  // never the same twice in a row
  const HYPNO = ['spiral', 'mandala', 'sparkle', 'tunnel', 'swirl'];
  const OTHER_SHARE = 0.25;
  // the next one: lastOther is the last shape shown that was not the spiral (or null)
  const nextHypno = (lastOther, rnd) => {
    if (rnd() >= OTHER_SHARE) return 'spiral';
    const o = HYPNO.filter(k => k !== 'spiral' && k !== lastOther);
    return o[Math.min(o.length - 1, rnd() * o.length | 0)];
  };
  // … and where there is no memory (the dream windows: every window works it out from Dream's clock): the n-th one
  const hypnoAt = (n, seed) => HYPNO[(((3 * n + seed) % HYPNO.length) + HYPNO.length) % HYPNO.length];
  const rings = new Map();                             // a soft ring of light, one per 10° of hue (drawn once, then stamped)
  const ring = hue => {
    const k = ((Math.round(hue / 10) % 36) + 36) % 36;
    if (!rings.has(k)) rings.set(k, softLight([[0.5, `hsla(${k * 10},70%,70%,0)`], [0.76, `hsla(${k * 10},70%,72%,1)`], [1, `hsla(${k * 10 + 30},70%,60%,0)`]], 128));
    return rings.get(k);
  };
  // A pupil that is not round: a cat's 'slit', a 'heart', a 'star', or one of HYPNO – a 'spiral', or a soft shimmer:
  // a 'mandala' (lights turning, breathing), a 'sparkle' (lights sinking like snow), a 'tunnel' (rings into the depth), a 'swirl'.
  // o: hue (the dream's), fire (it burns), beat (0–1: the music's pulse, they move with it), now (a clock, if not the page's)
  function pupilShape(g, shape, x, y, pr, R, mirror, o) {
    g.fillStyle = '#05030a';
    g.beginPath();
    if (shape === 'slit') {                            // a cat's slit – it comes with the grin
      g.ellipse(x, y, pr * 0.3, Math.min(R * 0.92, pr * 1.6), 0, 0, Math.PI * 2);
    } else if (shape === 'heart') {
      const s = pr * 1.15, yy = y - s * 0.25;
      g.moveTo(x, yy + s * 0.95);
      g.bezierCurveTo(x - s * 1.25, yy + s * 0.15, x - s * 0.7, yy - s * 0.85, x, yy - s * 0.25);
      g.bezierCurveTo(x + s * 0.7, yy - s * 0.85, x + s * 1.25, yy + s * 0.15, x, yy + s * 0.95);
    } else if (shape === 'star') {
      const rot = performance.now() / 900 * (mirror ? -1 : 1);
      for (let k = 0; k < 10; k++) { const rr = k % 2 ? pr * 0.5 : pr * 1.2, an = rot + k * Math.PI / 5 - Math.PI / 2; g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); }
      g.closePath();
    } else {
      g.arc(x, y, pr * 1.02, 0, Math.PI * 2);
    }
    g.fill();
    const now = o.now === undefined ? performance.now() : o.now, beat = o.beat || 0, dir = mirror ? -1 : 1, hue = o.hue + 180;
    // the shimmers: soft lights (stamped, no filter), half transparent, gently breathing – more a glow in the pupil than a sign
    if (shape === 'mandala' || shape === 'sparkle' || shape === 'tunnel' || shape === 'swirl') {
      const al = g.globalAlpha, br = 0.9 + 0.1 * Math.sin(now / 1300) + 0.12 * beat, soft = (0.42 + 0.14 * beat) * al;
      g.save(); g.globalCompositeOperation = 'screen';
      g.beginPath(); g.arc(x, y, pr * 1.02, 0, Math.PI * 2); g.clip();
      if (shape === 'mandala') {                       // two rings of lights turning against each other
        for (const [n, rr, sp, hh, sz] of [[6, 0.56, 1, 0, 0.42], [6, 0.26, -1.5, 50, 0.3]]) for (let k = 0; k < n; k++) {
          const an = now / 3200 * sp * dir + k * Math.PI * 2 / n;
          stamp(g, tinted(hue + hh + now * 0.01), x + Math.cos(an) * pr * rr * br, y + Math.sin(an) * pr * rr * br, pr * sz * br, soft);
        }
      } else if (shape === 'sparkle') {                // soft lights sinking through the pupil like slow snow
        for (let k = 0; k < 9; k++) {
          const u = (now / (3200 + k * 230) + k * 0.618) % 1, yy = (u * 2 - 1) * 0.95, tw = 0.6 + 0.4 * Math.sin(now / 420 + k * 2.3);
          stamp(g, tinted(hue + k * 12), x + (((k * 0.381) % 1) * 2 - 1) * 0.8 * pr + Math.sin(now / 900 + k) * pr * 0.06, y + yy * pr, pr * (0.24 + 0.12 * ((k * 5) % 4) / 3) * br, soft * Math.sin(Math.PI * u) * tw);
        }
      } else if (shape === 'tunnel') {                 // soft rings sinking into the depth, one after the other
        for (let k = 0; k < 4; k++) {
          const u = ((k + now / 1100) % 4) / 4, rr = pr * 1.05 * Math.pow(1 - u, 1.5) * br;
          stamp(g, ring(hue + u * 60), x, y, Math.max(1, rr), soft * 1.2 * (1 - u) * Math.min(1, u * 5));
        }
      } else {                                         // three arms of light turning like a slow whirlpool
        const turn = -now / 1100 * dir;
        for (let arm = 0; arm < 3; arm++) for (let k = 0; k < 5; k++) {
          const u = k / 4, an = turn + arm * Math.PI * 2 / 3 + u * 2.2, rr = (0.14 + 0.66 * u) * pr * br;
          stamp(g, tinted(hue + arm * 30), x + Math.cos(an) * rr, y + Math.sin(an) * rr, pr * (0.2 + 0.2 * u), soft * (0.5 + 0.5 * u));
        }
      }
      g.restore(); g.globalAlpha = al;
    }
    if (shape === 'spiral') {                          // hypnosis: a turning spiral in the pupil
      const turn = now / 260 * (mirror ? -1 : 1);
      g.strokeStyle = `hsl(${o.hue + 180},90%,72%)`; g.lineWidth = Math.max(1.5, pr * (0.1 + 0.05 * beat)); g.beginPath();
      for (let k = 0; k <= 80; k++) { const u = k / 80, an = turn + u * Math.PI * 7, rr = u * pr * 0.95; g[k ? 'lineTo' : 'moveTo'](x + Math.cos(an) * rr, y + Math.sin(an) * rr); }
      g.stroke();
    }
    if (shape === 'heart' || shape === 'star') {       // these glow a little – a heart for fire glows like embers and beats
      g.globalCompositeOperation = 'screen';
      const beat = o.fire ? 0.75 + 0.25 * Math.sin(performance.now() / 140) : 1;
      g.fillStyle = `hsla(${shape === 'heart' ? (o.fire ? 18 : 340) : 48},95%,${o.fire ? 58 : 65}%,${o.fire ? 0.75 * beat : 0.35})`; g.beginPath(); g.arc(x, y, pr * (o.fire ? 0.75 * beat : 0.5), 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
  }

  root.DreamEye = { LOOKS, EMO, HYPNO, nextHypno, hypnoAt, fibres, stars, draw, irisWorld, pupilShape };
})(typeof window !== 'undefined' ? window : globalThis);
