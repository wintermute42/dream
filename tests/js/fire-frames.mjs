// #218: painted camera pictures for the fire detection (static/dreamfire.js) – flames that flicker, lamps that do not,
// skin in warm light. No real pictures, no real people: every scene is drawn from a few shapes and a seeded random
// number, 15 pictures a second, as the eyes sample their camera (96 × 72). Used by tests/js/fire.test.mjs and by
// scripts/fire_video.mjs (a film of the same scenes for a browser's fake camera).
export const W = 96, H = 72, FPS = 15;

export function rng(seed) {                            // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
// a flame's colour by its heat (0–1): dark red, orange, yellow, a nearly white core
const flameRgb = q => [255 * ramp(q, 0.1, 0.45), 235 * ramp(q, 0.3, 0.9), 180 * ramp(q, 0.75, 1)];

// A scene is a list of things; each thing is (x, y, i) -> [r, g, b, alpha] or null, in sample pixels (x right, y down),
// i the picture's number. The picture is drawn three times finer and averaged, as a camera's lens and a browser's
// scaling do, plus sensor noise.
// gain(i): the camera's exposure, a factor on the whole picture
export function scene({ back = [12, 12, 18], noise = 3, seed = 1, things = [], face = null, gain = null }) {
  const prep = things.map(t => t.prep ? t : { prep: () => {}, at: t });
  return {
    face: i => face ? face(i) : null,
    frame(i, w = W, h = H, S = 3) {                   // larger pictures (a film) need no finer drawing: S = 1
      const rnd = rng(seed * 7919 + i), d = new Uint8ClampedArray(w * h * 4), sc = W / w;
      for (const t of prep) t.prep(i);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
          const px = (x + (sx + 0.5) / S) * sc, py = (y + (sy + 0.5) / S) * sc;
          let c = back;
          for (const t of prep) { const q = t.at(px, py, i); if (q) { const a = q[3]; c = [c[0] + (q[0] - c[0]) * a, c[1] + (q[1] - c[1]) * a, c[2] + (q[2] - c[2]) * a]; } }
          r += c[0]; g += c[1]; b += c[2];
        }
        const o = (y * w + x) * 4, k = (gain ? gain(i) : 1) / (S * S), nz = () => (rnd() + rnd() + rnd() - 1.5) * 2 * noise;
        d[o] = r * k + nz(); d[o + 1] = g * k + nz(); d[o + 2] = b * k + nz(); d[o + 3] = 255;
      }
      return d;
    },
  };
}

// a flame standing at (cx, cy) (its foot), wd wide and ht high: three tongues, each with a height and a sway of its
// own that change from picture to picture (lively: how much, 0–1); path(i) -> [x, y] moves it
export function flame({ cx = 48, cy = 50, wd = 10, ht = 24, lively = 1, seed = 5, path = null, bright = 1, from = 0, until = 1e9, grow = null }) {
  const rnd = rng(seed), tongues = [0, 1, 2].map(k => ({ off: (k - 1) * wd * 0.3, h: 1, sway: 0 }));
  let last = -1, x0 = cx, y0 = cy, size = 1, glow = 1;
  return {
    prep(i) {
      while (last < i) {                               // the same flame whatever picture is asked for first
        last++;
        for (const t of tongues) { t.h = 0.3 * t.h + 0.7 * (1 - lively * 0.55 * rnd()); t.sway = 0.3 * t.sway + 0.7 * (rnd() - 0.5) * lively; }
        glow = 1 - 0.2 * lively * rnd();
      }
      [x0, y0] = path ? path(i) : [cx, cy]; size = grow ? grow(i) : 1;
      this.off = i < from || i >= until;
    },
    at(x, y) {
      if (this.off) return null;
      const up = (y0 - y) / (ht * size);
      if (up < -0.15 || up > 1.1) return null;
      let q = 0;
      for (const t of tongues) {
        const tall = Math.max(0, 1 - Math.max(0, up) / t.h), dx = (x - x0 - t.off * size - t.sway * wd * size * 0.5 * Math.max(0, up)) / (wd * size * 0.33 * (0.45 + 0.55 * tall));
        const foot = up < 0 ? Math.exp(-up * up * 90) : 1;
        q = Math.max(q, Math.exp(-dx * dx / 2) * Math.pow(tall, 0.6) * foot);
      }
      q *= glow * bright;
      if (q < 0.1) return null;
      const [r, g, b] = flameRgb(q);
      return [r, g, b, ramp(q, 0.1, 0.3)];
    },
  };
}
// a round thing of one colour with a soft edge: a lamp, a face, a hand, a jacket. path(i) -> [x, y], grow(i) -> factor
export function blob({ cx = 48, cy = 36, rx = 8, ry = rx, rgb = [255, 160, 50], edge = 1.5, shade = 0, path = null, grow = null }) {
  let x0 = cx, y0 = cy, k = 1;
  return {
    prep(i) { [x0, y0] = path ? path(i) : [cx, cy]; k = grow ? grow(i) : 1; },
    at(x, y) {
      const u = (x - x0) / (rx * k), v = (y - y0) / (ry * k), q = Math.sqrt(u * u + v * v);
      if (q >= 1) return null;
      const a = ramp(1 - q, 0, edge / (Math.min(rx, ry) * k)), s = 1 - shade * q * q;
      return [rgb[0] * s, rgb[1] * s, rgb[2] * s, a];
    },
  };
}

