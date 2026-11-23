/* Dream – "you in the dream" (#219, #229): whoever stands in front of Dreamy Eyes, cut out on the phone and seen as in
   a dream: the picture wavers as through water, the person runs out into mist at their edge with a delicate fringe in
   the dream's colours, the face is clear only for a moment in the middle, and when it leaves it comes apart into
   drifting streaks and sparks before the mist blows away. Around them the dream: its picture as the background, a soft
   glow, fireflies, now and then a frame of blossoms, a mandala or mist.
   Everything here is drawn on this device from the camera's picture and a mask of the person (selfie segmentation in
   eyes.html) with plain canvas drawing – no model ever paints or changes the person, and nothing is sent, kept or read
   back by anyone: this file never talks to the network (tests/test_rights.py, tests/js/you.test.mjs).
   No blur filter and no loop over a picture's pixels (only over the tiny outline, once per mask): softness is a small
   copy scaled up, the wavering is the picture drawn in strips. No DOM besides canvases; needs dreamlife.js; a global
   `DreamYou`. */
(function (root) {
  'use strict';
  const { softLight, stamp, tinted } = root.DreamBrush;
  const FRAMES = ['blossom', 'mandala', 'mist'];
  const LONG = 80, TINY = 64, GLOW = 28;                // the outline, small: scaled up again it is soft by itself
  const FACE = 0.3;                                     // how much of the picture's width the face takes
  const WIND = [0.96, -0.28];                           // where the picture drifts when it leaves
  const PATCH = softLight([[0, 'rgba(255,255,255,1)'], [0.62, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 64);   // a piece of the picture
  const WHITE = softLight([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']], 64);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const canvas = () => document.createElement('canvas');
  const fit = (c, w, h = w) => { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } };
  const wipe = (cv, n) => { fit(cv, n); const c = cv.getContext('2d'); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(0, 0, n, n); return c; };
  // how clear the face is while the moment stays (x: 0–1 of that time): dreamy as it comes, clear in the middle – people
  // recognise themselves –, dreamy again before it leaves
  const peak = x => smooth((x - 0.06) / 0.28) * (1 - smooth((x - 0.68) / 0.28));

  function create() {
    const tiny = canvas();
    return { pic: canvas(), flat: canvas(), mid: canvas(), cut: canvas(), soft: canvas(), half: canvas(), mask: canvas(), over: canvas(), gone: canvas(),
      tiny, thin: canvas(), thin2: canvas(), thin4: canvas(), rim: canvas(), halo: canvas(), glow: canvas(), fog: canvas(), fringe: [canvas(), canvas()], stamp: null,
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

  // The person's outline, small and in the camera's framing – made once per mask (`o.stamp` names it), not per picture:
  // `tiny` the mask (fading out where the camera's picture ends: no cut shoulders), `thin` the same smaller still and
  // thinned towards its edge (scaled up it lets the person run out softly instead of ending in a line), `rim` only the
  // edge (for mist and shimmer)
  function outline(y, o) {
    if (o.stamp !== undefined && o.stamp === y.stamp) return;
    y.stamp = o.stamp;
    const k = LONG / Math.max(o.sw, o.sh), w = Math.max(8, Math.round(o.sw * k)), h = Math.max(8, Math.round(o.sh * k));
    const tw = Math.ceil(w / 4), th = Math.ceil(h / 4);
    fit(y.tiny, w, h); fit(y.rim, w, h); fit(y.thin, w, h); fit(y.thin2, tw * 2, th * 2); fit(y.thin4, tw, th);
    const tc = y.tx;
    tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1; tc.clearRect(0, 0, w, h); tc.drawImage(o.mask, 0, 0, w, h);
    tc.globalCompositeOperation = 'destination-out';
    for (const [ax, ay, bx, by] of [[0, h, 0, h * 0.86], [0, 0, w * 0.06, 0], [w, 0, w * 0.94, 0]]) {
      const gr = tc.createLinearGradient(ax, ay, bx, by);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      tc.fillStyle = gr; tc.fillRect(0, 0, w, h);
    }
    tc.globalCompositeOperation = 'source-over';
    const e = y.thin4.getContext('2d');
    e.globalCompositeOperation = 'source-over'; e.clearRect(0, 0, tw, th);
    for (let k = 0; k < 3; k++) { e.drawImage(y.tiny, 0, 0, tw, th); e.globalCompositeOperation = 'destination-in'; }   // thinner with each time
    for (const [cv, from] of [[y.thin2, y.thin4], [y.thin, y.thin2]]) {   // and up again in steps: round, no squares
      const x = cv.getContext('2d');
      x.clearRect(0, 0, cv.width, cv.height); x.drawImage(from, 0, 0, cv.width, cv.height);
    }
    const img = tc.getImageData(0, 0, w, h), d = img.data;
    for (let i = 3; i < d.length; i += 4) { const a = d[i] / 255; d[i] = 1020 * a * (1 - a); d[i - 1] = d[i - 2] = d[i - 3] = 255; }   // only the edge
    y.rim.getContext('2d').putImageData(img, 0, 0);
  }

  // The person alone, on nothing, running out softly at their edge: `y.cut`, n × n. o: { src, sw, sh (the camera's
  // picture and its size), mask (the person, white on nothing, in the camera's framing), stamp (changes with the mask;
  // without it the outline is made anew every time), face: { x, y, size, h, eyes } (0–1, as the camera sees it), n }
  function cutout(y, o) {
    const n = o.n, sw = o.sw, sh = o.sh, face = o.face;
    const want = cropOf(sw, sh, face), k = y.crop && !o.still ? 0.25 : 1;   // it follows the face softly
    y.crop = y.crop ? { x: y.crop.x + (want.x - y.crop.x) * k, y: y.crop.y + (want.y - y.crop.y) * k, s: y.crop.s + (want.s - y.crop.s) * k } : want;
    const q = y.crop, has = face && face.size > 0;
    const fw = has ? face.size * sw / q.s * n : n * FACE, fh = has && face.h > 0 ? face.h * sh / q.s * n : fw * 1.3;
    const fx = has ? n - (face.x * sw - q.x) / q.s * n : n / 2, fy = has ? (face.y * sh - q.y) / q.s * n : n * 0.45;
    // the face's oval – what is clear when the moment is (full to 0.8 of it: just past the face)
    y.guard = { x: fx, y: fy, rx: fw * 0.66, ry: fh * 0.64 };
    const e = has && face.eyes ? face.eyes.map(p => [n - (p.x * sw - q.x) / q.s * n, (p.y * sh - q.y) / q.s * n]).sort((a, b) => a[0] - b[0]) : null;
    y.eyes = e && e[1][0] - e[0][0] > n * 0.04 ? { x0: e[0][0] / n, x1: e[1][0] / n, y: (e[0][1] + e[1][1]) / 2 / n }
      : { x0: (fx - fw * 0.21) / n, x1: (fx + fw * 0.21) / n, y: (fy - fh * 0.1) / n };
    outline(y, o);
    const m = Math.max(TINY, n >> 1), mc = wipe(y.mask, m);
    put(mc, o.mask, y, sw, sh, m);
    mc.globalCompositeOperation = 'destination-in'; put(mc, y.thin, y, sw, sh, m);   // out into mist, never past the person: the room stays unseen
    mc.globalCompositeOperation = 'source-over';
    // the face always belongs to the person, whatever the mask says: no hole the dream could shine through
    if (has) oval(mc, { x: fx * m / n, y: fy * m / n, rx: fw * 0.5 * m / n, ry: fh * 0.5 * m / n }, 1, 0.72, '255,255,255');
    const c = wipe(y.cut, n);
    put(c, o.src, y, sw, sh, n);
    c.globalCompositeOperation = 'destination-in'; c.drawImage(y.mask, 0, 0, n, n);
    c.globalCompositeOperation = 'source-over';
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

  // How the picture leaves (#219, #229): not a plain fade – it comes apart into soft pieces, the outermost first, the
  // face last, and each piece is drawn out into a streak as the wind takes it; `leave` 0–1.
  // Where a piece is at that moment: { x, y, k (how far it has gone, 0–1), an (where it drifts) } – null once it is gone.
  function piece(y, b, n, leave) {
    const gd = y.guard, bx = b.x * n, by = b.y * n, d = Math.min(1, Math.hypot(bx - gd.x, by - gd.y) / (n * 0.75));
    const k = clamp((leave - (1 - d) * 0.4 - b.j * 0.1) / 0.3, 0, 1);
    if (k >= 1) return null;
    const drift = k * k * n * 0.22, wx = WIND[0] * 0.75 + Math.cos(b.a) * 0.25, wy = WIND[1] * 0.75 + Math.sin(b.a) * 0.25;
    return { x: bx + wx * drift + (bx - gd.x) * k * 0.2, y: by + wy * drift - k * n * 0.03, k, an: Math.atan2(wy, wx) };
  }
  // white where the picture still is
  function dissolve(y, n, leave) {
    const c = wipe(y.gone, n);
    c.globalCompositeOperation = 'lighter';
    for (const b of y.bits) {
      const at = piece(y, b, n, leave);
      if (!at) continue;
      c.save(); c.translate(at.x, at.y); c.rotate(at.an); c.scale(1 + 2.4 * at.k, 1 - 0.6 * at.k);   // a streak
      stamp(c, PATCH, 0, 0, n / 8 * (1.15 - 0.3 * at.k), 1 - at.k); c.restore();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    return y.gone;
  }
  // what the pieces leave behind: a spark where each one goes, and the mist of the person – it stays a breath longer
  // and blows away
  function embers(c, y, n, t, hue, leave, count) {
    c.globalCompositeOperation = 'lighter';
    const every = Math.max(1, Math.round(y.bits.length / Math.max(1, count * 2)));
    for (let i = 0; i < y.bits.length; i += every) {
      const b = y.bits[i], at = piece(y, b, n, leave);
      if (!at || at.k <= 0) continue;
      const glow = Math.sin(at.k * Math.PI) * (0.6 + 0.4 * Math.sin(t / 130 + b.a * 5)), r = n * (0.012 + 0.012 * b.j);
      const x = at.x + Math.cos(at.an) * n * 0.07 * at.k, yy = at.y + Math.sin(at.an) * n * 0.07 * at.k - at.k * at.k * n * 0.05;
      stamp(c, tinted(hue + b.j * 60 - 20), x, yy, r * 1.8, 0.5 * glow);
      stamp(c, WHITE, x, yy, r * 0.5, 0.9 * glow);
    }
    const gd = y.guard, al = smooth((leave - 0.2) / 0.4) * (1 - smooth((leave - 0.6) / 0.4)), away = leave * leave * n * 0.42;
    c.globalCompositeOperation = 'source-over';        // a veil, not more light: what is left of the picture pales behind it
    if (al > 0.003) for (let i = 3; i < y.bits.length; i += 7) {
      const b = y.bits[i], x = gd.x + (b.x * n - gd.x) * 0.6, yy = gd.y + n * 0.1 + (b.y * n - gd.y) * 0.6;
      stamp(c, tinted(hue + 20 + b.j * 40), x + WIND[0] * away * (0.6 + 0.8 * b.j) + Math.sin(t / 900 + b.a) * n * 0.02,
        yy + WIND[1] * away + Math.cos(t / 1100 + b.a) * n * 0.015, n * (0.16 + 0.1 * b.j) * (1 + 0.5 * leave), 0.22 * al);
    }
    c.globalAlpha = 1;
  }

  // The picture as through water or the shimmer over a fire: drawn in strips, each a little aside – across, then down.
  // The face wavers less than what is around it, and not at all while it is clear (a strip that stays where it is is
  // copied pixel for pixel); leaving, the strips are torn along the wind into streaks, the outer ones first.
  function waver(y, n, t, strips, clear, leave) {
    const gd = y.guard, h = Math.max(1, Math.ceil(n / strips)), amp = n * 0.011 * (1 - 0.4 * clear), least = 0.45 * (1 - clear);
    const part = d => least + (1 - least) * smooth((d - 0.8) / 0.9);   // d: how far from the face, in face sizes
    const wave = (v, a, b, c, e) => { const u = v / n * 6.283; return 0.6 * Math.sin(u * a + t / b) + 0.4 * Math.sin(u * c - t / e); };
    // one pass: the strips of `from` along one axis, each moved by `by(strip)` across it; where a strip has moved
    // away from the picture's edge, its outermost line is drawn out to it (leaving, it just drifts off)
    const pass = (cv, from, down, by) => {
      const c = wipe(cv, n);
      for (let v = 0; v < n; v += h) {
        let d = by(v + h / 2);
        if (Math.abs(d) < 0.02) d = 0;
        if (down) c.drawImage(from, v, 0, h, n, v, d, h, n); else c.drawImage(from, 0, v, n, h, d, v, n, h);
        if (!d || leave > 0) continue;
        const at = d > 0 ? 0 : n - 1, to = d > 0 ? 0 : n + d - 1, len = Math.abs(d) + 1;
        if (down) c.drawImage(from, v, at, h, 1, v, to, h, len); else c.drawImage(from, at, v, 1, h, to, v, len, h);
      }
      return c;
    };
    pass(y.mid, y.flat, false, v => {
      const d = Math.abs(v - gd.y) / gd.ry, k = leave > 0 ? clamp((leave - 0.25 * (1 - Math.min(1, d / 4))) / 0.6, 0, 1) : 0;
      return amp * part(d) * wave(v, 1.7, 780, 4.3, 510) + n * 0.15 * k * k * (0.55 + 0.3 * Math.sin(v / n * 33 + 1.7) + 0.15 * Math.sin(v / n * 82 + t / 400));
    });
    return pass(y.pic, y.mid, true, v => {
      const w = part(Math.abs(v - gd.x) / gd.rx);
      return amp * w * wave(v, 1.3, -910, 3.7, -610) - leave * leave * n * 0.03 * w;
    });
  }

  // The whole picture: `y.pic`, n × n. Besides what cutout takes: dream (the dream's picture, or null), hue (the
  // dream's colour), t (ms), frame (null or one of FRAMES), level (0–1: how far the moment has come), clear (0–1: how
  // clear the face is – see `peak`; without it: dreamy), sparks (how many), strips (how finely it wavers), leave (0–1:
  // how far it has dissolved into the dream again).
  function compose(y, o) {
    const n = o.n, t = o.t, hue = o.hue, sw = o.sw, sh = o.sh, al = o.level === undefined ? 1 : clamp(o.level, 0, 1);
    const leave = clamp(o.leave || 0, 0, 1), clear = clamp(o.clear || 0, 0, 1) * (1 - leave), count = o.sparks === undefined ? 24 : o.sparks;
    cutout(y, o);
    const gd = y.guard, pulse = 0.5 + 0.5 * Math.sin(t / 1100);
    fit(y.flat, n);
    const p = y.flat.getContext('2d');
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
    // a shape in one colour: the outline (in the camera's framing) or the person as cut out, small – scaled up it is soft
    const tint = (cv, size, from, col) => {
      const x = wipe(cv, size);
      if (from === y.cut) x.drawImage(from, 0, 0, size, size); else put(x, from, y, sw, sh, size);
      x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, size, size);
    };
    tint(y.glow, GLOW, y.tiny, `hsl(${hue},90%,66%)`);
    tint(y.halo, TINY, y.tiny, `hsl(${hue + 35},95%,80%)`);
    const cx = gd.x, cy = n * 0.62;                     // the glow grows out from the person's middle
    p.globalCompositeOperation = 'lighter';
    for (const [cv, k, a] of [[y.glow, 1.16 + 0.03 * pulse, 0.55 + 0.25 * pulse], [y.glow, 1.07, 0.5], [y.halo, 1.03, 0.25]]) {
      p.globalAlpha = a * al; p.drawImage(cv, cx - cx * k, cy - cy * k, n * k, n * k);
    }
    p.globalAlpha = 1; p.globalCompositeOperation = 'source-over';
    if (BEHIND[o.frame]) BEHIND[o.frame](p, n, t, hue, al);
    sparks(p, y, n, t, hue, al, count, false);          // these fly behind the person
    // a delicate fringe in the dream's colours: the person's shape once to each side, behind them – it shows through
    // where they run out
    const off = n * (0.018 + 0.008 * Math.sin(t / 1900)), size = Math.max(TINY, n >> 2);
    p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.7 * al;
    for (const [k, cv] of y.fringe.entries()) {
      tint(cv, size, y.cut, `hsl(${hue + (k ? 70 : -50)},95%,62%)`);
      p.drawImage(cv, (k ? off : -off), Math.sin(t / 1300 + k * 2) * off * 0.4, n, n);
    }
    p.globalAlpha = 1; p.globalCompositeOperation = 'source-over';
    // the person: dreamy – soft (a small copy, scaled up) with the dream shining through – and clear as far as `clear` says
    if (clear < 0.995) {
      const s = Math.max(40, n / 5 | 0), half = wipe(y.half, n >> 1);   // made small in two steps: no flicker
      half.drawImage(y.cut, 0, 0, n >> 1, n >> 1);
      const sc = wipe(y.soft, s);
      for (let k = 0; k < 4; k++) { sc.globalAlpha = 1 / (k + 1); sc.drawImage(y.half, (k & 1) - 0.5, (k >> 1) - 0.5, s, s); }   // four copies, each a little aside: no steps
      p.globalAlpha = 0.86 + 0.14 * clear; p.drawImage(y.soft, 0, 0, n, n);
    }
    p.globalAlpha = 0.14 + 0.86 * clear * clear; p.drawImage(y.cut, 0, 0); p.globalAlpha = 1;
    // what lies in front: the frame, mist and a shimmer at the person's edge, fireflies – while the face is clear its
    // oval is taken out of all of it again
    const v = wipe(y.over, n);
    if (FRONT[o.frame]) FRONT[o.frame](v, n, t, hue, al);
    tint(y.fog, GLOW, y.rim, `hsl(${hue + 15},45%,86%)`);
    const wide = 1.05 + 0.02 * pulse;
    v.globalAlpha = 0.38 * al; v.drawImage(y.fog, cx - cx * wide, cy - cy * wide, n * wide, n * wide);
    tint(y.halo, TINY, y.rim, `hsl(${hue + 20 + 40 * Math.sin(t / 2300)},95%,75%)`);
    v.globalCompositeOperation = 'lighter'; v.globalAlpha = (0.2 + 0.18 * pulse) * al; v.drawImage(y.halo, 0, 0, n, n);
    v.globalAlpha = 1; v.globalCompositeOperation = 'source-over';
    sparks(v, y, n, t, hue, al, count, true);
    if (clear > 0) { v.globalCompositeOperation = 'destination-out'; v.globalAlpha = clear; oval(v, gd, 1, 0.8, '0,0,0'); v.globalAlpha = 1; v.globalCompositeOperation = 'source-over'; }
    p.drawImage(y.over, 0, 0);
    const pc = waver(y, n, t, o.strips || 96, clear, leave);
    if (leave > 0) {                                    // it comes apart, and its fireflies fly off into the dream
      pc.globalCompositeOperation = 'destination-in'; pc.drawImage(dissolve(y, n, leave), 0, 0); pc.globalCompositeOperation = 'source-over';
      const glowing = Math.sin(Math.min(1, leave * 1.15) * Math.PI);
      for (const front of [false, true]) sparks(pc, y, n, t, hue, glowing, y.sparks.length, front, leave);
      embers(pc, y, n, t, hue, leave, count);
    }
    return y.pic;
  }

  root.DreamYou = { FRAMES, FACE, create, cropOf, cutout, compose, dissolve, peak };
})(typeof window !== 'undefined' ? window : globalThis);
