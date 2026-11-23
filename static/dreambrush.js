/* Dream – the brushes the style worlds share (#221). What every world of Dreamy Eyes (eyes.html) and the dream windows
   (window.html) needs to draw, whatever its material: random numbers from a seed, noise, smooth lines and bands that
   swell, soft lights drawn once and stamped, how bright the dream is where, the lids of an eye and the skeleton of a
   face as bare curves. A world (static/world-<name>.js) decides how these look; the scene – what, when, where – stays
   with the pages.

   The numbers are pure (tests/js/brush.test.mjs runs them in Node); what makes a canvas needs a browser. A global
   `DreamBrush`. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, lerp = (a, b, k) => a + (b - a) * k;
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // ---------- random numbers and noise ----------
  function rng(seed) {                                 // the same random numbers from the same seed (mulberry32)
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hash = (seed, k) => rng((seed ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0)();   // one random number for a seed and a moment
  const cell = (x, y, seed) => hash((Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed) >>> 0, 0);
  function noise2(x, y, seed = 0) {                    // soft noise, 0–1, the same for the same place
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(cell(xi, yi, seed), cell(xi + 1, yi, seed), u), lerp(cell(xi, yi + 1, seed), cell(xi + 1, yi + 1, seed), u), v);
  }
  function fbm(x, y, octaves = 3, seed = 0) {          // … in several sizes at once: clouds, grain, a hand's wobble
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < octaves; i++) { s += a * noise2(x * f, y * f, seed + i); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  // a square of noise that repeats at its edges, N×N numbers around 0–2 (five octaves): fields of cloud are cut from it
  function noiseTile(N, seed) {
    const r = rng(seed), out = new Float32Array(N * N);
    for (let o = 0, amp = 1; o < 5; o++, amp *= 0.5) {
      const cells = 3 << o, grid = Float32Array.from({ length: cells * cells }, r);
      for (let y = 0; y < N; y++) {
        const fy = y / N * cells, y0 = fy | 0, ty = fy - y0, sy = ty * ty * (3 - 2 * ty), ya = y0 * cells, yb = ((y0 + 1) % cells) * cells;
        for (let x = 0; x < N; x++) {
          const fx = x / N * cells, x0 = fx | 0, tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % cells;
          out[y * N + x] += amp * lerp(lerp(grid[ya + x0], grid[ya + x1], sx), lerp(grid[yb + x0], grid[yb + x1], sx), sy);
        }
      }
    }
    return out;
  }
  // a field cut from such a square: white, opaque where the noise is among its highest `share`, with a soft edge
  function field(noise, share, soft) {
    const N = Math.round(Math.sqrt(noise.length)), sorted = Float32Array.from(noise).sort(), at = q => sorted[clamp(Math.round(q * (sorted.length - 1)), 0, sorted.length - 1)];
    const lo = share >= 1 ? -1 : at(1 - share - soft), hi = share >= 1 ? -0.5 : share <= 0 ? 3 : at(1 - share + soft);
    const c = canvas(N), x = c.getContext('2d'), im = x.createImageData(N, N), d = im.data;
    for (let i = 0; i < N * N; i++) {
      const u = share <= 0 ? 0 : clamp((noise[i] - lo) / (hi - lo || 1), 0, 1);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255 * u * u * (3 - 2 * u);
    }
    x.putImageData(im, 0, 0);
    return c;
  }

  // ---------- lines and bands ----------
  const bez = (p0, p1, p2, p3, u) => { const m = 1 - u; return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3; };
  // a smooth line through points [[x, y], …] (Catmull-Rom), n samples per span
  function curve(P, n = 8) {
    const out = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (let j = 0; j < n; j++) {
        const u = j / n, u2 = u * u, u3 = u2 * u;
        const f = k => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u3);
        out.push([f(0), f(1)]);
      }
    }
    out.push(P[P.length - 1].slice());
    return out;
  }
  // a band along the line P that swells and thins: half as wide as wide(u) at u (0–1 along it), drawn up to `upTo` (0–1:
  // a line being drawn in). Returns the outline, one side out and the other back.
  function band(P, wide, upTo = 1) {
    const n = P.length, m = Math.max(2, Math.min(n, Math.ceil((n - 1) * clamp(upTo)) + 1)), A = [], B = [];
    for (let i = 0; i < m; i++) {
      const p = P[Math.max(0, i - 1)], q = P[Math.min(n - 1, i + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, dx = (q[0] - p[0]) / l, dy = (q[1] - p[1]) / l;
      const w = wide(i / (n - 1)) * (i === m - 1 && m < n ? 0.3 : 1);   // where the drawing hand is right now, it thins out
      A.push([P[i][0] - dy * w, P[i][1] + dx * w]); B.push([P[i][0] + dy * w, P[i][1] - dx * w]);
    }
    return A.concat(B.reverse());
  }
  function trace(g, P) { g.beginPath(); g.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) g.lineTo(P[i][0], P[i][1]); }
  function ribbon(g, P, wide, upTo = 1) { trace(g, band(P, wide, upTo)); g.closePath(); g.fill(); }

  // ---------- soft lights, drawn once and stamped ----------
  const sprites = new Map();
  // whatever is costly to draw and looks the same every time: made once per key, then only stamped
  const sprite = (key, make) => { let s = sprites.get(key); if (!s) sprites.set(key, s = make()); return s; };
  // #188: a soft light is drawn once and stamped (scaled, with its alpha) – the same look as a gradient per light, far cheaper
  function softLight(stops, size) {
    const c = canvas(size), x = c.getContext('2d'), r = size / 2, gr = x.createRadialGradient(r, r, 0, r, r, r);
    for (const [at, col] of stops) gr.addColorStop(at, col);
    x.fillStyle = gr; x.fillRect(0, 0, size, size);
    return c;
  }
  const stamp = (c, img, x, y, r, al) => { c.globalAlpha = al; c.drawImage(img, x - r, y - r, r * 2, r * 2); };
  const hueKey = hue => ((Math.round(hue / 10) % 36) + 36) % 36;   // one light per 10° of hue
  const tinted = hue => { const k = hueKey(hue); return sprite('tint' + k, () => softLight([[0, `hsla(${k * 10},70%,72%,1)`], [1, `hsla(${k * 10 + 30},70%,60%,0)`]], 128)); };
  function night(c, x, y, r, al) {                     // a soft darkness behind something: it stays the clearest thing there
    const gr = c.createRadialGradient(x, y, r * 0.25, x, y, r);
    gr.addColorStop(0, `rgba(5,4,10,${al})`); gr.addColorStop(1, 'rgba(5,4,10,0)');
    c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ---------- the dream: its colour, how bright it is where ----------
  const hueOf = ([r, gg, b]) => {                      // the hue of an RGB colour, 0–360
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn || 1;
    const h = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const LUMA = [0.2126, 0.7152, 0.0722];
  // of a small copy of the dream (RGBA, w×h): its mean colour `col` and brightness `lum` (0–1), and for every place
  // L(u, v) – how bright it is there (u, v 0–1): a world can let its lines swell where the dream is light
  function brightness(data, w, h) {
    const n = w * h, map = new Float32Array(n);
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2];
      r += R; gg += G; b += B; map[i] = (LUMA[0] * R + LUMA[1] * G + LUMA[2] * B) / 255;
    }
    return { col: [r / n, gg / n, b / n], lum: (LUMA[0] * r + LUMA[1] * gg + LUMA[2] * b) / n / 255,
      L: (u, v) => map[Math.min(h - 1, clamp(v) * h | 0) * w + Math.min(w - 1, clamp(u) * w | 0)] };
  }
  function cover(c, img, x, y, w, h, zoom = 1, cx = 0.5, cy = 0.5) {   // a picture filling a box, zoomed around (cx, cy)
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const s = Math.max(w / iw, h / ih) * zoom, sw = w / s, sh = h / s;
    const sx = clamp(cx * iw - sw / 2, 0, Math.max(0, iw - sw)), sy = clamp(cy * ih - sh / 2, 0, Math.max(0, ih - sh));
    c.drawImage(img, sx, sy, Math.min(sw, iw), Math.min(sh, ih), x, y, w, h);
  }
  function kaleido(c, pic, n, t, seed, k) {            // a picture folded into a turning kaleidoscope of k wedges, n pixels wide
    const R = n / 2, rot = t / 9000 + seed;
    c.save(); c.translate(R, R);
    for (let i = 0; i < k; i++) {
      c.save(); c.rotate(rot + i * TAU / k); if (i % 2) c.scale(1, -1);
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R, -Math.PI / k - 0.02, Math.PI / k + 0.02); c.closePath(); c.clip();
      cover(c, pic, 0, -R / 2, R, R, 1.8, 0.5 + 0.3 * Math.sin(t / 7000 + seed), 0.5 + 0.2 * Math.cos(seed));
      c.restore();
    }
    c.restore();
  }

  // ---------- an eye and a face as bare curves ----------
  // The lids of one eye at (cx, cy), half as wide as a and half as high as b; mirror: the right one of a pair; up and
  // lo: how far the upper and the lower lid are open. Every world draws the same opening in its own material: `path`
  // traces it, upper(u) and lower(u) are points on the lids from the inner corner (0) to the outer one (1).
  function lids(cx, cy, a, b, mirror, up, lo) {
    const o = mirror ? 1 : -1, lift = b * 0.17;      // the outer corner a little lifted, the inner one soft and low
    const yL = o < 0 ? cy - lift : cy + lift * 0.2, yR = o > 0 ? cy - lift : cy + lift * 0.2;
    const upX = u => bez(cx - a, cx - a * 0.45, cx + a * 0.45, cx + a, u), upY = u => bez(yL, cy - b * 1.32 * up, cy - b * 1.32 * up, yR, u);
    const loY = u => bez(yL, cy + b * 1.05 * lo, cy + b * 1.05 * lo, yR, u), io = u => o > 0 ? u : 1 - u;
    return { o, lift, yL, yR, yOut: cy - lift, upX, upY, loY, upper: u => [upX(io(u)), upY(io(u))], lower: u => [upX(io(u)), loY(io(u))],
      path(g) {
        g.beginPath(); g.moveTo(cx - a, yL);
        g.bezierCurveTo(cx - a * 0.45, cy - b * 1.32 * up, cx + a * 0.45, cy - b * 1.32 * up, cx + a, yR);
        g.bezierCurveTo(cx + a * 0.45, cy + b * 1.05 * lo, cx - a * 0.45, cy + b * 1.05 * lo, cx - a, yL);
        g.closePath();
      } };
  }
  // The face behind a pair of eyes as bare curves, for a world to draw in its own material. `cx`, `ey`: the middle
  // between the eyes; `half`: half the distance between them; t (ms): hair sways a little. Every curve is a list of
  // screen points and belongs to a part of the face rule (static/dreamvis.js, #220) – a world draws it as visible as
  // `DreamVis.of(vis, part)` says. There is no nose: the rule has no level for one.
  function skeleton(cx, ey, half, t = 0) {
    const u = half / 1.95, F = p => [cx + p[0] * u, ey + p[1] * u], sway = k => Math.sin(t / 2000 + k) * 0.12, out = [];
    const add = (part, name, pts, n) => out.push({ part, name, pts: curve(pts.map(F), n) });
    for (const o of [-1, 1]) {
      add('brows', 'brow', [[0.6 * o, -1.25], [1.4 * o, -1.85], [2.3 * o, -2.0], [3.5 * o, -1.35]]);
      add('outline', 'jaw', [[3.75 * o, -1.8], [3.9 * o, 0.4], [3.5 * o, 2.4], [2.4 * o, 4.3], [1.0 * o, 5.55], [0, 5.85]]);
      for (let i = 0; i < 5; i++) {
        add('hair', 'strand', [[0.15 * o, -3.45 - i * 0.12], [(1.6 + i * 0.35) * o, -3.8 - i * 0.1], [(3.5 + i * 0.42) * o, -2.4 + i * 0.1], [(4.2 + i * 0.45 + sway(i)) * o, 0.5],
          [(3.9 + i * 0.5 + sway(i + 1) * 2) * o, 3.0 + i * 0.2], [(4.2 + i * 0.5 + sway(i + 2) * 3) * o, 5.4 + i * 0.25]], 7);
      }
    }
    add('mouth', 'upper lip', [[-1.05, 3.78], [-0.45, 3.52], [-0.12, 3.5], [0, 3.6], [0.12, 3.5], [0.45, 3.52], [1.05, 3.78]], 5);
    add('mouth', 'lips', [[-1.05, 3.78], [-0.4, 3.86], [0, 3.8], [0.4, 3.86], [1.05, 3.78]], 5);   // closed, always
    add('mouth', 'lower lip', [[-0.88, 3.9], [-0.4, 4.28], [0, 4.38], [0.4, 4.28], [0.88, 3.9]], 5);
    out.push({ part: 'mark', name: 'mark', pts: [F([0, -2.6])] });   // where a sign on the forehead sits
    return out;
  }

  const api = { TAU, clamp, lerp, smooth, canvas, rng, hash, noise2, fbm, noiseTile, field, bez, curve, band, trace, ribbon, sprite, softLight, stamp, tinted,
    night, hueOf, brightness, cover, kaleido, lids, skeleton };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DreamBrush = api;
})(typeof window !== 'undefined' ? window : globalThis);
