// Full-frame-rate effects drawn over the dream picture, shared by the stage (index.html) and the output windows
// (output.html): they run at 60 fps however few pictures per second the AI makes. The autopilot picks which ones and
// how strong (amounts 0…1); every renderer draws them from the same few numbers. This file is the Canvas 2D drawing;
// gl-stage.js (#204) draws the same effects on the graphics card and falls back to this one without WebGL 2.
window.DreamFx = (() => {
  'use strict';
  // the order they are applied in: shapes first, then what reads the previous frame (feedback, trails)
  const ORDER = ['mirror', 'kaleido', 'mandala', 'tunnel', 'waves', 'glitch', 'pixel', 'raster', 'rgb', 'feedback', 'trails'];
  // done on the canvas element with a CSS filter (cheap): colour rotation and a short negative
  const FILTERS = ['hue', 'invert'];
  const ALL = ORDER.concat(FILTERS);

  const mk = () => document.createElement('canvas');
  const size = (c, w, h) => { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c.getContext('2d'); };
  // the buffer for a box of cw × ch CSS pixels: at most maxW wide, the same format
  const fit = (cw, ch, maxW) => { const k = Math.min(1, maxW / Math.max(1, cw)); return [Math.max(2, Math.round(cw * k)), Math.max(2, Math.round(ch * k))]; };
  // #205 (Pf-6 of #187): an element's size in CSS pixels without asking the browser every frame (that makes it lay
  // the page out in the middle of drawing): the browser tells when it changes. Only an element not measured yet, or
  // one that was hidden a moment ago, is asked directly. It is the size on the page, whatever the motion (#215) makes of it.
  const sizes = new WeakMap();
  const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(list => { for (const e of list) sizes.set(e.target, [e.contentRect.width, e.contentRect.height]); }) : null;
  function box(el) {
    let s = sizes.get(el);
    if (!s && watch) watch.observe(el);
    if (!s || !s[0]) { s = [el.clientWidth, el.clientHeight]; if (watch) sizes.set(el, s); }
    return s;
  }
  // glitch: a few slices [top, height, shift] (shares of the picture), new ones on every strong beat and now and then
  function slices(st, p, rnd) {
    if (p.pulse > 0.6 || !st.slices || rnd() < 0.05) {
      st.slices = Array.from({ length: 4 + Math.floor(rnd() * 6) }, () => [rnd(), 0.02 + rnd() * 0.08, (rnd() - 0.5) * 0.16]);
    }
    return st.slices;
  }
  // the grids of the mosaic (coarser with its strength and on the beat) and of the print raster
  const pixelGrid = (w, h, a, p) => { const cols = Math.max(24, Math.round(120 - 60 * a - 25 * p.pulse)); return [cols, Math.max(12, Math.round(cols * h / w))]; };
  const rasterGrid = (w, h) => [64, Math.max(8, Math.round(64 * h / w))];

  // where the effects are centred (#83: at the dancer's hand; 0…1, default the middle)
  const at = (p, w, h) => [w * (p.cx == null ? 0.5 : p.cx), h * (p.cy == null ? 0.5 : p.cy)];
  // kaleidoscope: n mirrored wedges of the picture around the centre, turned by spin (radians)
  function wedges(ctx, src, w, h, n, spin, scale = 1, c = [w / 2, h / 2]) {
    const [cx, cy] = c, R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 2, a = Math.PI * 2 / n;
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(i * a + spin);
      if (i % 2) ctx.scale(1, -1);                       // every other wedge mirrored: seamless edges
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R * scale, -a / 2 - 0.01, a / 2 + 0.01); ctx.closePath(); ctx.clip();
      ctx.rotate(-spin * 0.5);
      const k = scale * 2 * R / Math.min(w, h);        // big enough that the turned picture fills the whole wedge
      ctx.drawImage(src, -w * k / 2, -h * k / 2, w * k, h * k);
      ctx.restore();
    }
  }

  // one effect: draws effect(src) over dst (dst already holds src) with alpha a
  const FX = {
    mirror(d, s, w, h, a, p) {                         // 2-fold, or 4-fold with seed
      d.globalAlpha = a;
      d.save(); d.translate(w, 0); d.scale(-1, 1); d.drawImage(s, 0, 0, w / 2, h, 0, 0, w / 2, h); d.restore();
      if (p.seed % 2) { d.save(); d.translate(0, h); d.scale(1, -1); d.drawImage(d.canvas, 0, 0, w, h / 2, 0, 0, w, h / 2); d.restore(); }
    },
    kaleido(d, s, w, h, a, p) { d.globalAlpha = a; wedges(d, s, w, h, 6, p.spin, 1, at(p, w, h)); },
    mandala(d, s, w, h, a, p) {                        // more segments, an inner ring turning the other way
      const n = 8 + 2 * (p.seed % 3);
      d.globalAlpha = a; wedges(d, s, w, h, n, p.spin * 0.7, 1, at(p, w, h));
      d.globalAlpha = a * 0.8; wedges(d, s, w, h, n * 2, -p.spin * 1.3, 0.45 + 0.05 * p.pulse, at(p, w, h));
    },
    tunnel(d, s, w, h, a, p) {                         // the picture inside itself, the rings flowing inwards (to the centre)
      const ph = (p.t * (0.18 + 0.5 * p.pulse)) % 1, [cx, cy] = at(p, w, h);
      d.globalAlpha = a;
      for (let k = 0; k < 6; k++) {
        const sc = Math.pow(0.66, k + ph) * 1.5;
        if (sc > 1.6) continue;
        d.drawImage(s, cx - cx * sc, cy - cy * sc, w * sc, h * sc);
      }
    },
    waves(d, s, w, h, a, p) {                          // strips moved sideways like heat haze or water, more with the bass
      // with a hand (p.loc 0…1) the waves gather around its height and run out from there
      const n = 48, sh = h / n, amp = w * 0.035 * (0.4 + p.bass + p.pulse), loc = p.loc || 0, y0 = p.cy == null ? 0.5 : p.cy;
      d.globalAlpha = a;
      for (let i = 0; i < n; i++) {
        const u = i / n - y0, near = Math.exp(-u * u / 0.03);
        const dx = Math.sin(i * 0.33 - loc * Math.abs(u) * 18 + p.t * 2.6) * amp * (1 - loc + loc * (0.25 + 1.6 * near));
        d.drawImage(s, 0, i * sh, w, sh + 1, dx, i * sh, w, sh + 1);
      }
    },
    glitch(d, s, w, h, a, p, st) {                     // slices slipping sideways, new ones on every strong beat
      d.globalAlpha = a;
      for (const [y, hh, dx] of slices(st, p, st.rnd)) d.drawImage(s, 0, y * h, w, hh * h, dx * w * (0.3 + p.pulse), y * h, w, hh * h);
    },
    pixel(d, s, w, h, a, p, st) {                      // a coarse mosaic, coarser on the beat
      const [cols, rows] = pixelGrid(w, h, a, p);
      const t = size(st.small || (st.small = mk()), cols, rows);
      t.drawImage(s, 0, 0, cols, rows);
      d.globalAlpha = a; d.imageSmoothingEnabled = false; d.drawImage(st.small, 0, 0, w, h); d.imageSmoothingEnabled = true;
    },
    raster(d, s, w, h, a, p, st) {                     // halftone dots or lines: the picture as a print raster
      const [cols, rows] = rasterGrid(w, h), cw = w / cols, ch = h / rows;
      const t = size(st.rs || (st.rs = mk()), cols, rows);
      t.drawImage(s, 0, 0, cols, rows);
      const px = t.getImageData(0, 0, cols, rows).data;
      d.globalAlpha = a; d.fillStyle = '#000'; d.fillRect(0, 0, w, h);
      const dots = p.seed % 3 !== 0;                  // mostly dots, now and then lines
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2], lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
        d.fillStyle = `rgb(${r},${g},${b})`;
        if (dots) { d.beginPath(); d.arc(x * cw + cw / 2, y * ch + ch / 2, Math.max(0.5, cw * 0.62 * Math.sqrt(lum)), 0, 7); d.fill(); }
        else { const t = ch * (0.2 + 0.8 * lum); d.fillRect(x * cw, y * ch + (ch - t) / 2, cw + 0.5, t); }
      }
    },
    rgb(d, s, w, h, a, p, st) {                        // the colour channels pulled apart on the beat
      const r = w * 0.012 * (0.4 + 1.6 * p.pulse), ang = p.ang || 0, offX = r * Math.cos(ang), offY = r * Math.sin(ang);   // along the movement
      const ch = c => { const k = size(st[c] || (st[c] = mk()), w, h); k.globalCompositeOperation = 'source-over'; k.drawImage(s, 0, 0);
        k.globalCompositeOperation = 'multiply'; k.fillStyle = c; k.fillRect(0, 0, w, h); return st[c]; };
      const m = size(st.mix || (st.mix = mk()), w, h);
      m.globalCompositeOperation = 'source-over'; m.fillStyle = '#000'; m.fillRect(0, 0, w, h);
      m.globalCompositeOperation = 'lighter';
      m.drawImage(ch('#f00'), -offX, -offY); m.drawImage(ch('#0f0'), 0, 0); m.drawImage(ch('#00f'), offX, offY);
      d.globalAlpha = a; d.drawImage(st.mix, 0, 0);
    },
    feedback(d, s, w, h, a, p, st) {                   // the last frame, a little closer and turned, behind the new one
      if (!st.prev) return;
      d.save(); d.globalAlpha = 0.78 * a;
      const [cx, cy] = at(p, w, h);
      d.translate(cx, cy); d.rotate(0.035 * (p.dir || 1) * (0.5 + p.pulse)); d.scale(1.05 + 0.04 * p.pulse, 1.05 + 0.04 * p.pulse);
      d.drawImage(st.prev, -cx, -cy, w, h); d.restore();
      d.globalAlpha = 1 - 0.55 * a; d.drawImage(s, 0, 0);
    },
    trails(d, s, w, h, a, p, st) {                     // what was bright stays a while: streaks after every movement
      if (!st.prev) return;
      d.globalAlpha = 0.88 * a; d.drawImage(st.prev, 0, 0);
      d.globalAlpha = 1; d.globalCompositeOperation = 'lighten'; d.drawImage(s, 0, 0); d.globalCompositeOperation = 'source-over';
    },
  };

  // a renderer for one canvas: keeps its own buffers and the previous frame (for feedback and trails)
  function create(cv, maxW = 960, rnd = Math.random) {
    const st = { rnd }, A = mk(), B = mk(), prev = mk();
    return {
      // img: the picture now shown, old/mix: the one it is blending from and how far (the cross-fade stays visible),
      // rel: how old lies against img (morph.rel; #215: the canvas moves with img, old keeps its own place under it);
      // p: {amts: {name: 0…1}, pulse, bass, spin, t, seed, dir, cx, cy (centre 0…1), loc (how much it follows it), ang (radians)}
      render(img, p, old, mix = 1, rel = null) {
        const [w, h] = fit(...box(cv), maxW);            // its size on the page, whatever the motion (#215) makes of it
        const out = size(cv, w, h);
        const iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height);
        if (!iw || !ih) return;
        let src = A, dst = B, sctx = size(A, w, h); size(B, w, h);
        const cover = (im, alpha) => { const ow = im.naturalWidth || im.width, oh = im.naturalHeight || im.height; if (!ow || !oh) return;
          const s = Math.max(w / ow, h / oh); sctx.globalAlpha = alpha; sctx.drawImage(im, (w - ow * s) / 2, (h - oh * s) / 2, ow * s, oh * s); };
        if (old && mix < 0.99) {                         // the picture covers the canvas
          if (rel) { cover(img, 1); sctx.save(); placed(sctx, rel, w, h); }   // img under old's edges, where a turned picture ends
          cover(old, 1);
          if (rel) sctx.restore();
        }
        cover(img, old && mix < 0.99 ? Math.max(0, mix) : 1); sctx.globalAlpha = 1;
        st.prev = prev.width === w && prev.height === h ? prev : null;
        for (const name of ORDER) {
          const a = Math.min(1, (p.amts && p.amts[name]) || 0);
          if (a < 0.02) continue;
          const d = dst.getContext('2d');
          d.globalAlpha = 1; d.globalCompositeOperation = 'source-over'; d.drawImage(src, 0, 0);
          FX[name](d, src, w, h, a, p, st);
          d.globalAlpha = 1; d.globalCompositeOperation = 'source-over';
          [src, dst] = [dst, src];
        }
        out.globalAlpha = 1; out.clearRect(0, 0, w, h); out.drawImage(src, 0, 0);
        size(prev, w, h).drawImage(src, 0, 0);
      },
      reset() { prev.width = prev.height = 0; cv.width = cv.height = 0; },
    };
  }
  // the CSS filter for the element: colour rotation (degrees) and a short negative (0…1)
  const cssFilter = p => {
    const f = [];
    if (p.hue) f.push(`hue-rotate(${Math.round(p.hue)}deg)`);
    if (p.inv > 0.02) f.push(`invert(${Math.min(0.85, p.inv).toFixed(2)})`);
    return f.join(' ');
  };
  // smoothing: every screen frame mixes a little of the newest AI picture into what is shown – a moving
  // average in time. Small jumps of detail from picture to picture (flicker) melt away, big changes still come
  // through, just softer. tau: seconds until a new picture is ~63 % there.
  function smoother(cv, maxW = 1280) {
    let src = null, ready = false, copy = null, wait = 0;
    return {
      push(img) { src = img; },
      // #215: a new picture takes over, and the canvas will move with it: what is on it is laid out anew the way it
      // was shown (m: morph.rel of the picture before against the new one), so the picture before does not jump back
      // to where the new one starts. img: the new picture, under the edges of a turned one.
      rebase(m, img) {
        if (!ready || !m || !cv.width) return;
        const w = cv.width, h = cv.height, ctx = cv.getContext('2d');
        size(copy || (copy = mk()), w, h).drawImage(cv, 0, 0);
        const iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height);
        if (iw && ih) { const s = Math.max(w / iw, h / ih); ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s); }
        ctx.save(); placed(ctx, m, w, h); ctx.drawImage(copy, 0, 0); ctx.restore();
      },
      step(dt, tau) {
        const iw = src && (src.naturalWidth || src.width), ih = src && (src.naturalHeight || src.height);
        if (!iw || !ih) return;
        const [w, h] = fit(...box(cv), maxW);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; ready = false; }
        // #205 (Pf-4 of #187): a canvas keeps 8 bits per colour, so a share of a hundredth per frame would be rounded
        // away and leave a shadow of the old picture for good. A small share waits until it has grown to a tenth
        // (the WebGL chain keeps the smoothed picture as floating-point numbers and needs no such step).
        wait += dt;
        const share = ready ? 1 - Math.exp(-wait / Math.max(0.016, tau)) : 1;
        if (share < 0.1) return;
        wait = 0;
        const ctx = cv.getContext('2d'), s = Math.max(w / iw, h / ih);
        ctx.globalAlpha = share;
        ctx.drawImage(src, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
        ctx.globalAlpha = 1; ready = true;
      },
      reset() { ready = false; wait = 0; cv.width = cv.height = 0; },
      get ready() { return ready; },
    };
  }
  // #194, #215: the motion between two AI pictures. Each picture goes on moving the way the dream moves – zoomed and
  // turned around its pivot, as the next input will be – until the next picture comes; so the stage neither stands
  // still nor jumps, however few pictures per second the AI makes. Only a transform (60 fps, almost free). The numbers
  // come from morph.js: one camera runs through all pictures, and each is told how far it is moved right now and how
  // fast it goes on (a record), so a new picture joins the motion instead of starting it anew.
  const Morph = window.DreamMorph;
  const raw = (el, now) => (el._morph ? Morph.moved(el._morph, now - el._morph.born) : null);
  const morph = {
    start(el, m, now) { el._morph = Morph.valid(m) ? { ...m, born: now } : null; },
    // a new picture `front` with record m takes over from `back`: that one goes on from where it is, at the new pace –
    // the two move as one while they cross-fade
    show(front, back, m, now) {
      const was = raw(back, now), old = back._morph;
      morph.start(front, m, now);
      const f = front._morph, by = f || old;
      back._morph = by && (f || was.r || was.l) ? { r0: was ? was.r : 0, l0: was ? was.l : 0, vr: f ? f.vr : 0, vl: f ? f.vl : 0,
        period: by.period, px: (old || f).px, py: (old || f).py, born: now } : null;
    },
    // how far the picture has moved by now: turned by r degrees and scaled by s around (px, py); null = it rests
    at(el, now) {
      const m = raw(el, now);
      return m ? { r: m.r, s: Math.exp(m.l), px: el._morph.px, py: el._morph.py } : null;
    },
    // how `old` lies against `el` right now (what was drawn of it stays in place when the drawing turns to el); null: just as el
    rel(old, el, now) {
      const o = morph.at(old, now), n = morph.at(el, now);
      if (!o && !n) return null;
      const m = { r: (o ? o.r : 0) - (n ? n.r : 0), s: (o ? o.s : 1) / (n ? n.s : 1), px: (n || o).px, py: (n || o).py };
      return Math.abs(m.r) > 1e-3 || Math.abs(m.s - 1) > 1e-5 ? m : null;
    },
    apply(el, now, target = el) {
      const m = morph.at(el, now);
      if (!m) { if (target.style.transform) target.style.transform = ''; return; }
      target.style.transformOrigin = `${(m.px * 100).toFixed(1)}% ${(m.py * 100).toFixed(1)}%`;
      target.style.transform = `rotate(${m.r.toFixed(3)}deg) scale(${m.s.toFixed(5)})`;
    },
  };
  // a drawing turned by m.r degrees and scaled by m.s around the pivot of a w × h canvas
  function placed(ctx, m, w, h) { ctx.translate(m.px * w, m.py * h); ctx.rotate(m.r * Math.PI / 180); ctx.scale(m.s, m.s); ctx.translate(-m.px * w, -m.py * h); }
  return { create, cssFilter, smoother, morph, fit, box, slices, pixelGrid, rasterGrid, ORDER, FILTERS, ALL };
})();