const TAU = Math.PI * 2, sec = i => i / FPS;
// a thing whose brightness changes: lit(x, y, i) -> factor (a dimmer, an LED's beat with the camera's shutter)
const glowing = (thing, lit) => { let n = 0; return { prep(i) { thing.prep(i); n = i; }, at(x, y) { const q = thing.at(x, y); if (!q) return null; const k = lit(x, y, n); return [Math.min(255, q[0] * k), Math.min(255, q[1] * k), Math.min(255, q[2] * k), q[3]]; } }; };
// a screen showing something warm that moves: a sunset panning, two bright things drifting, a cut every 2.5 s
function screen({ x0 = 28, y0 = 20, w = 44, h = 26, seed = 3 }) {
  let n = 0, cut = 0, bright = 1; const r = rng(seed), looks = Array.from({ length: 40 }, () => [0.75 + 0.3 * r(), r(), r()]);
  return { prep(i) { n = i; cut = Math.floor(sec(i) / 2.5) % 40; bright = looks[cut][0]; },
    at(x, y) {
      if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return null;
      const t = sec(n), u = (x - x0) / w, v = (y - y0) / h, [, a, b] = looks[cut];
      const sun = Math.exp(-(((u - (0.2 + 0.6 * a + 0.05 * t) % 1) / 0.18) ** 2) - ((v - 0.3 - 0.3 * b) / 0.3) ** 2);
      const drift = Math.exp(-(((u - (0.7 * b + 0.08 * t) % 1) / 0.12) ** 2) - ((v - 0.7) / 0.2) ** 2);
      const k = bright * (0.75 + 0.2 * Math.sin(u * 5 + t * 0.6));
      return [Math.min(255, (225 + 30 * sun) * k), Math.min(255, (120 + 110 * sun + 60 * drift) * k), Math.min(255, (45 + 60 * sun) * k), 1];
    } };
}
// skin in warm, bright light, from pale to dark – as a camera may well show it
export const SKIN = { pale: [255, 224, 189], light: [241, 194, 125], tan: [224, 172, 105], brown: [198, 134, 66], dark: [141, 85, 36], rosy: [234, 160, 130] };
const LAMP = [255, 165, 55], ROOM = [58, 52, 48];
const shake = (seed, amp) => { const r = rng(seed), p = []; return i => { while (p.length <= i) p.push([(r() - 0.5) * 2 * amp, (r() - 0.5) * 2 * amp]); return p[i]; }; };

