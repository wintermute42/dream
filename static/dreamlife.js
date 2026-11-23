/* Dream – the dream's living things, drawn the same way by Dreamy Eyes (eyes.html) and the dream windows (window.html).
   #201: moved here from eyes.html so that both speak one visual language. No DOM besides canvases; a global `DreamLife`.
   #214: the eye itself is in dreameye.js, the painted faces' life in dreamface.js.
   #221: `draw` is how today's look – the first style world (world-classic.js) – draws them; the pages ask the style
   layer (dreamstyle.js). What is the scene and the same in every world stays here: how big a kind is, its puffs, the
   impossible shapes. Needs dreambrush.js. */
(function (root) {
  'use strict';
  const { hueOf, softLight, stamp, tinted } = root.DreamBrush;   // #221: the brushes all style worlds share
  // how big a kind is drawn, relative to its size
  const SCALE = { tree: 1.7, moth: 1.5, bubbles: 1.6, orbit: 1, tear: 1.4 };
  const puffs = () => Array.from({ length: 7 }, () => [Math.random() - 0.5, Math.random() - 0.5, 0.35 + Math.random() * 0.45]);

  // One living thing d = { kind, x, y, size, hue, spin, puffs, side, life, … } at age ms, faded in and out by env (0–1),
  // drawn at size s, its drifting height y. o.H is the screen's height (embers rise through it), o.anchor = [x, y, r] the
  // eye a moon circles. Drawn into g with 'lighter' already set by the caller.
  function draw(g, d, age, env, s, y, o) {
    if (d.kind === 'symbol') { symbol(g, d, age, env, s, y); return; }
    if (d.kind === 'cloud') {                        // soft puffs drifting upwards
      for (const [ox, oy, rr] of d.puffs) {
        stamp(g, tinted(d.hue), d.x + ox * s * 1.2 + Math.sin(age / 1700 + ox * 6) * s * 0.06, y + oy * s * 0.6, s * rr, 0.3 * env);
      }
      g.globalAlpha = 1;
    } else if (d.kind === 'bloom') {                 // a sunflower spiral of light (golden angle) that turns and breathes
      const n = 110, rot = age * 0.00025 * d.spin, pulse = 1 + 0.08 * Math.sin(age / 500);
      for (let k = 0; k < n; k++) {
        const ang = k * 2.39996 + rot, rr = s * Math.sqrt(k / n) * pulse;
        g.fillStyle = `hsla(${d.hue + k * 3 + age * 0.02},90%,64%,${0.75 * env})`;
        g.beginPath(); g.arc(d.x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, s * 0.03 * (1 - 0.55 * k / n) + 0.6, 0, Math.PI * 2); g.fill();
      }
    } else if (d.kind === 'tree') {                  // a fractal tree of light that grows, sways and fades
      const grow = Math.min(1, age / 2600), depth = 7, sway = Math.sin(age / 900) * 0.12;
      g.lineCap = 'round';
      const branch = (x, yy, len, ang, k) => {
        if (k > depth * grow + 0.5) return;
        const x2 = x + Math.cos(ang) * len, y2 = yy + Math.sin(ang) * len;
        g.strokeStyle = `hsla(${d.hue + k * 18},85%,${55 + k * 4}%,${0.75 * env})`; g.lineWidth = Math.max(0.6, s * 0.05 * (1 - k / depth));
        g.beginPath(); g.moveTo(x, yy); g.lineTo(x2, y2); g.stroke();
        branch(x2, y2, len * 0.72, ang - 0.42 + sway, k + 1); branch(x2, y2, len * 0.72, ang + 0.42 + sway, k + 1);
      };
      branch(d.x, d.y + s * 0.6, s * 0.38, -Math.PI / 2, 0);
    } else if (d.kind === 'moth') {                  // a moth of light fluttering on a looping path, leaving sparks
      const k = age / 1000, mx = d.x + Math.sin(k * 1.3) * s * 1.2, my = y + Math.sin(k * 2.1) * s * 0.6, flap = Math.abs(Math.sin(age / 90));
      for (let j = 1; j <= 6; j++) {
        const kk = k - j * 0.08, tx = d.x + Math.sin(kk * 1.3) * s * 1.2, ty = d.y - (age - j * 80) * 0.006 + Math.sin(kk * 2.1) * s * 0.6;
        g.fillStyle = `hsla(${d.hue + j * 20},90%,70%,${0.4 * env * (1 - j / 7)})`; g.beginPath(); g.arc(tx, ty, s * 0.03, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = `hsla(${d.hue},90%,72%,${0.8 * env})`;
      for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(mx + sx * s * 0.12 * flap, my, s * 0.14 * flap + 1, s * 0.09, sx * 0.5, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = `hsla(${d.hue + 60},90%,85%,${env})`; g.beginPath(); g.ellipse(mx, my, s * 0.025, s * 0.07, 0, 0, Math.PI * 2); g.fill();
    } else if (d.kind === 'bubbles') {               // iridescent bubbles rising and wobbling
      for (let j = 0; j < 7; j++) {
        const ph = (age / 1000 + j * 0.7) % 4.5, bx = d.x + Math.sin(ph * 2 + j) * s * 0.35 + (j - 3) * s * 0.12, by = d.y + s * 0.6 - ph * s * 0.5, br = s * (0.06 + 0.04 * (j % 3));
        const bub = g.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.1, bx, by, br);
        bub.addColorStop(0, `hsla(${d.hue + j * 40},90%,90%,${0.15 * env})`); bub.addColorStop(0.75, `hsla(${d.hue + j * 40 + 90},90%,70%,${0.2 * env})`); bub.addColorStop(1, `hsla(${d.hue + j * 40 + 180},95%,78%,${0.8 * env})`);
        g.fillStyle = bub; g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
      }
    } else if (d.kind === 'aurora') {                // ribbons of northern light waving across
      for (let j = 0; j < 3; j++) {
        g.strokeStyle = `hsla(${d.hue + j * 50},85%,62%,${0.3 * env})`; g.lineWidth = s * (0.12 - j * 0.03); g.beginPath();
        for (let k = 0; k <= 30; k++) { const u = k / 30, ax = d.x + (u - 0.5) * s * 4, ay = y + Math.sin(u * 6 + age / 700 + j) * s * 0.25 + j * s * 0.12; g[k ? 'lineTo' : 'moveTo'](ax, ay); }
        g.stroke();
      }
    } else if (d.kind === 'orbit') {                 // little moons circling one eye
      const [ex, ey, ea] = o.anchor || [d.x, y, s * 0.6];
      for (let j = 0; j < 3; j++) {
        const an = age / (900 + j * 400) * (j % 2 ? -1 : 1) + j * 2.1, ox = ex + Math.cos(an) * ea * (1.15 + j * 0.12), oy = ey + Math.sin(an) * ea * (0.75 + j * 0.08);
        const mg = g.createRadialGradient(ox, oy, 0, ox, oy, ea * 0.11);
        mg.addColorStop(0, `hsla(${d.hue + j * 70},90%,85%,${0.9 * env})`); mg.addColorStop(1, `hsla(${d.hue + j * 70},90%,60%,0)`);
        g.fillStyle = mg; g.beginPath(); g.arc(ox, oy, ea * 0.11, 0, Math.PI * 2); g.fill();
      }
    } else if (d.kind === 'tear') {                  // a tear of light runs down and bursts into stars
      const p = age / d.life, fall = Math.min(1, p / 0.55), ty = d.y + fall * fall * s * 9;
      if (p < 0.6) {
        const tg = g.createRadialGradient(d.x, ty, 0, d.x, ty, s);
        tg.addColorStop(0, `hsla(${d.hue},90%,90%,.95)`); tg.addColorStop(1, `hsla(${d.hue},90%,60%,0)`);
        g.fillStyle = tg; g.beginPath(); g.ellipse(d.x, ty, s * 0.55, s * 0.8, 0, 0, Math.PI * 2); g.fill();
      } else {
        const q = (p - 0.6) / 0.4;
        for (let j = 0; j < 9; j++) { const an = j * 0.7, rr = q * s * 4; g.fillStyle = `hsla(${d.hue + j * 25},95%,75%,${1 - q})`;
          g.beginPath(); g.arc(d.x + Math.cos(an) * rr, d.y + s * 9 + Math.sin(an) * rr, s * 0.18, 0, Math.PI * 2); g.fill(); }
      }
    } else if (d.kind === 'stars') {                 // a burst of sparkles around an eye
      const q = age / d.life;
      for (const [an, rr, ph] of d.puffs) {
        const r2 = d.size * rr * (0.7 + 0.5 * q), sx = d.x + Math.cos(an) * r2, sy = d.y + Math.sin(an) * r2 * 0.7, sz = d.size * 0.035 * (d.big || 1) * (1 - q) * (0.6 + ph);
        g.fillStyle = `hsla(${d.hue + ph * 60},95%,80%,${1 - q})`; g.beginPath();
        for (let k = 0; k < 8; k++) { const rr2 = k % 2 ? sz * 0.35 : sz * 1.4, a2 = k * Math.PI / 4 + age / 400; g.lineTo(sx + Math.cos(a2) * rr2, sy + Math.sin(a2) * rr2); }
        g.closePath(); g.fill();
      }
    } else if (d.kind === 'ember') {                 // #162: a glowing ember rising and swaying
      const q = age / d.life, ex = d.x + Math.sin(age / 300 + d.spin * 9) * d.size * 6, ey = d.y - q * o.H * 0.75;
      const gr = g.createRadialGradient(ex, ey, 0, ex, ey, d.size * 3);
      gr.addColorStop(0, `hsla(${d.hue + 20},100%,75%,${1 - q})`); gr.addColorStop(1, `hsla(${d.hue},100%,50%,0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(ex, ey, d.size * 3, 0, Math.PI * 2); g.fill();
    } else if (d.kind === 'fireheart') {             // #162: a little burning heart floating up
      const q = age / d.life, hx = d.x + Math.sin(age / 500 + d.spin * 7) * d.size, hy = d.y - q * o.H * 0.7, s2 = d.size * (0.8 + 0.2 * Math.sin(age / 120));
      g.fillStyle = `hsla(${d.hue},100%,60%,${(1 - q) * 0.9})`; g.beginPath();
      g.moveTo(hx, hy + s2 * 0.9); g.bezierCurveTo(hx - s2 * 1.2, hy + s2 * 0.1, hx - s2 * 0.65, hy - s2 * 0.8, hx, hy - s2 * 0.25);
      g.bezierCurveTo(hx + s2 * 0.65, hy - s2 * 0.8, hx + s2 * 1.2, hy + s2 * 0.1, hx, hy + s2 * 0.9); g.fill();
    } else if (d.kind === 'sparks') {                // #218: a shower of sparks flying in from where a fire flared up (d.dir)
      const q = age / d.life, out = 1 - (1 - q) * (1 - q);
      for (const [an, sp, ph] of d.puffs) {
        const far = d.size * sp * out, sx = d.x + Math.cos(d.dir + an) * far, sy = d.y + Math.sin(d.dir + an) * far + d.size * 0.3 * q * q;
        g.fillStyle = `hsla(${d.hue + ph * 30},100%,${62 + 25 * (1 - q)}%,${(1 - q) * (0.55 + 0.45 * Math.sin(age / 55 + ph * 40))})`;
        g.beginPath(); g.arc(sx, sy, d.size * 0.009 * (0.5 + ph) * (1.2 - q), 0, Math.PI * 2); g.fill();
      }
    } else if (d.kind === 'zzz') {                   // sleepy: little z's drift up and away
      const q = age / d.life;
      g.font = `700 ${d.size * (0.7 + q)}px system-ui, sans-serif`; g.fillStyle = `hsla(${d.hue + 40},70%,80%,${0.8 * (1 - q)})`;
      g.fillText('z', d.x + Math.sin(age / 500) * d.size * 0.6 + q * d.size * 1.5, d.y - q * d.size * 5);
    } else {                                         // a mandala: three rings of petals, eightfold, slowly turning
      g.lineWidth = Math.max(1, s * 0.012);
      for (let ring = 0; ring < 3; ring++) {
        const k = 8, rr = s * (0.3 + ring * 0.3), rot = age * 0.0002 * d.spin * (ring % 2 ? -1 : 1);
        g.strokeStyle = `hsla(${d.hue + ring * 40 + age * 0.015},85%,66%,${0.7 * env})`;
        g.fillStyle = `hsla(${d.hue + ring * 40},85%,55%,${0.12 * env})`;
        for (let j = 0; j < k; j++) {
          const ang = rot + j * Math.PI * 2 / k + ring * 0.2;
          g.save(); g.translate(d.x, y); g.rotate(ang);
          g.beginPath(); g.moveTo(0, rr * 0.35);
          g.quadraticCurveTo(rr * 0.22, rr * 0.7, 0, rr); g.quadraticCurveTo(-rr * 0.22, rr * 0.7, 0, rr * 0.35);
          g.fill(); g.stroke(); g.restore();
        }
      }
    }
  }

  // #201: symbols for the dream windows – sacred shapes of light, slowly turning and breathing
  const SYMBOLS = ['spiral', 'flower', 'star', 'moon', 'third', 'sun'];
  function symbol(g, d, age, env, s, y) {
    const rot = age * 0.00015 * d.spin, br = 1 + 0.05 * Math.sin(age / 700);
    g.save(); g.translate(d.x, y); g.rotate(rot); g.scale(br, br);
    g.lineWidth = Math.max(1, s * 0.018); g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = `hsla(${d.hue + age * 0.01},90%,70%,${0.8 * env})`; g.fillStyle = `hsla(${d.hue + 40},90%,60%,${0.12 * env})`;
    const v = d.variant;
    if (v === 'spiral') {                              // a double spiral, drawn out and in again
      const grow = Math.min(1, age / 2500);
      for (const sg of [1, -1]) {
        g.beginPath();
        for (let k = 0; k <= 120 * grow; k++) { const a = k * 0.13, r = s * 0.9 * k / 120; g.lineTo(sg * Math.cos(a) * r, sg * Math.sin(a) * r); }
        g.stroke();
      }
    } else if (v === 'flower') {                       // the flower of life: seven circles, petals where they cross
      const r = s * 0.32;
      for (let k = 0; k < 7; k++) {
        const a = k * Math.PI / 3, cx = k ? Math.cos(a) * r : 0, cy = k ? Math.sin(a) * r : 0;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      g.beginPath(); g.arc(0, 0, r * 2, 0, Math.PI * 2); g.stroke();
    } else if (v === 'star') {                         // a seven-pointed star in one line
      const n = 7, r = s * 0.85; g.beginPath();
      for (let k = 0; k <= n; k++) { const a = k * 3 * Math.PI * 2 / n - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.fill(); g.stroke();
    } else if (v === 'moon') {                         // a crescent with a small star
      const r = s * 0.6; g.beginPath(); g.arc(0, 0, r, 0.6, Math.PI * 2 - 0.6); g.arc(r * 0.45, 0, r * 0.78, Math.PI * 2 - 0.95, 0.95, true); g.closePath();
      g.fill(); g.stroke(); g.beginPath(); g.arc(r * 0.85, -r * 0.1, s * 0.05, 0, Math.PI * 2); g.stroke();
    } else if (v === 'third') {                        // the third eye: an eye in a triangle, rays around
      const r = s * 0.85; g.beginPath();
      for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 3; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.42, r * 0.12); g.quadraticCurveTo(0, -r * 0.22, r * 0.42, r * 0.12); g.quadraticCurveTo(0, r * 0.42, -r * 0.42, r * 0.12); g.stroke();
      g.beginPath(); g.arc(0, r * 0.12, r * 0.1, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.beginPath(); g.moveTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05); g.lineTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25); g.stroke(); }
    } else {                                           // a sun: a ring and wavy rays
      const r = s * 0.35; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke();
      for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8; g.beginPath();
        for (let u = 0; u <= 8; u++) { const rr = r * (1.2 + u * 0.09), w = Math.sin(u * 1.4 + age / 300) * 0.06; g.lineTo(Math.cos(a + w) * rr, Math.sin(a + w) * rr); }
        g.stroke();
      }
    }
    g.restore();
  }


  // #214: impossible shapes for the dream windows – the faces of a figure that cannot be, as polygons in the order
  // they are drawn (far ones first), in a square from -1 to 1. A face: { pts, shade (0 light … 1 dark), fade (it comes
  // out of nothing from the left), glass (a pane one sees through), wall (one of many in a row) }. `path`: where a light may walk (the stairs).
  const shapes = {};
  function impossible(kind) {
    if (shapes[kind]) return shapes[kind];
    let faces = [], path = null, own = false;         // own: it turns around its own middle, not that of its outline
    const quad = (x0, y0, x1, y1, w) => {              // a beam from one point to another, w wide, a little longer than that
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2, ex = dx / l * w / 2, ey = dy / l * w / 2;
      return [[x0 - ex + nx, y0 - ey + ny], [x1 + ex + nx, y1 + ey + ny], [x1 + ex - nx, y1 + ey - ny], [x0 - ex - nx, y0 - ey - ny]];
    };
    if (kind === 'penrose') {                          // the tribar: three bars, each at a right angle to the next
      own = true;
      const h = 2, P = (i, j) => [i + j / 2 - h / 2, -(j - h / 3) * Math.sqrt(3) / 2];   // a lattice of triangles, the hole in the middle
      faces = [
        { shade: 0.05, pts: [P(0, h), P(-1, h + 1), P(-1, -2), P(h + 3, -2), P(h + 3, -1), P(0, -1)] },
        { shade: 0.34, pts: [P(0, 0), P(0, -1), P(h + 3, -1), P(-1, h + 3), P(-2, h + 3), P(h + 1, 0)] },
        { shade: 0.62, pts: [P(h, 0), P(h + 1, 0), P(-2, h + 3), P(-2, -1), P(-1, -2), P(-1, h + 1)] },
      ];
    } else if (kind === 'stairs') {                    // the endless staircase: four flights around a yard, always upwards
      const flights = [[1, 0, 5], [0, 1, 4], [-1, 0, 3], [0, -1, 2]], N = 14, rise = 2 / N, c = Math.cos(Math.PI / 6);
      const pr = (x, y, z) => [(x - y) * c, (x + y) / 2 - z];
      const cells = [];
      let x = 0, y = 0, k = 0;
      for (const [dx, dy, n] of flights) for (let i = 0; i < n; i++) { cells.push([x, y, 1.1 + k * rise, k]); x += dx; y += dy; k++; }
      path = cells.map(([cx, cy, z]) => pr(cx, cy, z));
      cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[2] - b[2]);
      for (const [cx, cy, z] of cells) {
        faces.push({ shade: 0.42, wall: true, pts: [pr(cx + 0.5, cy - 0.5, z), pr(cx + 0.5, cy + 0.5, z), pr(cx + 0.5, cy + 0.5, 0), pr(cx + 0.5, cy - 0.5, 0)] });
        faces.push({ shade: 0.68, wall: true, pts: [pr(cx - 0.5, cy + 0.5, z), pr(cx + 0.5, cy + 0.5, z), pr(cx + 0.5, cy + 0.5, 0), pr(cx - 0.5, cy + 0.5, 0)] });
        faces.push({ shade: 0.04, pts: [pr(cx - 0.5, cy - 0.5, z), pr(cx + 0.5, cy - 0.5, z), pr(cx + 0.5, cy + 0.5, z), pr(cx - 0.5, cy + 0.5, z)] });
      }
    } else if (kind === 'fork') {                      // the devil's fork: three round prongs that are two square bars
      const Y = [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25].map(v => v * 0.52), x0 = -1.5, L = 1.5, a = 0.5, sk = (x, y) => [x, y - 0.26 * x];
      const rect = (xa, ya, xb, yb) => [sk(xa, ya), sk(xb, ya), sk(xb, yb), sk(xa, yb)];
      faces.push({ shade: 0.7, fade: true, pts: rect(x0 + 0.5, Y[1], L - a, Y[2]) }, { shade: 0.7, fade: true, pts: rect(x0 + 0.5, Y[3], L - a, Y[4]) });
      for (let j = 0; j < 3; j++) faces.push({ shade: j === 1 ? 0.22 : 0.05, pts: rect(x0, Y[2 * j], j === 1 ? L - a : L, Y[2 * j + 1]) });
      faces.push({ shade: 0.4, pts: rect(L - a, Y[1], L, Y[4]) });
      for (let j = 0; j < 3; j++) {                    // their round ends
        const cy = (Y[2 * j] + Y[2 * j + 1]) / 2, ry = (Y[2 * j + 1] - Y[2 * j]) / 2, pts = [];
        for (let q = 0; q < 20; q++) { const an = q / 20 * Math.PI * 2; pts.push(sk(x0 + Math.cos(an) * 0.11, cy + Math.sin(an) * ry)); }
        faces.push({ shade: 0.3, pts });
      }
    } else {                                           // the impossible cube: a beam at the back crosses in front of one at the front
      const F = [[-0.78, -0.38], [0.38, -0.38], [0.38, 0.78], [-0.78, 0.78]], d = 0.4, B = F.map(([px, py]) => [px + d, py - d]), w = 0.15;
      faces.push({ glass: true, shade: 0, pts: F }, { glass: true, shade: 0.3, pts: [F[0], B[0], B[1], F[1]] }, { glass: true, shade: 0.5, pts: [F[1], B[1], B[2], F[2]] });
      for (let i = 0; i < 4; i++) faces.push({ shade: 0.6, pts: quad(...B[i], ...B[(i + 1) % 4], w) });
      for (let i = 0; i < 4; i++) faces.push({ shade: 0.34, pts: quad(...F[i], ...B[i], w) });
      for (let i = 0; i < 4; i++) faces.push({ shade: 0.05, pts: quad(...F[i], ...F[(i + 1) % 4], w) });
      faces.push({ shade: 0.6, pts: quad(B[0][0], F[0][1] - 0.2, B[0][0], F[0][1] + 0.2, w) });   // … which cannot be
      faces.push({ shade: 0.6, pts: quad(F[1][0] - 0.2, B[2][1], F[1][0] + 0.2, B[2][1], w) });
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;       // into the square from -1 to 1, around its middle
    for (const f of faces) for (const [px, py] of f.pts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    const mx = own ? 0 : (x0 + x1) / 2, my = own ? 0 : (y0 + y1) / 2;
    let far = 0;
    for (const f of faces) for (const [px, py] of f.pts) far = Math.max(far, Math.hypot(px - mx, py - my));
    const fit = ([px, py]) => [(px - mx) / far, (py - my) / far];
    for (const f of faces) f.pts = f.pts.map(fit);
    return (shapes[kind] = { faces, path: path && path.map(fit) });
  }
  const IMPOSSIBLE = ['penrose', 'stairs', 'fork', 'cube'];

  root.DreamLife = { draw, puffs, SCALE, SYMBOLS, impossible, IMPOSSIBLE };
})(typeof window !== 'undefined' ? window : globalThis);
