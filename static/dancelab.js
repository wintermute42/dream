/* Dream – the dance lab (#243): see live what Dream makes of a dance, change the mapping while dancing, say "good" or
   "bad" without hands, record sessions and play them back.

   A part of the page of Dream Dance (#251: static/dance.html – it reads the stage through the bridge of the window
   that opened it). It shows the camera picture with the skeleton, the hands and the
   LED markers (trails of the hands, a multiple exposure of the last poses) large, and right beside it the feature
   stream of dance.js as running curves – a gap where a value is not known, a band where the skeleton was lost – with
   what each feature is computed from, its source and how sure it is (`origin`); the output with its effects and the
   hand model's 21 points per hand (with trails of the finger tips; `fingerWhy` says why there are none). Below: one row of the mapping table to tune (target, curve,
   ranges, smoothing – at once, undoable), and the sessions kept on this Mac.
   A session is numbers, never pictures (dancerec.js): the camera picture is drawn here and nowhere kept. Playing a
   session back puts its features in the place of the live ones, so settings can be tried without dancing again.

   The lab does no work while it is closed and nothing is recorded. `tune`, `clock`, `origin`, `fingerWhy` and `lostSpans` are pure
   (tests/js/dancerec.test.mjs). Looks: dancelab.css – only transform and opacity move. A global `DanceLab`. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const R = node ? require('./dancerec.js') : root.DreamDanceRec, M = node ? require('./dancemap.js') : root.DreamDanceMap;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const clock = s => { const n = Math.max(0, Math.floor(s)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  const STRIPS = ['energy', 'tempo', 'phase', 'open', 'turn', 'height', 'still'];
  const FINGER_STRIPS = ['palm', 'spread', 'pinch'];
  const WINDOW = 12;                                   // seconds of curves in view
  const CURVE_NAMES = { lin: () => T('straight'), soft: () => T('early (soft start)'), hard: () => T('late (needs more)'), s: () => T('S (soft both ends)') };
  const spoken = mark => (mark === 'good' ? T('👍 Good') : mark === 'bad' ? T('👎 Bad') : '');
  // the words a spoken feedback is made of: English, and the page's language beside it (each a list in the translations)
  const words = () => ({ good: [...R.WORDS.good, ...T('good great yes nice super top right').split(' ')], bad: [...R.WORDS.bad, ...T('bad no nope wrong').split(' ')],
    not: [...R.WORDS.not, ...T('not').split(' ')] });

  // the table after a row was tuned: {dst}, {curve}, {inLo}, {inHi}, {outLo}, {outHi}, {smooth}. The input range keeps
  // its order (from ≤ to), every number its range; the row is the owner's from then on.
  function tune(rows, id, change) {
    return rows.map(r => {
      if (r.id !== id) return r;
      const n = { ...r, in: r.in.slice(), out: r.out.slice(), origin: 'own' };
      if (change.dst) n.dst = change.dst;
      if (change.curve in M.CURVES) n.curve = change.curve;
      // only what goes both ways (turning, a target with a rest in the middle) may go out below zero
      const lo = M.BIPOLAR.has(n.dst) || n.in[0] < 0 ? -1 : 0;
      n.out = n.out.map(v => clamp(v, lo, 1));
      if ('inLo' in change) n.in[0] = clamp(+change.inLo || 0, -1, n.in[1]);
      if ('inHi' in change) n.in[1] = clamp(+change.inHi || 0, n.in[0], 1);
      if ('outLo' in change) n.out[0] = clamp(+change.outLo || 0, lo, 1);
      if ('outHi' in change) n.out[1] = clamp(+change.outHi || 0, lo, 1);
      if ('smooth' in change) n.smooth = clamp(+change.smooth || 0, 0, 5);
      return n;
    });
  }

  // What a feature is computed from, in words, and the sources of the stream by their names.
  const WHAT = {
    energy: () => T('how fast the hands move, in shoulder widths a second'),
    tempo: () => T('how often the hands’ path repeats'),
    phase: () => T('where in its repetition the movement is'),
    open: () => T('distance between the two hands, in shoulder widths'),
    turn: () => T('a hand circling the middle of its own path'),
    height: () => T('how high the hands are, measured from the shoulders'),
    still: () => T('rest: hardly any energy for half a second'),
    palm: () => T('how far the fingers are stretched'), spread: () => T('the angle between the fingers'), pinch: () => T('thumb on index finger'),
  };
  const SRC_NAMES = new Map([['pose', () => T('skeleton (wrists)')], ['marker', () => T('LED markers')], ['light', () => T('light spots')],
    ['sensor', () => T('motion sensor')], ['hand', () => T('hand model (21 points)')], ['eyes', () => 'Dreamy Eyes'], ['camera', () => T('Mac camera')]]);
  // origin(key, src, conf): one feature for the display – {what, from, sure (0 … 100), known}. src is the stream's
  // source name ("pose", "pose+marker", "marker+sensor" …); undefined: not kept (a session keeps values, not sources).
  function origin(key, src, conf) {
    const k = String(key).replace(/^[lr]\./, ''), what = Object.prototype.hasOwnProperty.call(WHAT, k) ? WHAT[k]() : '';
    const known = conf > 0, parts = [...new Set(String(src || '').split('+').filter(Boolean))];
    const from = src === undefined ? T('not kept in a session') : !known || !parts.length ? T('nothing detected')
      : parts.map(n => { const f = SRC_NAMES.get(n); return typeof f === 'function' ? f() : n; }).join(' + ');
    return { what, from, sure: known ? Math.round(clamp(conf, 0, 1) * 100) : 0, known };
  }
  // Why the finger view has no hands. det: {kind, fingers, ready, camera} – what the stage detects with (null in a
  // playback: the session has what it has). Returns a text for the whole view, or '' (then each hand speaks for itself).
  function fingerWhy(det) {
    if (!det) return '';
    if (det.camera !== 'running') return T('The camera is not running.');
    if (det.kind !== 'hand') return T('Fingers need the detection “Hands (AI)” – LED markers have no fingers.');
    if (!det.fingers) return T('Fingers are off: switch on “Fingers (hand AI)” below – the hand model is loaded once (about 8 MB).');
    if (!det.ready) return T('The hand model is loading (once, about 8 MB) …');
    return '';
  }
  // The stretches without a skeleton: frames [{t, p: {b}}] → [[t0, t1], …] (a frame without body points, up to the next
  // frame that has them).
  function lostSpans(frames) {
    const out = []; let from = null;
    for (const f of frames) {
      if (!f.p.b && from == null) from = f.t;
      if (f.p.b && from != null) { out.push([from, f.t]); from = null; }
    }
    if (from != null && frames.length) out.push([from, frames[frames.length - 1].t]);
    return out;
  }

  function mount(box, opts) {
    const { keys, fxNames = {}, targets = {} } = opts, label = n => (root.DancePanel ? root.DancePanel.label(n, fxNames) : n);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const btn = (text, title, cls = '') => { const b = el('button', 'btn ' + cls, text); b.type = 'button'; if (title) b.title = title; return b; };
    const check = (text, on, title) => { const l = el('label', 'dl-check'), i = el('input'); i.type = 'checkbox'; i.checked = on; if (title) l.title = title; l.append(i, ' ' + text); return [l, i]; };
    const view = (title, aria) => { const f = el('figure', 'dl-view'), c = el('figcaption', '', title), cv = el('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', aria); f.append(c, cv); return [f, cv, c]; };
    const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim() || '#fff';
    const C = { text: col('--text'), muted: col('--muted'), line: col('--line'), accent: col('--accent'), ok: col('--ok'), warn: col('--warn') };
    const HAND_COL = { cyan: '#35e6f0', magenta: '#f040dc', green: '#59e06a', blue: '#5b8cff' };
    const handCol = h => HAND_COL[(opts.colours() || {})[h]] || (h === 'l' ? HAND_COL.cyan : HAND_COL.magenta);

    box.classList.add('dl'); box.setAttribute('role', 'region'); box.setAttribute('aria-label', T('Dance lab')); box.hidden = true; box.textContent = '';
    // ---------- the bar: what the lab is doing, record, feedback ----------
    const bar = el('header', 'dl-bar'), title = el('h2', '', opts.title || T('🧪 Dance lab')), modeTxt = el('span', 'dl-mode'), tools = el('div', 'btns dl-tools');
    modeTxt.setAttribute('role', 'status');
    const recBtn = btn(T('● Record'), T('Record a session: the features and the points of skeleton and hands – numbers only, no camera picture (key R)')); recBtn.setAttribute('aria-pressed', 'false');
    const goodBtn = btn(spoken('good'), T('That felt right: keep the last seconds (key G)')), badBtn = btn(spoken('bad'), T('That did not work: keep the last seconds (key B)'));
    const voiceBtn = btn('🎙', T('Hold and say “good” or “bad” (or key V)')); voiceBtn.setAttribute('aria-label', T('Feedback by voice: hold and say “good” or “bad”'));
    const secsLab = el('label', 'dl-secs'), secsIn = el('input'), secsVal = el('span', 'val');
    secsIn.type = 'range'; secsIn.min = 1; secsIn.max = 15; secsIn.step = 1; secsLab.append(T('a feedback keeps the last'), secsIn, secsVal);
    tools.append(recBtn, goodBtn, badBtn, voiceBtn, secsLab); bar.append(title, modeTxt, tools);
    // ---------- the three views ----------
    const views = el('div', 'dl-views');
    const [camFig, camCv] = view(T('Camera, skeleton and markers'), T('The camera picture with the detected skeleton, the hands and the LED markers'));
    const [outFig, outCv] = view(T('Output with effects'), T('What the audience sees: the picture with its effects'));
    const [finFig, finCv] = view(T('Fingers (hand AI)'), T('The 21 points of each hand, enlarged: left hand left, right hand right'));
    const camOpts = el('div', 'dl-opts'), [camL, camOn] = check(T('Camera picture'), true, T('Off: only skeleton, hands and markers on black')),
      [multiL, multiOn] = check(T('Multiple exposure'), false, T('Several poses of the last seconds (in playback: of the looped stretch) pale over each other')),
      [trailL, trailOn] = check(T('Hand trails'), true, T('The way of each hand as a fading line in its marker colour'));
    const camState = el('div', 'dl-camstate'); camState.setAttribute('role', 'status');
    camOpts.append(camL, multiL, trailL); camFig.append(camState, camOpts); camFig.classList.add('dl-cam');
    const finVals = el('div', 'dl-fvals'), finOpts = el('div', 'dl-opts'),
      [finL, finOn] = check(T('Fingers (hand AI)'), false, T('A second model finds 21 points per hand – fist, spread fingers, pinch. Needs the detection “Hands (AI)”; loaded once, about 8 MB.'));
    finOpts.append(finL); finFig.append(finVals, finOpts);
    finOn.onchange = () => { if (opts.setFingers) opts.setFingers(finOn.checked); };
    views.append(outFig, finFig);
    // ---------- the curves ----------
    const curves = el('figure', 'dl-curves'), cvCap = el('figcaption', '', T('Feature stream')), gestTxt = el('span', 'dl-gesture'), cvCv = el('canvas');
    gestTxt.setAttribute('role', 'status'); gestTxt.setAttribute('aria-live', 'polite'); cvCap.append(' ', gestTxt);
    cvCv.setAttribute('role', 'img'); cvCv.setAttribute('aria-label', T('Running curves of energy, tempo, phase, opening, turning, height and stillness; a gap where a value is not known'));
    const lostKey = el('span', 'dl-lostkey', T('▮ skeleton lost')); lostKey.hidden = true; cvCap.append(' ', lostKey);
    // what every curve is made of: its source and how sure it is, in words beside the picture
    const srcBox = el('table', 'dl-srcs'), srcHead = el('thead'), srcBody = el('tbody'), srcRows = {};
    { const tr = el('tr'); for (const h of [T('Feature'), T('Computed from'), T('Source now'), T('Sure')]) { const th = el('th', '', h); th.scope = 'col'; tr.append(th); } srcHead.append(tr); }
    for (const k of STRIPS) {
      const tr = el('tr'), name = el('th', '', label(k)), what = el('td', 'dl-srcwhat', origin(k, '', 0).what), from = el('td', 'dl-srcfrom', '–'), sure = el('td', 'dl-srcsure'), bar = el('i'), num = el('span', '', '–');
      name.scope = 'row'; bar.setAttribute('aria-hidden', 'true'); sure.append(bar, num); tr.append(name, what, from, sure); srcBody.append(tr); srcRows[k] = { tr, from, bar, num, shown: '' };
    }
    const srcCap = el('caption', '', T('What each feature is computed from')); srcBox.append(srcCap, srcHead, srcBody);
    curves.append(cvCap, cvCv, srcBox);
    const main = el('div', 'dl-main'); main.append(camFig, curves);
    // ---------- the time line (playback) ----------
    const time = el('div', 'dl-time'); time.hidden = true;
    const playBtn = btn('⏸', T('Play / pause')), seek = el('input'), timeTxt = el('span', 'dl-clock'), band = el('canvas', 'dl-band');
    playBtn.setAttribute('aria-label', T('Play or pause')); seek.type = 'range'; seek.min = 0; seek.step = 0.01; seek.setAttribute('aria-label', T('Position in the session'));
    band.setAttribute('role', 'img'); band.setAttribute('aria-label', T('The session’s time line: recognised gestures and feedback marks'));
    const speeds = el('div', 'dl-speeds'); speeds.setAttribute('role', 'group'); speeds.setAttribute('aria-label', T('Speed'));
    const speedBtns = [[1, '1×'], [0.5, '½×'], [0.25, '¼×']].map(([k, t]) => { const b = btn(t, T('Speed {t}', { t })); b.dataset.k = k; b.setAttribute('aria-pressed', String(k === 1)); speeds.append(b); return b; });
    const loopA = btn(T('[ from here'), T('The loop begins at this position')), loopB = btn(T('to here ]'), T('The loop ends at this position')), loopOff = btn(T('Loop off'), T('Play the whole session again'));
    const liveBtn = btn(T('↩ Live'), T('End the playback: the live dance steers again'));
    const row1 = el('div', 'dl-timerow'); row1.append(playBtn, seek, timeTxt); const row2 = el('div', 'btns compact'); row2.append(speeds, loopA, loopB, loopOff, liveBtn);
    time.append(row1, band, row2);
    // ---------- tune a row, the sessions, a session's feedback moments ----------
    const cols = el('div', 'dl-cols');
    const tuneBox = el('section', 'dl-card'), listBox = el('section', 'dl-card'), marksBox = el('section', 'dl-card'); marksBox.hidden = true;
    const field = (text, input) => { const l = el('label', 'dl-field'); l.append(el('span', '', text), input); return l; };
    const range = (min, max, step) => { const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; return i; };
    const rowSel = el('select'), dstSel = el('select'), curveSel = el('select'), inLo = range(-1, 1, 0.01), inHi = range(-1, 1, 0.01), outLo = range(-1, 1, 0.01), outHi = range(-1, 1, 0.01), smooth = range(0, 2, 0.05);
    const tuneCv = el('canvas', 'dl-tunecv'), tuneVal = el('div', 'dl-tuneval'), undoBtn = btn(T('↶ Undo'), T('Take the last change of the table back')), tuneState = el('span', 'dl-state');
    tuneCv.setAttribute('role', 'img'); tuneCv.setAttribute('aria-label', T('The row’s curve: what comes in (across) and what goes out (up); the dot is the live value'));
    tuneState.setAttribute('role', 'status'); undoBtn.disabled = true;
    for (const k of Object.keys(M.CURVES)) { const o = el('option', '', CURVE_NAMES[k]()); o.value = k; curveSel.append(o); }
    for (const [g, kindName] of [[T('Effects (at once)'), 'instant'], [T('AI sliders (slow)'), 'slow']]) {
      const og = el('optgroup'); og.label = g;
      for (const t of Object.keys(targets).filter(t => targets[t] === kindName)) { const o = el('option', '', label(t)); o.value = t; og.append(o); }
      dstSel.append(og);
    }
    const tuneBtns = el('div', 'btns compact'); tuneBtns.append(undoBtn, tuneState);
    tuneBox.append(el('h3', '', T('Tune a row')), field(T('Row'), rowSel), field(T('Steers'), dstSel), field(T('Curve'), curveSel), field(T('Comes in from'), inLo), field(T('Comes in to'), inHi),
      field(T('Goes out from'), outLo), field(T('Goes out to'), outHi), field(T('Smoothing'), smooth), tuneVal, tuneCv, tuneBtns);
    const listState = el('div', 'dl-state'), list = el('ul', 'dl-list'); listState.setAttribute('role', 'status');
    listBox.append(el('h3', '', T('Sessions and feedback')), listState, list);
    const marksList = el('ul', 'dl-list'); marksBox.append(el('h3', '', T('Feedback moments of this session')), marksList);
    cols.append(tuneBox, listBox, marksBox);
    box.append(bar, main, views, time, cols);
    const toast = el('div', 'dl-toast'); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); document.body.append(toast);

    // ---------- state ----------
    const rng = R.ring(30), press = R.clutch(0.5), undo = []; let spans = [];
    let liveSrc = null, open = false, rec = null, player = null, raf = 0, lastT = 0, lastPack = 0, lastDraw = 0, lastOut = 0, lastVals = 0, shown = null, toastTimer = 0, undoAt = 0, undoKey = '', tuneId = null, drawnRows = '';
    const active = () => open || !!rec;
    const state = () => opts.state({ open, rec: !!rec, play: !!player });
    function say(text) {
      toast.textContent = text; toast.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('on'), 2200);
    }
    function mode() {
      const t = player ? T('Playback – the session steers instead of the live dance') : rec ? T('Live · recording {t}', { t: clock(rec.seconds) }) : T('Live');
      if (modeTxt.textContent !== t) modeTxt.textContent = t;
      recBtn.setAttribute('aria-pressed', String(!!rec)); recBtn.classList.toggle('rec', !!rec); recBtn.textContent = rec ? T('■ Stop') : T('● Record');
      goodBtn.disabled = badBtn.disabled = voiceBtn.disabled = recBtn.disabled = !!player;
    }

    // ---------- canvases: sized to their box, no finer than twice the CSS pixels ----------
    const sizes = new WeakMap();
    const ro = new ResizeObserver(es => es.forEach(e => sizes.set(e.target, [e.contentRect.width, e.contentRect.height])));
    [camCv, outCv, finCv, cvCv, band, tuneCv].forEach(c => ro.observe(c));
    function ctxOf(cv) {
      const s = sizes.get(cv); if (!s || !s[0]) return null;
      const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(s[0] * dpr), h = Math.round(s[1] * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, s[0], s[1]];
    }

    // ---------- drawing: the figure ----------
    function figure(c, w, h, f, alpha, thin) {
      const P = ([x, y]) => [x * w, y * h], b = R.body(f);
      c.lineCap = 'round'; c.globalAlpha = alpha;
      if (b) {
        c.strokeStyle = C.text; c.lineWidth = thin ? 1.5 : 3; c.beginPath();
        for (const [a, e] of R.BONES) { c.moveTo(...P(b[a])); c.lineTo(...P(b[e])); }
        const neck = [(b[1][0] + b[2][0]) / 2, (b[1][1] + b[2][1]) / 2]; c.moveTo(...P(neck)); c.lineTo(...P(b[0])); c.stroke();
        c.beginPath(); c.arc(...P(b[0]), Math.max(4, Math.hypot(b[1][0] - b[2][0], (b[1][1] - b[2][1]) * h / w) * w * 0.3), 0, 7); c.stroke();
      }
      for (const hnd of ['l', 'r']) {
        const pts = R.hand21(f, hnd), wr = R.wrist(f, hnd);
        c.strokeStyle = c.fillStyle = handCol(hnd);
        if (pts) { c.lineWidth = thin ? 1 : 1.5; c.beginPath(); for (const [a, e] of R.HAND_BONES) { c.moveTo(...P(pts[a])); c.lineTo(...P(pts[e])); } c.stroke(); }
        if (wr) { c.beginPath(); c.arc(...P(wr), thin ? 3 : 6, 0, 7); c.fill(); }
        for (const cand of f.i.h[hnd]) if (cand[3] === 1) {    // an LED marker: a ring where it was seen
          c.lineWidth = 2; c.beginPath(); c.arc(cand[0] * w, cand[1] * h, thin ? 5 : 10, 0, 7); c.stroke();
        }
      }
      c.globalAlpha = 1;
    }
    // frames: the ones in view, the newest last
    function drawCam(frames, fresh) {
      const g = ctxOf(camCv); if (!g) return; const [c, w, h] = g, f = fresh ? frames[frames.length - 1] : null;
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      if (!player && camOn.checked && opts.video && opts.video.videoWidth) { c.globalAlpha = 0.6; c.drawImage(opts.video, 0, 0, w, h); c.globalAlpha = 1; }
      if (!player && opts.overlay) opts.overlay(c, w, h);   // #252: what the page draws into the camera picture (the calibration, the one person)
      if (!f) { c.fillStyle = C.muted; c.font = '13px system-ui'; c.textAlign = 'center'; c.fillText(T('nothing detected – is “Movement” on?'), w / 2, h / 2); return; }
      if (skeletonWanted(frames) && !f.p.b) {            // this frame has no skeleton: plain to see, in the picture itself
        c.strokeStyle = C.warn; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
        c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, 0, w, 30); c.fillStyle = C.warn; c.font = '600 14px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(T('Skeleton lost – no body found in this picture'), w / 2, 15); c.textBaseline = 'alphabetic';
      }
      if (trailOn.checked) {
        for (const hnd of ['l', 'r']) {
          const tr = frames.filter(x => f.t - x.t <= 1.5).map(x => R.wrist(x, hnd)); c.strokeStyle = handCol(hnd); c.lineWidth = 3; c.lineCap = 'round';
          for (let i = 1; i < tr.length; i++) if (tr[i] && tr[i - 1]) { c.globalAlpha = 0.9 * i / tr.length; c.beginPath(); c.moveTo(tr[i - 1][0] * w, tr[i - 1][1] * h); c.lineTo(tr[i][0] * w, tr[i][1] * h); c.stroke(); }
        }
        c.globalAlpha = 1;
      }
      if (multiOn.checked) {
        const stretch = player && player.loop ? player.session.frames.filter(x => x.t >= player.loop[0] && x.t <= player.loop[1]) : frames.filter(x => f.t - x.t <= 2);
        const n = Math.min(8, stretch.length);
        for (let k = 0; k < n; k++) figure(c, w, h, stretch[Math.round(k * (stretch.length - 1) / Math.max(1, n - 1))], 0.14 + 0.3 * k / n, true);
      }
      figure(c, w, h, f, 1, false);
    }
    // Is a skeleton to be expected? Live: when the stage detects with the body model; in a session: when it has one anywhere in view.
    const detect = () => (player || !opts.detect ? null : opts.detect());
    function skeletonWanted(frames) { const d = detect(); return d ? d.kind === 'hand' : frames.some(x => x.p.b); }
    const KIND_NAMES = new Map([['hand', () => T('Hands (AI)')], ['marker', () => T('LED markers')], ['on', () => T('Fire/LED')]]);
    // the line below the camera: what Dream detects with, and what it found in the newest frame
    function camLine(frames, f) {
      const d = detect(), kind = d && KIND_NAMES.get(d.kind), parts = [];
      if (d) parts.push(d.camera === 'running' ? T('Detects with: {k}', { k: typeof kind === 'function' ? kind() : T('nothing') }) : d.status || T('The camera is not running.'));
      else if (player) parts.push(T('Playback of a session'));
      if (f) {
        if (skeletonWanted(frames)) parts.push(f.p.b ? T('skeleton found') : T('skeleton lost'));
        for (const hnd of ['l', 'r']) {
          const c0 = f.i.h[hnd][0], name = hnd === 'l' ? T('left hand') : T('right hand');
          parts.push(c0 ? T('{h}: {s} ({p} %)', { h: name, s: origin('', R.SRC[c0[3]] || 'pose', 1).from, p: Math.round(c0[2] * 100) }) : T('{h}: not seen', { h: name }));
        }
      }
      const t = parts.join(' · ');
      if (camState.textContent !== t) camState.textContent = t;
      camState.classList.toggle('warn', !!f && skeletonWanted(frames) && !f.p.b);
    }
    // the table of sources: live from the stream's record, in a playback from the session (values and confidences only)
    function drawSources(f, src) {
      for (const k of STRIPS) {
        const row = srcRows[k], i = keys.indexOf(k), o = origin(k, player ? undefined : (src && src[k]) || '', f ? f.c[i] : 0), key = o.from + '|' + o.sure;
        if (row.shown === key) continue;
        row.shown = key; row.from.textContent = o.from; row.num.textContent = o.known ? o.sure + ' %' : '–';
        row.bar.style.transform = `scaleX(${(o.sure / 100).toFixed(2)})`; row.tr.classList.toggle('unknown', !o.known);
      }
    }
    function drawOut(now) {
      if (now - lastOut < 66) return; lastOut = now;       // the output beside it: fifteen times a second is plenty
      const g = ctxOf(outCv); if (!g) return; const [c, w, h] = g;
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h); opts.snapshot(c, w, h);
    }
    // a hand, enlarged into its half of the view: the wrist at the bottom, the palm a quarter of the height
    function drawFingers(frames) {
      const g = ctxOf(finCv); if (!g) return; const [c, w, h] = g, f = frames[frames.length - 1], asp = f ? f.i.a : 16 / 9;
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.lineCap = 'round';
      const why = fingerWhy(detect());
      if (why) {                                         // no fingers at all, and why: across the whole view, in lines that fit
        c.fillStyle = C.muted; c.font = '13px system-ui'; c.textAlign = 'center';
        const lines = []; let line = '';
        for (const word of why.split(' ')) { const next = line ? line + ' ' + word : word; if (c.measureText(next).width > w - 32 && line) { lines.push(line); line = word; } else line = next; }
        lines.push(line); lines.forEach((l, n) => c.fillText(l, w / 2, h / 2 + (n - (lines.length - 1) / 2) * 18));
        return;
      }
      ['l', 'r'].forEach((hnd, n) => {
        const x0 = n * w / 2, bw = w / 2, pts = f && R.hand21(f, hnd);
        c.strokeStyle = C.line; c.lineWidth = 1; c.strokeRect(x0 + 4.5, 4.5, bw - 9, h - 9);
        c.fillStyle = C.muted; c.font = '12px system-ui'; c.textAlign = 'left'; c.fillText(hnd === 'l' ? T('Left hand') : T('Right hand'), x0 + 12, 22);
        if (!pts) { c.textAlign = 'center'; c.fillText(player ? T('no hand') : T('no hand in the picture'), x0 + bw / 2, h / 2); return; }
        // each pose is placed by its own wrist and palm, so the fingers' movement shows – not the hand's way through the picture
        const place = p => { const palm = Math.hypot((p[9][0] - p[0][0]) * asp, p[9][1] - p[0][1]) || 1e-6, k = 0.26 * h / palm;
          return p.map(q => [x0 + bw / 2 + (q[0] - p[0][0]) * asp * k, h * 0.86 + (q[1] - p[0][1]) * k]); };
        const hist = frames.filter(x => f.t - x.t <= 0.8 && R.hand21(x, hnd)).map(x => place(R.hand21(x, hnd))), cur = hist[hist.length - 1];
        if (multiOn.checked) {
          const n2 = Math.min(6, hist.length); c.strokeStyle = handCol(hnd); c.lineWidth = 1.5;
          for (let k = 0; k < n2 - 1; k++) { const p = hist[Math.round(k * (hist.length - 1) / Math.max(1, n2 - 1))]; c.globalAlpha = 0.12 + 0.25 * k / n2; c.beginPath(); for (const [a, e] of R.HAND_BONES) { c.moveTo(...p[a]); c.lineTo(...p[e]); } c.stroke(); }
        }
        c.lineWidth = 1.2; c.strokeStyle = handCol(hnd);     // the finger tips' trails
        for (const tip of R.TIPS) for (let i = 1; i < hist.length; i++) { c.globalAlpha = 0.7 * i / hist.length; c.beginPath(); c.moveTo(...hist[i - 1][tip]); c.lineTo(...hist[i][tip]); c.stroke(); }
        c.globalAlpha = 1; c.strokeStyle = C.text; c.lineWidth = 3; c.beginPath(); for (const [a, e] of R.HAND_BONES) { c.moveTo(...cur[a]); c.lineTo(...cur[e]); } c.stroke();
        c.fillStyle = handCol(hnd); for (const q of cur) { c.beginPath(); c.arc(q[0], q[1], 3.5, 0, 7); c.fill(); }
      });
    }
    // ---------- drawing: the curves ----------
    // frames in view and the second at the right edge (live: now) or under the cursor (playback: the middle)
    function drawCurves(frames, t1, cursor, marks) {
      const g = ctxOf(cvCv); if (!g) return; const [c, w, h] = g, idx = k => keys.indexOf(k);
      const hands = ['l', 'r'].filter(hd => frames.some(f => f.c[idx(hd + '.palm')] > 0));
      const strips = [...STRIPS, ...hands.flatMap(hd => FINGER_STRIPS.map(k => hd + '.' + k))], top = 20, sh = (h - top) / strips.length, x0 = hands.length ? 150 : 86, x1 = w - 46;   // room for a finger strip's longer name
      const X = t => x1 - (t1 - t) / WINDOW * (x1 - x0);
      c.clearRect(0, 0, w, h); c.font = '11px system-ui'; c.textBaseline = 'middle';
      // the band of recognised gestures along the top, and the feedback marks through everything
      let run = null; c.fillStyle = C.accent;
      const flush = end => { if (!run) return; c.globalAlpha = 0.35; c.fillRect(X(run.t0), 2, Math.max(2, X(end) - X(run.t0)), top - 6); c.globalAlpha = 1; c.fillStyle = C.text; c.textAlign = 'left'; c.fillText(label('g.' + run.g), Math.max(x0, X(run.t0)) + 4, top / 2 - 1); c.fillStyle = C.accent; run = null; };
      for (const f of frames) { if (run && f.g !== run.g) flush(f.t); if (f.g && !run) run = { g: f.g, t0: f.t }; }
      if (frames.length) flush(frames[frames.length - 1].t);
      // where the skeleton was lost: a band through all curves – what they show there comes without a body
      const lost = skeletonWanted(frames) ? lostSpans(frames) : [];
      lostKey.hidden = !lost.length;
      c.fillStyle = C.warn; c.globalAlpha = 0.16;
      for (const [a, b] of lost) { const xa = Math.max(x0, X(a)), xb = Math.min(x1, Math.max(X(b), X(a) + 2)); if (xb > xa) c.fillRect(xa, top, xb - xa, h - top); }
      c.globalAlpha = 1;
      strips.forEach((k, n) => {
        const y0 = top + n * sh, mid = k === 'turn', i = idx(k), base = mid ? y0 + sh / 2 : y0 + sh - 3, amp = mid ? sh / 2 - 3 : sh - 6, fing = k.includes('.');
        c.strokeStyle = C.line; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, base + 0.5); c.lineTo(x1, base + 0.5); c.stroke();
        c.fillStyle = C.muted; c.textAlign = 'right'; c.fillText(fing ? (k[0] === 'l' ? T('L') : T('R')) + ' ' + label(k.slice(2)) : label(k), x0 - 8, y0 + sh / 2);
        c.strokeStyle = fing ? handCol(k[0]) : C.accent; c.lineWidth = 1.6; c.lineJoin = 'round';
        let on = false, lost = null; c.beginPath();
        for (const f of frames) {
          const known = f.c[i] > 0, x = X(f.t);
          if (known) { const y = base - f.v[i] * amp; if (on) c.lineTo(x, y); else c.moveTo(x, y); }
          if (!known && lost == null) lost = x;
          if (known && lost != null) { gapMark(c, lost, x, base); lost = null; }
          on = known;
        }
        c.stroke();
        if (lost != null && frames.length) gapMark(c, lost, X(frames[frames.length - 1].t), base);
        const lastF = cursor != null ? frames.find(f => f.t >= cursor) : frames[frames.length - 1];
        c.fillStyle = C.text; c.textAlign = 'left';
        c.fillText(lastF && lastF.c[i] > 0 ? (k === 'tempo' ? (lastF.b ? String(Math.round(lastF.b)) : '–') : Math.round(lastF.v[i] * 100) + ' %') : '–', x1 + 6, y0 + sh / 2);
      });
      for (const m of marks) { const x = X(m.t); if (x < x0 || x > x1) continue; c.strokeStyle = m.mark === 'good' ? C.ok : C.warn; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      if (cursor != null) { c.strokeStyle = C.text; c.lineWidth = 1; c.beginPath(); c.moveTo(X(cursor), 0); c.lineTo(X(cursor), h); c.stroke(); }
    }
    // a gap: the value was not known here (a hand lost, no rhythm) – a dashed stretch on the base line
    function gapMark(c, xa, xb, y) {
      if (xb - xa < 2) return;
      c.save(); c.strokeStyle = C.warn; c.globalAlpha = 0.7; c.setLineDash([3, 4]); c.lineWidth = 1.5; c.beginPath(); c.moveTo(xa, y - 2); c.lineTo(xb, y - 2); c.stroke(); c.restore();
    }
    function drawBand() {
      const g = ctxOf(band); if (!g || !player) return; const [c, w, h] = g, s = player.session, X = t => t / Math.max(0.01, s.seconds) * w;
      c.clearRect(0, 0, w, h); c.fillStyle = C.line; c.fillRect(0, h / 2 - 1, w, 2);
      c.fillStyle = C.accent; c.globalAlpha = 0.5; for (const sp of spans) c.fillRect(X(sp.t0), 4, Math.max(2, X(sp.t1) - X(sp.t0)), h - 8); c.globalAlpha = 1;
      if (player.loop) { c.strokeStyle = C.text; c.lineWidth = 2; c.strokeRect(X(player.loop[0]) + 1, 1, X(player.loop[1]) - X(player.loop[0]) - 2, h - 2); }
      for (const m of s.marks) { c.fillStyle = m.mark === 'good' ? C.ok : C.warn; c.fillRect(X(m.t) - 1.5, 0, 3, h); }
      c.fillStyle = C.text; c.fillRect(X(player.pos) - 1, 0, 2, h);
    }

    // ---------- tune a row ----------
    const rowsNow = () => opts.rows();
    function drawTune(rows) {
      const shape = JSON.stringify(rows.map(r => [r.id, r.src, r.dst]));
      if (shape !== drawnRows) {
        drawnRows = shape; rowSel.textContent = '';
        for (const r of rows) { const o = el('option', '', `${label(r.src)} → ${label(r.dst)}`); o.value = r.id; rowSel.append(o); }
        if (!rows.some(r => r.id === tuneId)) tuneId = rows.length ? rows[0].id : null;
        if (tuneId) rowSel.value = tuneId;
      }
      const r = rows.find(x => x.id === tuneId);
      for (const i of [dstSel, curveSel, inLo, inHi, outLo, outHi, smooth]) i.disabled = !r;
      if (!r) return;
      const set = (i, v) => { if (document.activeElement !== i) i.value = v; };
      set(dstSel, r.dst); set(curveSel, r.curve); set(inLo, r.in[0]); set(inHi, r.in[1]); set(outLo, r.out[0]); set(outHi, r.out[1]); set(smooth, r.smooth);
      const pc = v => Math.round(v * 100) + ' %';
      const said = T('in {a} … {b} · out {c} … {d} · smoothing {s} s', { a: pc(r.in[0]), b: pc(r.in[1]), c: pc(r.out[0]), d: pc(r.out[1]), s: (+r.smooth).toFixed(2) });
      if (tuneVal.textContent !== said) tuneVal.textContent = said;
    }
    function drawTuneCurve(f) {
      const g = ctxOf(tuneCv), r = rowsNow().find(x => x.id === tuneId); if (!g) return; const [c, w, h] = g;
      c.clearRect(0, 0, w, h); if (!r) return;
      const lo = Math.min(0, r.in[0]) < 0 ? -1 : 0, olo = Math.min(r.out[0], r.out[1], 0) < 0 ? -1 : 0, X = v => 6 + (v - lo) / (1 - lo) * (w - 12), Y = v => h - 6 - (v - olo) / (1 - olo) * (h - 12);
      c.strokeStyle = C.line; c.lineWidth = 1; c.strokeRect(6.5, 6.5, w - 13, h - 13);
      c.strokeStyle = C.accent; c.lineWidth = 2; c.beginPath();
      for (let k = 0; k <= 60; k++) { const v = lo + (1 - lo) * k / 60, y = M.shape(r, v, 1); if (k) c.lineTo(X(v), Y(y)); else c.moveTo(X(v), Y(y)); }
      c.stroke();
      const i = keys.indexOf(r.src);
      if (f && i >= 0 && f.c[i] >= 0.25) { c.fillStyle = C.ok; c.beginPath(); c.arc(X(f.v[i]), Y(M.shape(r, f.v[i], 1)), 5, 0, 7); c.fill(); }
    }
    function change(key, ch) {
      const rows = rowsNow(), now = performance.now();
      if (key !== undoKey || now - undoAt > 800) { undo.push(rows); if (undo.length > 30) undo.shift(); }   // one step per drag, not per pixel
      undoKey = key; undoAt = now; undoBtn.disabled = false;
      opts.setRows(tune(rows, tuneId, ch)); tuneState.textContent = T('applies at once · Dream keeps it');
    }
    rowSel.onchange = () => { tuneId = rowSel.value; drawTune(rowsNow()); };
    dstSel.onchange = () => change('dst', { dst: dstSel.value }); curveSel.onchange = () => change('curve', { curve: curveSel.value });
    inLo.oninput = () => change('inLo', { inLo: +inLo.value }); inHi.oninput = () => change('inHi', { inHi: +inHi.value });
    outLo.oninput = () => change('outLo', { outLo: +outLo.value }); outHi.oninput = () => change('outHi', { outHi: +outHi.value });
    smooth.oninput = () => change('smooth', { smooth: +smooth.value });
    undoBtn.onclick = () => { const prev = undo.pop(); if (prev) { opts.setRows(prev); undoKey = ''; tuneState.textContent = T('taken back'); } undoBtn.disabled = !undo.length; };

    // ---------- sessions ----------
    const api = opts.api || {
      list: () => fetch('/dance/sessions').then(r => r.json()),
      get: id => fetch('/dance/sessions/' + id).then(r => (r.ok ? r.json() : null)),
      add: s => fetch('/dance/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).then(r => r.json()),
      del: id => fetch('/dance/sessions/' + id, { method: 'DELETE' }).then(r => r.ok),
      exp: (id, file) => fetch('/dance/sessions/' + id + '/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file) }).then(r => r.json()),
    };
    const when = at => new Date(at * 1000).toLocaleString(root.I18N ? root.I18N.lang : undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    async function refresh() {
      let data; try { data = await api.list(); } catch (e) { data = null; }
      if (!data || !Array.isArray(data.sessions)) { listState.textContent = T('The sessions cannot be read right now.'); return; }
      listState.textContent = data.sessions.length ? T('Kept on this Mac in {f} – numbers only, no camera pictures.', { f: data.folder }) : T('Nothing kept yet. Record a session, or say “good” or “bad” while you dance.');
      list.textContent = '';
      for (const m of data.sessions) {
        const li = el('li'), fb = m.kind === 'feedback';
        const what = fb ? `${m.good ? '👍' : '👎'} ${when(m.at)} · ${T('{n} s', { n: Math.round(m.seconds) })}${m.gesture ? ' · ' + label('g.' + m.gesture) : ''}${m.targets && m.targets.length ? ' → ' + m.targets.map(label).join(', ') : ''}`
          : `● ${when(m.at)} · ${clock(m.seconds)}${m.good || m.bad ? ` · 👍 ${m.good} 👎 ${m.bad}` : ''}`;
        const text = el('span', 'dl-what', what), play = btn('▶', T('Play this back: it steers instead of the live dance')), exp = btn('⬇', T('Write a test file for the detection (numbers only; it stays on this Mac)')), del = btn('🗑', T('Delete'));
        play.setAttribute('aria-label', T('Play back: {w}', { w: what })); exp.setAttribute('aria-label', T('Test file of: {w}', { w: what })); del.setAttribute('aria-label', T('Delete: {w}', { w: what }));
        play.onclick = () => playback(m.id);
        exp.onclick = () => testFile(m.id);
        del.onclick = () => {                             // asks once more on the button itself – no dialog in the way
          if (del.dataset.sure) { api.del(m.id).then(refresh); return; }
          del.dataset.sure = '1'; del.textContent = T('Really delete?'); setTimeout(() => { delete del.dataset.sure; del.textContent = '🗑'; }, 3000);
        };
        const bs = el('span', 'dl-rowbtns'); bs.append(play, exp, del); li.append(text, bs); list.append(li);
      }
    }
    // A test file is the dancer's real movement: Dream writes it into its state folder on the Mac and says where it
    // belongs from there – never a download to whatever device asks, never Dream's code folder.
    async function testFile(id) {
      let r = null; try { const s = await api.get(id); if (R.good(s)) r = await api.exp(id, R.testFile(s, id)); } catch (e) { r = null; }
      listState.textContent = r && r.file
        ? T('Test file written: {f}. It holds your real movement: move it to a private place (a private repository, folder testdaten/dance-sessions/) – never into Dream’s code folder or a public repository.', { f: r.file })
        : (r && r.error) || T('The test file could not be written.');
    }
    async function keep(s, text) {
      try { const r = await api.add(s); if (r && r.id) { say(text); if (open) refresh(); return; } say(r && r.error ? r.error : T('Could not be kept.')); }
      catch (e) { say(T('Could not be kept.')); }
    }

    // ---------- record, feedback, playback ----------
    function record(on = !rec) {
      if (player || on === !!rec) return;
      if (on) { rec = R.recorder(keys, rowsNow(), 16 / 9); say(T('● Recording – numbers only, no camera picture')); }
      else { const s = rec.stop(); rec = null; if (s.frames.length >= 10) keep(s, T('Session kept: {t}', { t: clock(s.seconds) })); else say(T('Too short – nothing kept.')); }
      mode(); state(); loop();
    }
    // mark: 'good' | 'bad'; by: who said it ('panel', 'key', 'button', 'voice', 'control', 'midi')
    function feedback(mark, by) {
      if (!spoken(mark)) return false;
      if (!active() || player) {                        // said so only to a hand at this Mac – never onto the audience's picture for a pedal
        if (by === 'panel' || by === 'key' || by === 'voice') say(T('Feedback needs the dance lab open on the live dance, or a recording.'));
        return false;
      }
      const secs = opts.secs(), m = R.moment(rng, mark, by, secs, rowsNow(), keys, 16 / 9);
      if (rec) rec.mark(performance.now() / 1000, mark, by, secs);
      if (m.frames.length < 5) { say(T('{m} – but nothing was detected in the last seconds', { m: spoken(mark) })); return true; }
      keep(m, T('{m} – the last {n} s are kept', { m: spoken(mark), n: Math.round(m.seconds) }));
      return true;
    }
    let asked = 0;
    async function playback(id) {
      const mine = ++asked; let s; try { s = await api.get(id); } catch (e) { s = null; }
      if (!open || mine !== asked) return;             // closed meanwhile, or another one was asked for
      if (!R.good(s) || !s.frames.length) { say(T('This session cannot be played.')); return; }
      if (rec) record(false);
      player = R.player(s); spans = R.gestures(s); seek.max = s.seconds; time.hidden = false; marksBox.hidden = false; rng.clear();
      marksList.textContent = '';
      const rv = R.review(s);
      if (!rv.length) marksList.append(el('li', 'dl-what', T('No feedback in this session.')));
      for (const m of rv) {
        const li = el('li'), what = `${m.mark === 'good' ? '👍' : '👎'} ${clock(m.t)} · ${m.gesture ? T('{g} · {p} % sure', { g: label('g.' + m.gesture), p: Math.round(m.sure * 100) }) : T('no gesture')}${m.targets.length ? ' → ' + m.targets.map(([k]) => label(k)).join(', ') : ''}`;
        const b = btn(what, T('Jump there and loop over its seconds')); b.classList.add('dl-jump');
        b.onclick = () => { player.setLoop(Math.max(0, m.t - m.secs), m.t); player.seek(Math.max(0, m.t - m.secs)); player.play(); };
        li.append(b); marksList.append(li);
      }
      mode(); state(); loop();
    }
    function live() {
      if (!player) return;
      const lost = time.contains(document.activeElement) || marksBox.contains(document.activeElement);
      player = null; opts.play(null); time.hidden = true; marksBox.hidden = true; mode(); state();
      if (lost && open) recBtn.focus();                // the button that was pressed is gone: the focus stays in the lab
    }
    playBtn.onclick = () => player && player.play(!player.playing);
    seek.oninput = () => player && player.seek(+seek.value);
    band.onclick = e => { if (player) { const r = band.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width * player.seconds); } };
    speedBtns.forEach(b => { b.onclick = () => { if (!player) return; player.setSpeed(+b.dataset.k); speedBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b))); }; });
    let loopFrom = null;
    loopA.onclick = () => { if (player) { loopFrom = player.pos; say(T('Loop from {t} – now set its end', { t: clock(loopFrom) })); } };
    loopB.onclick = () => { if (player && loopFrom != null && player.pos > loopFrom) player.setLoop(loopFrom, player.pos); };
    loopOff.onclick = () => { if (player) { player.setLoop(null); loopFrom = null; } };
    liveBtn.onclick = live;
    recBtn.onclick = () => record(); goodBtn.onclick = () => feedback('good', 'panel'); badBtn.onclick = () => feedback('bad', 'panel');
    secsIn.oninput = () => { opts.setSecs(+secsIn.value); secsVal.textContent = T('{n} s', { n: secsIn.value }); };
    voiceBtn.addEventListener('mousedown', () => opts.voice(true)); voiceBtn.addEventListener('mouseup', () => opts.voice(false)); voiceBtn.addEventListener('mouseleave', () => opts.voice(false)); voiceBtn.addEventListener('blur', () => opts.voice(false));
    voiceBtn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); opts.voice(true); } });
    voiceBtn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') opts.voice(false); });

    // ---------- the loop: only while the lab is open or records ----------
    function loop() { if (!raf && active()) { lastT = performance.now(); raf = requestAnimationFrame(tick); } }
    // whatever goes wrong in a frame (a session that is not what it says): the lab lets go of the stage and goes on live
    function tick(now) {
      raf = 0; if (!active()) return;
      try { frame(now); } catch (e) { console.error('[dance lab]', e); if (player) { live(); say(T('This session cannot be played.')); } }
      if (active()) raf = requestAnimationFrame(tick);
    }
    function frame(now) {
      const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
      const due = press.due(now / 1000); if (due) feedback(due, 'button');
      let frames, cursor = null, t1, marks = [];
      if (player) {
        const f = player.tick(dt), s = player.session;
        opts.play(f ? R.unpack(f, s.keys) : null);
        // the stretch in view, cut out by its places in the session (never a pass over all of it)
        const a = player.at(player.pos - WINDOW / 2 - 1), here = player.index, b = player.at(player.pos + WINDOW / 2);
        frames = s.frames.slice(a, b + 1); cursor = player.pos; t1 = player.pos + WINDOW / 2; marks = s.marks;
        shown = s.frames.slice(a, here + 1);
      } else {
        const s = opts.live();
        if (s && now - lastPack >= 1000 / R.RATE - 2) {
          lastPack = now; liveSrc = s.rec.src; const f = R.pack(now / 1000, keys, s.rec, s.input, s.landmarks, s.out); rng.push(f);
          if (rec && !rec.add(now / 1000, t => ({ ...f, t: Math.round(t * 1e5) / 1e5 }))) { record(false); say(T('The recording is full ({t}) – it was kept.', { t: clock(R.MAX_SECONDS) })); }
        }
        frames = shown = rng.tail(WINDOW); t1 = now / 1000;     // time runs on: when nothing comes, the curves end and the gap grows
      }
      if (open && now - lastDraw >= 30) {
        lastDraw = now;
        const f = shown.length && (player || now / 1000 - shown[shown.length - 1].t < 0.5) ? shown[shown.length - 1] : null;
        drawCam(shown, !!f); drawOut(now); drawFingers(f ? shown : []); drawCurves(frames, t1, cursor, marks);
        const g = f && f.g ? T('{g} · {p} % sure', { g: label('g.' + f.g), p: Math.round(f.gc * 100) }) : T('no gesture');
        if (gestTxt.textContent !== g) gestTxt.textContent = g;
        drawTune(rowsNow()); drawTuneCurve(f);
        if (now - lastVals > 200) {
          lastVals = now; mode(); camLine(shown, f); drawSources(f, liveSrc);
          const i = k => keys.indexOf(k), pc = v => Math.round(v * 100) + ' %', det = detect(), why = fingerWhy(det);
          if (det && document.activeElement !== finOn) finOn.checked = !!det.fingers;
          finOn.disabled = !!player || !opts.setFingers || (!!det && det.kind !== 'hand');
          finVals.textContent = why || !f ? why : ['l', 'r'].map(hd => (f.c[i(hd + '.palm')] > 0
            ? `${hd === 'l' ? T('Left hand') : T('Right hand')}: ${label('palm')} ${pc(f.v[i(hd + '.palm')])} · ${label('spread')} ${pc(f.v[i(hd + '.spread')])}${f.v[i(hd + '.pinch')] > 0.5 ? ' · ' + label('pinch') : ''}${f.v[i(hd + '.snap')] > 0.3 ? ' · ' + label('snap') : ''} (${pc(f.c[i(hd + '.palm')])})`
            : `${hd === 'l' ? T('Left hand') : T('Right hand')}: ${player ? T('lost') : T('no hand in the picture')}`)).join('\n');
        }
        if (player) {
          if (document.activeElement !== seek) seek.value = player.pos;
          timeTxt.textContent = `${clock(player.pos)} / ${clock(player.seconds)}`; playBtn.textContent = player.playing ? '⏸' : '▶'; drawBand();
        }
      }
    }
    function show(on = !open) {
      if (on === open) return;
      open = on; box.hidden = !on;
      if (on) { secsIn.value = opts.secs(); secsVal.textContent = T('{n} s', { n: secsIn.value }); drawnRows = ''; mode(); refresh(); loop(); }
      else { live(); if (!rec) rng.clear(); }
      state();
    }

    return { show, record, feedback, refresh, get open() { return open; }, get active() { return active(); }, get recording() { return !!rec; }, get playing() { return !!player; },
      // a wristband's one button: one press "good", two right after each other "bad"
      button() { if (!active() || player) return; const v = press.press(performance.now() / 1000); if (v) feedback(v, 'button'); },
      // what was said into the microphone while the lab is open
      voice(text) { const v = R.verdict(text, words()); if (v) feedback(v, 'voice'); else say(T('“{t}” – say “good” or “bad”.', { t: String(text).slice(0, 40) })); },
      secs(v) { if (document.activeElement !== secsIn) { secsIn.value = v; secsVal.textContent = T('{n} s', { n: Math.round(v) }); } } };
  }

  const api = { mount, tune, clock, origin, fingerWhy, lostSpans };
  if (node) module.exports = api;
  else root.DanceLab = api;
})(typeof window !== 'undefined' ? window : globalThis);
