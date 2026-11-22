/* Dream – "you in the dream" (#219): whoever stands in front of Dreamy Eyes, as the camera sees them – cut out on the
   phone, the face unchanged, and only around them the dream: the dream's picture as the background, a soft glowing
   outline, fireflies, a shimmer in the dream's colour at their edge, now and then a frame of blossoms, a mandala or mist.
   Everything here is drawn on this device from the camera's picture and a mask of the person (selfie segmentation in
   eyes.html); nothing is sent, kept or read back by anyone – this file never talks to the network (tests/test_rights.py).
   The rule of the drawing: the person's own pixels are put down once, as they are, and nothing is ever drawn over the
   face (tests/js/you.test.mjs). No DOM besides canvases; needs dreamlife.js; a global `DreamYou`. */
(function (root) {
  'use strict';
  const { softLight, stamp, tinted } = root.DreamLife;
  const FRAMES = ['blossom', 'mandala', 'mist'];
  const TINY = 64, GLOW = 28;                           // the mask, small: scaled up again it is the soft outline
  const FACE = 0.3;                                     // how much of the picture's width the face takes
  const PATCH = softLight([[0, 'rgba(255,255,255,1)'], [0.62, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 64);   // a piece of the picture
  const WHITE = softLight([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']], 64);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const canvas = () => document.createElement('canvas');
  const fit = (c, n) => { if (c.width !== n || c.height !== n) { c.width = c.height = n; return true; } return false; };

  function create() {
    const tiny = canvas(), rim = canvas();
    tiny.width = tiny.height = rim.width = rim.height = TINY;
    return { pic: canvas(), cut: canvas(), mask: canvas(), over: canvas(), gone: canvas(), tiny, rim, halo: canvas(), glow: canvas(),
      bits: Array.from({ length: 64 }, (_, k) => ({ x: (k % 8 + 0.5 + (Math.random() - 0.5) * 0.5) / 8, y: ((k >> 3) + 0.5 + (Math.random() - 0.5) * 0.5) / 8, j: Math.random(), a: Math.random() * Math.PI * 2 })),
      tx: tiny.getContext('2d', { willReadFrequently: true }), crop: null, guard: null, eyes: { x0: 0.42, x1: 0.58, y: 0.42 },
      sparks: Array.from({ length: 24 }, (_, k) => ({ a: Math.random() * Math.PI * 2, r: 0.22 + Math.random() * 0.26,
        v: (0.06 + Math.random() * 0.16) * (k % 3 ? 1 : -1), ph: Math.random() * Math.PI * 2, s: 0.012 + Math.random() * 0.016, hue: Math.random() * 70 - 25 })) };
  }

  // the square that is shown: the face a third of its width, a little above the middle. Someone close to the camera
  // needs more room than its picture has – then the square reaches beyond it (above the head, the shoulders stay at
  // its lower edge): there is only dream there anyway
  function cropOf(sw, sh, face) {
    const m = Math.min(sw, sh);
    if (!face || !(face.size > 0)) return { x: (sw - m) / 2, y: (sh - m) / 2, s: m };
    const s = clamp(face.size * sw / FACE, m * 0.5, m * 1.5);
    return { x: s <= sw ? clamp(face.x * sw - s / 2, 0, sw - s) : (sw - s) / 2,
      y: s <= sh ? clamp(face.y * sh + s * 0.05 - s / 2, 0, sh - s) : sh - s, s };
  }
  // a picture in the camera's framing (the camera itself, or the mask of the person), cropped and mirrored like a mirror
  function put(c, img, y, sw, sh, n) {
    const q = y.crop, k = n / q.s;
    c.save(); c.translate(n, 0); c.scale(-1, 1);
    c.drawImage(img, -q.x * k, -q.y * k, sw * k, sh * k);   // the whole picture, placed: the canvas crops it (also beyond its edge)
    c.restore();
  }
  function oval(c, o, k, inner, col) {                  // a soft oval: full up to `inner` of its radius, gone at its edge
    c.save(); c.translate(o.x, o.y); c.scale(o.rx * k, o.ry * k);
    const gr = c.createRadialGradient(0, 0, inner, 0, 0, 1);
    gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = gr; c.fillRect(-1, -1, 2, 2); c.restore();
  }

  // The person alone, on nothing: `y.cut`, n × n. o: { src, sw, sh (the camera's picture and its size), mask (the person,
  // white on nothing, in the camera's framing), face: { x, y, size, h, eyes } (0–1, as the camera sees it), n }
  function cutout(y, o) {
    const n = o.n, sw = o.sw, sh = o.sh, face = o.face;
    const want = cropOf(sw, sh, face), k = y.crop && !o.still ? 0.25 : 1;   // it follows the face softly
    y.crop = y.crop ? { x: y.crop.x + (want.x - y.crop.x) * k, y: y.crop.y + (want.y - y.crop.y) * k, s: y.crop.s + (want.s - y.crop.s) * k } : want;
    const q = y.crop, has = face && face.size > 0;
    const fw = has ? face.size * sw / q.s * n : n * FACE, fh = has && face.h > 0 ? face.h * sh / q.s * n : fw * 1.3;
    const fx = has ? n - (face.x * sw - q.x) / q.s * n : n / 2, fy = has ? (face.y * sh - q.y) / q.s * n : n * 0.45;
    // the face's oval – where nothing but the camera's own picture may ever be (full to 0.8 of it: just past the face)
    y.guard = { x: fx, y: fy, rx: fw * 0.66, ry: fh * 0.64 };
    const e = has && face.eyes ? face.eyes.map(p => [n - (p.x * sw - q.x) / q.s * n, (p.y * sh - q.y) / q.s * n]).sort((a, b) => a[0] - b[0]) : null;
    y.eyes = e && e[1][0] - e[0][0] > n * 0.04 ? { x0: e[0][0] / n, x1: e[1][0] / n, y: (e[0][1] + e[1][1]) / 2 / n }
      : { x0: (fx - fw * 0.21) / n, x1: (fx + fw * 0.21) / n, y: (fy - fh * 0.1) / n };
    const m = Math.max(TINY, n >> 1);
    fit(y.mask, m);
    const mc = y.mask.getContext('2d');
    mc.globalCompositeOperation = 'source-over'; mc.clearRect(0, 0, m, m);
    put(mc, o.mask, y, sw, sh, m);
    {                                                   // where the camera's picture ends the person fades out softly – no cut shoulders
      const k = m / q.s, x0 = -q.x * k, y0 = -q.y * k, w = sw * k, h = sh * k;
      mc.save(); mc.translate(m, 0); mc.scale(-1, 1); mc.globalCompositeOperation = 'destination-out';
      for (const [ax, ay, bx, by] of [[0, y0 + h, 0, y0 + h * 0.86], [x0, 0, x0 + w * 0.06, 0], [x0 + w, 0, x0 + w * 0.94, 0]]) {
        const gr = mc.createLinearGradient(ax, ay, bx, by);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        mc.fillStyle = gr; mc.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
      }
      mc.restore(); mc.globalCompositeOperation = 'source-over';
    }
    // the face always belongs to the person, whatever the mask says: no hole and no thin edge the dream could shine through
    if (has) oval(mc, { x: fx * m / n, y: fy * m / n, rx: fw * 0.5 * m / n, ry: fh * 0.5 * m / n }, 1, 0.96, '255,255,255');
    fit(y.cut, n);
    const c = y.cut.getContext('2d');
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(0, 0, n, n);
    put(c, o.src, y, sw, sh, n);                        // the camera's picture, as it is
    c.globalCompositeOperation = 'destination-in'; c.drawImage(y.mask, 0, 0, n, n);
    c.globalCompositeOperation = 'source-over';
    if (has) {                                          // and the face once more, sharp to its edge: exactly the camera's picture
      c.save(); c.beginPath(); c.ellipse(fx, fy, fw * 0.5, fh * 0.5, 0, 0, Math.PI * 2); c.clip();
      put(c, o.src, y, sw, sh, n); c.restore();
    }
    return y.cut;
  }

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
  function mandala(c, n, t, hue, al) {                  // rings of petals drawn in light behind the person, turning both ways
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
  const BEHIND = { mandala }, FRONT = { blossom: blossoms, mist };   // an aureole behind the head; a wreath, veils before the shoulders

  function sparks(c, y, n, t, hue, al, count, front, away = 0) {  // fireflies around the person, never where the face is
    const gd = y.guard;
    c.globalCompositeOperation = 'lighter';
    for (let k = front ? 1 : 0; k < Math.min(count, y.sparks.length); k += 2) {
      const s = y.sparks[k], an = s.a + t / 1000 * s.v, rr = n * (s.r + 0.03 * Math.sin(t / 1700 + s.ph) + away * (0.12 + 0.5 * s.s * 30));   // leaving: they fly off
      const x = gd.x + Math.cos(an) * rr, yy = gd.y + n * 0.08 + Math.sin(an) * rr * 1.1 + Math.sin(t / 900 + s.ph) * n * 0.012 - away * n * 0.06;
      const dx = (x - gd.x) / gd.rx, dy = (yy - gd.y) / gd.ry;
      if (dx * dx + dy * dy < 1.3) continue;
      const tw = 0.55 + 0.45 * Math.sin(t / 380 + s.ph * 3), r = n * s.s * (0.7 + 0.5 * tw);
      stamp(c, tinted(hue + s.hue), x, yy, r * 2.2, 0.75 * tw * al);
      stamp(c, WHITE, x, yy, r * 0.8, 0.95 * tw * al);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }

  // How the picture leaves (#219): not a plain fade – it comes apart into soft pieces that drift off into the dream, the
  // outermost first, the face last; `leave` 0–1. White where the picture still is.
  function dissolve(y, n, leave) {
    fit(y.gone, n);
    const c = y.gone.getContext('2d'), gd = y.guard, far = n * 0.75;
    c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, n, n); c.globalCompositeOperation = 'lighter';
    for (const b of y.bits) {
      const bx = b.x * n, by = b.y * n, d = Math.min(1, Math.hypot(bx - gd.x, by - gd.y) / far);
      const at = (1 - d) * 0.5 + b.j * 0.12, k = clamp((leave - at) / 0.38, 0, 1);   // when this piece goes, and how far it has
      if (k >= 1) continue;
      const drift = k * k * n * 0.16;
      stamp(c, PATCH, bx + Math.cos(b.a) * drift + (bx - gd.x) * k * 0.35, by + Math.sin(b.a) * drift * 0.6 - k * n * 0.07, n / 8 * (1.15 - 0.45 * k), 1 - k);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    return y.gone;
  }

  // The whole picture: `y.pic`, n × n. Besides what cutout takes: dream (the dream's picture, or null), hue (the
  // dream's colour), t (ms), frame (null or one of FRAMES), level (0–1: how far the moment has come), sparks (how many),
  // leave (0–1: how far it has dissolved into the dream again).
  function compose(y, o) {
    const n = o.n, t = o.t, hue = o.hue, al = o.level === undefined ? 1 : clamp(o.level, 0, 1);
    cutout(y, o);
    const gd = y.guard, pulse = 0.5 + 0.5 * Math.sin(t / 1100);
    fit(y.pic, n);
    const p = y.pic.getContext('2d');
    // the dream as the background, slowly zooming and wandering – the room behind the person is never shown
    p.globalCompositeOperation = 'source-over'; p.globalAlpha = 1; p.fillStyle = '#07060b'; p.fillRect(0, 0, n, n);
    if (o.dream) {
      const side = n * (1.3 + 0.12 * Math.sin(t / 7000));
      p.drawImage(o.dream, (n - side) / 2 + Math.sin(t / 9000) * n * 0.1, (n - side) / 2 + Math.cos(t / 11000) * n * 0.08, side, side);
    } else {
      const gr = p.createRadialGradient(n / 2, n * 0.45, 0, n / 2, n * 0.45, n * 0.75);
      gr.addColorStop(0, `hsl(${hue},60%,32%)`); gr.addColorStop(1, `hsl(${hue + 40},60%,8%)`);
      p.fillStyle = gr; p.fillRect(0, 0, n, n);
    }
    // the person's outline, small: scaled up again it is soft by itself (no blur filter – old phones have none)
    const tc = y.tx;
    tc.globalCompositeOperation = 'source-over'; tc.clearRect(0, 0, TINY, TINY);
    tc.drawImage(y.mask, 0, 0, TINY, TINY);
    const tint = (cv, size, from, col) => {
      fit(cv, size);
      const x = cv.getContext('2d');
      x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, size, size); x.drawImage(from, 0, 0, size, size);
      x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, size, size);
    };
    tint(y.glow, GLOW, y.tiny, `hsl(${hue},90%,66%)`);
    tint(y.halo, TINY, y.tiny, `hsl(${hue + 35},95%,80%)`);
    const cx = gd.x, cy = n * 0.62;                     // the glow grows out from the person's middle
    p.globalCompositeOperation = 'lighter';
    for (const [cv, k, a] of [[y.glow, 1.16 + 0.03 * pulse, 0.55 + 0.25 * pulse], [y.glow, 1.07, 0.6], [y.halo, 1.03, 0.75]]) {
      p.globalAlpha = a * al; p.drawImage(cv, cx - cx * k, cy - cy * k, n * k, n * k);
    }
    p.globalAlpha = 1; p.globalCompositeOperation = 'source-over';
    if (BEHIND[o.frame]) BEHIND[o.frame](p, n, t, hue, al);
    sparks(p, y, n, t, hue, al, o.sparks === undefined ? 24 : o.sparks, false);   // these fly behind the person
    // the person, once and as the camera sees them
    p.drawImage(y.cut, 0, 0);
    // what lies in front: the frame, a shimmer exactly at the person's edge, fireflies – and the face's oval taken out
    // of all of it again, so none of it can ever touch the face
    fit(y.over, n);
    const v = y.over.getContext('2d');
    v.globalCompositeOperation = 'source-over'; v.globalAlpha = 1; v.clearRect(0, 0, n, n);
    if (FRONT[o.frame]) FRONT[o.frame](v, n, t, hue, al);
    const img = tc.getImageData(0, 0, TINY, TINY), d = img.data;
    for (let i = 3; i < d.length; i += 4) { const a = d[i] / 255; d[i] = 1020 * a * (1 - a); d[i - 1] = d[i - 2] = d[i - 3] = 255; }   // only the edge
    y.rim.getContext('2d').putImageData(img, 0, 0);
    tint(y.halo, TINY, y.rim, `hsl(${hue + 20 + 40 * Math.sin(t / 2300)},95%,75%)`);
    v.globalCompositeOperation = 'lighter'; v.globalAlpha = (0.45 + 0.25 * pulse) * al; v.drawImage(y.halo, 0, 0, n, n);
    v.globalAlpha = 1; v.globalCompositeOperation = 'source-over';
    sparks(v, y, n, t, hue, al, o.sparks === undefined ? 24 : o.sparks, true);
    v.globalCompositeOperation = 'destination-out'; oval(v, gd, 1, 0.8, '0,0,0'); v.globalCompositeOperation = 'source-over';
    p.drawImage(y.over, 0, 0);
    const leave = clamp(o.leave || 0, 0, 1);
    if (leave > 0) {                                    // it comes apart, and its fireflies fly off into the dream
      p.globalCompositeOperation = 'destination-in'; p.drawImage(dissolve(y, n, leave), 0, 0); p.globalCompositeOperation = 'source-over';
      const glowing = Math.sin(Math.min(1, leave * 1.15) * Math.PI);
      for (const front of [false, true]) sparks(p, y, n, t, hue, glowing, y.sparks.length, front, leave);
    }
    return y.pic;
  }

  root.DreamYou = { FRAMES, FACE, create, cropOf, cutout, compose, dissolve };
})(typeof window !== 'undefined' ? window : globalThis);
