// Camera ↔ beamer calibration (#92) and the warp of the beamer picture into the camera picture (#93).
// Coordinates are 0…1: "camera" in the camera picture, "picture" in Dream's picture as the beamer shows it.
window.DreamCalib = (() => {
  'use strict';

  // homography from four (or more) point pairs (direct linear transform, h33 = 1): maps src → dst
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < src.length; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    // least squares: (AᵀA) h = Aᵀb, solved by Gauss–Jordan with pivoting
    const n = 8, M = Array.from({ length: n }, (_, r) => {
      const row = new Array(n + 1).fill(0);
      for (let k = 0; k < A.length; k++) { for (let c = 0; c < n; c++) row[c] += A[k][r] * A[k][c]; row[n] += A[k][r] * b[k]; }
      return row;
    });
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;     // degenerate: points on a line or doubled
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((row, i) => row[n] / row[i]).concat(1);
  }
  function apply(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }
  function invert(H) {
    const [a, b, c, d, e, f, g, h, i] = H;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
    return inv.map(v => v / inv[8]);
  }
  // a usable calibration: the four corners keep their order (no flip, no fold) and map back exactly
  function plausible(H, cam, pic) {
    if (!H) return false;
    const err = cam.reduce((m, p, i) => { const q = apply(H, p[0], p[1]); return Math.max(m, Math.hypot(q[0] - pic[i][0], q[1] - pic[i][1])); }, 0);
    const area = pts => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
    return err < 0.02 && Math.sign(area(cam)) === Math.sign(area(pic)) && Math.abs(area(cam)) > 0.01;
  }

  // draws the picture (src, covering 0…1) as the camera sees it: through the inverse calibration, in a grid of
  // small triangles (each an affine piece of the perspective), onto ctx of size w×h (camera space)
  function warpToCamera(ctx, src, Hpic2cam, w, h, n = 8) {
    const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
    if (!sw || !sh) return;
    const at = (u, v) => { const [x, y] = apply(Hpic2cam, u, v); return [x * w, y * h]; };
    const tri = (s0, s1, s2, d0, d1, d2) => {
      // affine map from the source triangle (pixels of src) onto the destination triangle (pixels of ctx)
      const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
      const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
      if (Math.abs(den) < 1e-9) return;
      const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den, b = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
      const c = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
      const d = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den, e = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
      const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
      const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3, grow = p => [p[0] + (p[0] - cx) * 0.02, p[1] + (p[1] - cy) * 0.02];
      const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];   // a hair bigger: no seams between the triangles
      ctx.save(); ctx.beginPath(); ctx.moveTo(...g0); ctx.lineTo(...g1); ctx.lineTo(...g2); ctx.closePath(); ctx.clip();
      ctx.setTransform(a, d, b, e, c, f); ctx.drawImage(src, 0, 0); ctx.restore();
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
      const S = [[u0 * sw, v0 * sh], [u1 * sw, v0 * sh], [u1 * sw, v1 * sh], [u0 * sw, v1 * sh]];
      const D = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
      tri(S[0], S[1], S[2], D[0], D[1], D[2]); tri(S[0], S[2], S[3], D[0], D[2], D[3]);
    }
  }

  // where the markers are shown, in picture coordinates (inside the edges, so a wide-angle camera sees them)
  const MARKS = [[0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88]];

  // The calibration run. show(i | null): the beamer shows marker i (or black); grab(): the camera's grey picture
  // {d: Uint8Array, w, h}; click(): a promise of a point the owner clicked in the camera picture (or null);
  // step(text): progress for the panel. Resolves {h, delay} or throws Error('cancel' | message).
  async function run({ show, grab, click, step, signal }) {
    const wait = ms => new Promise((res, rej) => { const t = setTimeout(res, ms); signal && signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('cancel')); }); });
    const frame = async () => { await wait(40); if (signal && signal.aborted) throw new Error('cancel'); return grab(); };
    const avg = async n => { let acc = null, f; for (let k = 0; k < n; k++) { f = await frame(); if (!f) continue; acc = acc || new Float32Array(f.d.length); for (let i = 0; i < f.d.length; i++) acc[i] += f.d[i] / n; } return acc && { d: acc, w: f.w, h: f.h }; };
    const cam = [], delays = [];
    for (let i = 0; i < MARKS.length; i++) {
      step(T('Point {i} of 4: measuring the projector …', { i: i + 1 }));
      show(null); await wait(500);
      const base = await avg(4);
      if (!base) throw new Error(T('No camera – switch on movement.'));
      show(i); const t0 = performance.now();
      let found = null, seenAt = 0, hits = 0, last = null;
      // the marker: what got brighter than in the black picture, stable over three frames
      while (performance.now() - t0 < 4000 && !found) {
        const f = await frame(); if (!f) continue;
        let best = 0; for (let k = 0; k < f.d.length; k++) { const v = f.d[k] - base.d[k]; if (v > best) best = v; }
        if (best < 35) { hits = 0; continue; }
        let sx = 0, sy = 0, sw = 0;
        for (let k = 0; k < f.d.length; k++) { const v = f.d[k] - base.d[k] - best * 0.5; if (v > 0) { sx += (k % f.w) * v; sy += Math.floor(k / f.w) * v; sw += v; } }
        const p = [(sx / sw + 0.5) / f.w, (sy / sw + 0.5) / f.h];
        if (!seenAt) seenAt = performance.now();
        hits = last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.02 ? hits + 1 : 1; last = p;
        if (hits >= 3) found = p;
      }
      if (found) delays.push(seenAt - t0);
      else {
        // the camera does not see the beamer (an infrared camera): a lamp at the marker, or a click
        step(T('Point {i} of 4: the camera does not see the projector – hold a lamp at the point or click it in the camera picture (diagnostics).', { i: i + 1 }));
        const clicked = click();
        while (!found) {
          const c = await Promise.race([clicked, wait(60).then(() => undefined)]);
          if (c) { found = c; break; }
          const f = await frame(); if (!f) continue;
          let best = 0, at = 0; for (let k = 0; k < f.d.length; k++) if (f.d[k] > best) { best = f.d[k]; at = k; }
          if (best > 235 && best - base.d[at] > 60) {
            const p = [((at % f.w) + 0.5) / f.w, (Math.floor(at / f.w) + 0.5) / f.h];
            hits = last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.03 ? hits + 1 : 1; last = p;
            if (hits >= 8) found = p;
          }
        }
      }
      cam.push(found);
    }
    show(null);
    const H = homography(cam, MARKS);
    if (!plausible(H, cam, MARKS)) throw new Error(T('The points do not fit together – hold the camera still and once more.'));
    delays.sort((a, b) => a - b);
    return { h: H.map(v => +v.toFixed(6)), delay: delays.length ? Math.round(delays[delays.length >> 1]) : 0, cam };
  }
  return { homography, apply, invert, plausible, warpToCamera, run, MARKS };
})();