// every scene with what the eyes should make of it: fire (yes or no), and where the flame is (0–1) if it stands still
export const SCENES = {
  campfire: { fire: true, at: [0.5, 0.74], make: () => scene({ seed: 11, things: [flame({ cx: 48, cy: 62, wd: 34, ht: 44, seed: 3 })] }) },
  torch: { fire: true, at: [0.3, 0.5], make: () => scene({ seed: 12, things: [flame({ cx: 29, cy: 40, wd: 9, ht: 20, seed: 4 })] }) },
  candle: { fire: true, at: [0.7, 0.59], make: () => scene({ seed: 13, things: [flame({ cx: 67, cy: 44, wd: 3.2, ht: 8, lively: 0.8, seed: 6 })] }) },
  'candle in still air': { fire: null, make: () => scene({ seed: 13, things: [flame({ cx: 67, cy: 44, wd: 3.2, ht: 8, lively: 0.3, seed: 6 })] }) },
  'three candles': { fire: true, make: () => scene({ seed: 14, things: [20, 48, 76].map((x, k) => flame({ cx: x, cy: 46, wd: 3, ht: 7, lively: 0.8, seed: 20 + k })) }) },
  // a small flame far away, swung in a circle (poi): about two sample pixels wide
  poi: { fire: true, moving: true, make: () => scene({ seed: 15, things: [flame({ wd: 2.6, ht: 5, seed: 7, path: i => [48 + 24 * Math.cos(TAU * 0.9 * sec(i)), 38 + 20 * Math.sin(TAU * 0.9 * sec(i))] })] }) },
  'distant flame': { fire: null, at: [0.2, 0.3], make: () => scene({ seed: 16, things: [flame({ cx: 19, cy: 23, wd: 2.2, ht: 4.5, lively: 0.8, seed: 8 })] }) },
  'flame in a lit room': { fire: true, at: [0.6, 0.51], make: () => scene({ seed: 17, back: ROOM, noise: 2, things: [flame({ cx: 58, cy: 40, wd: 8, ht: 16, seed: 9 })] }) },
  'flame beside a face': { fire: true, at: [0.78, 0.57], face: () => ({ x: 0.33, y: 0.45, w: 0.27, h: 0.5 }),
    make() { return scene({ seed: 18, back: ROOM, things: [blob({ cx: 32, cy: 32, rx: 12, ry: 17, rgb: SKIN.tan, shade: 0.25, path: i => [32 + 3 * Math.sin(TAU * 0.3 * sec(i)), 32] }), flame({ cx: 75, cy: 44, wd: 7, ht: 15, seed: 10 })], face: this.face }); } },
  'candle close by': { fire: true, at: [0.4, 0.57], make: () => scene({ seed: 19, back: [30, 26, 24], things: [flame({ cx: 38, cy: 50, wd: 6, ht: 15, lively: 0.6, seed: 13 })] }) },
  lighter: { fire: true, at: [0.55, 0.5], make: () => scene({ seed: 20, back: ROOM, things: [flame({ cx: 53, cy: 40, wd: 3.6, ht: 9, lively: 0.9, seed: 14 })] }) },
  // ---- no fire ----
  // what a real room showed (#218, the owner's test): warm light everywhere, a camera that hunts for its exposure
  'dim warm room, noisy camera': { fire: false, make: () => scene({ seed: 70, back: [150, 112, 74], noise: 7, things: [blob({ cx: 66, cy: 24, rx: 16, ry: 12, rgb: [236, 184, 112], edge: 9 }), blob({ cx: 20, cy: 50, rx: 12, ry: 16, rgb: [205, 150, 96], edge: 6 })] }) },
  'warm wall in dim light': { fire: false, make: () => { const wall = { prep() {}, at: (x, y) => [150 + 0.95 * x, 100 + 0.6 * x, 52 + 0.3 * x + 0.1 * y, 1] }; return scene({ seed: 71, noise: 7, things: [wall] }); } },
  'warm wall, lamp-lit spot': { fire: false, make: () => scene({ seed: 72, back: [170, 118, 70], noise: 6, things: [blob({ cx: 40, cy: 30, rx: 22, ry: 18, rgb: [255, 196, 96], edge: 16 })] }) },
  'exposure pumping': { fire: false, make: () => scene({ seed: 73, back: [140, 104, 70], noise: 4, gain: i => 1 + 0.16 * Math.sin(TAU * 0.8 * sec(i)) + 0.05 * Math.sign(Math.sin(TAU * 2.3 * sec(i))),
    things: [blob({ cx: 60, cy: 28, rx: 13, rgb: [250, 170, 70], edge: 6 }), blob({ cx: 22, cy: 50, rx: 7, rgb: [240, 150, 60], edge: 3 })] }) },
  'exposure pumping, dark room with a lamp': { fire: false, make: () => scene({ seed: 74, noise: 5, gain: i => 1 + 0.2 * Math.sin(TAU * 1.1 * sec(i)), things: [blob({ cx: 60, cy: 26, rx: 9, rgb: [235, 150, 50], edge: 3 })] }) },
  'warm LED, slow beat': { fire: false, make: () => scene({ seed: 75, things: [glowing(blob({ cx: 50, cy: 30, rx: 10, rgb: [235, 150, 50], edge: 4 }), (x, y, i) => 1 + 0.22 * Math.sin(TAU * 3.3 * sec(i)))] }) },
  'warm LED, fast beat': { fire: false, make: () => scene({ seed: 76, things: [glowing(blob({ cx: 50, cy: 30, rx: 10, rgb: [235, 150, 50], edge: 4 }), (x, y, i) => 1 + 0.22 * Math.sin(TAU * 6.7 * sec(i)))] }) },
  'warm LED, bands running through': { fire: false, make: () => scene({ seed: 77, things: [glowing(blob({ cx: 50, cy: 34, rx: 16, ry: 20, rgb: [235, 150, 50], edge: 5 }), (x, y, i) => 1 + 0.25 * Math.sin(TAU * (y / 14 - 2.7 * sec(i))))] }) },
  'string of warm LEDs, beating': { fire: false, make: () => scene({ seed: 78, noise: 4, things: [10, 25, 40, 55, 70, 85].map((x, k) => glowing(blob({ cx: x, cy: 14 + (x % 20) / 4, rx: 2.2, rgb: [250, 160, 50], edge: 1 }), (xx, yy, i) => 1 + 0.25 * Math.sin(TAU * 4.1 * sec(i) + k))) }) },
  'screen with warm moving pictures': { fire: false, make: () => scene({ seed: 79, back: [20, 18, 22], things: [screen({})] }) },
  'screen in a lit room': { fire: false, make: () => scene({ seed: 80, back: ROOM, noise: 4, things: [screen({ x0: 8, y0: 30, w: 34, h: 22, seed: 9 })] }) },
  'orange lamp': { fire: false, make: () => scene({ seed: 31, things: [blob({ cx: 60, cy: 26, rx: 9, rgb: LAMP, edge: 3 })] }) },
  'large orange lamp': { fire: false, make: () => scene({ seed: 32, things: [blob({ cx: 40, cy: 34, rx: 24, ry: 20, rgb: LAMP, edge: 6 })] }) },
  'small lamp, noisy camera': { fire: false, make: () => scene({ seed: 33, noise: 4, things: [blob({ cx: 70, cy: 20, rx: 2.4, rgb: LAMP, edge: 1.2 })] }) },
  'string of small lamps': { fire: false, make: () => scene({ seed: 34, noise: 4, things: [10, 25, 40, 55, 70, 85].map(x => blob({ cx: x, cy: 14 + (x % 20) / 4, rx: 1.8, rgb: LAMP, edge: 1 })) }) },
  'lamp, phone being touched': { fire: false, make: () => { const p = shake(41, 0.8); return scene({ seed: 35, things: [blob({ rx: 9, rgb: LAMP, edge: 3, path: i => [60 + p(i)[0], 26 + p(i)[1]] })] }); } },
  'lamp, phone carried': { fire: false, make: () => scene({ seed: 36, things: [blob({ rx: 8, rgb: LAMP, edge: 3, path: i => [48 + 22 * Math.sin(TAU * 0.25 * sec(i)), 34 + 8 * Math.sin(TAU * 0.4 * sec(i))] })] }) },
  'lamp being dimmed': { fire: false, make: () => { const l = blob({ cx: 50, cy: 30, rx: 12, rgb: LAMP, edge: 4 }); const at = l.at.bind(l); let k = 1; return scene({ seed: 37, things: [{ prep(i) { l.prep(i); k = 0.55 + 0.45 * Math.cos(TAU * 0.2 * sec(i)); }, at: (x, y) => { const q = at(x, y); return q && [q[0] * k, q[1] * k, q[2] * k, q[3]]; } }] }); } },
  'orange jacket walking by': { fire: false, make: () => scene({ seed: 38, back: ROOM, things: [blob({ rx: 9, ry: 16, rgb: [240, 120, 30], edge: 2, path: i => [-12 + 22 * sec(i) % 122, 44 + 1.5 * Math.sin(TAU * 1.8 * sec(i))] })] }) },
  ...Object.fromEntries(Object.entries(SKIN).map(([name, rgb], k) => [`${name} face moving`, { fire: false,
    make: () => scene({ seed: 50 + k, back: ROOM, things: [blob({ rx: 15, ry: 20, rgb, shade: 0.25, edge: 3, path: i => [48 + 12 * Math.sin(TAU * 0.4 * sec(i)), 36 + 4 * Math.sin(TAU * 0.7 * sec(i))] })] }) }])),
  'face coming close': { fire: false, make: () => scene({ seed: 60, back: ROOM, things: [blob({ rx: 12, ry: 16, rgb: SKIN.light, shade: 0.25, edge: 3, grow: i => 1.5 - 0.5 * Math.cos(TAU * 0.25 * sec(i)) })] }) },
  'face talking, hand gesturing': { fire: false, make: () => scene({ seed: 61, back: ROOM, things: [
    blob({ rx: 14, ry: 19, rgb: SKIN.tan, shade: 0.25, edge: 3, path: i => [40 + 2 * Math.sin(TAU * 1.1 * sec(i)), 34 + 1.5 * Math.sin(TAU * 2.3 * sec(i))] }),
    blob({ rx: 6, ry: 8, rgb: SKIN.tan, shade: 0.2, edge: 2, path: i => [76 + 8 * Math.sin(TAU * 0.8 * sec(i)), 52 + 6 * Math.cos(TAU * 0.6 * sec(i))] })] }) },
  'face found by the phone': { fire: false, face: i => ({ x: (48 + 12 * Math.sin(TAU * 0.4 * sec(i))) / W, y: 0.5, w: 0.3, h: 0.55 }),
    make() { return scene({ seed: 62, back: ROOM, things: [blob({ rx: 15, ry: 20, rgb: SKIN.light, shade: 0.25, edge: 3, path: i => [48 + 12 * Math.sin(TAU * 0.4 * sec(i)), 36] })], face: this.face }); } },
  'nothing warm': { fire: false, make: () => scene({ seed: 63, back: [70, 80, 110], noise: 6, things: [blob({ rx: 14, rgb: [230, 235, 255], edge: 4 })] }) },
};

