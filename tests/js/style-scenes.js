// #221, #222: scenes a style world is asked to draw – eyes, pupils, living things, the faces of light, the window
// motifs, and (#222) the night behind the eyes, a window's sky, fire, the trance and what is drawn around "you in the
// dream". With a seeded random and a clock that stands still (the page sets both before the modules load).
// tests/js/style.html draws them in today's look and compares with the pictures kept; tests/js/worlds.html draws them
// in every other world. A global `StyleScenes`.
window.StyleScenes = (() => {
  const W = 960, H = 540, SW = 96, SH = 54, T0 = 54321;
  const { canvas, hueOf, night, softLight } = DreamBrush;
  // an invented dream: bands of colour with a sun in them
  const pic = canvas(256), pg = pic.getContext('2d'), bands = pg.createLinearGradient(0, 0, 256, 256);
  [[0, '#14306e'], [0.3, '#1fa0a8'], [0.55, '#f0c060'], [0.8, '#e05a78'], [1, '#5a2a96']].forEach(([at, col]) => bands.addColorStop(at, col));
  pg.fillStyle = bands; pg.fillRect(0, 0, 256, 256);
  pg.fillStyle = '#fff2c0'; pg.beginPath(); pg.arc(170, 90, 34, 0, Math.PI * 2); pg.fill();
  const look = DreamBrush.brightness(pg.getImageData(0, 0, 256, 256).data, 256, 256), col = look.col, hue = hueOf(col);
  const fib = DreamEye.fibres(), stars = DreamEye.stars();
  const eye = (g, cx, cy, a, mirror, o = {}) => {      // one eye of the world in use, as a page would ask for it
    const style = DreamStyle.eye(), io = { rot: 0.7, hue, stars, pic: (x, y, n, al) => { g.globalAlpha = al; g.drawImage(pic, x - n / 2, y - n / 2, n, n); }, heat: 0.7 };
    return style.draw(g, cx, cy, a, a * 0.56, mirror, { open: o.open ?? 0.9, blink: o.blink || 0, squint: o.squint || 0, col, energy: 0.4,
      look: DreamEye.LOOKS[o.look || 'rose'], brow: DreamEye.EMO[o.emo || 'curious'][mirror ? 1 : 0], browAl: o.browAl || 0, crease: o.browAl || 0, fib, gx: o.gx || 0, gy: o.gy || 0,
      pupil: 0.45, pupilMix: o.shape ? 1 : 0, pupilShape: (ix, iy, pr, R) => style.pupilShape(g, o.shape, ix, iy, pr, R, mirror, { hue, beat: 0.5, now: T0 }),
      iris: (ix, iy, R) => { style.irisWorld(g, o.iris || 'dream', ix, iy, R, mirror, 1, io); g.globalAlpha = 1; } });
  };
  const LOOKS = Object.keys(DreamEye.LOOKS), EMO = Object.keys(DreamEye.EMO);
  const LIFE = ['cloud', 'bloom', 'mandala', 'tree', 'moth', 'bubbles', 'aurora', 'orbit', 'tear', 'stars', 'ember', 'fireheart', 'sparks', 'zzz'];
  const thing = (kind, i, x, y, size) => ({ kind, x, y, size, hue: hue + i * 40, spin: i % 2 ? 1 : -1, side: 0, life: 9000, dir: 0.4, wob: 1, puffs: Array.from({ length: 10 }, (_, k) => [k * 0.63 - 0.5, 0.6 + 0.05 * k - 0.5, 0.4 + (k * 0.37) % 0.4]) });
  const geo = { cx: W / 4, ey: H / 2, A: 48, half: 58, q: 1 };
  const faces = level => g => {                        // the faces of light, drawn around a pair of eyes
    DreamStyle.face().MODES.forEach((mode, i) => {
      g.save(); g.translate((i % 3) * (W / 3) - W / 12, (i / 3 | 0) * (H / 2) - H / 4 + 40); g.scale(0.62, 0.62);
      DreamStyle.face().draw(g, mode, T0, { ...geo, cx: geo.cx * 1.6, ey: geo.ey * 1.2 }, DreamVis.held(level));
      g.restore();
    });
  };
  const soft = canvas(256), sg = soft.getContext('2d'), EDGE = softLight([[0, 'rgba(0,0,0,1)'], [0.7, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']], 256);
  const kit = (w, h) => ({ W: w, H: h, mid: [w / 2, h / 2], pulse: 0.3, hue, pic, tier: 2,   // what a window hands a motif
    softPiece: (c, t, paint, x, y, r, al) => { sg.globalCompositeOperation = 'source-over'; sg.globalAlpha = 1; sg.clearRect(0, 0, 256, 256); paint(sg, 256); sg.globalCompositeOperation = 'destination-in'; sg.drawImage(EDGE, 0, 0); c.globalAlpha = al; c.drawImage(soft, x - r, y - r, r * 2, r * 2); c.globalAlpha = 1; },
    eye: (c, m, dt, x, y, a, lk) => { night(c, x, y, a * 1.2, 0.5); eye(c, x, y, a, false, { look: Object.keys(DreamEye.LOOKS).find(k => DreamEye.LOOKS[k] === lk) }); } });
  const POSES = [                                      // the trance: tunnel and mandala around the open third eye; the pull, the view through it, the dot
    { ex: W * 0.27, ey: H * 0.42, A: 62, pull: 0, eo: 1, dim: 1, mand: 1, tun: 1, view: 0, dot: 0 },
    { ex: W * 0.74, ey: H * 0.5, A: 70, pull: 0.8, eo: 0.7, dim: 0, mand: 0, tun: 0, view: 0.55, dot: 0.6 }];
  const SCENES = {
    // eyes – every look, every world of the iris, with and without brows
    eyes: g => LOOKS.forEach((lk, i) => { const y = 60 + i * 105;
      eye(g, 250, y, 92, false, { look: lk, emo: EMO[i], browAl: i % 2, iris: ['dream', 'kaleido', 'vortex', 'galaxy', 'fire'][i], gx: 0.4 - i * 0.2, open: 1 - i * 0.12 });
      eye(g, 700, y, 92, true, { look: lk, emo: EMO[i], browAl: i % 2, iris: ['dream', 'kaleido', 'vortex', 'galaxy', 'embers'][i], gx: 0.4 - i * 0.2, open: 1 - i * 0.12, squint: i * 0.2 }); }),
    // every shape of the pupil
    pupils: g => ['slit', 'heart', 'star', ...DreamEye.HYPNO].forEach((shape, i) => eye(g, 130 + (i % 4) * 235, 140 + (i / 4 | 0) * 260, 105, i % 2 === 1, { shape, look: LOOKS[i % 5], blink: i === 7 ? 0.5 : 0 })),
    // everything that lives around the eyes and drifts through the windows
    life: g => { const life = DreamStyle.life(); g.globalCompositeOperation = 'lighter';
      LIFE.forEach((kind, i) => { const x = 90 + (i % 7) * 130, y = 150 + (i / 7 | 0) * 250; life.draw(g, thing(kind, i, x, y, 60), 2600, 0.9, 60 * (DreamLife.SCALE[kind] || 1), y - 12, { H, anchor: [x, y, 40] }); }); },
    'faces-hints': faces(1), 'faces-rare': faces(2),
    // the large motifs of a dream window, with what a window hands over
    motifs: g => DreamStyle.motifs().forEach((kind, i) => { const w = W / 3, h = H / 2;
      g.save(); g.translate((i % 3) * w, (i / 3 | 0) * h); g.beginPath(); g.rect(0, 0, w, h); g.clip();
      DreamStyle.motif(kind)(g, { kind, seed: 1234567 }, T0, 0.016, kit(w, h));
      g.restore(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }),
    // #222 – the night behind the eyes: where the dream shines through, in each of its three ways
    back: g => ['clouds', 'fractal', 'pattern'].forEach((mode, i) => { const w = W / 3, c = canvas(w, H), bk = c.getContext('2d');
      const clouds = Array.from({ length: 13 }, (_, k) => ({ x: (k * 0.37) % 1, y: (k * 0.61) % 1, r: 0.16 + (k * 0.13) % 0.2, v: 0.004 + (k * 0.003) % 0.01, puffs: Array.from({ length: 5 }, (_, j) => [((j * 0.41 + k * 0.17) % 1 - 0.5) * 1.2, ((j * 0.29 + k * 0.23) % 1 - 0.5) * 0.5, 0.45 + (j * 0.31) % 0.55]) }));
      bk.globalAlpha = 1; DreamStyle.part('back').mask(bk, mode, T0, w, H, 1, { clouds, upright: false });
      bk.globalAlpha = 1; bk.globalCompositeOperation = 'source-in'; bk.drawImage(pic, 0, 0, w, H);
      g.drawImage(c, i * w, 0); }),
    // the sky of a dream window
    sky: g => { const w = 240, h = 135, c = canvas(w, h), cg = c.getContext('2d');
      DreamStyle.part('sky').clouds(cg, T0, { w, h, tier: 2, swell: 0.6, drift: 3.3, index: 1, pulse: 0.3, dream: (x, px, py, pw, ph) => x.drawImage(pic, px, py, pw, ph) });
      g.drawImage(c, 0, 0, W, H); },
    // fire: the flames, strong and on the left
    fire: g => DreamStyle.part('fire').flames(g, T0, 0.9, 0.3, { W, H, perf: 60 }),
    // the trance
    trance: g => { const tr = DreamStyle.part('trance'), o = { W, H, hue, perf: 60, dream: pic }; for (const p of POSES) { tr.back(g, T0, p, o); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; tr.eye(g, T0, p, o); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } },
    // around "you in the dream": the cloud a picture comes in, the rings at the pupils, the frames, fireflies, the outline's colours
    you: g => { const you = DreamStyle.part('you'), n = 180, tints = you.tints(hue, T0);
      you.cloud(g, 170, H / 2, 300, T0, 1); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      you.rings(g, [[420, 110], [560, 110]], 46, T0, hue, 0.5, 0.2);
      for (let k = 0; k < 12; k++) { g.globalCompositeOperation = 'lighter'; you.spark(g, 380 + (k % 6) * 44, 260 + (k / 6 | 0) * 60, 9 + k % 3 * 3, hue + k * 9 - 25, 0.4 + (k % 4) * 0.2, 1, k); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      Object.values(tints).forEach((c, k) => { g.fillStyle = c; g.fillRect(380 + k * 80, 420, 60, 60); });
      you.FRAMES.forEach((frame, i) => { const c = canvas(n), x = c.getContext('2d');
        if (you.behind[frame]) you.behind[frame](x, n, T0, hue, 1);
        x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
        if (you.front[frame]) you.front[frame](x, n, T0, hue, 1);
        g.drawImage(c, 700 + (i % 2) * 130, (i / 2 | 0) * 190 + (i % 2) * 90); }); },
  };
  // a scene of the world in use, on black
  function draw(name) {
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#07060b'; g.fillRect(0, 0, W, H);
    SCENES[name](g);
    return c;
  }
  // what the tests compare: a small copy of it, its colours as text
  function small(c) {
    const s = canvas(SW, SH), sg2 = s.getContext('2d', { willReadFrequently: true });
    sg2.drawImage(c, 0, 0, SW, SH);
    const d = sg2.getImageData(0, 0, SW, SH).data, rgb = new Uint8Array(SW * SH * 3);
    for (let i = 0; i < SW * SH; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
    return btoa(String.fromCharCode(...rgb));
  }
  return { W, H, T0, NAMES: Object.keys(SCENES), LIFE, draw, small, eye, thing, kit, geo, pic, hue };
})();
