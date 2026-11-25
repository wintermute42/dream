/* Dream – teaching Dream a movement (#236, #265): moves of one's own, and how exactly a movement is recognised.

   A part of the page of Dream Dance (static/dance.html – it reads the stage through the bridge of the window that
   opened it). The wizard, repeatable for every movement:
   1. choose the movement – a built-in gesture, one of your own, or a new one;
   2. show it five times (a new one: Dream counts down, takes the hands' way and finds the repetitions by itself –
      dancemoves.js –, each shown as a small skeleton that runs round; one that went wrong is thrown away; with a name
      it is kept on this Mac: dancemoves.py, trajectories and skeleton points, never a camera picture);
   3. dance freely for 30 seconds without it (the counter-check: what is no such movement);
   4. dance with and without it: every hit flashes, and you say 👍 "recognised right" or 👎 "recognised wrongly"
      (buttons or the keys G and B);
   5. the result: dots for hits and false alarms, and the tolerance Dream chose from them (tight, normal, loose) –
      [Keep] puts it on the accent with that movement (a new move becomes an accent), [Another round] starts again.
   While it teaches, the detection takes the movement loosely (every candidate counts – the dancer says which were right).
   The quick way (a new sentence by showing it, danceslots.js) takes three repetitions and keeps the move at once.
   The list shows every move of one's own with its looping skeleton, its name (change it there), the piece of prompt it
   brings along (for the old table's target "Prompt piece of the move"), how sure Dream is of it right now, and the
   button to delete it (its accents go with it).

   `take` (a take in the making), `spans`, `moveFile`, `why`, `bounds`, `episodes` and `pickTolerance` are pure
   (tests/js/moveteach.test.mjs). Looks: moveteach.css – only transform and opacity move. A global `MoveTeach`. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const R = node ? require('./dancerec.js') : root.DreamDanceRec, MV = node ? require('./dancemoves.js') : root.DreamMoves;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const FORMAT = 'dream-dance-move', VERSION = 1;
  const MV_MAX = 24;                                   // as many moves as Dream keeps (dancemoves.py)
  const COUNT = 3, MAX_TAKE = 12;                      // seconds: the countdown, and the longest take
  const r4 = x => Math.round(x * 10000) / 10000, r5 = x => Math.round(x * 100000) / 100000;
  const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N}_ .+-]{0,31}$/u;

  // ---------- a take in the making ----------
  // add(live, clutch): one frame of the stage ({rec, input, landmarks, out} – the lab's `live`) joins the take, at most
  // RATE a second and MAX_TAKE seconds long (then it answers false). What is kept per frame: the session frame of
  // dancerec.js, the hands in body units (`u`) and whether the clutch was engaged (`k`).
  function take(keys) {
    const frames = [], samples = []; let t0 = null, last = -1;
    return {
      add(live, clutch) {
        const rec = live && live.rec; if (!rec || !Number.isFinite(rec.t)) return true;
        if (t0 == null) t0 = rec.t;
        const t = rec.t - t0;
        if (t > MAX_TAKE) return false;
        if (t - last < 1 / R.RATE - 1e-3) return true;
        last = t;
        const h = rec.hands || {}, u = [...(h.l || [null, null]), ...(h.r || [null, null])];
        frames.push({ ...R.pack(t, keys, rec, live.input, live.landmarks, live.out), u, k: clutch ? 1 : 0 });
        samples.push({ t, l: h.l || null, r: h.r || null });
        return true;
      },
      get seconds() { return frames.length ? frames[frames.length - 1].t : 0; }, get frames() { return frames; },
      // the repetitions found in it so far (dancemoves.js `segment`), and the grid they were found on
      look() { const g = MV.grid(samples); return { g, seg: MV.segment(g) }; },
    };
  }
  // The frames of each repetition, their time starting at 0: [[frame, …], …] for [{t0, t1}, …]
  const spans = (frames, reps) => reps.map(r => frames.filter(f => f.t >= r.t0 - 1e-9 && f.t < r.t1 - 1e-9).map(f => ({ ...f, t: r5(Math.max(0, f.t - r.t0)) })));
  // What is sent to Dream to be kept: the name, the piece of prompt, the template and the repetitions
  const moveFile = (name, piece, tpl, reps, keys, aspect = 16 / 9) => ({ format: FORMAT, version: VERSION, name, piece: piece || '', rate: R.RATE, aspect: r4(aspect), keys, tpl,
    reps: reps.map(frames => ({ frames })) });

  // ---------- how exactly a movement is recognised ----------
  // The peaks of how sure the detection was of a movement: series [how sure, frame by frame] → [the highest value of
  // every stretch above `hi` (it ends below `lo`)] – one per time Dream took it for the movement.
  function episodes(series, hi = 0.3, lo = 0.2) {
    const out = []; let top = null;
    for (const c of series || []) {
      if (!Number.isFinite(c)) continue;
      if (top == null) { if (c >= hi) top = c; continue; }
      top = Math.max(top, c);
      if (c < lo) { out.push(top); top = null; }
    }
    if (top != null) out.push(top);
    return out;
  }
  // The tolerance that fits what the dancer showed: good – the peaks of the times the movement was done (the five
  // showings, the hits confirmed with 👍), bad – the peaks of the times it was not (the counter-check, the hits marked
  // 👎); levels: {tight, normal, loose} → how sure the detection must be (dance.js TOL). The loosest one without a false
  // alarm, else the one with the fewest. → {tol, hits, misses, alarms} at that tolerance.
  function pickTolerance(good, bad, levels) {
    const at = tol => ({ tol, hits: good.filter(p => p >= levels[tol]).length, misses: good.filter(p => p < levels[tol]).length, alarms: bad.filter(p => p >= levels[tol]).length });
    const all = ['loose', 'normal', 'tight'].map(at);
    return all.find(r => r.alarms === 0) || all.reduce((a, r) => (r.alarms < a.alarms ? r : a));
  }
  // Why a take did not become a move, in words
  const WHY = {
    short: () => T('That was too short – show the move at least three times in a row.'),
    nohands: () => T('Your hands were not seen through the take – is the detection running, and are the hands you use in the picture?'),
    small: () => T('Hardly any movement was seen – make the move larger.'),
    norhythm: () => T('No repetition found – show the same move several times in a row, in an even tempo (one repetition in a third of a second to a good second).'),
    few: seg => T('Only {n} repetitions found – show it at least 3 times.', { n: seg.count }),
  };
  const why = seg => { switch (seg.why) { case 'short': return WHY.short(); case 'nohands': return WHY.nohands(); case 'small': return WHY.small(); case 'few': return WHY.few(seg); default: return WHY.norhythm(); } };

  // ---------- drawing: one repetition as a small skeleton that runs round ----------
  // What is to be seen of a repetition, fitted into a square: the box around every point of it. frames: session frames.
  function bounds(frames, aspect) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const see = p => { if (!p) return; const x = p[0] * aspect; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
    for (const f of frames) {
      const b = R.body(f) || [];
      b.slice(0, 9).forEach(see); see(R.wrist(f, 'l')); see(R.wrist(f, 'r'));
      if (b.length > 2) see([b[0][0], b[0][1] - 0.35 * Math.hypot((b[1][0] - b[2][0]) * aspect, b[1][1] - b[2][1])]);   // room for the head
    }
    if (!(x1 >= x0)) return null;
    const side = Math.max(x1 - x0, y1 - y0, 0.02) * 1.16;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, side };
  }
  // c: a 2D context; s: the square's side in CSS pixels; frames: the repetition; pos: 0 … 1 through it; cols: {l, r}
  function drawRep(c, s, frames, box, aspect, pos, cols, text) {
    c.clearRect(0, 0, s, s);
    if (!box || !frames.length) return;
    const P = p => [s / 2 + (p[0] * aspect - box.cx) / box.side * s, s / 2 + (p[1] - box.cy) / box.side * s];
    c.lineCap = c.lineJoin = 'round';
    for (const h of ['l', 'r']) {                      // the hand's whole way, closed: the move at a glance
      const way = frames.map(f => R.wrist(f, h)).filter(Boolean);
      if (way.length < 2) continue;
      c.strokeStyle = cols[h]; c.globalAlpha = 0.55; c.lineWidth = 2; c.beginPath();
      way.forEach((p, i) => (i ? c.lineTo(...P(p)) : c.moveTo(...P(p)))); c.closePath(); c.stroke();
    }
    const f = frames[Math.min(frames.length - 1, Math.floor(clamp(pos, 0, 0.9999) * frames.length))], b = R.body(f);
    c.globalAlpha = 1;
    if (b) {
      c.strokeStyle = text; c.lineWidth = 2; c.beginPath();
      for (const [a, e] of R.BONES) { if (a > 8 || e > 8) continue; c.moveTo(...P(b[a])); c.lineTo(...P(b[e])); }   // down to the hips: the legs do not belong to the move
      const neck = [(b[1][0] + b[2][0]) / 2, (b[1][1] + b[2][1]) / 2]; c.moveTo(...P(neck)); c.lineTo(...P(b[0])); c.stroke();
      c.beginPath(); c.arc(...P(b[0]), Math.max(3, Math.hypot((b[1][0] - b[2][0]) * aspect, b[1][1] - b[2][1]) / box.side * s * 0.3), 0, 7); c.stroke();
    }
    for (const h of ['l', 'r']) { const w = R.wrist(f, h); if (w) { c.fillStyle = cols[h]; c.beginPath(); c.arc(...P(w), 4.5, 0, 7); c.fill(); } }
  }

  // opts: {keys, fxNames, live() → the lab's live frame (for a take), sure() → {g: {gesture: how sure}, gesture} – what the
  //        detection says right now, moves() → [{id, name, piece}], clutch() → engaged?, colours(),
  //        changed() – a move was kept, renamed or deleted, levels() → {tight, normal, loose} (dance.js TOL),
  //        probe(name | null) – the detection takes this gesture loosely while it teaches, gestures – the built-in ones,
  //        pictogram(src) → svg (danceslots.js), keep({src, tol, fx, fresh}) – put what was taught on an accent}
  function mount(box, opts) {
    const { keys, fxNames = {} } = opts, label = n => (root.DancePanel ? root.DancePanel.label(n, fxNames) : n);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const btn = (text, title, cls = '') => { const b = el('button', 'btn ' + cls, text); b.type = 'button'; if (title) b.title = title; return b; };
    const css = getComputedStyle(document.documentElement), TEXT = css.getPropertyValue('--text').trim() || '#fff';
    const HAND_COL = { cyan: '#35e6f0', magenta: '#f040dc', green: '#59e06a', blue: '#5b8cff' };
    const cols = () => { const c = (opts.colours && opts.colours()) || {}; return { l: HAND_COL[c.l] || HAND_COL.cyan, r: HAND_COL[c.r] || HAND_COL.magenta }; };
    const calm = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const api = opts.api || {
      get: id => fetch('/dance/moves/' + id).then(r => (r.ok ? r.json() : null)),
      add: m => fetch('/dance/moves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).then(r => r.json()),
      change: (id, what) => fetch('/dance/moves/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(what) }).then(r => r.json()),
      del: id => fetch('/dance/moves/' + id, { method: 'DELETE' }).then(r => r.ok),
    };
    const nameOf = src => { if (w && w.name && src === w.src) return w.name;
       const m = src.startsWith('g.') && opts.moves().find(x => x.id === src.slice(2)); return m ? m.name : label(src); };
    const probe = name => { try { opts.probe(name); } catch (e) { /* the stage is reloading */ } };

    box.classList.add('mt'); box.setAttribute('role', 'region'); box.setAttribute('aria-label', T('Teaching and your moves')); box.textContent = '';
    const head = el('header', 'mt-head'), title = el('h2', '', T('🕺 Your moves'));
    const state = el('div', 'mt-state'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
    head.append(title);
    // ---- the wizard ----
    const wiz = el('div', 'mt-wiz'); wiz.hidden = true; wiz.setAttribute('role', 'region'); wiz.setAttribute('aria-label', T('Teach a movement'));
    const STEPS = [T('1 · Choose'), T('2 · Show it 5×'), T('3 · Counter-check'), T('4 · Check'), T('5 · Result')];
    const stepBar = el('ol', 'mt-steps'); STEPS.forEach(t => stepBar.append(el('li', '', t)));
    const big = el('div', 'mt-big'), small = el('div', 'mt-say'), bar = el('div', 'mt-bar'), barFill = el('i');
    bar.setAttribute('aria-hidden', 'true'); bar.append(barFill); small.setAttribute('aria-live', 'polite');
    const pane = el('div', 'mt-pane'), btns = el('div', 'btns mt-btns'), closeBtn = btn('✕', T('Stop teaching (Esc) – a move not kept yet is thrown away'), 'mt-x mt-close');
    closeBtn.setAttribute('aria-label', T('Stop teaching'));
    wiz.append(closeBtn, stepBar, big, small, bar, pane, btns);
    // ---- the list ----
    const list = el('ul', 'mt-list'); list.setAttribute('aria-label', T('The moves you taught'));
    const hint = el('div', 'hint', T('A move is a rhythmic movement of your hands, shown a few times in a row (one repetition in a third of a second to a good second). Dream keeps its way as numbers on this Mac – never a camera picture – and recognises it like a built-in gesture. It becomes an accent: “When I dance “…” → …”. The prompt piece is blended in when the old table lets the move steer “Prompt piece of the move”.'));
    box.append(head, state, wiz, list, hint);

    // ---------- the wizard's state ----------
    let w = null, phase = 'idle', raf = 0, lastDraw = 0, listKey = '', busy = false;
    const say = text => { if (state.textContent !== text) state.textContent = text; };
    const items = new Map();
    function show(p, step, bigText, smallText) {
      phase = p; wiz.hidden = p === 'idle';
      [...stepBar.children].forEach((li, k) => { li.className = k === step ? 'cur' : k < step ? 'done' : ''; if (k === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
      big.textContent = bigText || ''; small.textContent = smallText || ''; pane.textContent = ''; btns.textContent = '';
      bar.hidden = !['count', 'take', 'show', 'check'].includes(p); barFill.style.transform = 'scaleX(0)';
      box.classList.toggle('mt-taking', p === 'take' || p === 'show' || p === 'check' || p === 'test');
      big.classList.toggle('mt-huge', p === 'count');   // the countdown is read from where the dancer stands
    }
    const add = (b, focus) => { btns.append(b); if (focus) b.focus(); return b; };
    function wizard(o = {}) {
      if (phase !== 'idle' || busy) { wiz.scrollIntoView({ block: 'nearest' }); return; }
      w = { fx: o.fx || null, quick: !!o.quick, src: o.src || null, made: null, good: [], bad: [], hits: [], rounds: 0 };
      wiz.hidden = false; wiz.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
      if (o.fresh) startTake(); else if (w.src) showIt(); else choose();
    }
    function stopAll(text) {
      probe(null);
      const made = w && w.made && !w.kept ? w.made : null;
      if (made) api.del(made).then(ok => { if (ok) opts.changed(); });
      w = null; tk = null; reps = []; show('idle', -1); say(text || '');
    }
    closeBtn.onclick = () => stopAll(T('Teaching stopped – nothing changed.'));
    wiz.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); stopAll(T('Teaching stopped – nothing changed.')); } });

    // 1 · choose
    function choose() {
      show('choose', 0, T('Which movement?'), T('A built-in one, to tune how exactly Dream takes it – or a new one of your own.'));
      const grid = el('div', 'mt-choices');
      for (const src of [...(opts.gestures || []).map(g => 'g.' + g), ...opts.moves().map(m => 'g.' + m.id)]) {
        const b = el('button', 'mt-opt'); b.type = 'button';
        if (opts.pictogram) { const p = el('span', 'mt-pict'); p.innerHTML = opts.pictogram(src); b.append(p); }
        b.append(el('span', '', nameOf(src))); b.onclick = () => { w.src = src; showIt(); }; grid.append(b);
      }
      const fresh = el('button', 'mt-opt mt-optnew', T('＋ A new move of your own')); fresh.type = 'button'; fresh.onclick = startTake; grid.append(fresh);
      pane.append(grid); grid.firstChild.focus();
    }
    // 2 · show it: a known movement five times – Dream counts what it takes for it
    const SHOW = 5, SHOW_MAX = 30, CHECK = 30;
    let series = [], at = 0, hit = null;
    function showIt() {
      const name = w.src.slice(2); probe(name); series = []; at = performance.now();
      show('show', 1, T('Show “{m}” – 0 of {n}', { m: nameOf(w.src), n: SHOW }), T('Do the movement five times, with a short pause between them. Every time Dream takes it, the counter goes on.'));
      add(btn(T('Skip'), T('Go on with fewer showings')), true).onclick = check;
    }
    // 3 · the counter-check: dance freely without the movement
    function check() {
      if (phase === 'show') w.good.push(...episodes(series));
      probe(w.src.slice(2)); series = []; at = performance.now();
      show('check', 2, T('Dance freely – without “{m}”', { m: nameOf(w.src) }), T('For {n} seconds: anything but this movement. Dream counts how often it would take something else for it.', { n: CHECK }));
      add(btn(T('Skip'), T('Go on without the counter-check')), true).onclick = test;
    }
    // 4 · check every hit: recognised right or wrongly?
    function test() {
      if (phase === 'check') w.bad.push(...episodes(series));
      probe(w.src.slice(2)); hit = null; w.hits = [];
      show('test', 3, T('Dance – with and without “{m}”', { m: nameOf(w.src) }), T('Every time Dream takes it, it flashes: say whether it was right – 👍 (key G) or 👎 (key B).'));
      const dots = el('div', 'mt-dots'); dots.setAttribute('aria-label', T('The hits so far')); dots.setAttribute('role', 'img');
      const ask = el('div', 'mt-ask'); ask.hidden = true;
      const good = btn(T('👍 recognised right'), T('It was the movement (key G)'), 'mt-good'), bad = btn(T('👎 recognised wrongly'), T('I did not do it (key B)'), 'mt-bad');
      good.onclick = () => answer(true); bad.onclick = () => answer(false);
      ask.append(el('span', 'mt-asktext', T('Dream took it for “{m}” – right?', { m: nameOf(w.src) })), good, bad);
      pane.append(ask, dots);
      w.ui = { dots, ask, good };
      const done = add(btn(T('Done → result'), T('Show the result'), 'on'), true); done.onclick = result;
    }
    function answer(right) {
      if (phase !== 'test' || !w.hits.length) return;
      const h = w.hits.find(x => x.ok == null); if (!h) return;
      h.ok = right; (right ? w.good : w.bad).push(h.peak); drawDots();
      w.ui.ask.hidden = !w.hits.some(x => x.ok == null);
    }
    function drawDots() {
      const d = w.ui.dots; d.textContent = '';
      for (const h of w.hits) { const i = el('i', h.ok == null ? 'q' : h.ok ? 'y' : 'n'); d.append(i); }
      const y = w.hits.filter(h => h.ok).length, n = w.hits.filter(h => h.ok === false).length;
      d.setAttribute('aria-label', T('{y} right, {n} wrong so far', { y, n }));
    }
    // 5 · the result: the tolerance Dream chose
    function result() {
      probe(null);
      const seen = w.good.length + w.bad.length > 0, r = seen ? pickTolerance(w.good, w.bad, opts.levels()) : { tol: 'normal', hits: 0, misses: 0, alarms: 0 };
      w.result = r; w.rounds++;
      show('result', 4, T('Tolerance: {t}', { t: { tight: T('tight'), normal: T('normal'), loose: T('loose') }[r.tol] }), seen
        ? T('{h} of {g} times recognised, {a} false alarms at this tolerance.', { h: r.hits, g: r.hits + r.misses, a: r.alarms })
        : T('Nothing was recognised – the tolerance stays normal. Try another round, a little larger.'));
      const dots = el('div', 'mt-dots mt-result'); dots.setAttribute('role', 'img');
      dots.setAttribute('aria-label', T('{h} hits, {m} missed, {a} false alarms', { h: r.hits, m: r.misses, a: r.alarms }));
      for (let k = 0; k < r.hits; k++) dots.append(el('i', 'y')); for (let k = 0; k < r.misses; k++) dots.append(el('i', 'm')); for (let k = 0; k < r.alarms; k++) dots.append(el('i', 'n'));
      const legend = el('div', 'hint mt-legend');
      for (const [cls, text] of [['y', T('hit')], ['m', T('missed')], ['n', T('false alarm')]]) { const i = el('i', cls); i.setAttribute('aria-hidden', 'true'); legend.append(i, el('span', '', text)); }
      pane.append(dots, legend);
      add(btn(T('Keep'), T('Use this tolerance for the accent with this movement'), 'on'), true).onclick = keepIt;
      add(btn(T('Another round'), T('Show, check and confirm once more – the more rounds, the more exactly Dream knows it'))).onclick = () => (w.made ? check() : showIt());
    }
    function keepIt() {
      const { src, fx } = w, tol = w.result.tol, fresh = !!w.made, name = w.name || nameOf(src);
      w.kept = true; probe(null);
      try { opts.keep({ src, tol, fx, fresh }); } catch (e) { /* the page is gone */ }
      w = null; show('idle', -1);
      say(fresh ? T('“{n}” is kept and is an accent now – engage the clutch and dance it.', { n: name }) : T('“{n}” is taken {t} from now on.', { n: name, t: { tight: T('tight'), normal: T('normal'), loose: T('loose') }[tol] }));
    }

    // 2 · a new move: count down, take, look at the repetitions, name it
    let countAt = 0, tk = null, found = null, reps = [], lookAt = 0;
    const aspect = () => { const f = tk && tk.frames[0]; return (f && f.i.a) || 16 / 9; };
    const want = () => (w && w.quick ? MV.MIN_REPS : MV.MAX_REPS);
    function startTake() {
      if (opts.moves().length >= MV_MAX) { stopAll(T('Too many moves are kept – delete one first.')); return; }
      tk = take(keys); found = null; reps = []; countAt = performance.now();
      show('count', 1, String(COUNT), T('Get ready: then show your move {n} times in a row.', { n: want() }));
      add(btn(T('Throw away'), T('Throw this take away (key Esc)')), true).onclick = () => stopAll(T('Thrown away – nothing kept.'));
    }
    function stopTake() {
      if (phase !== 'take') return;
      const { g, seg } = tk.look();
      if (seg.why) { stopAll(why(seg)); return; }
      const fr = spans(tk.frames, seg.reps);
      found = { g, seg }; reps = seg.reps.map((r, i) => ({ span: r, frames: fr[i], box: bounds(fr[i], aspect()), cv: null }));
      show('review', 1, T('{n} repetitions', { n: reps.length }), '');
      const repList = el('ul', 'mt-reps'); repList.setAttribute('aria-label', T('The repetitions of this take'));
      const nameIn = el('input'), field = el('label', 'mt-field'); nameIn.type = 'text'; nameIn.maxLength = 32; nameIn.placeholder = T('e.g. Lasso'); nameIn.autocomplete = 'off'; nameIn.id = 'mt-name';
      field.htmlFor = 'mt-name'; field.append(el('span', '', T('Name of the move')), nameIn);
      pane.append(repList, field);
      const next = add(btn(w.quick ? T('Keep the move') : T('Keep and go on →'), T('Keep this move on this Mac – numbers only, no camera picture'), 'on'));
      add(btn(T('Throw away'), T('Throw this take away'))).onclick = () => stopAll(T('Thrown away – nothing kept.'));
      const review = () => {
        const enough = reps.length >= MV.MIN_REPS; next.disabled = !enough || busy;
        small.textContent = enough ? T('{n} repetitions taken (one lasts {s} s). Throw away one that went wrong, give the move a name.', { n: reps.length, s: found.seg.period.toFixed(2) })
          : T('Only {n} repetitions are left – a move needs at least 3. Throw the take away and show it again.', { n: reps.length });
      };
      const drawReps = () => {
        repList.textContent = '';
        reps.forEach((r, i) => {
          const li = el('li', 'mt-rep'), cv = el('canvas', 'mt-cv'), cap = el('span', '', T('Repetition {n}', { n: i + 1 })), x = btn('✕', T('Throw this repetition away'), 'mt-x');
          cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', T('Repetition {n} as a skeleton that runs round', { n: i + 1 })); x.setAttribute('aria-label', T('Throw repetition {n} away', { n: i + 1 }));
          x.onclick = () => { reps.splice(reps.indexOf(r), 1); drawReps(); review(); (repList.querySelector('.mt-x') || nameIn).focus(); };
          r.cv = cv; li.append(cv, cap, x); repList.append(li);
        });
      };
      drawReps(); review(); nameIn.focus();
      const keep = async () => {
        if (busy || reps.length < MV.MIN_REPS) return;
        const name = nameIn.value.trim().replace(/\s+/g, ' ');
        if (!NAME_OK.test(name)) { small.textContent = T('A name: letters, digits, spaces and . + - , at most 32 characters.'); nameIn.focus(); return; }
        const tpl = MV.template(found.g, reps.map(r => r.span), found.seg.hands);
        if (!tpl) { small.textContent = WHY.small(); return; }
        busy = true; next.disabled = true;
        let r = null; try { r = await api.add(moveFile(name, '', tpl, reps.map(x => x.frames), keys, aspect())); } catch (e) { r = null; }
        busy = false;
        if (!w) return;
        if (!r || !r.id) { next.disabled = false; small.textContent = (r && r.error) || T('Could not be kept.'); return; }
        w.made = r.id; w.src = 'g.' + r.id; w.name = name; opts.changed(); tk = null;
        if (w.quick) { w.result = { tol: 'normal' }; keepIt(); return; }
        setTimeout(() => { if (w && phase === 'review') check(); }, 150);   // the stage knows the move by then
      };
      next.onclick = keep; nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') keep(); });
    }
    addEventListener('keydown', e => {
      if (phase !== 'test' || e.metaKey || e.ctrlKey || e.altKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'g') { e.preventDefault(); answer(true); } else if (k === 'b') { e.preventDefault(); answer(false); }
    });

    // ---------- the list of moves ----------
    function drawList(moves) {
      const keepFocus = document.activeElement && list.contains(document.activeElement) ? [document.activeElement.closest('li').dataset.id, document.activeElement.dataset.part] : null;
      for (const id of [...items.keys()]) if (!moves.some(m => m.id === id)) { items.get(id).li.remove(); items.delete(id); }
      if (!moves.length && !list.querySelector('.mt-none')) list.append(el('li', 'mt-none', T('No move of your own yet – “🎓 Teach a movement …” above, or “＋ A move of your own …” in the accents.')));
      if (moves.length && list.querySelector('.mt-none')) list.querySelector('.mt-none').remove();
      for (const m of moves) {
        let it = items.get(m.id);
        if (!it) {
          const li = el('li', 'mt-move'), cv = el('canvas', 'mt-cv'), body = el('div', 'mt-body'), name = el('input'), piece = el('input'), meter = el('span', 'mt-meter'), fill = el('i');
          const tune = btn(T('🎓 Tune'), T('Teach Dream this move more exactly'), 'mt-tune'), del = btn('🗑', T('Delete this move'), 'mt-del');
          li.dataset.id = m.id; cv.setAttribute('role', 'img'); meter.setAttribute('aria-hidden', 'true'); meter.append(fill);
          name.type = piece.type = 'text'; name.maxLength = 32; piece.maxLength = 80; piece.placeholder = T('Prompt piece, e.g. fire'); name.autocomplete = piece.autocomplete = 'off';
          name.dataset.part = 'name'; piece.dataset.part = 'piece'; del.dataset.part = 'del'; tune.dataset.part = 'tune';
          it = { li, cv, fill, name, piece, del, tune, frames: null, box: null, asked: false, m: null };
          const send = what => api.change(m.id, what).then(r => { if (r && r.id) { opts.changed(); say(T('Saved.')); } else say((r && r.error) || T('Could not be kept.')); }).catch(() => say(T('Could not be kept.')));
          name.onchange = () => { const v = name.value.trim().replace(/\s+/g, ' '); if (!NAME_OK.test(v)) { say(T('A name: letters, digits, spaces and . + - , at most 32 characters.')); name.value = it.m.name; return; } send({ name: v }); };
          piece.onchange = () => send({ piece: piece.value.trim().replace(/\s+/g, ' ') });
          tune.onclick = () => wizard({ src: 'g.' + m.id });
          del.onclick = () => {                           // asks once more on the button itself – no dialog in the way
            if (del.dataset.sure) { api.del(m.id).then(ok => { if (ok) { opts.changed(); say(T('“{n}” deleted – its accents are empty now.', { n: it.m.name })); } }); return; }
            del.dataset.sure = '1'; del.textContent = T('Really delete?'); setTimeout(() => { delete del.dataset.sure; del.textContent = '🗑'; }, 3000);
          };
          body.append(name, piece); li.append(cv, body, meter, tune, del); list.append(li); items.set(m.id, it);
        }
        it.m = m;
        const set = (i, v) => { if (document.activeElement !== i && i.value !== v) i.value = v; };
        set(it.name, m.name); set(it.piece, m.piece || '');
        it.name.setAttribute('aria-label', T('Name of the move “{n}”', { n: m.name }));
        it.piece.setAttribute('aria-label', T('Prompt piece of “{n}”', { n: m.name })); it.del.setAttribute('aria-label', T('Delete the move “{n}”', { n: m.name }));
        it.tune.setAttribute('aria-label', T('Tune the move “{n}”', { n: m.name }));
        it.cv.setAttribute('aria-label', T('“{n}”: one repetition as a skeleton that runs round, the hands’ ways in colour', { n: m.name }));
        if (!it.asked) { it.asked = true; api.get(m.id).then(file => { const fr = file && Array.isArray(file.reps) && file.reps[0] && file.reps[0].frames; if (Array.isArray(fr) && fr.length) { it.frames = fr; it.aspect = file.aspect || 16 / 9; it.box = bounds(fr, it.aspect); it.still = false; } }).catch(() => { it.asked = false; }); }
      }
      if (keepFocus) { const again = list.querySelector(`[data-id="${keepFocus[0]}"] [data-part="${keepFocus[1]}"]`); if (again) again.focus(); }
    }
    function fit(cv) {                                   // a square canvas, no finer than twice the CSS pixels
      const s = cv.clientWidth; if (!s) return null;
      const dpr = Math.min(2, root.devicePixelRatio || 1), px = Math.round(s * dpr);
      if (cv.width !== px || cv.height !== px) { cv.width = cv.height = px; }
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, s];
    }

    // ---------- the loop: the wizard, the previews, the list ----------
    function tick(now) {
      raf = requestAnimationFrame(tick);
      let live = null, rec = null;
      try { if (phase === 'take') live = opts.live(); rec = opts.sure(); } catch (e) { rec = null; }
      if (phase === 'count') {
        const left = COUNT - (now - countAt) / 1000;
        big.textContent = String(Math.max(1, Math.ceil(left))); barFill.style.transform = `scaleX(${clamp(1 - left / COUNT, 0, 1).toFixed(3)})`;
        if (left <= 0) { phase = 'take'; box.classList.add('mt-taking'); lookAt = now; big.textContent = T('Show it now'); small.textContent = T('The take runs – it ends by itself.'); }
      } else if (phase === 'take') {
        const room = tk.add(live, !!opts.clutch());
        barFill.style.transform = `scaleX(${clamp(tk.seconds / MAX_TAKE, 0, 1).toFixed(3)})`;
        if (now - lookAt > 400) {                        // how many repetitions so far – and enough of them ends the take
          lookAt = now; const { seg } = tk.look(), n = seg.why ? (seg.why === 'few' ? seg.count : 0) : seg.count;
          big.textContent = n ? T('{n} × seen', { n: Math.min(n, want()) }) : T('Show it now');
          if (n > want()) { stopTake(); return; }
        }
        if (!room) stopTake();
      } else if (phase === 'show' || phase === 'check') {
        const name = w.src.slice(2), c = rec && rec.g && Number.isFinite(rec.g[name]) ? rec.g[name] : 0;
        series.push(c);
        const secs = (now - at) / 1000;
        if (phase === 'show') {
          const n = episodes(series).length;
          big.textContent = T('Show “{m}” – {k} of {n}', { m: nameOf(w.src), k: Math.min(n, SHOW), n: SHOW });
          barFill.style.transform = `scaleX(${clamp(n / SHOW, 0, 1).toFixed(3)})`;
          if ((n >= SHOW && c < 0.2) || secs > SHOW_MAX) check();
        } else {
          barFill.style.transform = `scaleX(${clamp(secs / CHECK, 0, 1).toFixed(3)})`;
          const n = episodes(series).length, txt = T('{s} s left · taken for it {n}×', { s: Math.max(0, Math.ceil(CHECK - secs)), n });
          if (small.textContent !== txt) small.textContent = txt;
          if (secs >= CHECK) test();
        }
      } else if (phase === 'test' && rec) {
        const name = w.src.slice(2), c = rec.g && Number.isFinite(rec.g[name]) ? rec.g[name] : 0;
        if (rec.gesture === name && !hit) { hit = { peak: c, ok: null }; w.hits.push(hit); drawDots(); w.ui.ask.hidden = false; w.ui.dots.lastChild.classList.add('go'); }
        if (hit) { hit.peak = Math.max(hit.peak, c); if (rec.gesture !== name) hit = null; }
      }
      if (now - lastDraw < 45 || document.hidden) return;
      lastDraw = now;
      const moves = opts.moves(), key = JSON.stringify(moves.map(m => [m.id, m.name, m.piece]));
      if (key !== listKey) { listKey = key; drawList(moves); }
      const col = cols();
      if (phase === 'review') for (const r of reps) { const g = r.cv && fit(r.cv); if (g) drawRep(g[0], g[1], r.frames, r.box, aspect(), calm ? 0 : (now / 1000 / Math.max(0.3, found.seg.period)) % 1, col, TEXT); }
      for (const [id, it] of items) {
        const sure = rec && rec.g && Number.isFinite(rec.g[id]) ? rec.g[id] : 0, on = !!rec && rec.gesture === id;
        it.fill.style.transform = `scaleX(${clamp(sure, 0, 1).toFixed(2)})`; if (it.li.classList.contains('mt-on') !== on) it.li.classList.toggle('mt-on', on);
        if (!it.frames || (calm && it.still)) continue;
        const g = fit(it.cv); if (!g) continue;
        const secs = Math.max(0.3, it.frames[it.frames.length - 1].t + 1 / R.RATE);
        drawRep(g[0], g[1], it.frames, it.box, it.aspect, calm ? 0 : (now / 1000 / secs) % 1, col, TEXT); it.still = true;
      }
    }
    show('idle', -1); raf = requestAnimationFrame(tick);
    return { wizard, cancel: () => { if (phase !== 'idle') stopAll(T('Teaching stopped – nothing changed.')); }, get phase() { return phase; }, stop: () => cancelAnimationFrame(raf) };
  }

  const api = { mount, take, spans, moveFile, why, bounds, episodes, pickTolerance, FORMAT, VERSION, COUNT, MAX_TAKE };
  if (node) module.exports = api;
  else root.MoveTeach = api;
})(typeof window !== 'undefined' ? window : globalThis);
