/* Dream – the first style world: today's look (#221). Glowing lines with a soft halo, soft lights, the dream's
   colours all around the wheel. It is put together from what Dream drew before there were worlds, unchanged
   (tests/js/style.test.mjs compares pictures): the eye (static/dreameye.js), what lives around the eyes and in the
   windows (static/dreamlife.js), and – here – the faces of light around the eyes and the large motifs of the dream
   windows. Every other world falls back to this one for what it does not draw itself (static/dreamstyle.js). */
(function (root) {
  'use strict';
  const { DreamBrush, DreamVis, DreamLife, DreamEye, DreamStyle } = root;
  const { lerp, night, kaleido } = DreamBrush;
  const ease = x => x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;

  // ---------- the faces of light (Dreamy Eyes) ----------
  // #157: faces only hinted, drawn in light around the eyes – the eyes become theirs; the dream fills the lines.
  // #220: every line belongs to a part of the face and shows as far as the rule lets that part show (v): the sign on
  // the forehead with the hints; hair, outline, mouth and nose rarely, and clearly then. A face has one size – the
  // eyes' (A, half): it is never pressed into the screen, and what has no room on a wide, low screen runs off its edge
  // geo: where the eyes are, in c's pixels – cx, ey (the middle between them), A (half an eye's width), half (half the
  // distance between them) and q (c's pixels per pixel of the screen)
  function face(c, mode, t, geo, v, ink = 'rgba(255,255,255,', inkAl = 1) {
    const mark = DreamVis.of(v, 'mark'), hair = DreamVis.of(v, 'hair'), outline = DreamVis.of(v, 'outline'), mouth = DreamVis.of(v, 'mouth'), nose = DreamVis.of(v, 'nose');
    const { cx, ey, A, half, q } = geo;
    const line = (draw, wd, al) => {                   // every line twice: a wide soft glow and a fine bright core
      if (al > 0.004) for (const [k, aa] of [[3.2, al * 0.3], [1, al]]) { c.lineWidth = wd * k; c.strokeStyle = `${ink}${aa * inkAl})`; c.beginPath(); draw(); c.stroke(); }
    };
    c.lineCap = 'round'; c.lineJoin = 'round';
    const wd = Math.max(A * 0.07, 4.5 * q), sway = Math.sin(t / 1800);   // never hair-thin on a small upright screen
    // Nothing of a face lies on the eyes: above `lid` the lids, lashes and brows are clear; what sits on the head over
    // the eyes rests on that line at the lowest (`over`); and what stands on the head – ears, a crown – is as large as
    // the room above it allows (`tall`: 0.4–1), smaller as a whole, never flatter.
    const lid = ey - A * 1.12;
    const over = (x, y) => Math.abs(x - cx) < half + A * 1.2 ? Math.min(y, lid) : y;
    const tall = y => Math.max(0.4, Math.min(1, (y - 4) / (A * 1.25)));
    const dot = (x, y, r, al) => {                     // a small light with a soft halo – spores, sparkles, drops
      if (al > 0.004) for (const [k, aa] of [[2.6, al * 0.28], [1, al]]) { c.fillStyle = `${ink}${aa * inkAl})`; c.beginPath(); c.arc(x, y, r * k, 0, Math.PI * 2); c.fill(); }
    };
    if (mode === 'goddess') {                          // a beautiful goddess: face, flowing hair, a diadem of light, lips
      const fy = ey + A * 0.75, rx = half + A * 1.45, ry = A * 2.7;
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.12, Math.PI * 0.88), wd, 0.85 * outline);   // jaw and cheeks
      for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) {                                         // hair falling in waves
        const sx = cx + sd * (rx * 0.35 + k * A * 0.22), sy = over(sx, fy - ry * 0.95 + k * A * 0.08);
        line(() => { c.moveTo(sx, sy); c.bezierCurveTo(sx + sd * rx * 0.9, sy + A * 0.05, sx + sd * rx * (0.6 + 0.15 * Math.sin(t / 1500 + k)), sy + ry * 1.1, sx + sd * rx * (1.05 + 0.1 * sway), sy + ry * 1.9); }, wd * 0.7, 0.6 * hair);
      }
      for (let k = -4; k <= 4; k++) {                  // a diadem: rays of light above the brow
        const an = -Math.PI / 2 + k * 0.17, ix = cx + Math.cos(an) * ry * 0.78, iy = over(ix, fy + Math.sin(an) * ry * 1.02) - A * 0.08;
        const len = A * (0.6 + 0.12 * Math.sin(t / 600 + k) - Math.abs(k) * 0.05) * tall(iy);
        line(() => { c.moveTo(ix, iy); c.lineTo(ix + Math.cos(an) * len, iy + Math.sin(an) * len); }, wd * 0.8, 0.9 * mark);
      }
      const ly = ey + A * 1.55, lw = A * 0.55;        // lips, closed
      line(() => { c.moveTo(cx - lw, ly); c.quadraticCurveTo(cx - lw * 0.4, ly - A * 0.18, cx, ly - A * 0.05); c.quadraticCurveTo(cx + lw * 0.4, ly - A * 0.18, cx + lw, ly); c.quadraticCurveTo(cx, ly + A * 0.32, cx - lw, ly); }, wd * 0.8, 0.7 * mouth);
      line(() => { c.moveTo(cx, ey + A * 0.15); c.quadraticCurveTo(cx - A * 0.1, ey + A * 0.75, cx - A * 0.16, ey + A * 0.95); }, wd * 0.6, 0.6 * nose);   // the line of the nose
    } else if (mode === 'cat') {                       // a cat: ears, a wide soft face, nose, whiskers that twitch
      const fy = ey + A * 0.45, rx = half + A * 1.6, ry = A * 2.1;
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.05, Math.PI * 0.95), wd, 0.85 * outline);
      for (const sd of [-1, 1]) {
        const bx = cx + sd * rx * 0.62, by = over(bx, fy - ry * 0.78) - A * 0.05, E = A * tall(by), tip = Math.sin(t / 2200 + sd) * E * 0.12;   // the ears stand on the brow line
        line(() => { c.moveTo(bx - sd * E * 0.75, by); c.lineTo(bx + sd * E * 0.25 + tip, by - E * 1.25); c.lineTo(bx + sd * E * 0.95, by + E * 0.1); }, wd, 0.85 * mark);
        line(() => { c.moveTo(bx - sd * E * 0.35, by - E * 0.08); c.lineTo(bx + sd * E * 0.22 + tip, by - E * 0.8); c.lineTo(bx + sd * E * 0.6, by - E * 0.02); }, wd * 0.6, 0.65 * mark);
        for (let k = 0; k < 3; k++) {                  // whiskers
          const wy = ey + A * (1.0 + k * 0.18), tw = Math.sin(t / 300 + k * 2 + sd) * A * 0.06;
          line(() => { c.moveTo(cx + sd * A * 0.45, wy); c.quadraticCurveTo(cx + sd * A * 1.6, wy - A * 0.1 + tw, cx + sd * A * (2.6 + k * 0.2), wy + (k - 1) * A * 0.35 + tw); }, wd * 0.45, 0.7 * outline);
        }
      }
      const ny = ey + A * 0.85;                        // nose and the little ω of the mouth
      line(() => { c.moveTo(cx - A * 0.18, ny); c.lineTo(cx + A * 0.18, ny); c.lineTo(cx, ny + A * 0.2); c.closePath(); }, wd * 0.7, 0.8 * nose);
      line(() => { c.moveTo(cx, ny + A * 0.2); c.quadraticCurveTo(cx - A * 0.1, ny + A * 0.45, cx - A * 0.32, ny + A * 0.35); c.moveTo(cx, ny + A * 0.2); c.quadraticCurveTo(cx + A * 0.1, ny + A * 0.45, cx + A * 0.32, ny + A * 0.35); }, wd * 0.6, 0.7 * mouth);
    } else if (mode === 'mermaid') {                   // a mermaid: hair flowing like waves, a crown of shells, scales on her cheeks
      const fy = ey + A * 0.7, rx = half + A * 1.35, ry = A * 2.5;
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.12, Math.PI * 0.88), wd, 0.85 * outline);
      for (const sd of [-1, 1]) for (let k = 0; k < 5; k++) {   // hair drifting like seaweed in a current
        const sx = cx + sd * rx * (0.3 + k * 0.12), sy = over(sx, fy - ry * 0.9) - k * A * 0.05;
        line(() => { c.moveTo(sx, sy); for (let j = 1; j <= 16; j++) { const u = j / 16; c.lineTo(sx + sd * (rx * 0.5 + rx * 0.9 * u), sy + ry * 2.1 * u + Math.sin(t / 700 + u * 7 + k) * A * 0.3 * u); } }, wd * 0.7, 0.6 * hair);
      }
      for (let k = -3; k <= 3; k++) {                  // a crown of shells: little fans above the brow
        const an = -Math.PI / 2 + k * 0.2, bx = cx + Math.cos(an) * rx * 0.72, by = over(bx, fy + Math.sin(an) * ry * 1.02) - A * 0.3, r = A * (0.3 - Math.abs(k) * 0.03);
        line(() => { for (let j = 0; j <= 4; j++) { const a2 = Math.PI * (1.1 + j * 0.2); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a2) * r, by + Math.sin(a2) * r); } c.moveTo(bx - r, by); c.arc(bx, by, r, Math.PI, Math.PI * 2); }, wd * 0.55, 0.9 * mark);
      }
      for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) {   // scales on the cheekbones
        const sx = cx + sd * (half + A * (0.2 + (k % 2) * 0.25)), sy = ey + A * (0.75 + k * 0.22);
        line(() => c.arc(sx, sy, A * 0.14, Math.PI * 0.1, Math.PI * 0.9), wd * 0.6, 0.85 * outline);
      }
      const ly = ey + A * 1.55, lw = A * 0.5;
      line(() => { c.moveTo(cx - lw, ly); c.quadraticCurveTo(cx, ly - A * 0.2, cx + lw, ly); c.quadraticCurveTo(cx, ly + A * 0.3, cx - lw, ly); }, wd * 0.8, 0.7 * mouth);
    } else if (mode === 'forest') {                    // a forest spirit: a crown of leaves, vines framing the eyes, a leaf on the brow, spores – no mouth
      const fy = ey + A * 0.75, rx = half + A * 1.25, ry = A * 2.4;
      for (const [a0, a1] of [[0.12, 0.36], [0.64, 0.88]]) line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * a0, Math.PI * a1), wd, 0.8 * outline);   // only the cheeks: no chin line that could read as a mouth
      const leaf = (bx, by, an, len, wide, w, al) => {   // one leaf: two curves and its rib
        const tx = bx + Math.cos(an) * len, ty = by + Math.sin(an) * len, mx = (bx + tx) / 2, my = (by + ty) / 2, nx = -Math.sin(an) * wide, ny = Math.cos(an) * wide;
        line(() => { c.moveTo(bx, by); c.quadraticCurveTo(mx + nx, my + ny, tx, ty); c.quadraticCurveTo(mx - nx, my - ny, bx, by); c.moveTo(bx, by); c.lineTo(bx + (tx - bx) * 0.8, by + (ty - by) * 0.8); }, w, al);
      };
      for (let k = -4; k <= 4; k++) {                  // the crown: leaves fanning out above the brow, stirring as in a breeze
        const an = -Math.PI / 2 + k * 0.24, bx = cx + Math.cos(an) * rx * 0.8, by = over(bx, fy + Math.sin(an) * ry * 0.98) - A * 0.06, th = tall(by);
        leaf(bx, by, an + k * 0.07 + 0.1 * Math.sin(t / 1400 + k * 1.3), A * (1.15 - Math.abs(k) * 0.09) * (k % 2 ? 0.8 : 1) * th, A * 0.42 * th, wd * 0.6, 0.9 * mark);
      }
      leaf(cx, ey - A * 0.12, -Math.PI / 2 + 0.06 * sway, A * 0.46, A * 0.2, wd * 0.55, (0.7 + 0.2 * Math.sin(t / 1100)) * mark);   // a leaf on the brow, softly glowing
      for (const sd of [-1, 1]) {                       // vines down both sides of the eyes, ending in a curl, a few leaves on them
        const vx = cx + sd * (half + A * 1.35), vy = ey - A * 0.55, wv = k => Math.sin(t / 1700 + k * 1.9 + sd) * A * 0.07;
        const at = u => [vx + sd * (A * 0.5 * Math.sin(u * Math.PI) + A * 0.14 * Math.sin(u * 9)) + wv(u * 3) * u, vy + ry * 1.25 * u];
        line(() => { c.moveTo(vx, vy); for (let j = 1; j <= 14; j++) { const [px, py] = at(j / 14); c.lineTo(px, py); } }, wd * 0.6, 0.65 * hair);
        const [ex, eY] = at(1);
        line(() => { for (let j = 0; j <= 12; j++) { const an = j / 12 * Math.PI * 2.6, rr = A * 0.26 * (1 - j / 14); c.lineTo(ex - sd * (A * 0.26 - Math.cos(an) * rr), eY + Math.sin(an) * rr); } }, wd * 0.5, 0.6 * hair);
        for (let k = 1; k <= 3; k++) { const [lx, ly] = at(k * 0.24); leaf(lx, ly, Math.PI / 2 - sd * (1.15 - 0.15 * k) + 0.12 * Math.sin(t / 1200 + k + sd), A * 0.5, A * 0.2, wd * 0.5, 0.8 * hair); }
      }
      for (let k = 0; k < 9; k++) {                    // glowing spores drifting upwards, each with a soft halo
        const u = (t / 9000 + k * 0.37) % 1, sx = cx + Math.sin(k * 2.4 + u * 3) * rx * (0.5 + 0.55 * ((k * 7) % 5) / 4), sy = fy + ry * 0.9 - (fy + ry * 0.9 - 8) * u;
        dot(sx, sy, A * (0.06 + 0.035 * (k % 3)), Math.sin(u * Math.PI) * (0.75 + 0.25 * Math.sin(t / 350 + k)) * mark);
      }
    } else if (mode === 'priestess') {                 // a moon priestess: a crescent on her brow, a veil of light, long earrings
      const fy = ey + A * 0.75, rx = half + A * 1.3, ry = A * 2.5;
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.12, Math.PI * 0.88), wd, 0.85 * outline);
      const mr = A * 0.34 * tall(lid), my = Math.min(fy - ry * 0.72, lid - mr * 0.6);   // the crescent, gently glowing, above the brows
      line(() => { c.arc(cx, my, mr, Math.PI * 0.15, Math.PI * 0.85, true); c.arc(cx, my - mr * 0.35, mr * 0.8, Math.PI * 0.8, Math.PI * 0.2); }, wd * 0.8, (0.8 + 0.2 * Math.sin(t / 900)) * mark);
      for (let k = 0; k < 7; k++) {                    // the veil: arcs falling from her brow to her shoulders, swaying
        const u = k / 6, sw = Math.sin(t / 1600 + k * 0.6) * A * 0.15;
        const vx = rx * (0.2 + u * 0.95), vy = over(cx + vx, fy - ry * (0.95 - u * 0.1)) - A * 0.04;
        line(() => { c.moveTo(cx - vx, vy); c.quadraticCurveTo(cx + sw, vy - A * (1.3 - u * 0.5), cx + vx, vy); }, wd * 0.5, 0.55 * hair);
        for (const sd of [-1, 1]) line(() => { const x0 = cx + sd * rx * (0.95 + u * 0.15); c.moveTo(x0, fy - ry * 0.5 + u * ry * 0.3); c.quadraticCurveTo(x0 + sd * A * 0.4 + sw, fy + ry * 0.4, x0 + sd * A * 0.2, fy + ry * (0.9 + u * 0.4)); }, wd * 0.5, 0.55 * hair);
      }
      for (const sd of [-1, 1]) {                       // long earrings: a chain and a drop, swinging
        const ex = cx + sd * rx * 0.97, eY = fy + ry * 0.05, sw = Math.sin(t / 700 + sd) * A * 0.12;
        line(() => { c.moveTo(ex, eY); c.lineTo(ex + sw, eY + A * 0.9); }, wd * 0.5, 0.9 * outline);
        dot(ex + sw, eY + A * 1.05, A * 0.12, 0.95 * outline);
      }
      const ly = ey + A * 1.55, lw = A * 0.5;
      line(() => { c.moveTo(cx - lw, ly); c.quadraticCurveTo(cx - lw * 0.4, ly - A * 0.18, cx, ly - A * 0.05); c.quadraticCurveTo(cx + lw * 0.4, ly - A * 0.18, cx + lw, ly); c.quadraticCurveTo(cx, ly + A * 0.3, cx - lw, ly); }, wd * 0.8, 0.7 * mouth);
    } else {                                           // Medusa: a face and snakes of light writhing from her head
      const fy = ey + A * 0.7, rx = half + A * 1.3, ry = A * 2.4;
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.1, Math.PI * 0.9), wd, 0.85 * outline);
      for (let k = 0; k < 13; k++) {
        const part = k > 3 && k < 9 ? mark : hair;     // the snakes above the brow are her sign, those at the sides her hair
        if (part <= 0.004) continue;
        const an = Math.PI * (1.05 + k / 12 * 0.9), bx = cx + Math.cos(an) * rx * 0.85, by = over(bx, fy + Math.sin(an) * ry * 0.85);
        const len = Math.min(ry * (0.9 + 0.35 * Math.sin(k * 1.7)), (by - 4) / Math.max(0.05, -Math.sin(an)) * 0.92), ph = t / 420 + k * 1.3;   // those reaching up: no longer than the room above
        let hx = bx, hy = by, px = bx, py = by;
        line(() => {
          c.moveTo(bx, by);
          for (let j = 1; j <= 18; j++) {
            const u = j / 18, rr = len * u, wig = Math.sin(ph + u * 9) * A * 0.35 * u;
            px = bx + Math.cos(an) * rr - Math.sin(an) * wig; py = by + Math.sin(an) * rr + Math.cos(an) * wig; c.lineTo(px, py);
          }
          hx = px; hy = py;
        }, wd * 0.9, 0.75 * part);
        c.fillStyle = `${ink}${0.8 * part * inkAl})`; c.beginPath(); c.ellipse(hx, hy, A * 0.14, A * 0.09, an, 0, Math.PI * 2); c.fill();   // its head
      }
    }
  }

  const FACES = ['goddess', 'cat', 'medusa', 'mermaid', 'forest', 'priestess'];

  // ---------- the large motifs of a dream window ----------
  // Each is drawn into c around the window's middle; m is what Dream said (kind, seed), with its own memory. o is what
  // the window hands over: W, H, mid ([x, y]: the middle, floating a little), pulse (the beat, 0–1), hue (the dream's),
  // pic (a small square copy of the dream), tier (2 all of it, 1 less, 0 the least: a weak device), softPiece(c, t,
  // paint, x, y, r, al) (a round piece with a dissolved edge) and eye(c, m, dt, x, y, a, look) (the world's eye, alive).
  // --- the third eye: an eye in a triangle of light, a mandala turning behind it. In trance it opens in every window
  function third(c, m, t, dt, o) {
    const { W, H } = o;
    const [cx, cy0] = o.mid, R = Math.min(W, H) * 0.44 * (1 + 0.02 * o.pulse), cy = cy0 + R * 0.12, hue = o.hue;
    night(c, cx, cy, R * 1.2, 0.6);
    c.save(); c.globalCompositeOperation = 'lighter';
    DreamLife.draw(c, { kind: 'mandala', x: cx, y: cy, spin: -1, hue }, t, 0.5, R * 1.2, cy, { H });
    c.lineCap = 'round'; c.lineWidth = Math.max(1, R * 0.014);
    for (let k = 0; k < 24; k++) {                     // rays, breathing
      const an = k * Math.PI / 12 + t / 30000, r0 = R * 1.08, r1 = R * (1.2 + 0.09 * Math.sin(t / 600 + k * 1.9));
      c.strokeStyle = `hsla(${hue + 40 + k * 6},90%,72%,${0.35 + 0.2 * Math.sin(t / 900 + k)})`;
      c.beginPath(); c.moveTo(cx + Math.cos(an) * r0, cy + Math.sin(an) * r0); c.lineTo(cx + Math.cos(an) * r1, cy + Math.sin(an) * r1); c.stroke();
    }
    c.restore(); c.globalAlpha = 1;
    const tri = k => { c.beginPath(); for (let i = 0; i < 3; i++) { const an = -Math.PI / 2 + i * Math.PI * 2 / 3; c.lineTo(cx + Math.cos(an) * R * k, cy + Math.sin(an) * R * k); } c.closePath(); };
    c.save(); tri(1); c.clip();                        // the dream inside the triangle, as in deep water
    c.globalAlpha = 0.6; c.drawImage(o.pic, cx - R, cy - R, R * 2, R * 2); c.globalAlpha = 1;
    c.fillStyle = 'rgba(6,4,14,.45)'; c.fillRect(cx - R, cy - R, R * 2, R * 2);
    c.restore();
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round';
    for (const [w, al] of [[0.07, 0.1], [0.035, 0.22], [0.012, 0.85]]) { c.strokeStyle = `hsla(${hue + 30},95%,72%,${al})`; c.lineWidth = Math.max(1, R * w); tri(1); c.stroke(); }
    c.strokeStyle = `hsla(${hue + 70},90%,70%,.3)`; c.lineWidth = Math.max(1, R * 0.008); tri(0.84); c.stroke();
    c.restore();
    const a = R * 0.33;
    night(c, cx, cy, a * 1.5, 0.75);
    m.mirror = false;
    o.eye(c, m, dt, cx, cy + a * 0.08, a, DreamEye.LOOKS.golden);
  }
  // --- a mandala: the dream folded twelvefold (eightfold on a weak device), petals of light turning over it
  function mandala(c, m, t, dt, o) {
    const { W, H } = o;
    const [cx, cy] = o.mid, R = Math.min(W, H) * 0.47 * (1 + 0.03 * o.pulse), hue = o.hue, ph = (m.seed % 628) / 100;
    night(c, cx, cy, R * 1.12, 0.55);
    o.softPiece(c, t, (sc, n) => kaleido(sc, o.pic, n, t, ph, o.tier ? 12 : 8), cx, cy, R, 1);
    c.save(); c.globalCompositeOperation = 'lighter';
    DreamLife.draw(c, { kind: 'mandala', x: cx, y: cy, spin: 1, hue }, t, 0.9, R * 0.8, cy, { H });
    if (o.tier > 0) DreamLife.draw(c, { kind: 'mandala', x: cx, y: cy, spin: -1.7, hue: hue + 60 }, t, 0.75, R * 0.42, cy, { H });
    if (o.tier > 1) DreamLife.draw(c, { kind: 'bloom', x: cx, y: cy, spin: 1, hue: hue + 120 }, t, 0.8, R * 0.2, cy, { H });
    c.restore(); c.globalAlpha = 1;
  }
  // --- impossible shapes (DreamLife.impossible): slowly turning, every face filled with another part of the dream
  function shape(c, m, t, dt, o) {
    const { W, H } = o;
    const sh = DreamLife.impossible(m.kind), [cx, cy] = o.mid, S = Math.min(W, H) * 0.485 * (1 + 0.025 * o.pulse), hue = o.hue;
    const path = f => { c.beginPath(); for (const [x, y] of f.pts) c.lineTo(x * S, y * S); c.closePath(); };
    night(c, cx, cy, S * 1.15, 0.6);
    c.save(); c.translate(cx, cy); c.rotate((m.seed & 1 ? 1 : -1) * t / 1000 * Math.PI * 2 / 150 + m.seed % 7);   // once around in two and a half minutes
    sh.faces.forEach((f, i) => {
      c.save(); path(f); c.clip();
      const n = S * 3.1, u = 0.5 + 0.14 * Math.sin(i * 2.1 + t / 9000), v = 0.5 + 0.14 * Math.cos(i * 1.3 + t / 11000);
      const fill = al => { c.globalAlpha = al; c.drawImage(o.pic, -u * n, -v * n, n, n); c.globalAlpha = al * Math.min(0.86, f.shade * 1.2); c.fillStyle = '#05030c'; c.fillRect(-S * 1.1, -S * 1.1, S * 2.2, S * 2.2); };
      if (f.fade) {                                    // a face that comes out of nothing: the paradox of the fork
        let x0 = 1e9, x1 = -1e9;
        for (const [x] of f.pts) { x0 = Math.min(x0, x * S); x1 = Math.max(x1, x * S); }
        const cuts = o.tier ? 8 : 4;
        for (let k = 0; k < cuts; k++) { c.save(); c.beginPath(); c.rect(x0 + (x1 - x0) * k / cuts, -S * 1.1, (x1 - x0) / cuts + 0.6, S * 2.2); c.clip(); fill((k + 0.5) / cuts); c.restore(); }
      } else fill(f.glass ? 0.2 : 1);
      c.restore();
    });
    c.globalAlpha = 1; c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round'; c.lineWidth = Math.max(1, S * 0.011);   // edges of light
    sh.faces.forEach((f, i) => { c.strokeStyle = `hsla(${hue + 40 + i * 9 + t * 0.01},90%,74%,${f.fade ? 0.18 : f.glass ? 0.12 : f.wall ? 0.1 : 0.42})`; path(f); c.stroke(); });
    if (sh.path) {                                     // a light walks the stairs – always upwards, never arriving
      const n = sh.path.length, u = (t / 620) % n, k = u | 0, fr = u - k, [ax, ay] = sh.path[k], [bx, by] = sh.path[(k + 1) % n];
      const x = lerp(ax, bx, ease(fr)) * S, y = (lerp(ay, by, ease(fr)) - 0.06 - 0.07 * Math.sin(fr * Math.PI)) * S, r = S * 0.11;
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `hsla(${hue + 60},95%,90%,.95)`); gr.addColorStop(0.3, `hsla(${hue + 40},95%,70%,.5)`); gr.addColorStop(1, `hsla(${hue + 40},95%,60%,0)`);
      c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.restore(); c.globalAlpha = 1;
  }

  DreamStyle.register('classic', {
    eye: { draw: DreamEye.draw, irisWorld: DreamEye.irisWorld, pupilShape: DreamEye.pupilShape },
    life: { draw: DreamLife.draw },
    face: { draw: face, MODES: FACES },
    motif: { third, mandala, penrose: shape, stairs: shape, fork: shape, cube: shape },
  });
})(typeof window !== 'undefined' ? window : globalThis);
