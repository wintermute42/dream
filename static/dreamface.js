/* Dream – the painted faces come alive (#214).
   One file, three places:
   - on the stage (the script tag carries `data-detect`): where a painted face has its eyes, brows, mouth and outline is
     found here, once per face, in a worker of its own (this very file) with the face model Dream has anyway (/mp) –
     asked for and answered over /facemarks. The stage's own drawing never waits for it.
   - in a dream window, and in Dreamy Eyes when a painted face opens out of their pupils (#230): `DreamFace.mesh` lays
     a net of triangles over the face, `life` says what the face does next, `pose` moves its points (blink, look,
     smile, brows, a slight turn of the head) and `render` draws the moved net – Canvas 2D, triangle by triangle, only
     the triangles that moved. Neither ever looks for points itself.
   - all read `PICK`: which points of the face model travel, in which order. */
(function (root) {
  'use strict';
  // the points that travel, by what they are (numbers of the MediaPipe face mesh); A is the eye on the picture's left
  const GROUPS = {
    oval: [10, 297, 284, 389, 454, 361, 397, 379, 400, 152, 176, 150, 172, 132, 234, 162, 54, 67],
    eyeA: [33, 160, 159, 158, 133, 153, 145, 144],     // outer corner, upper lid (3), inner corner, lower lid (3)
    eyeB: [263, 387, 386, 385, 362, 380, 374, 373],
    iris: [468, 469, 470, 471, 472, 473, 474, 475, 476, 477],   // A: its middle and four points on its rim; B the same
    browA: [70, 63, 105, 66, 107],                     // from the outer end to the inner one
    browB: [300, 293, 334, 296, 336],
    lid: [30, 27, 56, 260, 257, 286],                  // the fold above each eye (3 each): above it nothing moves when a lid closes
    nose: [168, 6, 1, 2, 98, 327],                     // between the eyes, bridge, tip, below, the two wings
    lips: [61, 39, 0, 269, 291, 405, 17, 181],         // corner A, upper lip (3), corner B, lower lip (3)
    mouth: [13, 14],                                   // where the lips meet
    cheek: [50, 280, 205, 425],
    brow0: [151, 9],                                   // forehead, between the brows
  };
  const PICK = [], AT = {};                            // AT.eyeA = [index in PICK, …]
  for (const k in GROUPS) AT[k] = GROUPS[k].map(n => PICK.push(n) - 1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // the model's points (x, y in 0–1) as whole thousandths, in PICK's order: what travels
  const pack = lm => PICK.flatMap(n => [Math.round(clamp(lm[n].x, 0, 1) * 1000), Math.round(clamp(lm[n].y, 0, 1) * 1000)]);

  // ---------- a net of triangles over a set of points (Bowyer–Watson) ----------
  function delaunay(P) {
    const n = P.length / 2, pts = Array.from(P);
    pts.push(-1e5, -1e5, 1e5, -1e5, 0, 1e5);           // a triangle around everything
    const circle = (a, b, c) => {
      const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b] - ax, by = pts[2 * b + 1] - ay, cx = pts[2 * c] - ax, cy = pts[2 * c + 1] - ay;
      const d = 2 * (bx * cy - by * cx) || 1e-9, ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d, uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
      return [a, b, c, ax + ux, ay + uy, ux * ux + uy * uy];
    };
    let tris = [circle(n, n + 1, n + 2)];
    for (let i = 0; i < n; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1], edges = new Map(), keep = [];
      for (const t of tris) {
        if ((x - t[3]) ** 2 + (y - t[4]) ** 2 > t[5] * (1 + 1e-9)) { keep.push(t); continue; }
        for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
          const key = a < b ? a * 1000 + b : b * 1000 + a;
          if (edges.has(key)) edges.set(key, null); else edges.set(key, [a, b]);
        }
      }
      for (const e of edges.values()) if (e) keep.push(circle(e[0], e[1], i));
      tris = keep;
    }
    const out = [];
    for (const t of tris) if (t[0] < n && t[1] < n && t[2] < n) out.push(t[0], t[1], t[2]);
    return out;
  }

  // ---------- the face's net: its points (canvas pixels), a frame that never moves, the triangles ----------
  // pts: what `pack` made; img: the painted face; size: the side of the square the face is drawn into
  function mesh(pts, img, size) {
    const n = PICK.length, B = [];
    if (!Array.isArray(pts) || pts.length !== 2 * n) return null;
    for (let i = 0; i < 2 * n; i++) B.push(pts[i] / 1000 * size);
    for (let k = 0; k < 4; k++) { const u = k / 4 * size; B.push(u, 0, size, u, size - u, size, 0, size - u); }   // the frame
    const at = i => [B[2 * i], B[2 * i + 1]], dist = (a, b) => Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1]);
    let cx = 0, cy = 0;
    for (const i of AT.oval) { cx += B[2 * i] / AT.oval.length; cy += B[2 * i + 1] / AT.oval.length; }
    const r = AT.oval.reduce((s, i) => s + Math.hypot(B[2 * i] - cx, B[2 * i + 1] - cy), 0) / AT.oval.length;
    const eye = dist(AT.eyeA[0], AT.eyeA[4]), mouth = dist(AT.lips[0], AT.lips[4]);
    if (!(eye > size * 0.03 && mouth > size * 0.03 && r > size * 0.1)) return null;   // no face one could animate
    // how far a point stands out of the face (0 at its outline, 1 in the middle, the nose tip more): the head's turn
    const depth = new Float32Array(B.length / 2);
    for (let i = 0; i < n; i++) depth[i] = Math.max(0, 1 - ((B[2 * i] - cx) ** 2 + (B[2 * i + 1] - cy) ** 2) / (r * r));
    depth[AT.nose[2]] += 0.35;
    const tex = document.createElement('canvas'), cv = document.createElement('canvas');
    tex.width = tex.height = cv.width = cv.height = size;
    tex.getContext('2d').drawImage(img, 0, 0, size, size);
    const iA = AT.iris[0], iB = AT.iris[5];            // where it looks out of the picture (0–1): the middles of its irises
    return { size, base: Float32Array.from(B), out: new Float32Array(B.length), tris: delaunay(B), depth, tex, cv, g: cv.getContext('2d'),
      eye, mouth, r, mid: [cx / size, cy / size], eyes: { x0: B[2 * iA] / size, x1: B[2 * iB] / size, y: (B[2 * iA + 1] + B[2 * iB + 1]) / 2 / size }, lidGap: [dist(AT.eyeA[2], AT.eyeA[6]), dist(AT.eyeB[2], AT.eyeB[6])], drawn: 0 };
  }

  // a face without points (none found, or not yet): shown still, through the same `render`
  function plain(img, size) {
    const tex = document.createElement('canvas'), cv = document.createElement('canvas');
    tex.width = tex.height = cv.width = cv.height = size;
    tex.getContext('2d').drawImage(img, 0, 0, size, size);
    return { size, tris: [], tex, cv, g: cv.getContext('2d'), mid: [0.5, 0.46], drawn: 0 };
  }

  // ---------- what a face does next: by itself, with the beat, with whoever is kind to it ----------
  const lerp = (a, b, k) => a + (b - a) * k;
  const flick = p => p < 0 || p >= 1 ? 0 : p < 0.45 ? p / 0.45 : 1 - (p - 0.45) / 0.55;   // a lid closing and opening
  // a face's state at time t (milliseconds); soon: it is seen for a few seconds only – it smiles and lifts its brows early
  function alive(t, soon) {
    const k = soon ? 0.3 : 1;
    return { blink: 0, blinkAt: t + 1500 * k, wink: -1, look: [0, 0], want: [0, 0], lookAt: 0, smile: 0, smileUntil: 0, smileNext: t + (3000 + Math.random() * 4000) * k,
      brow: [0, 0], browWant: [0, 0], kind: 0, kindWant: 0, browUntil: 0, browNext: t + (4500 + Math.random() * 4500) * k, ph: Math.random() * 6 };
  }
  // f: what `alive` made; dt in seconds; w: petted (it smiles along), pulse (the beat, 0–1: the brows lift a little),
  // closed (its eyes stay shut). Returns the expression for `pose`.
  function life(f, t, dt, w) {
    w = w || {};
    if (t > f.blinkAt) {
      const p = (t - f.blinkAt) / 200;
      f.blink = flick(p);
      if (p >= 1) { f.blink = 0; f.blinkAt = t + (Math.random() < 0.15 ? 280 : 2200 + Math.random() * 4500); f.wink = Math.random() < 0.07 ? (Math.random() < 0.5 ? 0 : 1) : -1; }
    }
    if (t > f.lookAt) {                                // a glance somewhere, mostly well to one side – or straight out
      const x = Math.random() < 0.25 ? 0 : (0.45 + 0.55 * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      f.want = [x, x ? (Math.random() * 2 - 1) * 0.8 : 0]; f.lookAt = t + 700 + Math.random() * 2300;
    }
    const kl = 1 - Math.exp(-dt * 8);
    f.look = [lerp(f.look[0], f.want[0], kl), lerp(f.look[1], f.want[1], kl)];
    if (t > f.smileNext) { f.smileUntil = t + 3000 + Math.random() * 3000; f.smileNext = f.smileUntil + 5000 + Math.random() * 8000; }
    f.smile = lerp(f.smile, w.petted ? 1 : t < f.smileUntil ? 0.9 : 0.08, 1 - Math.exp(-dt * 2.2));
    if (t > f.browNext) {
      const pick = Math.random() * 4 | 0;              // both up, one up, kind (the inner ends up), a frown
      f.browWant = pick === 0 ? [1, 1] : pick === 1 ? (Math.random() < 0.5 ? [1, 0.15] : [0.15, 1]) : pick === 2 ? [0.2, 0.2] : [-0.85, -0.85];
      f.kindWant = pick === 2 ? 1 : 0; f.browUntil = t + 1800 + Math.random() * 2200; f.browNext = f.browUntil + 3500 + Math.random() * 6500;
    }
    const on = t < f.browUntil, kb = 1 - Math.exp(-dt * 6);
    for (const k of [0, 1]) f.brow[k] = lerp(f.brow[k], on ? f.browWant[k] : 0.5 * (w.pulse || 0), kb);   // and they lift a little with the beat
    f.kind = lerp(f.kind, on ? f.kindWant : 0, kb);
    const closed = w.closed ? 1 : 0;
    return { blink: [Math.max(closed, f.wink === 1 ? 0 : f.blink), Math.max(closed, f.wink === 0 ? 0 : f.blink)], look: f.look, smile: f.smile, brow: f.brow, kind: f.kind,
      turn: 0.72 * Math.sin(t / 3900 + f.ph) + 0.26 * Math.sin(t / 1700), nod: 0.65 * Math.sin(t / 4900 + f.ph * 2) + 0.2 * Math.sin(t / 2300) };
  }

  // ---------- an expression: where the points are now ----------
  // e: blink [A, B] (0–1), look [x, y] (-1–1), smile (0–1), brow [A, B] (-1 down … 1 up), kind (0–1: the inner ends
  // of the brows up), turn and nod (-1–1: the head turns a little – what stands out moves further)
  function pose(m, e) {
    const B = m.base, q = m.out;
    q.set(B);
    const move = (i, dx, dy) => { q[2 * i] += dx; q[2 * i + 1] += dy; };
    const smile = clamp(e.smile || 0, 0, 1);
    if (e.turn || e.nod) for (let i = 0; i < PICK.length; i++) move(i, (e.turn || 0) * m.depth[i] * m.r * 0.1, (e.nod || 0) * m.depth[i] * m.r * 0.075);
    for (const [k, ring] of [[0, AT.eyeA], [1, AT.eyeB]]) {
      const b = clamp((e.blink ? e.blink[k] : 0) + 0.2 * smile, 0, 1), gap = m.lidGap[k];    // smiling eyes narrow a little
      let mx = 0, my = 0;
      for (let j = 0; j < 3; j++) {                    // the upper lid comes down to the lower one, which rises a little
        const u = ring[1 + j], l = ring[7 - j], dx = B[2 * l] - B[2 * u], dy = B[2 * l + 1] - B[2 * u + 1];
        move(u, dx * 0.95 * b, dy * 0.95 * b); move(l, -dx * 0.05 * b, -dy * 0.05 * b);
        mx += dx / 3; my += dy / 3;
      }
      // the iris, all of it: it goes where the eye looks, and down to the lower lid as the eye closes. The lids go along a
      // little (the upper one up when it looks up, the lower one down when it looks down), as lids do – and the net, whose
      // iris reaches to the lids, does not fold over there
      const look = e.look || [0, 0], d = Math.hypot(mx, my) || 1, ux = mx / d, uy = my / d, lx = B[2 * ring[6]], ly = B[2 * ring[6] + 1];
      const gx = look[0] * m.eye * 0.15 * (1 - b), gy = look[1] * gap * 0.22 * (1 - b);
      for (let j = 0; j < 5; j++) {
        const i = AT.iris[5 * k + j], above = (lx - B[2 * i]) * ux + (ly - B[2 * i + 1]) * uy;
        move(i, gx + ux * above * 0.95 * b, gy + uy * above * 0.95 * b);
      }
      for (let j = 0; j < 3; j++) {
        const w = j === 1 ? 1 : 0.4;            // the middle of each lid touches the iris
        move(ring[1 + j], gx * w, Math.min(0, gy) * 0.6 * w); move(ring[7 - j], gx * w, (gy > 0 ? gy : 0.3 * gy) * w);
      }
      // the brows: up, the outer ends a little less; down (a frown), the inner ends most and towards each other – not so far
      // that they reach the folds above the eyes; kind, the inner ends up
      const up = clamp(e.brow ? e.brow[k] : 0, -1, 1), brow = k ? AT.browB : AT.browA, inward = Math.sign(m.mid[0] * m.size - B[2 * brow[4]]);
      for (let j = 0; j < 5; j++) {
        const inner = j / 4, down = Math.max(0, -up);
        move(brow[j], inward * gap * 0.25 * down * inner, up > 0 ? -gap * 0.8 * up * (0.6 + 0.1 * j) : gap * down * (0.15 + 0.25 * inner));
        move(brow[j], 0, -gap * 0.7 * (e.kind || 0) * inner * inner);
      }
      if (up < 0) move(AT.brow0[1], 0, gap * 0.06 * -up);   // between the brows: it follows them a little (half from each)
    }
    if (smile) {                                       // the corners of the mouth go out and up, lips and cheeks follow
      const w = m.mouth, L = AT.lips;
      for (const [i, sx, k] of [[L[0], -1, 1], [L[4], 1, 1], [L[1], -1, 0.35], [L[3], 1, 0.35], [L[7], -1, 0.45], [L[5], 1, 0.45]]) move(i, sx * w * 0.1 * k * smile, -w * 0.15 * k * smile);
      move(AT.lips[6], 0, -w * 0.035 * smile);
      for (const [i, k] of [[AT.cheek[2], 1], [AT.cheek[3], 1], [AT.cheek[0], 0.55], [AT.cheek[1], 0.55]]) move(i, 0, -w * 0.09 * k * smile);
    }
    return q;
  }

  // ---------- drawing the moved net: the still picture, and over it every triangle that moved ----------
  // q: the points as `pose` moved them (null: still); edge: a mask the picture is seen through (no square edge)
  function render(m, q, edge) {
    const g = m.g, B = m.base, T = m.tris;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, m.size, m.size); g.drawImage(m.tex, 0, 0);
    let n = 0;
    for (let t = 0; q && t < T.length; t += 3) {
      const a = T[t], b = T[t + 1], c = T[t + 2];
      const u0 = B[2 * a], v0 = B[2 * a + 1], u1 = B[2 * b], v1 = B[2 * b + 1], u2 = B[2 * c], v2 = B[2 * c + 1];
      const x0 = q[2 * a], y0 = q[2 * a + 1], x1 = q[2 * b], y1 = q[2 * b + 1], x2 = q[2 * c], y2 = q[2 * c + 1];
      if (Math.abs(x0 - u0) + Math.abs(y0 - v0) + Math.abs(x1 - u1) + Math.abs(y1 - v1) + Math.abs(x2 - u2) + Math.abs(y2 - v2) < 0.2) continue;
      const den = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
      if (Math.abs(den) < 1e-3) continue;
      const mx = (x0 + x1 + x2) / 3, my = (y0 + y1 + y2) / 3;   // a little larger than it is: no seams between neighbours
      const grow = (x, y) => { const d = Math.hypot(x - mx, y - my) || 1, k = (d + 0.9) / d; return [mx + (x - mx) * k, my + (y - my) * k]; };
      g.save(); g.beginPath(); g.moveTo(...grow(x0, y0)); g.lineTo(...grow(x1, y1)); g.lineTo(...grow(x2, y2)); g.closePath(); g.clip();
      g.transform((x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / den, (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / den,
        (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / den, (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / den,
        (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / den, (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / den);
      g.drawImage(m.tex, 0, 0); g.restore(); n++;
    }
    if (edge) { g.globalCompositeOperation = 'destination-in'; g.drawImage(edge, 0, 0, m.size, m.size); g.globalCompositeOperation = 'source-over'; }
    m.drawn = n;
    return m.cv;
  }

  // ---------- finding the points: a worker of the stage's page ----------
  async function workerMain() {                        // in the worker: one face at a time, as asked
    let maker = null;
    const landmarker = () => maker || (maker = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import('/mp/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks('/mp/wasm');
      // on the processor: once per painted face, and the graphics card stays with the dream
      return FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: '/mp/face_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 });
    })());
    root.onmessage = async ev => {
      const { face, url } = ev.data;
      let points = null, error = '';
      try {
        const bm = await createImageBitmap(await (await fetch(url)).blob());
        const lm = (await landmarker()).detect(bm).faceLandmarks[0];
        bm.close();
        if (lm && lm.length >= 478) points = pack(lm);
      } catch (e) { error = String(e && e.message || e); maker = null; }
      root.postMessage({ face, points, error });
    };
  }
  function serve(src) {                                // on the stage: Dream asks over /facemarks, the worker answers
    let worker = null, ws = null;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/facemarks`);
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || typeof m.face !== 'string' || !/^\/eyes\/mask\/[0-9a-f]{12}\.jpg$/.test(m.url)) return;
        if (!worker) {
          worker = new Worker(src);
          worker.onmessage = e => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ face: e.data.face, points: e.data.points })); };
          worker.onerror = () => { worker = null; };
        }
        worker.postMessage({ face: m.face, url: m.url });
      };
      ws.onclose = ev => { if (ev.code !== 4403) setTimeout(connect, 5000); };   // not the stage on Dream's Mac: not asked
    };
    connect();
  }

  root.DreamFace = { GROUPS, PICK, AT, pack, delaunay, mesh, plain, flick, alive, life, pose, render };
  if (typeof document === 'undefined' && typeof root.importScripts === 'function') workerMain();
  else if (typeof document !== 'undefined' && document.currentScript && document.currentScript.dataset.detect !== undefined) serve(document.currentScript.src);
})(typeof self !== 'undefined' ? self : globalThis);