// A film for a browser's fake camera (scripts/fire_video.mjs): an orange lamp all the time; after 4 s a torch catches
// fire on one side, is carried to the other (10–16 s), flares up (20 s), burns on steadily, flares up once more (46 s),
// dies down (from 58 s) and is out at 64 s.
export const FILM_SECS = 70;
export function film() {
  const at = s => s * FPS, mix = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
  const x = i => mix(26, 70, (i - at(10)) / at(1.2)) + (i > at(12) && i < at(16) ? 9 * Math.sin(TAU * 0.5 * (sec(i) - 12)) : 0);
  const size = i => (i < at(20) ? 1 : i < at(23) ? 1.8 : i < at(24) ? mix(1.8, 1.1, (i - at(23)) / at(1)) : i < at(46) ? 1.1 : i < at(49) ? 2 : i < at(50) ? mix(2, 1.1, (i - at(49)) / at(1)) : 1.1)
    * mix(1, 0.3, (i - at(58)) / at(5));
  return scene({ seed: 77, back: [16, 15, 22], noise: 2.5, things: [blob({ cx: 84, cy: 14, rx: 5, rgb: LAMP, edge: 2 }),
    flame({ wd: 8, ht: 17, seed: 12, from: at(4), until: at(64), path: i => [x(i), 50], grow: size })] });
}
