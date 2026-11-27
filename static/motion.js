// Movement detection in the stage (#85), in place of the separate flowtrack program: the camera picture is analysed
// right here – hands and body with MediaPipe's pose model on the graphics chip, light (fire, LEDs, light trails) by
// brightness. Built for the stage: fast movements (every camera frame, up to 60 fps; between pose results the
// difference of successive frames keeps the hand's tempo and direction, also when it is only a blur) and poor light
// (the picture is brightened and its contrast raised for the analysis, thresholds follow the room's brightness).
// It reports what flowtrack used to send: present, x, y, speed, spread, count, points (0…1 in the camera picture).
// #235: for the dance detection (dance.js) it also reports what each source sees of the two hands (`dance`: the pose
// model's wrists, LED markers in two colours – one per hand, found without a model in every camera frame –, the
// body's place and size, and, when asked for, the hand model's 21 points per hand). No picture ever leaves this file.
(typeof window !== 'undefined' ? window : globalThis).DreamMotion = (() => {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // One Euro filter: calm on slow movement, quick on fast movement (as in flowtrack)
  class OneEuro {
    constructor(minCutoff = 1.0, beta = 0.3, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff }); this.reset(); }
    reset() { this.x = this.dx = this.t = null; }
    static a(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
    filter(x, t) {
      if (this.t === null) { this.x = x; this.dx = 0; this.t = t; return x; }
      const dt = Math.max(t - this.t, 1e-4); this.t = t;
      const ad = OneEuro.a(this.dCutoff, dt); this.dx = ad * ((x - this.x) / dt) + (1 - ad) * this.dx;
      const a = OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt);
      this.x = a * x + (1 - a) * this.x; return this.x;
    }
  }

  // MediaPipe pose landmarks per hand (several are averaged), as flowtrack's pose_points [right_hand, left_hand]
  const HANDS = [[16, 18, 20, 22], [15, 17, 19, 21]];
  // OpenPose's 18 body points from MediaPipe's 33 ("neck" = middle of the shoulders), limbs and colours
  const OP_FROM_MP = [0, 'neck', 12, 14, 16, 11, 13, 15, 24, 26, 28, 23, 25, 27, 5, 2, 8, 7];
  const OP_LIMBS = [[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13],
    [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]];
  const OP_COLORS = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0],
    [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255],
    [255, 0, 255], [255, 0, 170], [255, 0, 85]];
  // rules as flowtrack's defaults; Dream maps the names to actions (~/.config/dream/motion.json), both languages work
  const RULES = [
    { names: ['Fire on', 'Feuer an'], when: f => f.present, for: 0.3 },
    { names: ['Fire off', 'Feuer aus'], when: f => !f.present, for: 2.0 },
    { names: ['Fast', 'Schnell'], when: f => f.speed > 1.0, for: 0.5, cooldown: 4 },
  ];
  // #240: which detected hand is "the" hand. The pose model lists the right hand first: when it lost that one for a
  // frame (poor light, half out of the picture) the left one stood first and the point jumped across the picture. The
  // hand nearest to where the point was going is taken; one far from it (another hand, a point the model guessed)
  // counts only when the next detection confirms it there – or when the model keeps seeing a hand away from the old
  // point (PERSIST detections in a row: a hand that moves fast never rests within CONFIRM of where it was first seen,
  // and the point must not wait at a stale place for it to pass by).
  // last: [x, y, t, vx, vy] or null; pend: the unconfirmed point [x, y, n] (n: detections in a row away from the point).
  const REACH = 0.15, REACH_PER_S = 3, CONFIRM = 0.1;   // picture units; per second since the hand was last seen
  const PERSIST = 3;
  // the moving pixels stand in for the model's hand only this long (seconds since the model last saw the hand): they
  // keep a blurred hand's tempo, but anything that moves near the old point would hold the point there for good
  const BLUR_S = 0.3, KNOWN_S = 0.5;
  const blurOk = (t, modelAt) => t - modelAt < BLUR_S;
  function pickHand(blobs, last, t, pend) {
    if (!blobs.length || !last) return { blobs, pend: null };
    const dt = Math.max(0, t - last[2]), px = last[0] + last[3] * dt, py = last[1] + last[4] * dt;
    let best = 0, bd = Infinity;
    blobs.forEach((b, i) => { const d = Math.hypot(b[0] - px, b[1] - py); if (d < bd) { bd = d; best = i; } });
    const b = blobs[best], ordered = [b, ...blobs.filter((_, i) => i !== best)];
    if (bd <= REACH + REACH_PER_S * dt) return { blobs: ordered, pend: null };
    const n = pend ? (pend[2] || 1) + 1 : 1;
    if (pend && (Math.hypot(b[0] - pend[0], b[1] - pend[1]) <= CONFIRM || n >= PERSIST)) return { blobs: ordered, pend: null };
    return { blobs: [], pend: [b[0], b[1], n] };
  }
  const MIN_VIS = 0.3;          // pose points count from this visibility on (low: poor light)
  const LEAD = 0.08;            // seconds of prediction without a measured delay (flowtrack: lead_ms 80); see lead()

  // picture(ctx, w, h): draws what Dream shows right now (for the projection's subtraction, #93)
  function create({ onFrame = () => {}, onRule = () => {}, onStatus = () => {}, picture = null } = {}) {
    const video = document.createElement('video'); video.muted = true; video.playsInline = true;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const prep = mk(320, 180), pctx = prep.getContext('2d');                       // brightened picture for the model
    const small = mk(96, 54), sctx = small.getContext('2d', { willReadFrequently: true });   // difference map
    // #117: light is searched at 320×180 – a small LED a few metres away is still a few pixels there
    const lightCv = mk(320, 180), lctx = lightCv.getContext('2d', { willReadFrequently: true });
    // the light's colour: '' = anything bright, else a hue the token has (green, magenta, blue, red)
    const HUES = { green: [80, 170], magenta: [280, 340], blue: [195, 255], red: [345, 15] };
    let lightColor = '';
    const trails = mk(512, 288), tctx = trails.getContext('2d');                   // the light-trail picture (source)
    const glow = mk(512, 288), gctx = glow.getContext('2d');
    let stream = null, kind = 'off', running = false, landmarker = null, loading = null, vfc = 0;
    // #235: markers (two colours, one per hand), the hand model (fingers) and what the dance detection gets of it all
    const mark = { on: false, colours: { l: 'cyan', r: 'magenta' }, found: { l: null, r: null } };
    const hands21 = { on: false, model: null, loading: null, at: 0, l: null, r: null };
    const lights = { l: null, r: null };               // light mode: which spot is which, kept from frame to frame
    let poseAt = 0;
    let camFps = 30, prevGray = null, gain = 1, contrast = 1, lum = 0.5, lumAt = 0, lastTs = -1, poseMs = 0, poseEvery = 1, frameNo = 0;
    const fx = new OneEuro(), fy = new OneEuro();
    // #96: what the latency is made of, and how far ahead the point is predicted
    const lat = { cam: null, proc: 0, lead: LEAD * 1000, fast: false };
    function setFast(on) {                             // "Schnell": the values follow at once, the filter barely smooths
      lat.fast = !!on;
      for (const f of [fx, fy]) { f.minCutoff = on ? 2.5 : 1.0; f.beta = on ? 1.5 : 0.3; }
    }
    // the prediction covers what passes between the camera seeing a movement and the beamer showing the answer:
    // the measured beamer → camera delay of the calibration plus the detection; capped, so a jerk never overshoots
    function setLead(ms) { lat.lead = clamp(ms, 40, 150); }
    const st = { present: false, x: 0.5, y: 0.5, speed: 0, spread: 0, count: 0, points: [], rate: 0, lum: 0.5, gain: 1,
      blur: false, kind: 'off', landmarks: null, at: 0, dance: null };
    let prev = null, vel = [0, 0], lastSeen = 0, modelAt = 0, nDet = 0, rateAt = performance.now(), trailsOn = false;
    let pend = null;
    const ruleState = RULES.map(() => ({ since: null, fired: false, at: -1e9 }));
    // calibration (#92): camera picture → Dream's picture (as the beamer shows it); without one they are the same
    let H = null, Hinv = null;
    const toPic = (x, y) => H ? DreamCalib.apply(H, x, y) : [x, y];
    const toCam = (x, y) => Hinv ? DreamCalib.apply(Hinv, x, y) : [x, y];
    let status = { code: 'off', text: '' };
    const say = (code, text) => { if (status.code !== code || status.text !== text) { status = { code, text }; onStatus(status); } };

    async function loadPose() {
      if (landmarker) return landmarker;
      if (!loading) loading = (async () => {
        say('loading', T('AI model is loading (downloaded once the first time, about 15 MB) …'));
        const { FilesetResolver, PoseLandmarker } = await import('/mp/vision_bundle.mjs');
        const files = await FilesetResolver.forVisionTasks('/mp/wasm');
        const make = delegate => PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/mp/pose_landmarker_lite.task', delegate },
          runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
        try { landmarker = await make('GPU'); } catch (e) { landmarker = await make('CPU'); }   // no WebGL: the CPU
        landmarker.detectForVideo(prep, 1); lastTs = 1;  // the first call compiles the shaders (seconds): not on stage
        return landmarker;
      })().catch(e => { loading = null; throw e; });
      return loading;
    }

    // #235: the hand model (21 points per hand), loaded only when the fingers are asked for – it shares the graphics chip
    async function loadHands() {
      if (hands21.model) return hands21.model;
      if (!hands21.loading) hands21.loading = (async () => {
        const { FilesetResolver, HandLandmarker } = await import('/mp/vision_bundle.mjs');
        const files = await FilesetResolver.forVisionTasks('/mp/wasm');
        const make = delegate => HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/mp/hand_landmarker.task', delegate }, runningMode: 'VIDEO', numHands: 2,
          minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
        try { hands21.model = await make('GPU'); } catch (e) { hands21.model = await make('CPU'); }
        return hands21.model;
      })().catch(e => { hands21.loading = null; throw e; });
      return hands21.loading;
    }

    // k: 'hand', 'on' (light) or 'marker' (#235); device: a camera's deviceId (none = the standard camera)
    let device = '';
    // src: a stream of its own instead of a camera (tests, other sources)
    // Every start and stop has a number: a start that was overtaken (the mode, then the kind, chosen in quick
    // succession; switched off while the camera was opening) lets go of what it opened and says nothing – two starts
    // at once used to tear the picture from each other and leave the detection dead with "no camera".
    let turn = 0;
    async function start(k, dev = '', src = null) {
      if (k === kind && running && dev === device && !src) return;
      stop(); kind = k; st.kind = k; running = true; device = dev;
      const my = turn;
      try {
        if (!stream) {
          say('camera', T('Opening the camera …'));
          const got = src || await navigator.mediaDevices.getUserMedia({ audio: false,
            video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 60 }, ...(dev ? { deviceId: { exact: dev } } : {}) } });
          if (my !== turn) { if (!src) got.getTracks().forEach(t => t.stop()); return; }
          stream = got; video.srcObject = stream; await video.play();
          if (my !== turn) return;
          camFps = stream.getVideoTracks()[0].getSettings().frameRate || 30;
        }
        await setExposure();
        if (k === 'hand') await loadPose();
        if (k === 'hand' && hands21.on) loadHands().catch(() => {});   // the fingers come when their model is there
        if (my !== turn) return;
        say('running', '');
        loop();
      } catch (e) {
        if (my !== turn) return;
        const cam = !stream;
        say(cam ? 'nocam' : 'nomodel', cam ? T('No camera – allow access or connect a camera.')
          : T('The AI model could not be loaded – the first time needs the internet.'));
        running = false;
      }
    }
    function stop() {
      turn++; running = false; kind = 'off'; st.kind = 'off';
      if (vfc && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(vfc);
      vfc = 0;
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; }
      prevGray = null; prev = null; fx.reset(); fy.reset();
      st.present = false;
      Object.assign(st, { speed: 0, count: 0, points: [], spread: 0, landmarks: null, rate: 0, dance: null });
      Object.assign(hands21, { l: null, r: null, at: 0 }); Object.assign(lights, { l: null, r: null }); mark.found = { l: null, r: null };
      pend = null; say('off', '');
    }
    function loop(now, meta) {
      if (!running) return;
      // how old the camera picture is when it is analysed (Chrome reports when the camera took it)
      if (meta && meta.captureTime) lat.cam = lat.cam == null ? now - meta.captureTime : lat.cam * 0.9 + (now - meta.captureTime) * 0.1;
      const t0 = performance.now();
      const next = () => { if (running) vfc = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop); };
      try { analyse(); } catch (e) { /* a frame that cannot be read (camera switching) is skipped */ }
      lat.proc = lat.proc * 0.9 + (performance.now() - t0) * 0.1;
      next();
    }

    // the room's brightness every half second: dark rooms get more gain and contrast for the model
    function measureLight(now) {
      if (now - lumAt < 500) return;
      lumAt = now;
      const d = sctx.getImageData(0, 0, small.width, small.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      lum = s / (d.length / 4) / 255;
      gain = clamp(0.42 / Math.max(0.02, lum), 1, 4); contrast = lum < 0.2 ? 1.35 : lum < 0.35 ? 1.2 : 1.05;
      st.lum = lum; st.gain = gain;
    }

    // difference of successive frames on a tiny grey picture: where something moves and how much (blur included)
    function motionMap(pred) {
      sctx.filter = 'none'; sctx.drawImage(video, 0, 0, small.width, small.height);
      const d = sctx.getImageData(0, 0, small.width, small.height).data, n = small.width * small.height;
      const g = new Float32Array(n); for (let i = 0; i < n; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
      if (pred) subtract(g, small.width, small.height, pred);
      let res = null;
      if (prevGray) {
        // noise rises with the gain in the dark: the threshold follows the median difference
        const diff = new Float32Array(n); for (let i = 0; i < n; i++) diff[i] = Math.abs(g[i] - prevGray[i]);
        const sorted = Array.from(diff).sort((a, b) => a - b), thr = Math.max(12, sorted[n >> 1] * 4 + 6);
        res = { diff, thr, w: small.width, h: small.height };
      }
      prevGray = g; return res;
    }
    // the centre of the moving pixels near a point (r: radius in picture units) – where a blurred hand is
    function movedNear(m, x, y, r) {
      if (!m) return null;
      let sx = 0, sy = 0, sw = 0;
      const x0 = Math.max(0, Math.floor((x - r) * m.w)), x1 = Math.min(m.w - 1, Math.ceil((x + r) * m.w));
      const y0 = Math.max(0, Math.floor((y - r) * m.h)), y1 = Math.min(m.h - 1, Math.ceil((y + r) * m.h));
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const v = m.diff[j * m.w + i] - m.thr; if (v > 0) { sx += i * v; sy += j * v; sw += v; }
      }
      return sw > m.thr * 6 ? [(sx / sw + 0.5) / m.w, (sy / sw + 0.5) / m.h] : null;
    }

    function poseBlobs(now) {
      // the model every frame while it keeps up; slower graphics chips: every second frame, the gap filled from
      // the difference map
      if (frameNo % poseEvery !== 0) return null;
      pctx.filter = gain > 1.05 || contrast > 1.05 ? `brightness(${gain.toFixed(2)}) contrast(${contrast.toFixed(2)})` : 'none';
      pctx.drawImage(video, 0, 0, prep.width, prep.height);
      const ts = Math.max(lastTs + 1, Math.round(now)); lastTs = ts;
      const t0 = performance.now(), r = landmarker.detectForVideo(prep, ts), dt = performance.now() - t0;
      poseMs = poseMs ? poseMs * 0.9 + dt * 0.1 : dt;
      // at most ~30 model runs a second (at 60 fps every second frame), more frames apart on slow chips; in between
      // the difference map follows the hand – the page keeps time for the dream and its effects
      poseEvery = clamp(Math.max(camFps > 45 ? 2 : 1, Math.ceil(poseMs / 14)), 1, 4);
      const person = r.landmarks && r.landmarks[0];
      st.landmarks = person || null; poseAt = now;
      // a hand model that stumbles never costs the frame its body
      if (hands21.on && hands21.model && frameNo % (poseEvery * 2) === 0) { try { fingers(person, ts); } catch (e) { Object.assign(hands21, { l: null, r: null }); } }
      if (!person) return [];
      const out = [];
      HANDS.forEach((idx, rank) => {
        const lms = idx.map(i => person[i]);
        if (Math.min(...lms.map(l => l.visibility == null ? 1 : l.visibility)) < MIN_VIS) return;
        out.push([lms.reduce((a, l) => a + l.x, 0) / lms.length, lms.reduce((a, l) => a + l.y, 0) / lms.length, HANDS.length - rank]);
      });
      return out;
    }
    // #235: the hand model's 21 points per hand, in picture heights (x times the picture's width / height, so a
    // finger is as long across as upright). Which hand is which: the pose model's wrist it lies on; without one, the
    // model's own guess (it assumes a mirrored picture – a camera's is not, so its "Left" is the right hand).
    function fingers(person, ts) {
      // the camera picture as it is (not the small brightened one of the body model): fingers are small
      const r = hands21.model.detectForVideo(video, ts), asp = video.videoWidth / Math.max(1, video.videoHeight);
      const sides = r.handedness || r.handednesses || [], got = { l: null, r: null };
      (r.landmarks || []).forEach((lm, i) => {
        const label = sides[i] && sides[i][0];
        let side = label && label.categoryName === 'Left' ? 'r' : 'l';
        if (person && person[15] && person[16]) {
          const d = k => Math.hypot(person[k].x - lm[0].x, person[k].y - lm[0].y);
          side = d(15) <= d(16) ? 'l' : 'r';
        }
        const c = label ? label.score : 0.5;
        if (!got[side] || got[side].c < c) got[side] = { pts: lm.map(p => [+(p.x * asp).toFixed(4), +p.y.toFixed(4)]), c: +c.toFixed(2) };
      });
      Object.assign(hands21, got, { at: performance.now() });
    }
    // #235: two LED markers, one colour per hand – bright spots of exactly these colours, in every camera frame
    function markers() {
      const W = lightCv.width, H = lightCv.height;
      lctx.drawImage(video, 0, 0, W, H);
      mark.found = DreamDance.findMarkers(lctx.getImageData(0, 0, W, H).data, W, H, mark.colours);
      return ['r', 'l'].filter(h => mark.found[h]).map(h => [mark.found[h].x, mark.found[h].y, 2]);
    }
    // what the dance detection gets: per hand every source's view (camera coordinates), the body, the fingers
    function danceInput(now, blobsCam) {
      const person = now - poseAt < 150 ? st.landmarks : null, hands = { l: [], r: [] };
      if (kind === 'hand' && person) {
        [['r', HANDS[0]], ['l', HANDS[1]]].forEach(([h, idx]) => {
          const lms = idx.map(i => person[i]), c = Math.min(...lms.map(l => (l.visibility == null ? 1 : l.visibility)));
          // `at`: when the model measured it – it does not run on every camera frame, and the stream must know a repeat
          if (c >= MIN_VIS) hands[h].push({ x: lms.reduce((a, l) => a + l.x, 0) / lms.length, y: lms.reduce((a, l) => a + l.y, 0) / lms.length, c, src: 'pose', at: poseAt / 1000 });
        });
      }
      if (kind === 'marker' || (kind === 'hand' && mark.on)) for (const h of ['l', 'r']) if (mark.found[h]) hands[h].push({ ...mark.found[h], src: 'marker' });
      if (kind === 'on') {
        // fire and light have no left and right: each spot stays the hand it was nearest to a frame ago
        const free = blobsCam.slice(0, 2).map(b => ({ x: b[0], y: b[1], c: 0.6, src: 'light' })), next = { l: null, r: null };
        for (const h of ['r', 'l']) {
          const was = lights[h]; if (!was || !free.length) continue;
          const i = free.reduce((a, f, j) => (Math.hypot(f.x - was.x, f.y - was.y) < Math.hypot(free[a].x - was.x, free[a].y - was.y) ? j : a), 0);
          if (Math.hypot(free[i].x - was.x, free[i].y - was.y) < 0.3) next[h] = free.splice(i, 1)[0];
        }
        for (const h of ['r', 'l']) if (!next[h] && free.length) next[h] = free.shift();   // a new spot: the hand that is free
        Object.assign(lights, next);
        for (const h of ['l', 'r']) if (lights[h]) hands[h].push(lights[h]);
      }
      const fresh = hands21.on && now - hands21.at < 200;
      st.dance = { hands, body: kind === 'hand' && person ? DreamDance.bodyFrom(person, video.videoWidth / Math.max(1, video.videoHeight)) : null,
        fingers: { l: fresh ? hands21.l : null, r: fresh ? hands21.r : null }, dark: lum < 0.12,
        pose: kind === 'hand' && person ? person : null,   // #267: the skeleton's points – base movements of one's own read them
        aspect: video.videoWidth / Math.max(1, video.videoHeight) };
    }
    // bright spots (fire, LEDs): threshold above the room's own brightness, so it works in the dark and in a lit hall
    function lightBlobs(pred) {
      const W = lightCv.width, H = lightCv.height;
      lctx.drawImage(video, 0, 0, W, H);
      const d = lctx.getImageData(0, 0, W, H).data, n = W * H, g = new Float32Array(n), hit = new Uint8Array(n);
      for (let i = 0; i < n; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
      if (pred) subtract(g, W, H, pred);
      const band = HUES[lightColor];
      if (band) {
        // a coloured token: its hue, fairly saturated and not dark – lamps, windows and white walls drop out. The LED's
        // core often clips to white, so bright pixels next to the colour count too (see the spread below).
        for (let i = 0; i < n; i++) {
          const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
          if (mx < 90 || g[i] < 40 || mx - mn < 0.3 * mx) continue;
          const c = mx - mn; let h = mx === r ? ((gg - b) / c) % 6 : mx === gg ? (b - r) / c + 2 : (r - gg) / c + 4; h = (h * 60 + 360) % 360;
          if (band[0] < band[1] ? h >= band[0] && h <= band[1] : h >= band[0] || h <= band[1]) hit[i] = 2;
        }
        for (let i = 0; i < n; i++) if (!hit[i] && g[i] > 225) {      // a clipped core next to the colour
          const x = i % W;
          if ((x > 0 && hit[i - 1] === 2) || (x < W - 1 && hit[i + 1] === 2) || hit[i - W] === 2 || hit[i + W] === 2) hit[i] = 1;
        }
      } else {
        let s = 0, s2 = 0;
        for (let i = 0; i < n; i++) { s += g[i]; s2 += g[i] * g[i]; }
        const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean)), thr = clamp(mean + 3 * sd, 120, 235);
        for (let i = 0; i < n; i++) if (g[i] >= thr) hit[i] = 1;
      }
      const seen = new Uint8Array(n), blobs = [], q = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        if (seen[i] || !hit[i]) continue;
        let head = 0, tail = 0, sx = 0, sy = 0, a = 0; q[tail++] = i; seen[i] = 1;
        while (head < tail) {
          const p = q[head++], x = p % W, y = (p / W) | 0; sx += x; sy += y; a++;
          for (const o of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
            if (o >= 0 && o < n && !seen[o] && hit[o]) { seen[o] = 1; q[tail++] = o; }
          }
        }
        if (a >= 3 && a <= n * 0.25) blobs.push([(sx / a + 0.5) / W, (sy / a + 0.5) / H, a]);
      }
      return blobs.sort((p, q2) => q2[2] - p[2]).slice(0, 4);
    }

    // #117: a short, fixed exposure in light mode (where the camera lets the browser set it): the room goes nearly
    // black, only LEDs and fire stay bright, and fast movement hardly blurs. Back to automatic for the hands.
    let shortWanted = true, exposure = { supported: null, on: false };
    async function setExposure() {
      const tr = stream && stream.getVideoTracks()[0];
      if (!tr || !tr.getCapabilities) { exposure = { supported: false, on: false }; return; }
      const caps = tr.getCapabilities();
      const ok = caps.exposureMode && caps.exposureMode.includes('manual') && caps.exposureTime;
      exposure.supported = !!ok;
      if (!ok) { exposure.on = false; return; }
      const want = (kind === 'on' || kind === 'marker') && shortWanted;
      try {
        if (want) {
          const t = clamp(20, caps.exposureTime.min, caps.exposureTime.max);   // ~2 ms (the unit is 100 µs)
          await tr.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: t }] });
        } else if (caps.exposureMode.includes('continuous')) {
          await tr.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] });
        }
        exposure.on = want;
      } catch (e) { exposure.on = false; }
    }

    // ---------- the projection subtracted (#93): Dream's own picture, as the camera sees it, taken away ----------
    // Snapshots of the shown picture are kept for a moment; the one shown "delay" ms ago (measured by the
    // calibration) is warped into camera space through the calibration, matched in brightness and subtracted from the
    // camera picture for the light detection and the difference map. The hand model gets the untouched picture.
    const unp = { on: false, delay: 0, gain: 0.7, hist: [], pool: [], amount: 0 };
    const predCv = mk(160, 90), predCtx = predCv.getContext('2d', { willReadFrequently: true });
    function remember(now) {
      const c = unp.pool.pop() || mk(96, 96), cx = c.getContext('2d');
      cx.fillStyle = '#000'; cx.fillRect(0, 0, 96, 96); picture(cx, 96, 96);
      unp.hist.push({ t: now, c });
      while (unp.hist.length > 2 && unp.hist[1].t < now - unp.delay - 300) unp.pool.push(unp.hist.shift().c);
    }
    function projected(now) {
      if (!unp.on || !Hinv || !picture) { unp.amount = 0; return null; }
      remember(now);
      const want = now - unp.delay;
      // everything shown within ±40 ms of then, the brightest of it: a delay a little off, or a picture change that the
      // camera catches a frame early, late or half-way, leaves nothing behind
      predCtx.setTransform(1, 0, 0, 1, 0, 0); predCtx.globalCompositeOperation = 'source-over';
      predCtx.fillStyle = '#000'; predCtx.fillRect(0, 0, 160, 90);
      let near = unp.hist.filter(h => Math.abs(h.t - want) <= 40);
      if (!near.length) near = [unp.hist.reduce((a, h) => Math.abs(h.t - want) < Math.abs(a.t - want) ? h : a)];
      const step = Math.ceil(near.length / 5);         // at most five pictures to warp
      near.filter((h, n) => n % step === 0 || n === near.length - 1).forEach(h => {
        DreamCalib.warpToCamera(predCtx, h.c, Hinv, 160, 90); predCtx.globalCompositeOperation = 'lighten';
      });
      predCtx.globalCompositeOperation = 'source-over';
      const d = predCtx.getImageData(0, 0, 160, 90).data, W = 160, Hh = 90, g = new Float32Array(W * Hh), p = new Float32Array(W * Hh);
      for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
      // a pixel wider (3×3 maximum): a calibration a hair off or a lens that bends a little still leaves no edges
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        let m = 0;
        for (let j = Math.max(0, y - 1); j <= Math.min(Hh - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(W - 1, x + 1); i++) m = Math.max(m, g[j * W + i]);
        p[y * W + x] = m;
      }
      return { d: p, w: W, h: Hh };
    }
    // cam -= gain · predicted; the gain (how bright the beamer appears to the camera) follows the picture: the median
    // ratio where the projection is bright enough to tell
    function subtract(g, W, Hh, pred) {
      const at = i => pred.d[Math.floor((Math.floor(i / W) + 0.5) * pred.h / Hh) * pred.w + Math.floor(((i % W) + 0.5) * pred.w / W)];
      const r = []; for (let i = 0; i < g.length; i += 2) { const q = at(i); if (q > 40) r.push(g[i] / q); }
      if (r.length > 100) { r.sort((a, b) => a - b); unp.gain = 0.9 * unp.gain + 0.1 * clamp(r[r.length >> 1], 0, 3); }
      let took = 0, had = 0;
      for (let i = 0; i < g.length; i++) { const q = unp.gain * at(i); had += g[i]; took += Math.min(g[i], q); g[i] = Math.max(0, g[i] - q); }
      unp.amount = had ? took / had : 0;
    }

    function analyse() {
      if (!video.videoWidth) return;
      const now = performance.now(), t = now / 1000; frameNo++;
      const pred = projected(now);
      const m = motionMap(pred);
      measureLight(now);
      let blobs = kind === 'hand' ? poseBlobs(now) : kind === 'marker' ? markers() : lightBlobs(pred), blur = false;
      if (kind === 'hand' && mark.on) { const m = markers(); if (blobs && !blobs.length) blobs = m; }   // the model sees no hand: the markers do
      const skipped = blobs === null;                  // a frame without the model (slow graphics chip): see below
      if (skipped) blobs = [];
      danceInput(now, blobs);
      blobs = blobs.map(b => [...toPic(b[0], b[1]), b[2]]);   // from here on in the picture's coordinates
      if (kind === 'hand' && !skipped) {
        // the point is "known" only while the model itself saw the hand lately – not while only moving pixels held it
        ({ blobs, pend } = pickHand(blobs, prev && t - lastSeen < KNOWN_S && t - modelAt < KNOWN_S ? [prev[0], prev[1], prev[2], vel[0], vel[1]] : null, t, pend));
        if (blobs.length) modelAt = t;
      }
      // a fast hand smears and the model loses it: follow the moving pixels near where it was (up to 0.3 s)
      if (kind === 'hand' && (!blobs.length || frameNo % poseEvery) && prev && t - lastSeen < BLUR_S && blurOk(t, modelAt)) {
        const [px, py] = toCam(prev[0] + vel[0] * (t - prev[2]), prev[1] + vel[1] * (t - prev[2]));
        const at = movedNear(m, clamp(px, 0, 1), clamp(py, 0, 1), 0.22);
        if (at) { blobs = [[...toPic(at[0], at[1]), 2]].concat(blobs.slice(1)); blur = true; }
      }
      if (skipped && !blur) { if (trailsOn) drawTrails([]); onFrame(st); return; }   // nothing new: keep the last values
      const f = st;
      f.blur = blur; f.present = blobs.length > 0; f.count = blobs.length;
      f.points = blobs.flatMap(b => [+b[0].toFixed(4), +b[1].toFixed(4)]).slice(0, 16);
      if (blobs.length) {
        const [x, y] = blobs[0];
        if (t - lastSeen > 0.5) { fx.reset(); fy.reset(); prev = null; }   // after a pause: no glide from the old point
        const sx = fx.filter(x, t), sy = fy.filter(y, t);
        if (prev) {
          const dt = Math.max(t - prev[2], 1e-3), vx = (sx - prev[0]) / dt, vy = (sy - prev[1]) / dt;
          vel = [0.5 * vel[0] + 0.5 * vx, 0.5 * vel[1] + 0.5 * vy];
          const k = lat.fast ? 0.45 : 0.2;             // "Schnell": the tempo follows a fast move at once
          f.speed = (1 - k) * f.speed + k * Math.hypot(vx, vy);
        } else vel = [0, 0];
        prev = [sx, sy, t]; lastSeen = t;
        const ahead = lat.lead / 1000;
        f.x = clamp(sx + vel[0] * ahead, -0.2, 1.2); f.y = clamp(sy + vel[1] * ahead, -0.2, 1.2);
        const xs = blobs.map(b => b[0]), ys = blobs.map(b => b[1]);
        f.spread = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        nDet++;
      } else { f.speed *= 0.9; f.spread = 0; }
      if (now - rateAt >= 1000) { f.rate = nDet * 1000 / (now - rateAt); nDet = 0; rateAt = now; }
      f.at = now;
      RULES.forEach((r, i) => {
        const rs = ruleState[i];
        if (!r.when(f)) { rs.since = null; rs.fired = false; return; }
        if (rs.since === null) rs.since = t;
        if (!rs.fired && t - rs.since >= r.for && t - rs.at >= (r.cooldown || 0)) { rs.fired = true; rs.at = t; onRule(r.names); }
      });
      if (trailsOn) drawTrails(blobs);
      onFrame(f);
    }

    // the light-trail picture, as flowtrack's built-in "trails" effect: glowing strokes that fade (source "flowtrack")
    function drawTrails(blobs) {
      const W = trails.width, H = trails.height, e = clamp(st.speed / 1.5, 0, 1);
      tctx.globalCompositeOperation = 'source-over'; tctx.fillStyle = 'rgba(0,0,0,0.1)'; tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = 'lighter';
      const c = `rgba(255,140,40,${(0.6 + 0.4 * e).toFixed(2)})`, r = (6 + 18 * e) * W / 640;
      for (const [x, y] of blobs) { tctx.fillStyle = c; tctx.beginPath(); tctx.arc(x * W, y * H, r, 0, 7); tctx.fill(); }
      gctx.globalCompositeOperation = 'source-over'; gctx.filter = 'none'; gctx.clearRect(0, 0, W, H); gctx.drawImage(trails, 0, 0);
      gctx.globalCompositeOperation = 'lighter'; gctx.filter = 'blur(6px)'; gctx.drawImage(trails, 0, 0); gctx.drawImage(trails, 0, 0);
      gctx.filter = 'none';
    }

    // the body as an OpenPose skeleton on black (for the pose ControlNet), in the picture's format
    function skeleton(cv) {
      const p = st.landmarks, ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      if (!p || p.length < 29) return false;
      const pic = (x, y) => { const q = toPic(x, y); return [q[0] * w, q[1] * h]; };
      const pts = OP_FROM_MP.map(s => s === 'neck' ? pic((p[11].x + p[12].x) / 2, (p[11].y + p[12].y) / 2) : pic(p[s].x, p[s].y));
      const th = Math.max(2, Math.round(Math.min(w, h) / 120));
      ctx.lineCap = 'round';
      OP_LIMBS.forEach(([a, b], i) => { ctx.strokeStyle = `rgb(${OP_COLORS[i]})`; ctx.lineWidth = th * 2; ctx.beginPath(); ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); ctx.stroke(); });
      pts.forEach((q, i) => { ctx.fillStyle = `rgb(${OP_COLORS[i]})`; ctx.beginPath(); ctx.arc(q[0], q[1], th * 2, 0, 7); ctx.fill(); });
      return true;
    }

    // the camera's grey picture, small (calibration and the projection's subtraction look at it)
    const grabCv = mk(160, 90), grabCtx = grabCv.getContext('2d', { willReadFrequently: true });
    function grab() {
      if (!running || !video.videoWidth) return null;
      grabCtx.drawImage(video, 0, 0, grabCv.width, grabCv.height);
      const d = grabCtx.getImageData(0, 0, grabCv.width, grabCv.height).data, g = new Uint8Array(grabCv.width * grabCv.height);
      for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0;
      return { d: g, w: grabCv.width, h: grabCv.height };
    }
    function calibrate(h) {
      H = h && h.length === 9 ? h : null; Hinv = H ? DreamCalib.invert(H) : null;
      if (H && !Hinv) H = null;
      prev = null; fx.reset(); fy.reset();             // positions jump to the new coordinates
    }

    return {
      start, stop, skeleton, video, grab, calibrate, setFast, setLead,
      lightOptions(color, short) { lightColor = HUES[color] ? color : ''; shortWanted = !!short; if (running) setExposure(); },
      // #235: LED markers beside the hand model (in marker mode they are all there is) and their two colours; the
      // hand model's fingers
      danceOptions({ markers: m, left, right, fingers: f }) {
        mark.on = !!m; mark.colours = { l: left, r: right }; hands21.on = !!f;
        if (!f) Object.assign(hands21, { l: null, r: null, at: 0 });
        if (f && running && kind === 'hand') loadHands().catch(() => {});
      },
      get fingersReady() { return !!hands21.model; },
      get exposure() { return exposure; },
      get latency() { return { cam: lat.cam, proc: lat.proc, lead: lat.lead, fast: lat.fast }; },
      get calibrated() { return !!H; },
      unproject(on, delay = 0) { unp.on = !!on; unp.delay = Math.max(0, +delay || 0); if (!on) { unp.pool.push(...unp.hist.map(h => h.c)); unp.hist = []; } },
      get unprojected() { return unp.on && !!Hinv && !!picture ? unp.amount : null; },
      toPic, toCam,
      get frame() { return st; },
      get status() { return status; },
      get kind() { return kind; },
      get poseMs() { return poseMs; },
      trails(on) { trailsOn = on; if (!on) tctx.clearRect(0, 0, trails.width, trails.height); return glow; },
    };
  }
  return { create, OneEuro, pickHand, blurOk, BLUR_S };
})();
if (typeof module === 'object' && module.exports) module.exports = globalThis.DreamMotion;   // tests/js/motion.test.mjs
