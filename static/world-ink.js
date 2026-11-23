/* Dream – the style world "ink & watercolour" (#223): light pigment on black paper. Surfaces are washes – a few blots
   made once (layered, deformed polygons with a wet edge where pigment gathers, and granulation), tinted in a handful
   of pigments and stamped; lines are brush strokes: bristles side by side that swell, thin out and run dry, each stroke
   painted in from its beginning. The line work "boils" a little, six drawings a second, as hand animation does. The
   eye is a bone wash with a brushed iris ring and bare paper for its highlight, the lid one loaded stroke flicked into
   a wing; its shade is pigment bleeding out into the paper.

   What today's look shows as signs has its own form here: a drop of red pigment blooming instead of a heart, a flick
   of splatter instead of stars, slow rings of wash instead of letters, a brushed enso instead of the triangle. Of a
   face there is what the face rule lets through (static/dreamvis.js), and never the middle of it.

   Everything is sprites drawn once (static/dreambrush.js) and short paths – no blur, shadow or filter per frame: old
   phones. Registers itself with the style layer (static/dreamstyle.js). */
(function (root) {
  'use strict';
  const { DreamBrush, DreamVis, DreamLife, DreamEye, DreamStyle } = root;
  const { TAU, clamp, lerp, smooth, rng, hash, fbm, noise2, curve, band, ribbon, sprite, canvas, lids, faceFrame, skeleton, kaleido, night, cover, hueOf, tile } = DreamBrush;
  const PI = Math.PI, ease = x => 1 - Math.pow(1 - clamp(x), 3), seg = (x, a, b) => clamp((x - a) / (b - a));

  // ---------- the materials ----------
  // the pigments in the box: whatever hue is asked for becomes one of them
  const PIG = { indigo: '#4f74cc', madder: '#cf5672', ochre: '#e3ae50', viridian: '#48b79a', violet: '#9270cc', vermilion: '#e8552f', bone: '#f1e8d4', shadow: '#8a8cb4', ink: '#0c0a16', white: '#ffffff' };
  const HUES = [PIG.indigo, PIG.madder, PIG.ochre, PIG.viridian, PIG.violet];
  const pig = hue => { const h = ((hue % 360) + 360) % 360; return h < 25 ? PIG.vermilion : h < 70 ? PIG.ochre : h < 190 ? PIG.viridian : h < 250 ? PIG.indigo : h < 300 ? PIG.violet : PIG.madder; };
  const other = (col, k) => HUES[(Math.max(0, HUES.indexOf(col)) + k) % 5];
  // a hand's wobble, cheap: soft noise along a line from a table (the brushes' noise2 costs too much per bristle)
  const NT = (() => { const r = rng(77), a = new Float32Array(1024); for (let i = 0; i < 1024; i++) a[i] = r(); return a; })();
  const n1 = (x, sd = 0) => { const i = Math.floor(x), f = x - i, k = (i + Math.imul(sd | 0, 131)) & 1023, p = NT[k]; return p + (NT[(k + 1) & 1023] - p) * f * f * (3 - 2 * f); };
  const boil = t => Math.floor(t / 166);              // the drawing changes six times a second
  const wob = (P, amp, sd) => P.map((p, i) => [p[0] + (n1(i * 0.3, sd) - 0.5) * 2 * amp, p[1] + (n1(i * 0.3 + 40, sd) - 0.5) * 2 * amp]);
  const circ = (x, y, r, n, a0 = 0, a1 = TAU) => Array.from({ length: n + 1 }, (_, k) => { const an = a0 + (a1 - a0) * k / n; return [x + Math.cos(an) * r, y + Math.sin(an) * r]; });

  // a wash: a blot of wet pigment – layered deformed polygons, the edge where pigment gathers, granulation. Made once.
  const S = 192, BLOTS = 7;
  function deform(poly, r, amt, rounds) {
    for (let k = 0; k < rounds; k++) {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]), an = r() * TAU, d = (r() + r() - 1) * len * amt;
        out.push(p, [(p[0] + q[0]) / 2 + Math.cos(an) * d, (p[1] + q[1]) / 2 + Math.sin(an) * d]);
      }
      poly = out;
    }
    return poly;
  }
  const blotShape = i => sprite('ink-blot' + i, () => {
    const c = canvas(S), x = c.getContext('2d'), r = rng(100 + i * 7); let base = [];
    for (let k = 0; k < 10; k++) { const an = k / 10 * TAU, rr = S * 0.25 * (0.75 + 0.5 * r()); base.push([S / 2 + Math.cos(an) * rr, S / 2 + Math.sin(an) * rr]); }
    base = deform(base, r, 0.45, 3);
    const path = P => { x.beginPath(); P.forEach((p, k) => x[k ? 'lineTo' : 'moveTo'](p[0], p[1])); x.closePath(); };
    x.fillStyle = x.strokeStyle = '#fff';
    x.filter = 'blur(1.2px)';                          // once, while the sprite is made (without it: slightly harder edges)
    for (let k = 0; k < 34; k++) { x.globalAlpha = 0.034; path(deform(base, r, 0.5 + 0.5 * (k / 34), 3)); x.fill(); }
    x.filter = 'blur(0.6px)';
    x.globalAlpha = 0.2; x.lineWidth = S * 0.01; x.lineJoin = 'round'; path(base); x.stroke();   // the wet edge
    x.filter = 'none'; x.globalCompositeOperation = 'destination-out';                          // granulation
    for (let k = 0; k < 900; k++) { x.globalAlpha = r() * 0.3; x.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
    return c;
  });
  const tinted = (i, col) => sprite('ink-wash' + i + col, () => {
    const c = canvas(S), x = c.getContext('2d'); x.drawImage(blotShape(i), 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, S, S); return c;
  });
  // `size` is the sprite's edge – the blot itself is about 0.6 of it
  function blot(c, i, col, x, y, size, al, rot = 0, sy = 1) {
    if (al <= 0.004) return;
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, sy); c.globalAlpha = Math.min(1, al);
    c.drawImage(tinted(((i | 0) % BLOTS + BLOTS) % BLOTS, col), -size / 2, -size / 2, size, size); c.restore();
  }
  // a brush stroke along P, half as wide as wf(u): o.nb bristles side by side, each running dry here and there, more
  // so towards the end; drawn up to o.prog (0–1: a stroke being painted in); o.run moves the dry places along it
  function brush(c, P, wf, o) {
    const n = P.length, prog = o.prog === undefined ? 1 : o.prog, al = o.alpha === undefined ? 1 : o.alpha;
    if (prog <= 0.001 || al <= 0.004 || n < 2) return;
    const m = Math.max(2, Math.min(n, Math.ceil((n - 1) * prog) + 1)), nb = o.nb || 6, r = rng(o.seed || 1), run = o.run || 0, dry0 = o.dry === undefined ? 0.35 : o.dry;
    const NX = new Array(m), NY = new Array(m), Wd = new Array(m); let wmax = 0;
    for (let i = 0; i < m; i++) {
      const p = P[Math.max(0, i - 1)], q = P[Math.min(n - 1, i + 1)], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, w = wf(i / (n - 1));
      NX[i] = -dy / l; NY[i] = dx / l; Wd[i] = w; if (w > wmax) wmax = w;
    }
    c.strokeStyle = o.color; c.lineCap = 'round'; c.lineJoin = 'round';
    const lw = wmax * 2 / nb * 1.5;
    for (let k = 0; k < nb; k++) {
      const off = nb === 1 ? 0 : (k / (nb - 1)) * 2 - 1 + (r() - 0.5) * 0.2, f = 4 + r() * 7, ph = r() * 100, dry = dry0 * (0.5 + r());
      c.globalAlpha = Math.min(1, al * (0.45 + 0.55 * r())); c.lineWidth = Math.max(0.7, lw * (0.4 + 1.1 * r())); c.beginPath();
      const wf2 = 1.5 + r() * 3, wp = r() * 50; let pen = false;
      for (let i = 0; i < m; i++) {
        const u = i / (n - 1);
        if (n1(u * f + ph - run, k * 3 + 1) > dry * (0.2 + 1.0 * u)) { const d = Wd[i] * (off + (n1(u * wf2 + wp, k * 7 + 2) - 0.5) * 0.7); c[pen ? 'lineTo' : 'moveTo'](P[i][0] + NX[i] * d, P[i][1] + NY[i] * d); pen = true; } else pen = false;
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  }
  // many small filled things in one path: dots [x, y, r], and ribbons [P, wide] (a press of the brush)
  const dots = (c, list) => { c.beginPath(); for (const [x, y, r] of list) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); } c.fill(); };
  function ribbons(c, list) {
    c.beginPath();
    for (const [P, wide] of list) { const B = band(P, wide); c.moveTo(B[0][0], B[0][1]); for (let i = 1; i < B.length; i++) c.lineTo(B[i][0], B[i][1]); c.closePath(); }
    c.fill();
  }
  // a disc drawn by hand: no perfect circle
  function disc(c, x, y, r, sd, k = 0.05, n = 40) {
    c.beginPath();
    for (let i = 0; i < n; i++) { const an = i / n * TAU, rr = r * (1 + k * (n1(i * 0.45, sd) - 0.5) * 2 * Math.min(1, (n - i) / 4)); c.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); }
    c.closePath();
  }
  // a leaf: one press of the brush from (x, y) towards an
  const leaf = (x, y, an, len, bend = 0.04) => { const L = []; for (let q = 0; q <= 6; q++) L.push([x + Math.cos(an + bend * q) * len * q / 6, y + Math.sin(an + bend * q) * len * q / 6]); return [L, u => len * 0.2 * Math.pow(Math.sin(PI * Math.pow(u, 0.7)), 0.9)]; };
  // an ink twig growing: a stem, and leaves set one after the other; grown 0–1
  function sprig(c, x, y, ang, len, grown, seed, al, col, stem = PIG.bone, T = 0) {
    if (al <= 0.004 || grown <= 0.001) return;
    const r = rng(seed), curl = (r() - 0.5) * 1.6 + Math.sin(T * 0.6 + seed) * 0.12, P = [[x, y]], list = [];
    for (let s = 1; s <= 14; s++) { const a = ang + curl * s / 14 + Math.sin(s * 0.9 + seed) * 0.08; P.push([P[s - 1][0] + Math.cos(a) * len / 14, P[s - 1][1] + Math.sin(a) * len / 14]); }
    brush(c, P, u => len * 0.012 * (1.2 - u), { seed, color: stem, alpha: 0.85 * al, dry: 0.3, nb: 2, prog: grown });
    for (let j = 0; j < 6; j++) {
      const idx = 2 + j * 2, k = seg(grown, idx / 14, idx / 14 + 0.18), side = j % 2 ? 1 : -1, la = ang + curl * idx / 14 + side * (0.75 + r() * 0.4);
      if (k > 0) list.push(leaf(P[idx][0], P[idx][1], la, len * (0.26 - j * 0.02) * ease(k), side * 0.04));
    }
    c.fillStyle = col; c.globalAlpha = 0.72 * al; ribbons(c, list); c.globalAlpha = 1;
  }
  // a flick of the brush: splatter around (x, y), the drops landing one after the other (shown 0–1)
  function splatter(c, x, y, size, col, al, seed, n = 18, shown = 1) {
    const r = rng(seed), list = [];
    for (let k = 0; k < n; k++) { const an = r() * TAU, rd = (r() + r()) * size * 0.7, rr = size * (0.015 + 0.09 * r() * r()); if (k / n < shown) list.push([x + Math.cos(an) * rd, y + Math.sin(an) * rd, rr]); }
    c.fillStyle = col; c.globalAlpha = al; dots(c, list); c.globalAlpha = 1;
  }
  // a brushed enso around (x, y): one loaded ring that runs dry, a fine dry one outside it
  function enso(c, x, y, R, seed, bf, al, o = {}) {
    const a0 = o.from === undefined ? -2.2 : o.from, col = o.color || PIG.bone;
    brush(c, wob(circ(x, y, R, o.n || 56, a0, a0 + TAU * 0.955), R * 0.008, bf), u => R * (o.wide || 0.082) * (0.2 + 0.8 * Math.sin(PI * Math.pow(u, 0.7))), { seed, color: col, alpha: 0.95 * al, dry: 0.5, nb: o.nb || 10, prog: o.prog });
    if (!o.bare) brush(c, wob(circ(x, y, R * 1.15, 48, a0 + 2.8, a0 + 2.8 + TAU * 0.8), R * 0.01, bf + 5), u => R * 0.012 * Math.sin(PI * u), { seed: seed + 2, color: o.fine || col, alpha: 0.45 * al, dry: 0.7, nb: 2, prog: o.prog });
  }
  // the iris' fibres: flicks of a fine brush, dark and light. Drawn once.
  const fibre = () => sprite('ink-fibre', () => {
    const c = canvas(256), f = c.getContext('2d'), r = rng(4), N = 256;
    for (let i = 0; i < 90; i++) {
      const an = r() * TAU, r0 = N * (0.14 + 0.06 * r()), r1 = N * (0.3 + 0.2 * r()), bend = (r() - 0.5) * 0.3, P = [];
      for (let q = 0; q <= 6; q++) { const v = q / 6, rr = lerp(r0, r1, v); P.push([N / 2 + Math.cos(an + bend * v) * rr, N / 2 + Math.sin(an + bend * v) * rr]); }
      f.fillStyle = r() < 0.5 ? `rgba(20,14,40,${0.25 + 0.4 * r()})` : `rgba(255,246,225,${0.12 + 0.3 * r()})`; const w = 0.5 + r(); ribbon(f, P, v => N * 0.008 * (1 - v) * w + 0.3);
    }
    return c;
  });
  // the paper's grain, multiplied over the night
  const grain = () => sprite('ink-grain', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), im = x.createImageData(N, N), r = rng(9);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = 150 + 105 * clamp(0.55 * fbm(i * 0.09, j * 0.09, 2) + 0.5 * r() + 0.15 * noise2(i * 0.5, j * 0.03)), o = (j * N + i) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255; }
    x.putImageData(im, 0, 0); return c;
  });

  // ---------- the eye: a bone wash, a brushed iris, one loaded stroke for the lid ----------
  function eye(g, cx, cy, a, b, mirror, p) {
    const up = Math.max(0.02, p.open * (1 - p.blink) * (1 - 0.25 * p.squint)), lo = (0.82 + 0.1 * p.open) * (1 - 0.35 * p.squint);
    const L = lids(cx, cy, a, b, mirror, up, lo), o = L.o, now = performance.now(), T = now / 1000, idx = mirror ? 1 : 0, hint = p.crease || 0, look = p.look, bf = boil(now) + idx * 31;
    const R = Math.min(a * 0.5, b * 1.02), ix = cx + p.gx * a * 0.34 * (mirror ? 0.96 : 1), iy = cy + p.gy * b * 0.32;
    g.save(); g.globalAlpha = 1;
    if (p.browAl > 0.01) {                             // the brow, when it comes: one stroke, painted in – it moves with what they feel
      const E = p.brow;
      let by0 = cy - b * 1.6 + b * E.inner, by2 = cy - b * 1.7 + b * E.outer, bpy = cy - b * (1.95 + 0.35 * look.arch) + b * E.peak;
      const room = Math.min(by0, by2, bpy) - b * 0.25;
      if (room < 0) { by0 -= room; by2 -= room; bpy -= room; }
      brush(g, wob(curve([[cx - o * a * 0.8, by0], [cx - o * a * 0.25, lerp(by0, bpy, 0.75)], [cx + o * a * 0.38, bpy], [cx + o * a * 1.02, by2]], 7), a * 0.006, bf + 30),
        u => a * 0.062 * look.brow * Math.pow(Math.sin(PI * Math.pow(u, 0.7)), 1.2), { seed: 70 + idx, color: PIG.bone, alpha: 0.8 * p.browAl, dry: 0.5, nb: 6, prog: Math.min(1, p.browAl * 1.7) });
    }
    // its shade: pigment bleeding out of the eye into the paper
    const p1 = pig(look.hue), br = 1 + 0.04 * Math.sin(T * 0.6 + idx), sh = look.alpha * 2;
    g.globalCompositeOperation = 'screen';
    blot(g, 1 + idx, p1, cx + o * a * 0.25, cy - b * 1.1, a * 3.3 * br, (0.2 + 0.2 * hint) * sh, idx * 2 + T * 0.02);
    blot(g, 3 + idx, pig(hueOf(p.col)), cx + o * a * 0.8, cy - b * 0.5, a * 2.3 * br, 0.3 * sh, 1 + T * 0.015);
    blot(g, 2, other(p1, 2), cx - o * a * 0.45, cy + b * 1.0, a * 2.1, 0.24 * sh, 2);
    g.globalCompositeOperation = 'source-over';
    g.save(); L.path(g); g.clip();
    g.fillStyle = '#e6dcc8'; g.globalAlpha = 0.95; g.fillRect(cx - a, cy - b * 1.6, 2 * a, 3.2 * b);
    g.globalCompositeOperation = 'multiply';
    blot(g, 4, PIG.shadow, cx, cy - b * 1.3, a * 3.1, 0.95, idx);               // the lid's shadow, a wash
    blot(g, 0, '#d59aa0', cx - o * a * 0.95, cy + b * 0.1, a * 0.95, 0.85, 0);   // the inner corner
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.save(); disc(g, ix, iy, R, idx * 9 + 3, 0.05, 44); g.clip();
    g.fillStyle = PIG.ink; g.fillRect(ix - R * 1.1, iy - R * 1.1, R * 2.2, R * 2.2);
    p.iris(ix, iy, R);                                 // the dream, a world of its own, and whoever is mirrored in it
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.6; g.drawImage(fibre(), ix - R * 1.05, iy - R * 1.05, R * 2.1, R * 2.1); g.globalAlpha = 1;
    g.restore();
    brush(g, wob(circ(ix, iy, R * 0.97, 36, 1 + idx, 1 + idx + TAU * 0.97), R * 0.012, bf), u => R * 0.085 * (0.3 + 0.7 * Math.sin(PI * u)), { seed: 5 + idx, color: '#17132b', alpha: 0.95, dry: 0.3, nb: 5 });
    const pr = R * p.pupil;
    if (p.pupilMix < 0.99) { g.globalAlpha = 1 - p.pupilMix; g.fillStyle = PIG.ink; disc(g, ix, iy, pr, idx * 5 + 1, 0.1, 30); g.fill(); }
    if (p.pupilMix > 0.01) { g.globalAlpha = p.pupilMix; p.pupilShape(ix, iy, pr, R); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (p.reflect) p.reflect(ix, iy, R);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    blot(g, 2, '#fffaf0', ix - R * 0.4, iy - R * 0.42, R * 0.55, 0.95, 1.3);     // the highlight: paper left bare
    blot(g, 5, '#fffaf0', ix + R * 0.34, iy + R * 0.3, R * 0.2, 0.6, 0.4);
    g.restore();
    // the upper lid: one loaded stroke from the inner corner, flicked off into a wing
    const P = [], wing = look.wing, [wx, yo] = L.upper(1);
    for (let k = 0; k <= 22; k++) P.push(L.upper(k / 22));
    if (wing > 0.05) P.push([wx + o * a * 0.1 * wing, yo - b * 0.12 * wing], [wx + o * a * 0.2 * wing, yo - b * 0.32 * wing], [wx + o * a * 0.27 * wing, yo - b * 0.58 * wing]);
    brush(g, wob(P, a * 0.006, bf), u => a * 0.055 * Math.sqrt(look.liner) * (0.15 + 0.85 * Math.pow(Math.sin(PI * Math.pow(u, 1.25)), 0.8)), { seed: 11 + idx, color: PIG.bone, alpha: 0.97, dry: 0.36, nb: 7 });
    if (hint > 0.01) {                                 // the lid's crease, with the hints: a fine dry line
      const C = []; for (let k = 2; k <= 20; k++) { const u = k / 22, q = L.upper(u); C.push([q[0], q[1] - b * (0.26 + 0.22 * Math.sin(PI * u) * (0.4 + 0.6 * up))]); }
      brush(g, wob(C, a * 0.005, bf + 3), u => a * 0.012 * Math.sin(PI * u), { seed: 13 + idx, color: PIG.bone, alpha: 0.6 * hint, dry: 0.6, nb: 2 });
    }
    const D = []; for (let k = 3; k <= 22; k++) D.push(L.lower(k / 22));
    brush(g, wob(D, a * 0.004, bf + 7), u => a * 0.014 * (0.3 + 0.7 * u), { seed: 17 + idx, color: PIG.bone, alpha: 0.6, dry: 0.65, nb: 2 });
    const la = [];                                     // lashes: a few quick flicks, none like the other
    for (let i = 0; i < 7; i++) {
      const base = L.upper(0.36 + i * 0.095), k = i / 6, len = a * (0.1 + 0.27 * Math.pow(k, 1.2)) * look.lashes * (0.65 + 0.7 * n1(i * 1.7, idx * 5 + 2)) * (0.35 + 0.65 * up);
      const dx = o * (0.2 + 1.15 * look.curl * k * k), wig = (n1(i, bf) - 0.5) * a * 0.012, Lp = [];
      for (let q = 0; q <= 6; q++) { const v = q / 6; Lp.push([base[0] + dx * len * (0.3 * v * (1 - v) + v * v) + wig * v, base[1] - len * (1.4 * v * (1 - v) + 0.9 * v * v)]); }
      la.push([Lp, v => a * 0.017 * (1 - v) + 0.3]);
    }
    for (let i = 0; i < 3; i++) { const base = L.lower(0.62 + i * 0.11), len = a * (0.035 + 0.02 * i) * look.lower; la.push([[base, [base[0] + o * len * 0.3, base[1] + len * 0.6], [base[0] + o * len * 0.8, base[1] + len]], v => a * 0.009 * (1 - v) + 0.25]); }
    g.fillStyle = PIG.bone; g.globalAlpha = 0.92; ribbons(g, la);
    g.restore(); g.globalAlpha = 1;
    return [ix, iy];
  }
  // tongues of flame, brushed: rising from (x0…x1, y), h high – each a press of the brush that sways
  function tongues(g, x0, x1, y, h, wide, n, T, al, seed) {
    const cols = [PIG.vermilion, PIG.ochre, '#ffd9a0'];
    for (let j = 0; j < 3; j++) {
      const list = [];
      for (let k = j; k < n; k += 3) {
        const u = n > 1 ? k / (n - 1) : 0.5, hh = h * (0.45 + 0.55 * n1(T * 1.9 + k * 7.3, seed)) * (j === 2 ? 0.6 : 1), x = lerp(x0, x1, u) + (hash(seed, k) - 0.5) * (x1 - x0) / n, P = [];
        for (let q = 0; q <= 7; q++) { const v = q / 7; P.push([x + Math.sin(T * 3.1 - v * 2.6 + k * 1.7) * wide * 1.6 * v, y - hh * v]); }
        list.push([P, v => wide * (j === 2 ? 0.55 : 1) * Math.pow(Math.sin(PI * Math.pow(1 - v, 1.6)), 0.8) + 0.3]);
      }
      g.fillStyle = cols[j]; g.globalAlpha = al * [0.7, 0.75, 0.8][j]; ribbons(g, list);
    }
    g.globalAlpha = 1;
  }
  // what is in an iris: the dream as every world shows it (static/dreameye.js) – but a fire is painted: the dream dim
  // behind vermilion and ochre washes, brushed tongues rising
  function irisWorld(g, style, ix, iy, R, mirror, al, o) {
    if (style !== 'fire' && style !== 'embers') { DreamEye.irisWorld(g, style, ix, iy, R, mirror, al, o); return; }
    const T = performance.now() / 1000, heat = o.heat === undefined ? 1 : o.heat, fire = style === 'fire';
    g.save();
    g.globalAlpha = al; g.fillStyle = '#160806'; g.fillRect(ix - R, iy - R, R * 2, R * 2);
    o.pic(ix, iy, R * 2.3, al * 0.3);
    g.globalCompositeOperation = 'screen';
    blot(g, 1, PIG.vermilion, ix + Math.sin(T * 0.7) * R * 0.1, iy + R * 0.5, R * 3 * (0.8 + 0.3 * heat), al * (fire ? 0.9 : 0.6), T * 0.1);
    blot(g, 4, PIG.ochre, ix + Math.sin(T * 0.9 + 2) * R * 0.2, iy + R * 0.8, R * 1.9, al * 0.8, 2 - T * 0.07);
    if (fire) tongues(g, ix - R * 0.8, ix + R * 0.8, iy + R * 1.02, R * (0.9 + 0.9 * heat), R * 0.11, 9, T, al, mirror ? 5 : 3);
    const list = [];                                   // glowing flecks carried up
    for (let k = 0; k < (fire ? 8 : 14); k++) { const u = (T / (1.8 + (k % 5) * 0.4) + k * 0.37) % 1; list.push([ix + Math.sin(k * 2.4 + T * 0.9 + u * 3) * R * 0.7, iy + R * (0.95 - 1.9 * u * (0.5 + 0.5 * heat)), R * (0.03 + 0.03 * ((k * 7) % 5) / 4) * Math.sin(PI * u)]); }
    g.fillStyle = PIG.ochre; g.globalAlpha = al * 0.9; dots(g, list);
    g.restore();
  }
  // A pupil that is not round. The soft shimmers and the cat's slit are every world's (static/dreameye.js); what
  // today's look draws as a sign is pigment here: for 'heart' a drop of red blooming in the wet, again and again, for
  // 'star' a flick of splatter landing, for 'spiral' one brushed line turning inward.
  function pupilShape(g, shape, x, y, pr, R, mirror, o) {
    if (shape !== 'heart' && shape !== 'star' && shape !== 'spiral') { DreamEye.pupilShape(g, shape, x, y, pr, R, mirror, o); return; }
    const al = g.globalAlpha, now = o.now === undefined ? performance.now() : o.now, T = now / 1000, beat = o.beat || 0, dir = mirror ? -1 : 1, sd = mirror ? 9 : 4;
    g.save();
    g.fillStyle = PIG.ink; disc(g, x, y, pr * 1.04, sd, 0.1, 30); g.fill();
    if (shape === 'heart') {
      const u = (T * (o.fire ? 0.6 : 0.36)) % 1, grow = ease(u * 1.4), b = 1 + 0.08 * beat * Math.sin(T * 6), red = o.fire ? PIG.vermilion : PIG.madder;
      g.globalCompositeOperation = 'screen';
      blot(g, 5, red, x, y, pr * (1.6 + 1.7 * grow) * b, al * 0.85 * (1 - u * u), 1 + dir * T * 0.05);   // the bloom spreading, and paling
      blot(g, 3, red, x, y + pr * 0.04, pr * 2.1 * b, al * 0.95, 2.2);                                    // the drop itself
      blot(g, 1, o.fire ? PIG.ochre : '#f29aa6', x - pr * 0.1, y - pr * 0.08, pr * 1.05 * b, al * 0.8, 4);
      g.globalCompositeOperation = 'source-over';
      blot(g, 2, '#fff3ea', x - pr * 0.2, y - pr * 0.24, pr * 0.42, al * 0.85, 0.6);
    } else if (shape === 'star') {
      const r = rng(31 + sd), cyc = T / 3.2, turn = Math.floor(cyc), w = cyc - turn, bone = [], warm = [];
      for (let k = 0; k < 16; k++) {
        const an = r() * TAU + turn * 1.3, rd = Math.sqrt(r()) * pr * 0.92, rr = pr * (0.035 + 0.13 * r() * r()), land = seg(w, k * 0.022, k * 0.022 + 0.05) * (1 - smooth(seg(w, 0.82, 1)));
        if (land > 0) (k % 3 ? bone : warm).push([x + Math.cos(an) * rd, y + Math.sin(an) * rd, rr * (0.6 + 0.4 * land) * (1 + 0.25 * beat)]);
      }
      g.globalAlpha = al * 0.95; g.fillStyle = PIG.bone; dots(g, bone); g.fillStyle = PIG.ochre; dots(g, warm);
    } else {
      const P = [];
      for (let k = 0; k <= 44; k++) { const u = k / 44, an = T * 2.4 * dir + u * PI * 5.2 * dir, rr = pr * 0.95 * (1 - u * 0.96); P.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr]); }
      g.globalAlpha = 1;
      brush(g, P, u => pr * (0.085 + 0.03 * beat) * (0.25 + 0.75 * Math.sin(PI * Math.pow(u, 0.6))), { seed: 21 + sd, color: PIG.bone, alpha: al * 0.95, dry: 0.4, nb: 4 });
      g.fillStyle = PIG.ochre; g.globalAlpha = al; dots(g, [[x, y, pr * 0.07]]);
    }
    g.restore(); g.globalAlpha = al;
  }

  // ---------- what lives around the eyes and drifts through the windows ----------
  // One living thing d at age ms, faded in and out by env, drawn at size s, its drifting height y (static/dreamlife.js
  // describes d and o). The caller has set 'lighter'; pigment covers, so each thing sets what it needs.
  function life(g, d, age, env, s, y, o) {
    const T = age / 1000, seed = ((d.born || 0) * 7 + (d.spin || 1) * 101 + (d.life || 0) + (d.puffs && d.puffs[0] ? d.puffs[0][0] * 9973 : 0)) | 0, r = rng(seed), x = d.x, kind = d.kind;
    const col = pig(d.hue), col2 = other(col, 1 + (r() * 3 | 0)), bf = boil(age) + (seed & 63);
    g.save(); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const wet = () => { g.globalCompositeOperation = 'screen'; }, dryOn = () => { g.globalCompositeOperation = 'source-over'; };
    if (kind === 'cloud') {                            // a petal wash drifting: blots of pigment, a few petals let go
      wet();
      d.puffs.forEach(([ox, oy, rr], k) => blot(g, k, k % 3 ? (k % 2 ? col : col2) : HUES[k % 5], x + ox * s * 1.2 + Math.sin(age / 1700 + ox * 6) * s * 0.06, y + oy * s * 0.6, s * rr * 2.7, 0.4 * env, k + T * 0.03));
      dryOn();
      const list = [];
      for (let k = 0; k < 4; k++) { const u = (T * 0.07 + k * 0.27 + r()) % 1, px = x + (r() - 0.5) * s * 1.6 + Math.sin(T * 0.9 + k * 2) * s * 0.12, py = y - s * 0.3 + u * s * 1.3; list.push([...leaf(px, py, 0.6 + Math.sin(T * 1.1 + k) * 0.9, s * 0.16, 0.12), Math.sin(PI * u)]); }
      g.fillStyle = '#f3c4c8'; for (const [P, w, a2] of list) { g.globalAlpha = 0.75 * env * a2; ribbons(g, [[P, w]]); }
    } else if (kind === 'bloom') {                     // a bloom of pigment spreading in wet paper
      const sz = s * (1 + 1.5 * ease(age / 5000));
      wet();
      blot(g, seed, col, x, y, sz, 0.55 * env, r() * 6); blot(g, seed + 2, col2, x + sz * 0.12, y + sz * 0.08, sz * 0.62 * ease(age / 7000), 0.5 * env, r() * 6);
      blot(g, seed + 4, PIG.bone, x - sz * 0.05, y, sz * 0.2 * ease(age / 3000), 0.55 * env, r() * 6);
      dryOn(); splatter(g, x, y, sz * 0.5, col, 0.6 * env, seed + 9, 7, age / 2500);
    } else if (kind === 'mandala') {                   // an enso: one breath, one circle
      wet(); blot(g, seed, col, x, y, s * 2.6, 0.22 * env * ease(age / 4000), r() * 6); dryOn();
      enso(g, x, y, s * 0.82, seed, bf, 0.9 * env, { from: r() * TAU, wide: 0.13, nb: 8, n: 40, prog: ease(age / 2200) });
    } else if (kind === 'tree') {                      // an ink twig growing leaf by leaf
      const an = -PI / 2 + (r() - 0.5) * 0.7;
      sprig(g, x, d.y + s * 0.6, an, s * 1.45, ease(age / 5000), seed, env, col === PIG.viridian ? PIG.viridian : (r() < 0.5 ? PIG.viridian : PIG.ochre), PIG.bone, T);
      sprig(g, x + Math.cos(an) * s * 0.45, d.y + s * 0.6 + Math.sin(an) * s * 0.45, an + (r() < 0.5 ? -0.8 : 0.8), s * 0.7, ease((age - 2500) / 4000), seed + 5, env, PIG.ochre, PIG.bone, T);
    } else if (kind === 'moth') {                      // a bird of two brush strokes, flying a looping path
      const k = T * 0.6, px = x + Math.sin(k * 1.3) * s * 1.1, py = y + Math.sin(k * 2.1) * s * 0.5, hd = Math.atan2(Math.cos(k * 2.1) * 1.05, Math.cos(k * 1.3) * 1.43), w = s * 0.62, flap = Math.sin(T * 6.5 + d.spin);
      const hx = Math.cos(hd), hy = Math.sin(hd), wings = [], under = [];
      wet(); blot(g, 3, col, px - hx * w * 0.5, py - hy * w * 0.5, w * 2.6, 0.3 * env, hd); dryOn();
      for (const sd of [-1, 1]) {
        const an = hd + sd * (PI / 2 + 0.2 + 0.55 * flap), reach = w * (0.75 + 0.25 * Math.abs(flap)), P = [];
        for (let q = 0; q <= 8; q++) { const v = q / 8; P.push([px + Math.cos(an) * reach * v - hx * w * 0.42 * v * v, py + Math.sin(an) * reach * v - hy * w * 0.42 * v * v]); }
        wings.push([P, v => w * 0.17 * Math.pow(Math.sin(PI * Math.pow(v, 0.55)), 0.9) + 0.4]);
        under.push([P.map(q => [q[0] - hx * w * 0.14, q[1] - hy * w * 0.14]), v => w * 0.13 * Math.sin(PI * Math.pow(v, 0.7))]);
      }
      g.fillStyle = col2; g.globalAlpha = 0.6 * env; ribbons(g, under);
      wings.push([[[px - hx * w * 0.42, py - hy * w * 0.42], [px, py], [px + hx * w * 0.5, py + hy * w * 0.5]], v => w * 0.05 * (1.1 - v) + 0.4]);   // the body, drawn out into a neck
      g.fillStyle = PIG.bone; g.globalAlpha = 0.9 * env; ribbons(g, wings);
    } else if (kind === 'bubbles') {                   // drops in wet paper: rings of pigment rising, each with a bare rim
      g.lineCap = 'round'; g.strokeStyle = PIG.bone;
      for (let j = 0; j < 6; j++) {
        const ph = (T + j * 0.75) % 4.5, bx = x + Math.sin(ph * 2 + j) * s * 0.3 + (j - 2.5) * s * 0.13, by = d.y + s * 0.6 - ph * s * 0.5, rr = s * (0.07 + 0.04 * (j % 3)) * (0.6 + 0.5 * ph / 4.5), al = env * Math.min(1, ph * 2, (4.5 - ph) * 1.5);
        if (al <= 0.01) continue;
        wet(); blot(g, j, HUES[(j + (seed & 3)) % 5], bx, by, rr * 4.2, 0.6 * al, j); dryOn();
        g.globalAlpha = 0.75 * al; g.lineWidth = Math.max(0.8, rr * 0.13); g.beginPath(); g.arc(bx, by, rr, j * 1.3, j * 1.3 + TAU * 0.82); g.stroke();
      }
    } else if (kind === 'aurora') {                    // one sweep of a broad flat brush, wavering, pigment pooling along it
      const P = [];
      for (let i = 0; i <= 26; i++) { const u = i / 26; P.push([x + (u - 0.5) * s * 4, y + Math.sin(u * 6 + T * 0.9) * s * 0.25 + Math.sin(u * 2.3 + T * 0.35) * s * 0.2]); }
      wet();
      for (let k = 0; k < 4; k++) { const q = P[3 + k * 6]; blot(g, seed + k, k % 2 ? col2 : col, q[0], q[1], s * 1.5, 0.3 * env, k); }
      brush(g, P, u => s * 0.2 * Math.pow(Math.sin(PI * u), 0.5), { seed, color: col, alpha: 0.7 * env, dry: 0.5, nb: 9, prog: ease(age / 1800) });
      dryOn();
      brush(g, P.map(q => [q[0], q[1] - s * 0.1]), u => s * 0.035 * Math.sin(PI * u), { seed: seed + 3, color: PIG.bone, alpha: 0.7 * env, dry: 0.6, nb: 3, prog: ease(age / 2400) });
    } else if (kind === 'orbit') {                     // three loaded brushes circling one eye, each stroke running dry behind it
      const [ex, ey, ea] = o.anchor || [x, y, s * 0.6], list = [], heads = [];
      for (let j = 0; j < 3; j++) {
        const dir = j % 2 ? -1 : 1, an = age / (900 + j * 400) * dir + j * 2.1, rx = ea * (1.18 + j * 0.13), ry = ea * (0.78 + j * 0.09), P = [];
        for (let q = 0; q <= 10; q++) { const a2 = an - dir * (1 - q / 10) * 1.1; P.push([ex + Math.cos(a2) * rx, ey + Math.sin(a2) * ry]); }
        list.push([P, v => ea * 0.05 * v * v + 0.3]); heads.push([P[10][0], P[10][1], ea * 0.055]);
      }
      g.fillStyle = PIG.bone; g.globalAlpha = 0.8 * env; ribbons(g, list); g.fillStyle = col === PIG.indigo ? PIG.ochre : col; g.globalAlpha = 0.95 * env; dots(g, heads);
    } else if (kind === 'tear') {                      // a drop of pigment runs down the paper, and blooms where it stops
      const p = age / d.life, fall = Math.min(1, p / 0.55), ty = d.y + fall * fall * s * 9, tc = col === PIG.ochre || col === PIG.vermilion ? PIG.indigo : col, away = 1 - smooth(seg(p, 0.6, 1));
      g.fillStyle = tc; g.globalAlpha = 0.7 * away;
      ribbons(g, [[[[x, d.y], [x + Math.sin(d.y) * s * 0.06, lerp(d.y, ty, 0.5)], [x, ty]], u => s * (0.05 + 0.1 * u * u) + 0.3]]);
      if (p < 0.6) { g.globalAlpha = 0.95; dots(g, [[x, ty, s * 0.3]]); g.fillStyle = '#fffaf0'; g.globalAlpha = 0.8; dots(g, [[x - s * 0.09, ty - s * 0.1, s * 0.08]]); }
      else { const q = (p - 0.6) / 0.4; wet(); blot(g, seed, tc, x, ty, s * (1.5 + 5 * ease(q)), 0.85 * (1 - q), 1); blot(g, seed + 3, PIG.bone, x, ty, s * (0.6 + 1.2 * ease(q)), 0.5 * (1 - q), 2); }
    } else if (kind === 'stars') {                     // a flick of splatter around an eye, where today's look bursts into stars
      const q = age / d.life, out = ease(q * 4), cols = [[], [], []];
      d.puffs.forEach(([an, rr, ph], k) => {
        const r2 = d.size * rr * (0.35 + 0.75 * out), sz = d.size * 0.03 * (d.big || 1) * (0.5 + 1.4 * ph) * (1 + 0.5 * q), px = x + Math.cos(an) * r2, py = d.y + Math.sin(an) * r2 * 0.7;
        cols[k % 3].push([px, py, sz]);
        if (k % 4 === 0) cols[k % 3].push([px + Math.cos(an) * sz * 2.6, py + Math.sin(an) * sz * 2, sz * 0.4]);   // a small one flung further
      });
      g.globalAlpha = 0.95 * (1 - q * q); [PIG.bone, PIG.ochre, col].forEach((cl, k) => { g.fillStyle = cl; dots(g, cols[k]); });
    } else if (kind === 'ember') {                     // a fleck of vermilion carried up, its wash fading behind it
      const q = age / d.life, px = x + Math.sin(age / 300 + d.spin * 9) * d.size * 6, py = d.y - q * o.H * 0.75, hot = d.spin > 0 ? PIG.vermilion : PIG.ochre;
      wet(); blot(g, seed, hot, px, py, d.size * 7.5, 0.7 * (1 - q), T);
      dryOn(); g.fillStyle = hot; g.globalAlpha = 1 - q; dots(g, [[px, py, d.size * 0.85]]); g.fillStyle = '#ffe9c0'; dots(g, [[px, py, d.size * 0.35]]);
    } else if (kind === 'fireheart') {                 // where today's look lets a heart rise: a drop of red pigment, blooming as it rises
      const q = age / d.life, px = x + Math.sin(age / 500 + d.spin * 7) * d.size, py = d.y - q * o.H * 0.7, sz = d.size * (2.4 + 3.2 * ease(q * 1.6));
      wet(); blot(g, seed, PIG.madder, px, py, sz, 0.9 * (1 - q), d.spin + T * 0.1); blot(g, seed + 2, PIG.vermilion, px, py, sz * 0.55, 0.9 * (1 - q), 2);
      dryOn(); g.fillStyle = PIG.madder; g.globalAlpha = 0.6 * (1 - q); ribbons(g, [[[[px, py], [px + d.size * 0.05, py + d.size * 1.1], [px, py + d.size * 2.2]], u => d.size * 0.09 * (1 - u) + 0.3]]);
      blot(g, 2, '#fff3ea', px - sz * 0.05, py - sz * 0.06, sz * 0.2, 0.8 * (1 - q), 1);
    } else if (kind === 'sparks') {                    // a flick of the fire's colours, flying in from where it flared up
      const q = age / d.life, out = 1 - (1 - q) * (1 - q), cols = [PIG.vermilion, PIG.ochre, '#ffe9c0'];
      g.globalAlpha = 0.95 * (1 - q);
      for (let j = 0; j < 3; j++) {
        g.fillStyle = cols[j]; g.beginPath();
        d.puffs.forEach(([an, sp, ph], k) => {
          if (k % 3 !== j) return;
          const far = d.size * sp * out, px = x + Math.cos(d.dir + an) * far, py = d.y + Math.sin(d.dir + an) * far + d.size * 0.3 * q * q, rr = d.size * 0.011 * (0.5 + ph) * (1.3 - q);
          g.moveTo(px + rr * 4, py); g.ellipse(px, py, rr * (1 + 3 * (1 - q)), rr, d.dir + an, 0, TAU);
        });
        g.fill();
      }
    } else if (kind === 'zzz') {                       // asleep: slow rings of wash rise, each wider and paler than the last
      const q = age / d.life; g.lineCap = 'round';
      for (let j = 0; j < 3; j++) {
        const qj = q - j * 0.14; if (qj < 0) continue;
        const px = x + Math.sin(age / 700 + j * 2) * d.size * 0.5 + qj * d.size * 1.5, py = d.y - qj * d.size * 5, rr = d.size * (0.34 + 1.0 * qj), al = 0.85 * (1 - q) * Math.min(1, qj * 12 + 0.6);
        wet(); blot(g, seed + j, j % 2 ? PIG.violet : PIG.indigo, px, py, rr * 3.6, 0.4 * al, j + T * 0.05);
        g.globalAlpha = 0.3 * al; g.strokeStyle = PIG.indigo; g.lineWidth = rr * 0.42; g.beginPath(); g.arc(px, py, rr, 0, TAU); g.stroke();
        dryOn(); g.globalAlpha = 0.6 * al; g.strokeStyle = PIG.bone; g.lineWidth = Math.max(0.8, rr * 0.05); g.beginPath(); g.arc(px, py, rr * 1.06, j * 2 + T * 0.2, j * 2 + T * 0.2 + TAU * 0.7); g.stroke();
      }
    } else {                                           // whatever else: a flick of the brush – splatter, and one drop that runs
      splatter(g, x, y, s, col, 0.8 * env, seed, 18, age / 600);
      const run = s * 1.8 * ease(age / 8000), P = []; for (let q = 0; q <= 10; q++) P.push([x + Math.sin(q * 0.7 + seed) * s * 0.02, y + run * q / 10]);
      g.fillStyle = col; g.globalAlpha = 0.7 * env; ribbons(g, [[P, u => s * (0.03 - 0.018 * u) + 0.3]]); dots(g, [[x, y + run, s * 0.04]]);
    }
    g.restore(); g.globalAlpha = 1;
  }

  // ---------- the faces of light ----------
  // Three ways a brush hints at whose eyes these are. v is the face rule's word: the sign on the forehead comes with
  // the hints; hair, the jaw and the closed mouth only in the rare moment, and faintly – a few strokes painted in one
  // after the other. The brow is the eye's own. Drawn twice by the page: without `ink` into the mask the dream shines
  // through (so: white), with it as the world's own pigment over that.
  const FACES = ['sumi', 'willow', 'plum'];
  function face(c, mode, t, geo, v, ink, inkAl = 1) {
    const mono = ink === undefined, K = mono ? 0.45 : Math.min(1, inkAl * 4.5);
    const mark = DreamVis.of(v, 'mark') * K, hair = DreamVis.of(v, 'hair') * 1.7 * K, outline = DreamVis.of(v, 'outline') * 1.7 * K, mouth = DreamVis.of(v, 'mouth') * 1.7 * K;
    if (mark + hair + outline + mouth <= 0.004) return;
    const T = t / 1000, F = faceFrame(geo.cx, geo.ey, geo.half, geo.h), a = F.u, sk = skeleton(geo.cx, geo.ey, geo.half, t, geo.h), bf = boil(t);
    const strands = sk.filter(k => k.name === 'strand').map(k => k.pts), jaws = sk.filter(k => k.name === 'jaw').map(k => k.pts), lip = n => sk.find(k => k.name === n).pts, M = sk.find(k => k.name === 'mark').pts[0];
    const pr = (s, e) => smooth(seg(v.fullForm, s, e)), pH = (s, e) => smooth(seg(v.hintForm, s, e));
    const tone = col => mono ? PIG.white : col, wash = (i, col, q, size, al, rot, sy) => blot(c, i, tone(col), q[0], q[1], size, al, rot, sy);
    const stroke = (P, wf, o) => brush(c, P, wf, { ...o, color: tone(o.color) });
    const press = (list, col, al) => { if (al > 0.004 && list.length) { c.fillStyle = tone(col); c.globalAlpha = Math.min(1, al); ribbons(c, list); c.globalAlpha = 1; } };
    const drops = (list, col, al) => { if (al > 0.004 && list.length) { c.fillStyle = tone(col); c.globalAlpha = Math.min(1, al); dots(c, list); c.globalAlpha = 1; } };
    c.save();
    if (mode === 'sumi') {
      // hair as broad dry strokes over washes of indigo and violet, the jaw one stroke each side, an ochre enso on the forehead
      const wa = hair * pr(0.1, 0.8);
      strands.forEach((P, k) => { const i = k % 5; if (i % 2 === 0) for (const [u, col, sz] of [[0.3, PIG.indigo, 3.6], [0.62, PIG.violet, 4.2], [0.88, PIG.viridian, 3.2]]) wash(k + (u * 10 | 0), col, P[Math.floor(u * (P.length - 1))], a * sz, 0.5 * wa, i + u * 5); });
      for (const sd of [-1, 1]) wash(sd > 0 ? 1 : 4, PIG.madder, F(2.45 * sd, 2.1), a * 2.5, 0.45 * outline * pr(0.3, 0.9), sd);
      strands.forEach((P, k) => { const i = k % 5; if (i !== 3) stroke(wob(P, a * 0.012, bf + k), u => a * (0.3 - 0.03 * i) * Math.pow(Math.sin(PI * u), 0.5), { seed: 40 + k, color: i % 2 ? '#aab4ea' : PIG.bone, alpha: (i % 2 ? 0.65 : 0.5) * hair, dry: 0.62, nb: 8, prog: pr(i * 0.07, 0.5 + i * 0.08) }); });
      jaws.forEach((P, k) => stroke(wob(P, a * 0.008, bf + 20 + k), u => a * 0.04 * Math.pow(Math.sin(PI * u), 0.6), { seed: 60 + k, color: PIG.bone, alpha: outline, dry: 0.45, nb: 5, prog: pr(0.1 + k * 0.1, 0.6 + k * 0.1) }));
      const la = mark * pH(0.2, 0.9);
      wash(3, PIG.ochre, M, a * 1.5, 0.5 * la, 1);
      stroke(wob(circ(M[0], M[1], a * 0.3, 24, -2, -2 + TAU * 0.92), a * 0.006, bf), u => a * 0.045 * Math.sin(PI * Math.pow(u, 0.8)), { seed: 84, color: PIG.ochre, alpha: 0.95 * mark, dry: 0.35, nb: 4, prog: pH(0.2, 0.9) });
    } else if (mode === 'willow') {
      // a willow: twigs hanging where hair would fall, leaves set along them one by one; a small sprig on the forehead
      const la = mark * pH(0.1, 1);
      wash(1, PIG.viridian, M, a * 1.5, 0.4 * la, 2);
      sprig(c, M[0] - a * 0.12, M[1] + a * 0.42, -PI / 2 + 0.2, a * 0.95, pH(0.1, 1), 91, la, tone(PIG.viridian), tone(PIG.bone), T);
      const green = [], gold = [], wa = hair * pr(0.2, 0.9);
      strands.forEach((P0, k) => {
        const i = k % 5, sd = k < 5 ? -1 : 1, m = pr(i * 0.08, 0.6 + i * 0.08), P = P0.map((q, j) => [q[0] + Math.sin(T * 0.8 - j * 0.2 + k * 1.3) * a * 0.1 * (j / P0.length), q[1]]), n = Math.ceil(P.length * m);
        if (i === 1) wash(k, PIG.viridian, P[20], a * 3.4, 0.4 * wa, k); else if (i === 3) wash(k + 2, PIG.indigo, P[30], a * 3.6, 0.4 * wa, k);
        stroke(P, u => a * 0.026 * (1.25 - u), { seed: 120 + k, color: PIG.bone, alpha: 0.85 * hair, dry: 0.3, nb: 2, prog: m });
        for (let j = 4 + (i % 2); j < n - 1; j += 3) {
          const tang = Math.atan2(P[j + 1][1] - P[j][1], P[j + 1][0] - P[j][0]), side = (j + i) % 2 ? 1 : -1, an = lerp(tang + side * 0.7, PI / 2 + sd * 0.25, 0.45), grown = ease(seg(n - j, 0, 6));
          ((j * 7 + k) % 5 === 0 ? gold : green).push(leaf(P[j][0], P[j][1], an + Math.sin(T * 1.3 + j + k) * 0.08, a * (0.5 - 0.006 * j) * grown, side * 0.05));
        }
      });
      press(green, PIG.viridian, 0.8 * hair); press(gold, PIG.ochre, 0.8 * hair);
      jaws.forEach((P, k) => stroke(wob(P, a * 0.008, bf + 20 + k), u => a * 0.022 * Math.pow(Math.sin(PI * u), 0.6), { seed: 66 + k, color: PIG.bone, alpha: 0.8 * outline, dry: 0.6, nb: 3, prog: pr(0.2 + k * 0.1, 0.8 + k * 0.1) }));
      const fallen = [];                               // a few leaves let go, sinking past the cheeks
      for (let k = 0; k < 6; k++) { const sd = k % 2 ? 1 : -1, u = (T * 0.05 + hash(5, k)) % 1, q = F(sd * (2.7 + 0.9 * hash(6, k)) + Math.sin(T * 0.7 + k) * 0.15, 1.3 + u * 3.6); fallen.push(leaf(q[0], q[1], PI / 2 + Math.sin(T * 0.9 + k * 2) * 0.9, a * 0.36 * Math.sin(PI * u), 0.1)); }
      press(fallen, PIG.viridian, 0.7 * outline * pr(0.4, 1));
    } else {
      // a plum branch in blossom: dry knotted strokes for the boughs, blossoms dabbed along them, petals falling; a drop
      // of red on the forehead
      const la = mark * pH(0.1, 0.9), sp = [];
      wash(5, PIG.madder, M, a * 1.5 * (0.6 + 0.4 * pH(0.1, 0.9)), 0.8 * la, 1); wash(0, PIG.vermilion, M, a * 0.7, 0.85 * la, 2); wash(2, '#fff3ea', [M[0] - a * 0.06, M[1] - a * 0.07], a * 0.24, 0.8 * la, 0);
      for (let k = 0; k < 5; k++) { const an = hash(3, k) * TAU, rd = a * (0.45 + 0.4 * hash(4, k)); sp.push([M[0] + Math.cos(an) * rd, M[1] + Math.sin(an) * rd * 0.7, a * (0.02 + 0.03 * hash(8, k))]); }
      drops(sp, PIG.madder, 0.85 * la * pH(0.5, 1));
      const wa = hair * pr(0.2, 1), centres = [], petals = [];
      strands.forEach((P0, k) => {
        const i = k % 5; if (i % 2) return;
        const m = pr(i * 0.06, 0.55 + i * 0.08), P = wob(P0, a * 0.07, 7 + k), n = Math.ceil(P.length * m);
        stroke(P, u => a * 0.085 * (1.15 - u) * (0.6 + 0.8 * n1(u * 9, k)), { seed: 140 + k, color: '#d6cdbf', alpha: 0.75 * hair, dry: 0.55, nb: 5, prog: m });
        for (let j = 6 + i; j < n; j += 7) {
          const q = P[j], grown = ease(seg(n - j, 0, 8)), ox = (hash(k, j) - 0.5) * a * 0.5, oy = (hash(k + 20, j) - 0.5) * a * 0.5;
          wash(j + k, PIG.madder, [q[0] + ox, q[1] + oy], a * 1.3 * grown, 0.75 * wa, j); wash(j + k + 3, '#f6b3c0', [q[0] + ox + a * 0.12, q[1] + oy - a * 0.08], a * 0.75 * grown, 0.75 * wa, j * 2);
          for (let e = 0; e < 3; e++) centres.push([q[0] + ox + (hash(j, e) - 0.5) * a * 0.22, q[1] + oy + (hash(j + 9, e) - 0.5) * a * 0.22, a * 0.03 * grown]);
        }
      });
      drops(centres, PIG.ochre, 0.9 * hair * pr(0.5, 1));
      for (let k = 0; k < 9; k++) { const sd = k % 2 ? 1 : -1, u = (T * 0.045 + hash(15, k)) % 1, q = F(sd * (3.0 + 1.6 * hash(16, k)) + Math.sin(T * 0.6 + k) * 0.2, -1.5 + u * 6.5); petals.push(leaf(q[0], q[1], Math.sin(T * 0.8 + k * 2) * 1.4 + 1, a * 0.26 * Math.sin(PI * u), 0.16)); }
      press(petals, '#f6b3c0', 0.75 * hair * pr(0.5, 1));
      for (const sd of [-1, 1]) wash(sd > 0 ? 6 : 2, PIG.madder, F(2.5 * sd, 2.0), a * 2.3, 0.4 * outline * pr(0.3, 0.9), sd * 2);
      const oa = outline * pr(0.2, 1), jd = [];        // the jaw: a dry line, and drops where the brush was shaken
      jaws.forEach((P, k) => {
        stroke(wob(P, a * 0.008, bf + 20 + k), u => a * 0.02 * Math.pow(Math.sin(PI * u), 0.6), { seed: 68 + k, color: PIG.bone, alpha: 0.6 * oa, dry: 0.75, nb: 2, prog: pr(0.2 + k * 0.1, 0.8 + k * 0.1) });
        for (let j = 3; j < P.length * pr(0.2, 0.9); j += 3) jd.push([P[j][0] + (hash(k + 30, j) - 0.5) * a * 0.2, P[j][1] + (hash(k + 40, j) - 0.5) * a * 0.2, a * (0.02 + 0.05 * hash(k + 50, j) ** 2)]);
      });
      drops(jd, PIG.bone, 0.9 * oa);
    }
    const ma = mouth * pr(0.45, 1);                    // the mouth: closed – a small wash, one line between the lips, a dry one below
    if (ma > 0.004) {
      const upl = lip('upper lip'), low = lip('lower lip'), fit = clamp((low[10][1] - upl[15][1]) / (a * 0.88), 0.3, 1);   // (as small as the face is pressed together)
      wash(2, mode === 'willow' ? '#d98f7c' : PIG.madder, F(0, 3.95), a * 2.9 * fit, 0.9 * ma, 0.2, 0.42);
      stroke(wob(lip('lips'), a * 0.005, bf + 50), u => a * 0.024 * Math.sin(PI * u), { seed: 81, color: PIG.bone, alpha: ma, dry: 0.3, nb: 3, prog: pr(0.45, 0.8) });
      stroke(wob(low, a * 0.005, bf + 52), u => a * 0.014 * Math.sin(PI * u), { seed: 83, color: PIG.bone, alpha: 0.7 * ma, dry: 0.55, nb: 2, prog: pr(0.6, 1) });
    }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- the large motifs of a dream window (world-classic.js describes m and o) ----------
  const stain = (c, cx, cy, R, T, al) => {             // pigment around a motif, bled into the paper
    c.save(); c.globalCompositeOperation = 'screen';
    for (let k = 0; k < 4; k++) { const an = k * 1.7 + 0.5 + T * 0.02; blot(c, k + 2, HUES[(k * 2) % 5], cx + Math.cos(an) * R * 1.9, cy + Math.sin(an) * R * 2, R * 2.3, al, k); }
    c.restore();
  };
  // --- the third eye: the eye in a brushed enso, quick flicks standing all around it like lashes, an ochre drop above.
  // In trance it opens in every window
  function third(c, m, t, dt, o) {
    const [cx, cy] = o.mid, R = Math.min(o.W, o.H) * 0.27 * (1 + 0.02 * o.pulse), T = t / 1000, bf = boil(t), n = [14, 24, 34][o.tier], list = [];
    night(c, cx, cy, R * 2.1, 0.6); stain(c, cx, cy, R, T, 0.2);
    c.save();
    c.fillStyle = 'rgba(8,6,14,.9)'; disc(c, cx, cy, R, 77, 0.03, 60); c.fill();
    for (let k = 0; k < n; k++) {                      // none like the other, and they breathe
      const an = k / n * TAU + (hash(17, k) - 0.5) * 0.12, len = R * (0.16 + 0.34 * hash(18, k)) * (1 + 0.12 * Math.sin(T * 0.9 + k * 1.7)), lean = (hash(19, k) - 0.5) * 0.7 + 0.25, r0 = R * 1.16, P = [];
      for (let q = 0; q <= 5; q++) { const vv = q / 5; P.push([cx + Math.cos(an + lean * vv * vv * 0.3) * (r0 + len * vv), cy + Math.sin(an + lean * vv * vv * 0.3) * (r0 + len * vv)]); }
      list.push([P, vv => R * 0.022 * (1 - vv) + 0.3]);
    }
    c.fillStyle = PIG.bone; c.globalAlpha = 0.85; ribbons(c, list); c.globalAlpha = 1;
    enso(c, cx, cy, R * 1.04, 201, bf, 1, { nb: o.tier ? 11 : 7, fine: PIG.ochre });
    const dx = cx + R * 0.1, dy = cy - R * 1.62;       // the sign: a drop of ochre in a ring of its own
    c.globalCompositeOperation = 'screen'; blot(c, 3, PIG.ochre, dx, dy, R * 0.75, 0.6, 1); c.globalCompositeOperation = 'source-over';
    enso(c, dx, dy, R * 0.13, 211, bf, 0.95, { nb: 4, n: 20, wide: 0.16, color: PIG.ochre, bare: true, from: -1 });
    c.restore(); c.globalAlpha = 1;
    m.mirror = false;
    o.eye(c, m, dt, cx, cy + R * 0.04, R * 0.7, DreamEye.LOOKS.golden);
  }
  // --- a mandala: the dream folded in a brushed enso, twigs growing out of it leaf by leaf, again and again
  function mandala(c, m, t, dt, o) {
    const [cx, cy] = o.mid, R = Math.min(o.W, o.H) * 0.3 * (1 + 0.03 * o.pulse), T = t / 1000, ph = (m.seed % 628) / 100, bf = boil(t);
    night(c, cx, cy, R * 2, 0.55); stain(c, cx, cy, R, T, 0.22);
    c.save();
    c.fillStyle = '#000'; disc(c, cx, cy, R, 77, 0.035, 60); c.fill();
    c.save(); disc(c, cx, cy, R, 77, 0.035, 60); c.clip();
    o.softPiece(c, t, (sc, n) => kaleido(sc, o.pic, n, t, ph, o.tier ? 12 : 8), cx, cy, R * 1.12, 1);
    c.globalCompositeOperation = 'multiply'; c.globalAlpha = 0.5; tile(c, grain(), o.W, o.H, Math.max(o.W, o.H) / 256, 0, 0, 0);
    c.restore(); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    enso(c, cx, cy, R * 1.04, 201, bf, 1, { nb: o.tier ? 11 : 7 });
    for (let k = 0; k < [3, 4, 5][o.tier]; k++) {
      const age = (T + k * 4.4 + 9) % 22, an = k / 5 * TAU + 0.4 + Math.floor((T + k * 4.4 + 9) / 22) * 0.7 + ph, env = smooth(age) * smooth((22 - age) / 4);
      sprig(c, cx + Math.cos(an) * R * 1.06, cy + Math.sin(an) * R * 1.06, an + 0.5, R * 0.95, ease(age / 7), 300 + k, env, k % 2 ? PIG.viridian : PIG.ochre, PIG.bone, T);
    }
    const r = rng(55 + (m.seed & 255)), sp = [];
    for (let k = 0; k < 26; k++) { const an = r() * TAU, rd = R * (1.2 + r() * 0.9); sp.push([cx + Math.cos(an) * rd, cy + Math.sin(an) * rd, R * (0.006 + 0.03 * r() * r())]); }
    c.fillStyle = PIG.bone; c.globalAlpha = 0.55; dots(c, sp);
    c.restore(); c.globalAlpha = 1;
  }
  // --- impossible shapes (DreamLife.impossible): every face a wash of the dream, the edges brushed and running dry,
  // a drop where two strokes meet
  function shape(c, m, t, dt, o) {
    const sh = DreamLife.impossible(m.kind), [cx, cy] = o.mid, Sz = Math.min(o.W, o.H) * 0.485 * (1 + 0.025 * o.pulse), bf = boil(t);
    const path = f => { c.beginPath(); for (const [x, y] of f.pts) c.lineTo(x * Sz, y * Sz); c.closePath(); };
    night(c, cx, cy, Sz * 1.15, 0.6);
    c.save(); c.translate(cx, cy); c.rotate((m.seed & 1 ? 1 : -1) * t / 1000 * TAU / 150 + m.seed % 7);
    sh.faces.forEach((f, i) => {
      c.save(); path(f); c.clip();
      const n = Sz * 3.1, u = 0.5 + 0.14 * Math.sin(i * 2.1 + t / 9000), v = 0.5 + 0.14 * Math.cos(i * 1.3 + t / 11000);
      c.globalAlpha = f.fade ? 0.35 : f.glass ? 0.15 : 0.8; c.drawImage(o.pic, -u * n, -v * n, n, n);
      c.globalAlpha = Math.min(0.9, 0.3 + f.shade * 0.9) * (f.glass ? 0.3 : 1); c.fillStyle = PIG.ink; c.fillRect(-Sz * 1.1, -Sz * 1.1, Sz * 2.2, Sz * 2.2);
      if (o.tier > 0 && !f.glass) { const mx = f.pts.reduce((s, q) => s + q[0], 0) / f.pts.length * Sz, my = f.pts.reduce((s, q) => s + q[1], 0) / f.pts.length * Sz; c.globalCompositeOperation = 'screen'; blot(c, i, HUES[i % 5], mx, my, Sz * 1.1, f.fade ? 0.12 : 0.24, i); }
      c.restore();
    });
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    const seen = new Map(), corners = new Map(), key = (x, y) => Math.round(x * 40) + ':' + Math.round(y * 40);
    for (const f of sh.faces) {
      const faint = f.fade || f.glass || f.wall;
      f.pts.forEach((p0, j) => {
        const p1 = f.pts[(j + 1) % f.pts.length], ka = key(p0[0], p0[1]), kb = key(p1[0], p1[1]), k = ka < kb ? ka + '|' + kb : kb + '|' + ka, e = seen.get(k);
        if (!e) seen.set(k, { a: p0, b: p1, faint }); else if (!faint) e.faint = false;
        if (!f.wall && !f.fade) corners.set(ka, p0);
      });
    }
    let idx = 0;
    for (const e of seen.values()) {
      const P = [], n = 7, len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * Sz, flip = idx % 2;
      for (let q = 0; q <= n; q++) { const u = flip ? 1 - q / n : q / n; P.push([lerp(e.a[0], e.b[0], u) * Sz, lerp(e.a[1], e.b[1], u) * Sz]); }
      brush(c, wob(P, Math.min(Sz * 0.004, len * 0.02), bf + idx), u => Sz * (e.faint ? 0.004 : 0.011) * (0.55 + 0.45 * Math.sin(PI * Math.pow(u, 0.6))), { seed: 500 + idx, color: PIG.bone, alpha: e.faint ? 0.35 : 0.9, dry: e.faint ? 0.7 : 0.4, nb: e.faint ? 1 : o.tier ? 3 : 2 });
      idx++;
    }
    if (o.tier > 0) { c.fillStyle = PIG.bone; c.globalAlpha = 0.8; dots(c, [...corners.values()].map(([x, y], i) => [x * Sz + (hash(71, i) - 0.5) * Sz * 0.012, y * Sz + (hash(72, i) - 0.5) * Sz * 0.012, Sz * (0.008 + 0.01 * hash(73, i))])); c.globalAlpha = 1; }
    if (sh.path) {                                     // a drop of ochre walks the stairs – always upwards, never arriving
      const n = sh.path.length, u = (t / 620) % n, k = u | 0, fr = u - k, e = fr < 0.5 ? 2 * fr * fr : 1 - (-2 * fr + 2) ** 2 / 2, [ax, ay] = sh.path[k], [bx, by] = sh.path[(k + 1) % n];
      const x = lerp(ax, bx, e) * Sz, y = (lerp(ay, by, e) - 0.06 - 0.07 * Math.sin(fr * PI)) * Sz;
      c.globalCompositeOperation = 'screen'; blot(c, 3, PIG.ochre, x, y, Sz * 0.22, 0.7, t / 900); c.globalCompositeOperation = 'source-over';
      c.fillStyle = PIG.ochre; dots(c, [[x, y, Sz * 0.026]]); c.fillStyle = '#fffaf0'; dots(c, [[x - Sz * 0.008, y - Sz * 0.009, Sz * 0.008]]);
    }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- the night behind Dreamy Eyes: the dream painted into the paper (white into bk where it shows) ----------
  function backMask(bk, mode, t, w, h, al, o) {
    const m = Math.min(w, h), T = t / 1000, D = Math.hypot(w, h);
    bk.save();
    if (mode === 'clouds') {                           // washes laid wet into wet, drifting – most of the paper stays black
      for (let k = 0; k < 10; k++) {
        const x = (((hash(7, k) + T * 0.004 * (0.5 + hash(9, k))) % 1.3) - 0.15) * w, y = (0.08 + 0.84 * hash(8, k)) * h + Math.sin(T * 0.11 + k) * m * 0.03;
        blot(bk, k, PIG.white, x, y, m * (0.55 + 0.6 * hash(5, k)) * (1 + 0.05 * Math.sin(T * 0.3 + k)), al * 0.55, k + T * 0.012 * (k % 2 ? 1 : -1));
      }
    } else if (mode === 'fractal') {                   // a great spiral in three sweeps of a dry brush, turning slowly; splatter between
      for (let j = 0; j < 3; j++) {
        const P = [];
        for (let i = 0; i <= 44; i++) { const u = i / 44, an = j * TAU / 3 + T * 0.03 + u * 3.6, rr = D * (0.1 + 0.5 * u); P.push([w / 2 + Math.cos(an) * rr, h / 2 + Math.sin(an) * rr * 0.9]); }
        brush(bk, P, u => m * 0.085 * Math.pow(Math.sin(PI * Math.pow(u, 0.6)), 0.6), { seed: 31 + j, color: PIG.white, alpha: al * 0.6, dry: 0.5, nb: 9 });
      }
      const sp = [];
      for (let k = 1; k < 70; k++) { const u = Math.sqrt(k / 70), an = k * 2.39996 - T * 0.02, rr = D * 0.56 * u; sp.push([w / 2 + Math.cos(an) * rr, h / 2 + Math.sin(an) * rr * 0.9, m * (0.004 + 0.02 * hash(11, k) ** 2)]); }
      bk.fillStyle = PIG.white; bk.globalAlpha = al * 0.7; dots(bk, sp);
    } else {                                           // rings of the brush around the eyes, turning against each other, a wash between them
      for (let i = 0; i < 4; i++) {
        const rr = m * (0.34 + 0.21 * i) * (1 + 0.02 * Math.sin(T * 0.5 + i)), a0 = T * 0.04 * (i % 2 ? -1 : 1) + i * 1.9;
        brush(bk, circ(w / 2, h / 2, rr, 60, a0, a0 + TAU * 0.9).map(([x, y]) => [x, h / 2 + (y - h / 2) * 0.92]), u => m * (0.05 + 0.012 * i) * (0.25 + 0.75 * Math.sin(PI * Math.pow(u, 0.7))), { seed: 41 + i, color: PIG.white, alpha: al * 0.6, dry: 0.5, nb: 8 });
        for (let k = 0; k < 3 + i; k++) { const an = -a0 * 0.7 + k * TAU / (3 + i) + i; blot(bk, i * 3 + k, PIG.white, w / 2 + Math.cos(an) * (rr + m * 0.1), h / 2 + Math.sin(an) * (rr + m * 0.1) * 0.92, m * 0.34, al * 0.4, an); }
      }
    }
    bk.restore();
  }

  // ---------- the sky of a dream window: the dream as washes, wet into wet, a little pigment bled into them ----------
  function skyClouds(cg, t, o) {
    const { w, h } = o, T = t / 1000 + o.drift * 40, m = Math.min(w, h), cx = w / 2, cy = h / 2, R = m * 0.3, n = [9, 12, 14][o.tier];
    for (let k = 0; k < n; k++) {
      const an = k / n * TAU + T * 0.012 + noise2(k, 1 + o.index) * 0.6, rad = R * (1.0 + 0.6 * noise2(k, 3)) * (1 + 0.1 * o.swell), sz = R * (1.9 + 1.3 * noise2(k, 9)) * (1 + 0.07 * Math.sin(T * 0.4 + k) + 0.08 * o.swell);
      blot(cg, k, PIG.white, cx + Math.cos(an) * rad * w / m, cy + Math.sin(an) * rad * 1.1 * h / m, sz, 0.8, k + T * 0.02);
    }
    blot(cg, 3, PIG.white, cx, cy, R * 3.4, 0.9, o.index);
    cg.globalAlpha = 1; cg.globalCompositeOperation = 'source-in';
    o.dream(cg, 0, 0, w, h, 1.2 + 0.1 * Math.sin(T / 19 + o.index), 0.5 + 0.2 * Math.sin(T / 26 + o.index * 1.7), 0.5 + 0.2 * Math.cos(T / 33 + o.index * 2.3));
    cg.globalCompositeOperation = 'source-atop';
    if (o.tier > 0) for (let k = 0; k < 4; k++) { const an = k * 1.7 + 0.5 + T * 0.02 + o.index; blot(cg, k + 2, HUES[(k * 2 + o.index) % 5], cx + Math.cos(an) * R * 1.7 * w / m, cy + Math.sin(an) * R * 1.6 * h / m, R * 2.4, 0.2, k); }
    cg.globalCompositeOperation = 'source-over'; cg.globalAlpha = 1;
  }

  // ---------- what fills the night: the paper's grain, in every wash that lies on it ----------
  function air(g, t, o) {
    if (o.tier < 1) return;                            // (the one thing here that fills the whole screen: not on a weak device)
    g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 1;
    tile(g, grain(), o.W, o.H, Math.max(o.W, o.H) / 256, 0, 0, 0);
    g.restore();
  }

  // ---------- fire: vermilion and ochre washes swelling up from below, brushed tongues rising, flecks carried up ----------
  function flames(g, t, k, side, o) {
    const { W, H } = o, T = t / 1000, few = o.perf <= 30, n = (W > H ? 10 : 6) * (few ? 0.7 : 1) | 0, m = Math.min(W, H), kk = Math.min(1, k), cols = [PIG.vermilion, PIG.ochre, PIG.vermilion, '#ffd9a0'];
    g.save(); g.globalCompositeOperation = 'screen';
    for (let i = 0; i < (few ? 5 : 8); i++) {          // the washes: each swells up, pales, and comes again
      const u = (T / (5 + i % 3) + hash(53, i)) % 1, x = W * (side + (hash(54, i) - 0.5) * 1.3), near = (x / W - side) / 0.35;
      blot(g, i, [PIG.vermilion, PIG.madder, PIG.ochre][i % 3], x, H * (1.04 - 0.34 * k * u * (0.6 + 0.4 * Math.exp(-near * near))), Math.max(W, H) * 0.5 * (0.55 + 0.45 * k) * (0.7 + 0.5 * u), 0.75 * kk * Math.sin(PI * Math.pow(u, 0.6)), i + T * 0.04);
    }
    for (let i = 0; i < n; i++) {                      // the tongues: loaded strokes rising, running dry at their tips
      const u = (i + 0.5) / n + 0.03 * Math.sin(i * 7.1), near = (u - side) / 0.3, hh = H * 0.52 * k * (0.5 + 0.5 * hash(51, i)) * (0.7 + 0.6 * Math.exp(-near * near)) * (0.85 + 0.15 * Math.sin(T * 3 + i * 2)), P = [];
      for (let q = 0; q <= 12; q++) { const v = q / 12; P.push([u * W + Math.sin(T * 2.4 - v * 3.2 + i * 1.7) * m * 0.05 * v + (hash(52, i) - 0.5) * hh * 0.3 * v, H + 6 - hh * v]); }
      brush(g, P, v => m * (0.03 + 0.02 * hash(55, i)) * Math.pow(1 - v, 0.7) + 0.5, { seed: 600 + i, color: cols[i % 4], alpha: 0.85 * kk, dry: 0.5, nb: few ? 4 : 6, run: T * 1.6 });
    }
    const sp = [];
    for (let i = 0; i < 16; i++) { const u = (T / (2.2 + (i % 5) * 0.5) + hash(56, i)) % 1; sp.push([W * (side + (hash(57, i) - 0.5) * 0.9) + Math.sin(T * 1.3 + i) * m * 0.03, H * (1 - 0.62 * k * u), m * (0.003 + 0.007 * hash(58, i)) * Math.sin(PI * u)]); }
    g.fillStyle = '#ffd9a0'; g.globalAlpha = 0.9 * kk; dots(g, sp);
    g.restore();
  }

  // ---------- the trance (world-classic.js describes p and o) ----------
  function tranceBack(g, t, p, o) {                    // the paper darkens; ensos fly towards the eye; rings of leaves turn around it; splatter is drawn in
    const { W, H } = o, T = t / 1000, R = Math.hypot(W, H) * 0.55, few = o.perf <= 45, bf = boil(t);
    g.save();
    g.fillStyle = `rgba(8,6,14,${0.6 * p.dim})`; g.fillRect(0, 0, W, H);
    if (p.tun > 0.01) for (let j = 0; j < 6; j++) {
      const s = (T / 1.8 + j / 6) % 1, r = R * (1 - s) ** 1.6 + p.A * 0.6, a0 = T / 4 + j * 2.1;
      brush(g, circ(p.ex, p.ey, r, 34, a0, a0 + TAU * 0.9).map(([x, y]) => [x, p.ey + (y - p.ey) * 0.92]), u => p.A * (0.03 + 0.12 * (1 - s)) * (0.25 + 0.75 * Math.sin(PI * Math.pow(u, 0.7))), { seed: 700 + j, color: j % 3 ? PIG.bone : HUES[j % 5], alpha: 0.7 * p.tun * Math.sin(s * PI), dry: 0.5, nb: few ? 4 : 6 });
    }
    if (p.mand > 0.01) {
      g.globalCompositeOperation = 'screen';
      for (let k = 0; k < 5; k++) { const an = k * TAU / 5 - T * 0.05; blot(g, k, HUES[k], p.ex + Math.cos(an) * p.A * 2.1, p.ey + Math.sin(an) * p.A * 2.1, p.A * 2.6, 0.3 * p.mand, k + T * 0.03); }
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < (few ? 2 : 3); i++) {
        const r = p.A * (1.3 + i * 0.75) * (1 + 0.05 * Math.sin(T * 1.1)) * (0.6 + 0.4 * p.mand), n = 12 + i * 7, list = [], turn = T / (5 + i * 1.3) * (i % 2 ? -1 : 1);
        for (let k = 0; k < n; k++) { const an = k / n * TAU + turn; list.push(leaf(p.ex + Math.cos(an) * r, p.ey + Math.sin(an) * r, an + (i % 2 ? -0.5 : 0.5), p.A * (0.5 + 0.1 * i) * (0.8 + 0.4 * hash(81 + i, k)), i % 2 ? -0.06 : 0.06)); }
        g.fillStyle = [PIG.viridian, PIG.ochre, PIG.madder][i]; g.globalAlpha = 0.75 * p.mand; ribbons(g, list); g.globalAlpha = 1;
        enso(g, p.ex, p.ey, r * 0.94, 710 + i, bf, 0.6 * p.mand, { nb: 3, wide: 0.014, n: 40, bare: true, from: -turn });
      }
    }
    if (p.pull > 0.01) {                               // everything is drawn in: drops flung towards the eye, streaking
      for (let j = 0; j < 3; j++) {
        g.fillStyle = [PIG.bone, PIG.ochre, PIG.indigo][j]; g.globalAlpha = 0.85 * p.pull; g.beginPath();
        for (let k = j; k < 45; k += 3) {
          const s = (T / 1.3 + k / 45 * 3.7) % 1, r = R * (1 - s), an = k * 2.399 + s * 5 + T / 1.5, x = p.ex + Math.cos(an) * r, y = p.ey + Math.sin(an) * r, rr = p.A * 0.035 * (0.4 + s) * (0.6 + hash(91, k));
          g.moveTo(x + rr * 4, y); g.ellipse(x, y, rr * 3.2, rr * 0.8, an + 1.2, 0, TAU);
        }
        g.fill();
      }
    }
    g.restore(); g.globalAlpha = 1;
  }
  function tranceEye(g, t, p, o) {                     // the third eye: a bone wash standing upright between two loaded strokes, flicks all along them
    const { ex, ey, A } = p, B = A * 0.5 * p.eo, { W, H } = o, T = t / 1000, bf = boil(t);
    g.save();
    if (p.dot > 0.01) {                                // what is left at the end: a drop of ochre in the paper
      g.globalCompositeOperation = 'screen'; blot(g, 3, PIG.ochre, ex, ey, A * 1.3 * (0.6 + 0.4 * p.dot), p.dot, T * 0.1); g.globalCompositeOperation = 'source-over';
      g.globalAlpha = p.dot; g.fillStyle = PIG.ochre; dots(g, [[ex, ey, A * 0.09]]); g.fillStyle = '#fffaf0'; dots(g, [[ex - A * 0.025, ey - A * 0.03, A * 0.03]]); g.globalAlpha = 1;
    }
    if (p.eo > 0.01) {
      const side = s => curve([[ex, ey - A], [ex + s * B * 1.02, ey - A * 0.45], [ex + s * B * 1.02, ey + A * 0.45], [ex, ey + A]], 10), l = side(-1), r = side(1);
      const almond = () => { g.beginPath(); g.moveTo(ex, ey - A); g.quadraticCurveTo(ex + B * 2, ey, ex, ey + A); g.quadraticCurveTo(ex - B * 2, ey, ex, ey - A); };
      g.globalCompositeOperation = 'screen';
      blot(g, 1, PIG.violet, ex - A * 0.5, ey - A * 0.2, A * 2.6, 0.3 * p.eo, 1 + T * 0.02); blot(g, 4, PIG.madder, ex + A * 0.5, ey + A * 0.3, A * 2.3, 0.28 * p.eo, 2 - T * 0.02);
      g.globalCompositeOperation = 'source-over'; g.save(); almond(); g.clip();
      g.fillStyle = '#e6dcc8'; g.globalAlpha = 0.95; g.fillRect(ex - A, ey - A, A * 2, A * 2);
      g.globalCompositeOperation = 'multiply'; blot(g, 4, PIG.shadow, ex - A * 0.6, ey, A * 2.2, 0.9, 1); blot(g, 0, PIG.shadow, ex + A * 0.7, ey - A * 0.3, A * 1.6, 0.7, 3);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      const ir = A * 0.4;
      g.save(); disc(g, ex, ey, ir, 13, 0.05, 44); g.clip();
      g.fillStyle = PIG.ink; g.fillRect(ex - ir * 1.1, ey - ir * 1.1, ir * 2.2, ir * 2.2);
      g.save(); g.translate(ex, ey); g.rotate(T / 6); g.translate(-ex, -ey);
      if (o.dream) cover(g, o.dream, ex - ir * 1.1, ey - ir * 1.1, ir * 2.2, ir * 2.2); else { g.fillStyle = PIG.indigo; g.fillRect(ex - ir * 1.1, ey - ir * 1.1, ir * 2.2, ir * 2.2); }
      g.restore();
      g.globalAlpha = 0.6; g.drawImage(fibre(), ex - ir * 1.05, ey - ir * 1.05, ir * 2.1, ir * 2.1); g.globalAlpha = 1;
      g.restore();
      brush(g, wob(circ(ex, ey, ir * 0.97, 36, 1, 1 + TAU * 0.97), ir * 0.012, bf), u => ir * 0.085 * (0.3 + 0.7 * Math.sin(PI * u)), { seed: 5, color: '#17132b', alpha: 0.95, dry: 0.3, nb: 5 });
      g.fillStyle = PIG.ink; disc(g, ex, ey, ir * (0.38 + 0.5 * p.pull), 6, 0.1, 30); g.fill();
      blot(g, 2, '#fffaf0', ex - ir * 0.4, ey - ir * 0.42, ir * 0.55, 0.95, 1.3);
      g.restore();
      const wf = u => A * 0.05 * (0.2 + 0.8 * Math.pow(Math.sin(PI * Math.pow(u, 0.8)), 0.8)), flicks = [];
      brush(g, wob(l, A * 0.006, bf), wf, { seed: 11, color: PIG.bone, alpha: 0.97 * Math.min(1, p.eo * 2), dry: 0.36, nb: 7 });
      brush(g, wob(r, A * 0.006, bf + 3), wf, { seed: 12, color: PIG.bone, alpha: 0.97 * Math.min(1, p.eo * 2), dry: 0.36, nb: 7 });
      for (const [P, s] of [[l, -1], [r, 1]]) for (let i = 4; i < P.length - 4; i += 3) {
        const len = A * 0.26 * p.eo * (0.55 + 0.8 * n1(i * 1.7, 3 + s)), up = (i / P.length - 0.5) * 1.6, wig = (n1(i, bf) - 0.5) * 0.08, Lp = [];
        for (let q = 0; q <= 5; q++) { const v = q / 5; Lp.push([P[i][0] + s * len * v, P[i][1] + len * (up + wig) * v * v - len * 0.25 * v * (1 - v)]); }
        flicks.push([Lp, v => A * 0.016 * (1 - v) + 0.3]);
      }
      g.fillStyle = PIG.bone; g.globalAlpha = 0.92 * Math.min(1, p.eo * 2); ribbons(g, flicks); g.globalAlpha = 1;
    }
    if (p.view > 0.01 && o.dream) {                    // through the wide pupil: the dream, large and clear, in an enso
      const R = Math.min(W, H) * 0.46 * p.view;
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, p.view * 1.2);
      g.save(); disc(g, ex, ey, R * 0.96, 77, 0.03, 60); g.clip(); cover(g, o.dream, ex - R, ey - R, R * 2, R * 2); g.restore();
      g.globalAlpha = 1; enso(g, ex, ey, R, 201, bf, Math.min(1, p.view * 1.2), { nb: o.perf > 45 ? 11 : 7 });
    }
    g.restore(); g.globalAlpha = 1;
  }

  // ---------- "you in the dream", and a painted face coming through the pupils: what is drawn around the picture ----------
  const you = {
    FRAMES: ['enso', 'twigs', 'wash'],
    behind: {
      enso(c, n, t, hue, al) {                         // one great enso behind the head, pigment bled into the paper inside it
        c.save(); c.globalCompositeOperation = 'screen';
        blot(c, 3, PIG.ochre, n * 0.5, n * 0.42, n * 0.95, 0.4 * al, t / 30000); blot(c, 1, pig(hue), n * 0.42, n * 0.5, n * 0.7, 0.3 * al, 2);
        c.globalCompositeOperation = 'source-over';
        enso(c, n * 0.5, n * 0.44, n * 0.37, 801, boil(t), al, { from: -2.2 + Math.sin(t / 9000) * 0.3, wide: 0.075, nb: 10 });
        c.restore(); c.globalAlpha = 1;
      },
      wash(c, n, t, hue, al) {                         // washes of pigment around them, wet into wet, breathing
        const T = t / 1000, p1 = pig(hue);
        c.save(); c.globalCompositeOperation = 'screen';
        for (let k = 0; k < 9; k++) { const an = k / 9 * TAU + Math.sin(T / 6 + k) * 0.2 + T / 50, rr = n * (0.3 + 0.04 * Math.sin(T / 2.7 + k * 2.1)); blot(c, k, k % 3 ? other(p1, k) : p1, n / 2 + Math.cos(an) * rr * 1.05, n * 0.48 + Math.sin(an) * rr, n * (0.5 + 0.08 * Math.sin(T / 3 + k)), 0.5 * al, k + T * 0.02); }
        c.restore(); c.globalAlpha = 1;
      },
    },
    front: {
      twigs(c, n, t, hue, al) {                        // ink twigs growing up around them from below, their leaves stirring
        const T = t / 1000;
        c.save();
        for (let k = 0; k < 6; k++) { const sd = k % 2 ? 1 : -1, j = k >> 1, x = n * (0.5 + sd * (0.3 + 0.07 * j)), y = n * (0.98 - 0.2 * j); sprig(c, x, y, -PI / 2 + sd * (0.15 + 0.2 * j) + Math.sin(T * 0.5 + k) * 0.04, n * (0.42 - 0.05 * j), 0.8 + 0.2 * Math.sin(T * 0.3 + k * 1.3), 820 + k, al, k % 3 === 2 ? PIG.ochre : PIG.viridian, PIG.bone, T); }
        c.restore(); c.globalAlpha = 1;
      },
    },
    tints: (hue, t) => ({ glow: pig(hue), halo: PIG.bone, rim: t % 9000 < 4500 ? PIG.ochre : PIG.bone }),
    spark(c, x, y, r, hue, tw, al, k) {                // a drop of splatter, bone or a pigment
      c.save(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = Math.min(1, (0.45 + 0.5 * tw) * al); c.fillStyle = (k || 0) % 3 ? PIG.bone : HUES[(k || 0) % 5];
      c.beginPath(); c.ellipse(x, y, r * (0.75 + 0.3 * hash(95, k || 0)), r * 0.7, (k || 0) * 1.3, 0, TAU); c.fill(); c.restore();
    },
    cloud(c, cx, cy, size, t, al) {                    // the wash a picture comes in: blots laid over each other, their edges granulated
      const T = t / 1000;
      c.save(); c.globalCompositeOperation = 'lighter';
      blot(c, 3, PIG.white, cx, cy, size * (1.5 + 0.04 * Math.sin(T / 1.3)), al, 0.3); blot(c, 5, PIG.white, cx, cy, size * 1.25, al, 2);
      for (let k = 0; k < 10; k++) {
        const an = k / 10 * TAU + 0.25 * Math.sin(T / 3.7 + k) + T / 21 * (k % 2 ? 1 : -1), rr = size * (0.27 + 0.06 * Math.sin(T / 1.9 + k * 1.9));
        blot(c, k, PIG.white, cx + Math.cos(an) * rr * 1.05, cy + Math.sin(an) * rr * 1.2, size * (0.75 + 0.12 * Math.sin(T / 1.5 + k * 2.3)), al * 0.9, k + T * 0.03);
      }
      c.restore(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    },
    rings(g, pupils, r, t, hue, p, mist) {             // a brushed ring at the edge of each window the picture comes through
      const al = (1 - p) * (1 - 0.6 * mist), bf = boil(t);
      g.save(); g.globalCompositeOperation = 'source-over';
      pupils.forEach(([px, py], k) => enso(g, px, py, r, 840 + k, bf, 0.9 * al, { wide: 0.07 + 0.08 * (1 - p), nb: 6, n: 30, from: t / 2600 + k * 2, bare: true }));
      g.restore(); g.globalAlpha = 1;
    },
  };

  DreamStyle.register('ink', {
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
