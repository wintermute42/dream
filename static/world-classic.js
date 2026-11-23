/* Dream – the first style world: today's look (#221). Glowing lines with a soft halo, soft lights, the dream's
   colours all around the wheel. It is put together from what Dream drew before there were worlds, unchanged
   (tests/js/style.test.mjs compares pictures): the eye (static/dreameye.js), what lives around the eyes and in the
   windows (static/dreamlife.js), and – here – the faces of light around the eyes and the large motifs of the dream
   windows. Every other world falls back to this one for what it does not draw itself (static/dreamstyle.js). */
(function (root) {
  'use strict';
  const { DreamBrush, DreamVis, DreamLife, DreamEye, DreamStyle } = root;
  const { lerp, night, kaleido, softLight, stamp, tinted } = DreamBrush;
  const ease = x => x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;

  // ---------- the faces of light (Dreamy Eyes) ----------
  // #157: faces only hinted, drawn in light around the eyes – the eyes become theirs; the dream fills the lines.
  // #220: every line belongs to a part of the face and shows as far as the rule lets that part show (v): the sign on
  // the forehead with the hints, hair, outline and mouth rarely and faintly, a nose never
  // geo: where the eyes are, in c's pixels – cx, ey (the middle between them), A (half an eye's width), half (half the
  // distance between them), h (the screen's height) and q (c's pixels per pixel of the screen)
  function face(c, mode, t, geo, v, ink = 'rgba(255,255,255,', inkAl = 1) {
    const mark = DreamVis.of(v, 'mark'), hair = DreamVis.of(v, 'hair'), outline = DreamVis.of(v, 'outline'), mouth = DreamVis.of(v, 'mouth');
    const { cx, ey, A, half, h, q } = geo;
    const line = (draw, wd, al) => {                   // every line twice: a wide soft glow and a fine bright core
      if (al > 0.004) for (const [k, aa] of [[3.2, al * 0.3], [1, al]]) { c.lineWidth = wd * k; c.strokeStyle = `${ink}${aa * inkAl})`; c.beginPath(); draw(); c.stroke(); }
    };
    c.lineCap = 'round'; c.lineJoin = 'round';
    const wd = Math.max(A * 0.07, 4.5 * q), sway = Math.sin(t / 1800);   // never hair-thin on a small upright screen
    const fit = (want, top, bottom) => Math.max(A * 1.2, Math.min(want, top, bottom));   // the face stays on the screen
    // Nothing of a face lies on the eyes: above `lid` the lids, lashes and brows are clear. The head's upper half is as
    // tall as that needs (`up`), whatever the screen leaves for its lower half; what sits on the head over the eyes rests
    // on that line at the lowest (`over`); and a crown is as tall as the room above it allows (`tall`: 0.4–1).
    const lid = ey - A * 1.12;
    const up = (fy, ry) => Math.max(A, Math.min(fy - 4, Math.max(ry, fy - lid + A * 0.1)));
    const over = (x, y) => Math.abs(x - cx) < half + A * 1.2 ? Math.min(y, lid) : y;
    const tall = y => Math.max(0.4, Math.min(1, (y - 4) / (A * 1.25)));
    const dot = (x, y, r, al) => {                     // a small light with a soft halo – spores, sparkles, drops
      if (al > 0.004) for (const [k, aa] of [[2.6, al * 0.28], [1, al]]) { c.fillStyle = `${ink}${aa * inkAl})`; c.beginPath(); c.arc(x, y, r * k, 0, Math.PI * 2); c.fill(); }
    };
    if (mode === 'goddess') {                          // a beautiful goddess: face, flowing hair, a diadem of light, lips
      const fy = ey + A * 0.75, rx = half + A * 1.45, ry = fit(A * 2.7, (fy - 4) / 1.24, (h - fy - 4) / 0.95);
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.12, Math.PI * 0.88), wd, 0.85 * outline);   // jaw and cheeks
      const rt = up(fy, ry);
      for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) {                                         // hair falling in waves
        const sx = cx + sd * (rx * 0.35 + k * A * 0.22), sy = over(sx, fy - rt * 0.95 + k * A * 0.08);
        line(() => { c.moveTo(sx, sy); c.bezierCurveTo(sx + sd * rx * 0.9, sy + A * 0.05, sx + sd * rx * (0.6 + 0.15 * Math.sin(t / 1500 + k)), sy + ry * 1.1, sx + sd * rx * (1.05 + 0.1 * sway), sy + ry * 1.9); }, wd * 0.7, 0.6 * hair);
      }
      for (let k = -4; k <= 4; k++) {                  // a diadem: rays of light above the brow
        const an = -Math.PI / 2 + k * 0.17, ix = cx + Math.cos(an) * rt * 0.78, iy = over(ix, fy + Math.sin(an) * rt * 1.02) - A * 0.08;
        const len = A * (0.6 + 0.12 * Math.sin(t / 600 + k) - Math.abs(k) * 0.05) * tall(iy);
        line(() => { c.moveTo(ix, iy); c.lineTo(ix + Math.cos(an) * len, iy + Math.sin(an) * len); }, wd * 0.8, 0.9 * mark);
      }
      const ly = ey + A * 1.55, lw = A * 0.55;        // lips, closed
      line(() => { c.moveTo(cx - lw, ly); c.quadraticCurveTo(cx - lw * 0.4, ly - A * 0.18, cx, ly - A * 0.05); c.quadraticCurveTo(cx + lw * 0.4, ly - A * 0.18, cx + lw, ly); c.quadraticCurveTo(cx, ly + A * 0.32, cx - lw, ly); }, wd * 0.8, 0.7 * mouth);
    } else if (mode === 'cat') {                       // a cat: ears, a wide soft face, whiskers that twitch
      const fy = ey + A * 0.45, rx = half + A * 1.6, ry = fit(A * 2.1, (fy - A * 1.3 - 4) / 0.78, (h - fy - 4) / 0.98);
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.05, Math.PI * 0.95), wd, 0.85 * outline);
      for (const sd of [-1, 1]) {
        const bx = cx + sd * rx * 0.62, by = over(bx, fy - up(fy, ry) * 0.78) - A * 0.05, eh = tall(by), tip = Math.sin(t / 2200 + sd) * A * 0.12;   // the ears stand on the brow line
        line(() => { c.moveTo(bx - sd * A * 0.75, by); c.lineTo(bx + sd * A * 0.25 + tip, by - A * 1.25 * eh); c.lineTo(bx + sd * A * 0.95, by + A * 0.1); }, wd, 0.85 * mark);
        line(() => { c.moveTo(bx - sd * A * 0.35, by - A * 0.08 * eh); c.lineTo(bx + sd * A * 0.22 + tip, by - A * 0.8 * eh); c.lineTo(bx + sd * A * 0.6, by - A * 0.02); }, wd * 0.6, 0.65 * mark);
        for (let k = 0; k < 3; k++) {                  // whiskers
          const wy = ey + A * (1.0 + k * 0.18), tw = Math.sin(t / 300 + k * 2 + sd) * A * 0.06;
          line(() => { c.moveTo(cx + sd * A * 0.45, wy); c.quadraticCurveTo(cx + sd * A * 1.6, wy - A * 0.1 + tw, cx + sd * A * (2.6 + k * 0.2), wy + (k - 1) * A * 0.35 + tw); }, wd * 0.45, 0.7 * outline);
        }
      }
      const ny = ey + A * 0.85;                        // the little ω of the mouth
      line(() => { c.moveTo(cx, ny + A * 0.2); c.quadraticCurveTo(cx - A * 0.1, ny + A * 0.45, cx - A * 0.32, ny + A * 0.35); c.moveTo(cx, ny + A * 0.2); c.quadraticCurveTo(cx + A * 0.1, ny + A * 0.45, cx + A * 0.32, ny + A * 0.35); }, wd * 0.6, 0.7 * mouth);
    } else if (mode === 'mermaid') {                   // a mermaid: hair flowing like waves, a crown of shells, scales on her cheeks
      const fy = ey + A * 0.7, rx = half + A * 1.35, ry = fit(A * 2.5, (fy - 4) / 1.15, (h - fy - 4) / 0.95);
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.12, Math.PI * 0.88), wd, 0.85 * outline);
      for (const sd of [-1, 1]) for (let k = 0; k < 5; k++) {   // hair drifting like seaweed in a current
        const sx = cx + sd * rx * (0.3 + k * 0.12), sy = over(sx, fy - up(fy, ry) * 0.9) - k * A * 0.05;
        line(() => { c.moveTo(sx, sy); for (let j = 1; j <= 16; j++) { const u = j / 16; c.lineTo(sx + sd * (rx * 0.5 + rx * 0.9 * u), sy + ry * 2.1 * u + Math.sin(t / 700 + u * 7 + k) * A * 0.3 * u); } }, wd * 0.7, 0.6 * hair);
      }
      for (let k = -3; k <= 3; k++) {                  // a crown of shells: little fans above the brow
        const an = -Math.PI / 2 + k * 0.2, bx = cx + Math.cos(an) * rx * 0.72, by = over(bx, fy + Math.sin(an) * up(fy, ry) * 1.02) - A * 0.3, r = A * (0.3 - Math.abs(k) * 0.03);
        line(() => { for (let j = 0; j <= 4; j++) { const a2 = Math.PI * (1.1 + j * 0.2); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a2) * r, by + Math.sin(a2) * r); } c.moveTo(bx - r, by); c.arc(bx, by, r, Math.PI, Math.PI * 2); }, wd * 0.55, 0.9 * mark);
      }
      for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) {   // scales on the cheekbones
        const sx = cx + sd * (half + A * (0.2 + (k % 2) * 0.25)), sy = ey + A * (0.75 + k * 0.22);
        line(() => c.arc(sx, sy, A * 0.14, Math.PI * 0.1, Math.PI * 0.9), wd * 0.6, 0.85 * outline);
      }
      const ly = ey + A * 1.55, lw = A * 0.5;
      line(() => { c.moveTo(cx - lw, ly); c.quadraticCurveTo(cx, ly - A * 0.2, cx + lw, ly); c.quadraticCurveTo(cx, ly + A * 0.3, cx - lw, ly); }, wd * 0.8, 0.7 * mouth);
    } else if (mode === 'forest') {                    // a forest spirit: a crown of leaves, vines framing the eyes, a leaf on the brow, spores – no mouth
      const fy = ey + A * 0.75, rx = half + A * 1.25, ry = fit(A * 2.4, (fy - A * 0.9 - 4) / 1.05, (h - fy - 4) / 0.95);
      for (const [a0, a1] of [[0.12, 0.36], [0.64, 0.88]]) line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * a0, Math.PI * a1), wd, 0.8 * outline);   // only the cheeks: no chin line that could read as a mouth
      const rt = up(fy, ry);
      const leaf = (bx, by, an, len, wide, w, al) => {   // one leaf: two curves and its rib
        const tx = bx + Math.cos(an) * len, ty = by + Math.sin(an) * len, mx = (bx + tx) / 2, my = (by + ty) / 2, nx = -Math.sin(an) * wide, ny = Math.cos(an) * wide;
        line(() => { c.moveTo(bx, by); c.quadraticCurveTo(mx + nx, my + ny, tx, ty); c.quadraticCurveTo(mx - nx, my - ny, bx, by); c.moveTo(bx, by); c.lineTo(bx + (tx - bx) * 0.8, by + (ty - by) * 0.8); }, w, al);
      };
      for (let k = -4; k <= 4; k++) {                  // the crown: leaves fanning out above the brow, stirring as in a breeze
        const an = -Math.PI / 2 + k * 0.24, bx = cx + Math.cos(an) * rx * 0.8, by = over(bx, fy + Math.sin(an) * rt * 0.98) - A * 0.06, th = tall(by);
        leaf(bx, by, an + k * 0.07 + 0.1 * Math.sin(t / 1400 + k * 1.3), A * (1.15 - Math.abs(k) * 0.09) * (k % 2 ? 0.8 : 1) * th, A * 0.42 * Math.max(0.6, th), wd * 0.6, 0.9 * mark);
      }
      leaf(cx, ey - A * 0.12, -Math.PI / 2 + 0.06 * sway, A * 0.46, A * 0.2, wd * 0.55, (0.7 + 0.2 * Math.sin(t / 1100)) * mark);   // a leaf on the brow, softly glowing
      for (const sd of [-1, 1]) {                       // vines down both sides of the eyes, ending in a curl, a few leaves on them
        const vx = cx + sd * (half + A * 1.35), vy = ey - A * 0.55, wv = k => Math.sin(t / 1700 + k * 1.9 + sd) * A * 0.07;
        const at = u => [vx + sd * (A * 0.5 * Math.sin(u * Math.PI) + A * 0.14 * Math.sin(u * 9)) + wv(u * 3) * u, vy + Math.min(ry * 1.25, h - 6 - A * 0.3 - vy) * u];
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
      const fy = ey + A * 0.75, rx = half + A * 1.3, ry = fit(A * 2.5, (fy - 4) / 1.25, (h - fy - 4) / 0.95);
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.12, Math.PI * 0.88), wd, 0.85 * outline);
      const rt = up(fy, ry), mr = A * 0.34 * tall(lid), my = Math.min(fy - rt * 0.72, lid - mr * 0.6);   // the crescent, gently glowing, above the brows
      line(() => { c.arc(cx, my, mr, Math.PI * 0.15, Math.PI * 0.85, true); c.arc(cx, my - mr * 0.35, mr * 0.8, Math.PI * 0.8, Math.PI * 0.2); }, wd * 0.8, (0.8 + 0.2 * Math.sin(t / 900)) * mark);
      for (let k = 0; k < 7; k++) {                    // the veil: arcs falling from her brow to her shoulders, swaying
        const u = k / 6, sw = Math.sin(t / 1600 + k * 0.6) * A * 0.15;
        const vx = rx * (0.2 + u * 0.95), vy = over(cx + vx, fy - rt * (0.95 - u * 0.1)) - A * 0.04;
        line(() => { c.moveTo(cx - vx, vy); c.quadraticCurveTo(cx + sw, Math.max(4 - vy * 0.5, vy - A * (1.3 - u * 0.5) * tall(vy)), cx + vx, vy); }, wd * 0.5, 0.55 * hair);
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
      const fy = ey + A * 0.7, rx = half + A * 1.3, ry = fit(A * 2.4, fy / 0.9, (h - fy - 4) / 0.95);
      line(() => c.ellipse(cx, fy, rx, ry, 0, Math.PI * 0.1, Math.PI * 0.9), wd, 0.85 * outline);
      for (let k = 0; k < 13; k++) {
        const part = k > 3 && k < 9 ? mark : hair;     // the snakes above the brow are her sign, those at the sides her hair
        if (part <= 0.004) continue;
        const an = Math.PI * (1.05 + k / 12 * 0.9), bx = cx + Math.cos(an) * rx * 0.85, by = over(bx, fy + Math.sin(an) * up(fy, ry) * 0.85);
        const len = ry * (0.9 + 0.35 * Math.sin(k * 1.7)) * (1 - (1 - tall(by)) * Math.abs(Math.sin(an))), ph = t / 420 + k * 1.3;   // those reaching up: as long as the room above
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

  // ---------- the night behind Dreamy Eyes: where the dream may shine through (#222: moved here from eyes.html) ----------
  // white into bk (w×h) where the dream shows: soft 'clouds' drifting sideways, a 'fractal' (a huge sunflower spiral of
  // soft lights), a 'pattern' (a kaleidoscopic flower of rings and petals). o: clouds (the page's clouds: x, y, r, v,
  // puffs), upright (a screen higher than wide)
  const LIGHT = softLight([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 128);
  function backMask(bk, mode, t, w, h, al, o) {
    const m = Math.min(w, h);
    if (mode === 'clouds') {                           // soft clouds drifting slowly sideways
      for (const c of o.clouds) {
        const cx = (((c.x + t / 1000 * c.v) % 1.3) - 0.15) * w, cy = c.y * h + Math.sin(t / 4000 + c.x * 9) * m * 0.03;
        for (const [ox, oy, rr] of c.puffs) stamp(bk, LIGHT, cx + ox * c.r * m, cy + oy * c.r * m, c.r * m * rr, al * 0.85);
      }
    } else if (mode === 'fractal') {                   // a huge sunflower spiral of soft lights, turning and breathing
      const n = 260, rot = t / 9000, br = 1 + 0.06 * Math.sin(t / 1600), Rmax = Math.hypot(w, h) * 0.6;
      for (let k = 1; k < n; k++) {
        const ang = k * 2.39996 + rot, rr = Rmax * Math.sqrt(k / n) * br;
        const R = m * (0.035 + 0.1 * Math.sqrt(k / n)) * (0.75 + 0.25 * Math.sin(t / 700 + k));
        stamp(bk, LIGHT, w / 2 + Math.cos(ang) * rr, h / 2 + Math.sin(ang) * rr, R, al * 0.9);
      }
    } else {                                           // a kaleidoscopic flower of rings and petals, turning both ways
      bk.save(); bk.translate(w / 2, h / 2);
      for (let ring = 1; ring <= 7; ring++) {
        const petals = 6 + ring * 2, base = m * 0.11 * ring, rot = t / 7000 * (ring % 2 ? 1 : -1);
        bk.beginPath();
        for (let k = 0; k <= 120; k++) {
          const an = k / 120 * Math.PI * 2, rr = base * (1 + 0.22 * Math.sin(an * petals + rot * 3 + t / 1500));
          bk[k ? 'lineTo' : 'moveTo'](Math.cos(an + rot) * rr, Math.sin(an + rot) * rr);
        }
        bk.closePath(); bk.lineWidth = m * (o.upright ? 0.03 : 0.05); bk.strokeStyle = `rgba(255,255,255,${o.upright ? 0.55 : 0.85})`; bk.stroke();   // finer upright
      }
      bk.restore();
    }
  }

  // ---------- the sky of a dream window: the dream, seen through drifting fields of cloud (#222: from window.html) ----------
  // into cg (w×h, cleared): o – tier (2 all of it … 0 the least), swell (0–1: the breath and the beat), drift (this
  // window's own piece of the sky), index (which window), dream(c, x, y, w, h, zoom, cx, cy) (the dream's picture)
  const VIGNETTE = (() => { const c = DreamBrush.canvas(64), x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 12, 32, 32, 46);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,.62)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c; })();
  function skyClouds(cg, t, o) {
    const { w, h, drift } = o, { tile, clouds } = DreamBrush, s = t / 1000 + drift * 40;
    tile(cg, clouds(11, 0.6, 0.1), w, h, 0.8, s / 46 + drift, s / 110, 0.2);
    cg.globalAlpha = o.swell; tile(cg, clouds(11, 0.82, 0.1), w, h, 0.8, s / 46 + drift, s / 110, 0.2); cg.globalAlpha = 1;   // they swell with the breath and the beat
    cg.globalCompositeOperation = 'destination-in';     // a second field drifts across and turns: where both are, the dream shows
    tile(cg, clouds(23, 0.72, 0.12), w, h, 1.15, -s / 70 + drift * 0.7, s / 58, 1.1 + s / 150);
    if (o.tier > 0) { cg.globalCompositeOperation = 'destination-out'; cg.globalAlpha = 0.3; tile(cg, clouds(37, 0.45, 0.22), w, h, 2.2, s / 30, -s / 37 + drift, -0.7 - s / 240); cg.globalAlpha = 1; }   // fine wisps of dark in them
    cg.globalCompositeOperation = 'destination-in'; cg.drawImage(VIGNETTE, 0, 0, w, h);
    cg.globalCompositeOperation = 'source-atop';        // the dream into them: large, drifting slowly, another part in every window
    const cx = 0.5 + 0.25 * Math.sin(t / 26000 + o.index * 1.7 + drift), cy = 0.5 + 0.25 * Math.cos(t / 33000 + o.index * 2.3 + drift);
    o.dream(cg, 0, 0, w, h, 1.3 + 0.15 * Math.sin(t / 19000 + o.index), cx, cy);
  }

  // ---------- fire (#162, #218; #222: from eyes.html): flames rise from the bottom of the screen, the night glows warm ----------
  // as high as the fire is strong (k), highest on the side the flame is on (side: 0 left – 1 right). o: W, H, perf (frames a second)
  function flames(g, t, k, side, o) {
    const { W, H } = o, n = (W > H ? 11 : 7) * (o.perf > 30 ? 1 : 0.7) | 0, w = W / n, base = H + 8;
    g.save(); g.globalCompositeOperation = 'lighter';
    const glow = g.createLinearGradient(0, H, 0, H * 0.3);
    glow.addColorStop(0, `rgba(255,80,15,${0.3 * k})`); glow.addColorStop(1, 'rgba(255,60,10,0)');
    g.fillStyle = glow; g.fillRect(0, H * 0.3, W, H * 0.7);
    const LAYERS = [[0.36, 0.95, 310, [255, 70, 20], [200, 30, 10]], [0.25, 0.7, 250, [255, 140, 30], [240, 80, 20]], [0.13, 0.42, 200, [255, 235, 160], [255, 180, 60]]];
    LAYERS.forEach(([hh, ww, sp, c0, c1], li) => {
      for (let i = -1; i <= n; i++) {
        const s = i * 12.9898 + li * 78.233, ph = t / sp;
        const fl = 0.62 + 0.2 * Math.sin(ph + s) + 0.18 * Math.sin(ph * 2.3 + s * 1.7);   // each tongue flickers on its own
        const x = (i + 0.5 + li * 0.33) * w, near = (x / W - side) / 0.3;
        const h = H * hh * fl * k * (0.6 + 0.4 * Math.sin(s * 3.1) ** 2) * (0.75 + 0.5 * Math.exp(-near * near));
        const sw = Math.sin(ph * 1.4 + s * 2) * w * 0.45, hw = w * ww;
        const gr = g.createLinearGradient(0, base, 0, base - h);
        gr.addColorStop(0, `rgba(${c0},${0.5 * k})`); gr.addColorStop(0.45, `rgba(${c1},${0.3 * k})`); gr.addColorStop(1, `rgba(${c1},0)`);
        g.fillStyle = gr; g.beginPath(); g.moveTo(x - hw, base);     // a round belly, a licking tip
        g.bezierCurveTo(x - hw, base - h * 0.45, x - hw * 0.2 + sw * 0.5, base - h * 0.62, x + sw, base - h);
        g.bezierCurveTo(x + hw * 0.2 + sw * 0.5, base - h * 0.62, x + hw, base - h * 0.45, x + hw, base); g.closePath(); g.fill();
      }
    });
    g.restore();
  }

  // ---------- the trance of Dreamy Eyes (#172; #222: from eyes.html) ----------
  // p is the pose the page worked out: ex, ey (where the third eye is), A (its size), and 0–1 each: dim, tun (the
  // tunnel), mand (the mandala), pull, eo (how far it is open), dot, view. o: W, H, hue (the dream's), perf, dream (its
  // picture, or null)
  function tranceBack(g, t, p, o) {                    // behind the closed eyes: the night dims, mandala, tunnel, the pull
    const { W, H, hue } = o;
    g.fillStyle = `rgba(5,4,9,${0.55 * p.dim})`; g.fillRect(0, 0, W, H);
    const R = Math.hypot(W, H) * 0.55;
    g.save(); g.globalCompositeOperation = 'lighter';
    if (p.tun > 0.01) for (let j = 0; j < 9; j++) {    // a tunnel: rings flying towards the eye
      const s = (t / 1500 + j / 9) % 1, r = R * (1 - s) ** 1.6 + p.A * 0.6;
      g.strokeStyle = `hsla(${hue + j * 40 + t * 0.03},90%,65%,${0.35 * p.tun * Math.sin(s * Math.PI)})`; g.lineWidth = 1.5 + 5 * (1 - s);
      g.beginPath(); g.ellipse(p.ex, p.ey, r, r * 0.92, t / 4000 + j, 0, Math.PI * 2); g.stroke();
    }
    if (p.mand > 0.01) {                               // a mandala: rings of petals turning against each other, breathing
      const rings = o.perf > 45 ? 5 : 3, br = 1 + 0.05 * Math.sin(t / 900);
      for (let i = 0; i < rings; i++) {
        const r = p.A * (1.3 + i * 0.65) * br * (0.6 + 0.4 * p.mand), n = 8 + i * 4, rot = t / (5000 + i * 1300) * (i % 2 ? -1 : 1), pl = p.A * (0.34 + i * 0.07);
        g.strokeStyle = `hsla(${hue + i * 30},85%,${62 + i * 3}%,${0.55 * p.mand})`; g.fillStyle = `hsla(${hue + i * 30 + 20},90%,60%,${0.12 * p.mand})`; g.lineWidth = 1.4;
        for (let k = 0; k < n; k++) {
          const an = rot + k / n * Math.PI * 2;
          g.save(); g.translate(p.ex + Math.cos(an) * r, p.ey + Math.sin(an) * r); g.rotate(an);
          g.beginPath(); g.moveTo(-pl * 0.5, 0); g.quadraticCurveTo(0, -pl * 0.32, pl * 0.5, 0); g.quadraticCurveTo(0, pl * 0.32, -pl * 0.5, 0); g.fill(); g.stroke();
          g.restore();
        }
        g.strokeStyle = `hsla(${hue + i * 30},85%,70%,${0.25 * p.mand})`; g.beginPath(); g.arc(p.ex, p.ey, r - pl * 0.6, 0, Math.PI * 2); g.stroke();
      }
    }
    if (p.pull > 0.01) {                               // the pull: streaks spiral into the pupil
      for (let k = 0; k < 48; k++) {
        const s = (t / 1300 + k / 48 * 3.7) % 1, r = R * (1 - s), an = k * 2.399 + s * 5 + t / 1500;
        g.strokeStyle = `hsla(${hue + k * 7},90%,72%,${0.6 * p.pull * s})`; g.lineWidth = 1 + 2.5 * s;
        g.beginPath(); g.moveTo(p.ex + Math.cos(an) * r, p.ey + Math.sin(an) * r); g.lineTo(p.ex + Math.cos(an - 0.25) * r * 0.9, p.ey + Math.sin(an - 0.25) * r * 0.9); g.stroke();
      }
    }
    g.restore();
  }
  function coverDraw(c, img, x, y, w, h) {             // an image filling a box, cropped to it
    const s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s;
    c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }
  function tranceEye(g, t, p, o) {                     // the third eye itself, in front of everything
    const { ex, ey, A } = p, B = A * 0.5 * p.eo, { W, H, hue } = o;
    if (p.dot > 0.01) {                                // closed: a glowing dot on the forehead that fades
      const gr = g.createRadialGradient(ex, ey, 0, ex, ey, A * 0.35);
      gr.addColorStop(0, `hsla(${hue + 30},90%,82%,${p.dot})`); gr.addColorStop(1, `hsla(${hue + 30},90%,60%,0)`);
      g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(ex - A, ey - A, A * 2, A * 2); g.restore();
    }
    if (p.eo > 0.01) {
      const almond = () => { g.beginPath(); g.moveTo(ex, ey - A); g.quadraticCurveTo(ex + B * 2, ey, ex, ey + A); g.quadraticCurveTo(ex - B * 2, ey, ex, ey - A); };
      g.save(); g.globalCompositeOperation = 'lighter';  // its glow
      for (const [w, al] of [[16, 0.1], [7, 0.22], [2.5, 0.8]]) { g.strokeStyle = `hsla(${hue + 30},95%,72%,${al * p.eo})`; g.lineWidth = w; almond(); g.stroke(); }
      g.restore();
      g.save(); almond(); g.clip();
      g.fillStyle = '#f6f0ff'; g.fillRect(ex - A, ey - A, A * 2, A * 2);
      const ir = A * 0.4;                              // an iris of the dream, turning slowly
      g.save(); g.beginPath(); g.arc(ex, ey, ir, 0, Math.PI * 2); g.clip();
      g.translate(ex, ey); g.rotate(t / 6000); g.translate(-ex, -ey);
      if (o.dream) coverDraw(g, o.dream, ex - ir, ey - ir, ir * 2, ir * 2); else { g.fillStyle = `hsl(${hue},70%,45%)`; g.fill(); }
      const ring = g.createRadialGradient(ex, ey, ir * 0.55, ex, ey, ir);
      ring.addColorStop(0, `hsla(${hue + 40},90%,60%,0)`); ring.addColorStop(1, `hsla(${hue + 40},90%,35%,.75)`);
      g.fillStyle = ring; g.fillRect(ex - ir, ey - ir, ir * 2, ir * 2);
      g.restore();
      g.fillStyle = '#05040a'; g.beginPath(); g.arc(ex, ey, ir * (0.38 + 0.5 * p.pull), 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(ex + ir * 0.22, ey - ir * 0.28, ir * 0.09, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    if (p.view > 0.01 && o.dream) {                    // through the wide pupil: the dream, large and clear, soft at its edge
      const R = Math.min(W, H) * 0.46 * p.view, d = Math.ceil(R * 2), cv = DreamBrush.sprite('classic-trance-view', () => DreamBrush.canvas(2));
      if (cv.width !== d || cv.height !== d) { cv.width = cv.height = Math.max(2, d); }
      const c = cv.getContext('2d');
      c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, d, d); coverDraw(c, o.dream, 0, 0, d, d);
      const m = c.createRadialGradient(d / 2, d / 2, R * 0.7, d / 2, d / 2, R);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalCompositeOperation = 'destination-in'; c.fillStyle = m; c.fillRect(0, 0, d, d);
      g.save(); g.globalAlpha = Math.min(1, p.view * 1.2); g.drawImage(cv, ex - R, ey - R, d, d); g.restore();
    }
  }

  // ---------- "you in the dream" and the painted faces coming through the pupils (#160, #219; #222: from dreamyou.js
  // and eyes.html): what is drawn around a picture – the picture itself is never the world's ----------
  function blossoms(c, n, t, hue, al) {                 // a wreath of blossoms that open and turn slowly
    const count = 14;
    for (let k = 0; k < count; k++) {
      const an = k / count * Math.PI * 2 + t / 26000, rr = n * (0.335 + 0.01 * Math.sin(t / 2100 + k * 1.7));
      const x = n / 2 + Math.cos(an) * rr, yy = n / 2 + Math.sin(an) * rr, s = n * (0.032 + 0.012 * ((k * 7) % 3) / 2) * (0.85 + 0.15 * Math.sin(t / 1500 + k));
      c.save(); c.translate(x, yy); c.rotate(t / 5200 * (k % 2 ? 1 : -1) + k);
      c.globalAlpha = 0.9 * al; c.fillStyle = `hsl(${hue + (k % 3) * 28 - 20},82%,${74 + (k % 2) * 8}%)`;
      for (let p = 0; p < 5; p++) { c.rotate(Math.PI * 2 / 5); c.beginPath(); c.ellipse(0, -s * 0.62, s * 0.36, s * 0.62, 0, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = `hsl(${hue + 50},95%,88%)`; c.beginPath(); c.arc(0, 0, s * 0.24, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
  }
  function aureole(c, n, t, hue, al) {                  // rings of petals drawn in light behind the person, turning both ways
    c.save(); c.translate(n / 2, n / 2); c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round';
    for (let ring = 0; ring < 3; ring++) {
      const petals = 12 + ring * 6, base = n * (0.27 + ring * 0.05), rot = t / 9000 * (ring % 2 ? 1 : -1);
      c.beginPath();
      for (let k = 0; k <= 180; k++) {
        const an = k / 180 * Math.PI * 2, rr = base * (1 + 0.045 * Math.sin(an * petals + t / 1300 * (ring % 2 ? -1 : 1)));
        c[k ? 'lineTo' : 'moveTo'](Math.cos(an + rot) * rr, Math.sin(an + rot) * rr);
      }
      c.closePath(); c.lineWidth = n * (0.012 - ring * 0.002); c.globalAlpha = (0.85 - ring * 0.15) * al;
      c.strokeStyle = `hsl(${hue + ring * 35},90%,${72 - ring * 4}%)`; c.stroke();
    }
    c.restore(); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  function mist(c, n, t, hue, al) {                     // veils of mist drifting around, thicker below
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 16; k++) {
      const an = k / 16 * Math.PI * 2 + Math.sin(t / 6000 + k) * 0.25 + t / 40000, low = 0.5 + 0.5 * Math.sin(an);
      const rr = n * (0.33 + 0.03 * Math.sin(t / 2700 + k * 2.1));
      stamp(c, tinted(hue + 20 + (k % 4) * 12), n / 2 + Math.cos(an) * rr * 1.05, n / 2 + Math.sin(an) * rr, n * (0.1 + 0.07 * low), (0.2 + 0.3 * low) * al);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  const WHITE = softLight([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']], 64);
  const PUFF = softLight([[0.15, 'rgba(255,255,255,1)'], [0.6175, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']], 256);   // the portal's cloud
  const you = {
    FRAMES: ['blossom', 'mandala', 'mist'],            // now and then a frame around the person …
    behind: { mandala: aureole },                      // … an aureole behind the head,
    front: { blossom: blossoms, mist },                // … a wreath, veils before the shoulders
    // the colours of the person's outline: the glow around them, the halo close to them, the shimmer at their edge
    tints: (hue, t) => ({ glow: `hsl(${hue},90%,66%)`, halo: `hsl(${hue + 35},95%,80%)`, rim: `hsl(${hue + 20 + 40 * Math.sin(t / 2300)},95%,75%)` }),
    // one firefly at (x, y), r large, twinkling (tw 0–1)
    spark(c, x, y, r, hue, tw, al) { stamp(c, tinted(hue), x, y, r * 2.2, 0.75 * tw * al); stamp(c, WHITE, x, y, r * 0.8, 0.95 * tw * al); },
    // the cloud a picture comes in (white into c where it shows): soft blobs that drift, breathe and change shape – never a hard edge
    cloud(c, cx, cy, size, t, al) {
      c.globalCompositeOperation = 'lighter';
      const blob = (x, y, r, a) => stamp(c, PUFF, x, y, r, a);
      blob(cx, cy, size * (0.42 + 0.02 * Math.sin(t / 1300)), al);                // the heart of the cloud
      const n = 12;
      for (let k = 0; k < n; k++) {                    // a ring of puffs, each wandering on its own
        const an = k / n * Math.PI * 2 + 0.25 * Math.sin(t / 3700 + k) + t / 21000 * (k % 2 ? 1 : -1);
        const rr = size * (0.27 + 0.06 * Math.sin(t / 1900 + k * 1.9)), br = size * (0.17 + 0.05 * Math.sin(t / 1500 + k * 2.3));
        blob(cx + Math.cos(an) * rr * 1.05, cy + Math.sin(an) * rr * 1.2, br, al * 0.9);
      }
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    },
    // a glowing ring at the edge of each window the picture comes through (the pupils), r wide; p: how far it has come
    // (0–1), mist: how veiled it still is (0–1)
    rings(g, pupils, r, t, hue, p, mist) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const [px, py] of pupils) {
        g.strokeStyle = `hsla(${hue + t * 0.05},90%,70%,${0.6 * (1 - p) * (1 - 0.6 * mist)})`; g.lineWidth = (2 + 6 * (1 - p)) * (1 - 0.5 * mist);
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.stroke();
      }
      g.restore();
    },
  };

  DreamStyle.register('classic', {
    eye: { draw: DreamEye.draw, irisWorld: DreamEye.irisWorld, pupilShape: DreamEye.pupilShape },
    life: { draw: DreamLife.draw },
    face: { draw: face, MODES: FACES },
    motif: { third, mandala, penrose: shape, stairs: shape, fork: shape, cube: shape },
    back: { mask: backMask },
    sky: { clouds: skyClouds },
    fire: { flames },
    trance: { back: tranceBack, eye: tranceEye },
    you,
  });
})(typeof window !== 'undefined' ? window : globalThis);
