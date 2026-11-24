/* Dream – moves of one's own (#236): teach Dream a dance move by showing it, and say what it does.

   A part of the page of Dream Dance (static/dance.html – it reads the stage through the bridge of the window that
   opened it). "Teach a new move" counts down, then takes the hands' way while the dancer shows the move three to five
   times; the repetitions are found by themselves (dancemoves.js) and shown at once, each as a small skeleton that runs
   round and round – one that went wrong can be thrown away. With a name it is kept on this Mac (dancemoves.py:
   trajectories and skeleton points, never a camera picture), and the stage recognises it from then on like a built-in
   gesture. The list below shows every move with its looping skeleton, its name (change it there), what it steers –
   that is a row of the mapping table, like everything a movement does –, the piece of prompt it brings along, how
   sure Dream is of it right now, and the button to delete it.

   `take` (a take in the making), `spans`, `moveFile`, `assign` and `targetOf` are pure (tests/js/moveteach.test.mjs).
   Looks: moveteach.css – only transform and opacity move. A global `MoveTeach`. */
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
  let mounted = 0;
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

  // ---------- what a move steers: a row of the mapping table ----------
  const srcOf = id => 'g.' + id;
  // the target of the move's first row ('' – it steers nothing in this table)
  const targetOf = (rows, id) => { const r = rows.find(x => x.src === srcOf(id)); return r ? r.dst : ''; };
  // the table after the move was given a target: '' removes its rows, a target changes its first row or adds one –
  // a row like a built-in gesture's (the size of the movement is its strength), marked as taught
  function assign(rows, id, dst) {
    const src = srcOf(id), mine = rows.find(r => r.src === src);
    if (!dst) return rows.filter(r => r.src !== src);
    if (mine) return rows.map(r => (r === mine ? { ...r, dst, on: true } : r));
    let rid = id, n = 1; while (rows.some(r => r.id === rid)) rid = id + '-' + (++n);
    return rows.concat({ id: rid, on: true, src, dst, curve: 'lin', in: [0, 1], out: [0, 1], smooth: 0.15, origin: 'taught' });
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

  function mount(box, opts) {
    const { keys, fxNames = {}, targets = {} } = opts, label = n => (root.DancePanel ? root.DancePanel.label(n, fxNames) : n);
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

    box.classList.add('mt'); box.setAttribute('role', 'region'); box.setAttribute('aria-label', T('Your moves')); box.textContent = '';
    const head = el('header', 'mt-head'), title = el('h2', '', T('🕺 Your moves')), teachBtn = btn(T('Teach a new move'), T('Show Dream a move of your own three to five times – it recognises it from then on (key T)'), 'mt-teachbtn');
    const state = el('div', 'mt-state'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
    head.append(title, teachBtn);
    // ---- the teaching box ----
    const teach = el('div', 'mt-teach'); teach.hidden = true;
    const big = el('div', 'mt-big'); big.setAttribute('aria-hidden', 'true');
    const bar = el('div', 'mt-bar'), barFill = el('i'); bar.setAttribute('aria-hidden', 'true'); bar.append(barFill);
    const stopBtn = btn(T('■ Done'), T('End the take (it also ends by itself)')), cancelBtn = btn(T('Throw away'), T('Throw this take away (key Esc)'));
    const repList = el('ul', 'mt-reps'); repList.setAttribute('aria-label', T('The repetitions of this take'));
    const form = el('div', 'mt-form'); form.hidden = true;
    const nameIn = el('input'), dstSel = el('select'), pieceIn = el('input'), keepBtn = btn(T('Keep the move'), T('Keep this move on this Mac – numbers only, no camera picture'), 'on');
    const uid = 'mt' + (++mounted);                  // the fields' ids, one set per card
    const field = (text, input, id) => { const l = el('label', 'mt-field'); input.id = id; l.htmlFor = id; l.append(el('span', '', text), input); return l; };
    nameIn.type = 'text'; nameIn.maxLength = 32; nameIn.placeholder = T('e.g. Lasso'); nameIn.autocomplete = 'off';
    pieceIn.type = 'text'; pieceIn.maxLength = 80; pieceIn.placeholder = T('e.g. fire, glowing embers'); pieceIn.autocomplete = 'off';
    function fillTargets(sel, value) {
      sel.textContent = '';
      const none = el('option', '', T('– nothing yet –')); none.value = ''; sel.append(none);
      for (const [g, kind] of [[T('Effects (at once)'), 'instant'], [T('AI sliders (slow)'), 'slow']]) {
        const og = document.createElement('optgroup'); og.label = g;
        for (const t of Object.keys(targets).filter(t => targets[t] === kind)) { const o = el('option', '', label(t)); o.value = t; og.append(o); }
        sel.append(og);
      }
      if (value && ![...sel.options].some(o => o.value === value)) { const o = el('option', '', label(value)); o.value = value; sel.append(o); }
      sel.value = value || '';
    }
    fillTargets(dstSel, '');
    const formBtns = el('div', 'btns'); formBtns.append(keepBtn);
    form.append(field(T('Name'), nameIn, uid + 'n'), field(T('Steers'), dstSel, uid + 'd'), field(T('Prompt piece'), pieceIn, uid + 'p'), formBtns);
    const teachBtns = el('div', 'btns'); teachBtns.append(stopBtn, cancelBtn);
    teach.append(big, bar, teachBtns, repList, form);
    // ---- the list ----
    const list = el('ul', 'mt-list'); list.setAttribute('aria-label', T('The moves you taught'));
    const hint = el('div', 'hint', T('A move is a rhythmic movement of your hands, shown three to five times in a row (one repetition in a third of a second to a good second). Dream keeps its way as numbers on this Mac – never a camera picture – and recognises it like a built-in gesture: after two to three repetitions, also a little faster, slower, larger or smaller. What it steers is a row of the table, so it acts only with the clutch engaged and belongs to the movement set you keep it in. The prompt piece is blended into the prompt when the move steers “Prompt piece of the move”.'));
    box.append(head, state, teach, list, hint);

    // ---------- state ----------
    let phase = 'idle', countAt = 0, tk = null, found = null, reps = [], lookAt = 0, raf = 0, busy = false, listKey = '', rowsKey = '', lastDraw = 0;
    const items = new Map();                           // move id → {li, cv, bar, name, dst, piece, frames, box}
    const say = text => { if (state.textContent !== text) state.textContent = text; };
    const aspect = () => { const f = tk && tk.frames[0]; return (f && f.i.a) || 16 / 9; };
    function setPhase(p) {
      phase = p; teach.hidden = p === 'idle'; teachBtn.disabled = p !== 'idle' || busy;
      stopBtn.hidden = p !== 'take'; bar.hidden = p !== 'take' && p !== 'count'; big.hidden = p === 'review'; repList.hidden = form.hidden = p !== 'review';
      box.classList.toggle('mt-taking', p === 'take');
    }
    function start() {
      if (phase !== 'idle' || busy) return;
      if (opts.moves().length >= MV_MAX) { say(T('Too many moves are kept – delete one first.')); return; }
      tk = take(keys); found = null; reps = []; countAt = performance.now(); setPhase('count');
      say(T('Get ready: the take starts in {n} seconds. Then show your move three to five times in a row.', { n: COUNT }));
      cancelBtn.focus();
    }
    function cancel(text) { const had = teach.contains(document.activeElement); tk = null; reps = []; setPhase('idle'); say(text || ''); if (had) teachBtn.focus(); }
    function stop() {
      if (phase !== 'take') return;
      const { g, seg } = tk.look();
      if (seg.why) { cancel(why(seg)); return; }
      const fr = spans(tk.frames, seg.reps);
      found = { g, seg }; reps = seg.reps.map((r, i) => ({ span: r, frames: fr[i], box: bounds(fr[i], aspect()), cv: null }));
      setPhase('review'); drawReps(); review(); nameIn.value = ''; pieceIn.value = ''; dstSel.value = '';
      nameIn.focus();
    }
    function review() {
      const enough = reps.length >= MV.MIN_REPS;
      keepBtn.disabled = !enough || busy;
      say(enough ? T('{n} repetitions taken (one lasts {s} s). Throw away one that went wrong, give the move a name and keep it.', { n: reps.length, s: found.seg.period.toFixed(2) })
        : T('Only {n} repetitions are left – a move needs at least 3. Throw the take away and show it again.', { n: reps.length }));
    }
    function drawReps() {
      repList.textContent = '';
      reps.forEach((r, i) => {
        const li = el('li', 'mt-rep'), cv = el('canvas', 'mt-cv'), cap = el('span', '', T('Repetition {n}', { n: i + 1 })), x = btn('✕', T('Throw this repetition away'), 'mt-x');
        cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', T('Repetition {n} as a skeleton that runs round', { n: i + 1 })); x.setAttribute('aria-label', T('Throw repetition {n} away', { n: i + 1 }));
        x.onclick = () => { reps.splice(reps.indexOf(r), 1); drawReps(); review(); (repList.querySelector('.mt-x') || nameIn).focus(); };
        r.cv = cv; li.append(cv, cap, x); repList.append(li);
      });
    }
    async function keep() {
      if (phase !== 'review' || busy || reps.length < MV.MIN_REPS) return;
      const name = nameIn.value.trim().replace(/\s+/g, ' '), piece = pieceIn.value.trim().replace(/\s+/g, ' '), dst = dstSel.value;
      if (!NAME_OK.test(name)) { say(T('A name: letters, digits, spaces and . + - , at most 32 characters.')); nameIn.focus(); return; }
      const tpl = MV.template(found.g, reps.map(r => r.span), found.seg.hands);
      if (!tpl) { say(WHY.small()); return; }
      busy = true; keepBtn.disabled = true;
      let r = null; try { r = await api.add(moveFile(name, piece, tpl, reps.map(x => x.frames), keys, aspect())); } catch (e) { r = null; }
      busy = false;
      if (!r || !r.id) { keepBtn.disabled = false; say((r && r.error) || T('Could not be kept.')); return; }
      if (dst) opts.setRows(assign(opts.rows(), r.id, dst));
      opts.changed();
      cancel(dst ? T('“{n}” is kept and steers “{t}”. Engage the clutch and dance it.', { n: name, t: label(dst) }) : T('“{n}” is kept. Choose below what it steers.', { n: name }));
    }
    teachBtn.onclick = start; stopBtn.onclick = stop; cancelBtn.onclick = () => cancel(T('Thrown away – nothing kept.')); keepBtn.onclick = keep;
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') keep(); });
    teach.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); cancel(T('Thrown away – nothing kept.')); } });

    // ---------- the list of moves ----------
    function drawList(moves) {
      const keepFocus = document.activeElement && list.contains(document.activeElement) ? [document.activeElement.closest('li').dataset.id, document.activeElement.dataset.part] : null;
      for (const id of [...items.keys()]) if (!moves.some(m => m.id === id)) { items.get(id).li.remove(); items.delete(id); }
      if (!moves.length && !list.querySelector('.mt-none')) list.append(el('li', 'mt-none', T('No move of your own yet. “Teach a new move” – and show it three to five times.')));
      if (moves.length && list.querySelector('.mt-none')) list.querySelector('.mt-none').remove();
      for (const m of moves) {
        let it = items.get(m.id);
        if (!it) {
          const li = el('li', 'mt-move'), cv = el('canvas', 'mt-cv'), body = el('div', 'mt-body'), name = el('input'), dst = el('select'), piece = el('input'), meter = el('span', 'mt-meter'), fill = el('i'), del = btn('🗑', T('Delete this move'), 'mt-del');
          li.dataset.id = m.id; cv.setAttribute('role', 'img'); meter.setAttribute('aria-hidden', 'true'); meter.append(fill);
          name.type = piece.type = 'text'; name.maxLength = 32; piece.maxLength = 80; piece.placeholder = T('Prompt piece, e.g. fire'); name.autocomplete = piece.autocomplete = 'off';
          name.dataset.part = 'name'; dst.dataset.part = 'dst'; piece.dataset.part = 'piece'; del.dataset.part = 'del';
          it = { li, cv, fill, name, dst, piece, del, frames: null, box: null, asked: false, m: null };
          const send = what => api.change(m.id, what).then(r => { if (r && r.id) { opts.changed(); say(T('Saved.')); } else say((r && r.error) || T('Could not be kept.')); }).catch(() => say(T('Could not be kept.')));
          name.onchange = () => { const v = name.value.trim().replace(/\s+/g, ' '); if (!NAME_OK.test(v)) { say(T('A name: letters, digits, spaces and . + - , at most 32 characters.')); name.value = it.m.name; return; } send({ name: v }); };
          piece.onchange = () => send({ piece: piece.value.trim().replace(/\s+/g, ' ') });
          dst.onchange = () => { opts.setRows(assign(opts.rows(), m.id, dst.value)); say(dst.value ? T('“{n}” steers “{t}”.', { n: it.m.name, t: label(dst.value) }) : T('“{n}” steers nothing in this table.', { n: it.m.name })); };
          del.onclick = () => {                           // asks once more on the button itself – no dialog in the way
            if (del.dataset.sure) { api.del(m.id).then(ok => { if (ok) { opts.changed(); say(T('“{n}” deleted.', { n: it.m.name })); teachBtn.focus(); } }); return; }
            del.dataset.sure = '1'; del.textContent = T('Really delete?'); setTimeout(() => { delete del.dataset.sure; del.textContent = '🗑'; }, 3000);
          };
          body.append(name, dst, piece); li.append(cv, body, meter, del); list.append(li); items.set(m.id, it);
        }
        it.m = m;
        const set = (i, v) => { if (document.activeElement !== i && i.value !== v) i.value = v; };
        set(it.name, m.name); set(it.piece, m.piece || '');
        it.name.setAttribute('aria-label', T('Name of the move “{n}”', { n: m.name })); it.dst.setAttribute('aria-label', T('What “{n}” steers', { n: m.name }));
        it.piece.setAttribute('aria-label', T('Prompt piece of “{n}”', { n: m.name })); it.del.setAttribute('aria-label', T('Delete the move “{n}”', { n: m.name }));
        it.cv.setAttribute('aria-label', T('“{n}”: one repetition as a skeleton that runs round, the hands’ ways in colour', { n: m.name }));
        if (!it.asked) { it.asked = true; api.get(m.id).then(file => { const fr = file && Array.isArray(file.reps) && file.reps[0] && file.reps[0].frames; if (Array.isArray(fr) && fr.length) { it.frames = fr; it.aspect = file.aspect || 16 / 9; it.box = bounds(fr, it.aspect); it.still = false; } }).catch(() => { it.asked = false; }); }
      }
      if (keepFocus) { const again = list.querySelector(`[data-id="${keepFocus[0]}"] [data-part="${keepFocus[1]}"]`); if (again) again.focus(); }
    }
    function drawTargets(rows) {
      for (const [id, it] of items) { const v = targetOf(rows, id); if (document.activeElement !== it.dst) fillTargets(it.dst, v); }
    }
    function fit(cv) {                                   // a square canvas, no finer than twice the CSS pixels
      const s = cv.clientWidth; if (!s) return null;
      const dpr = Math.min(2, root.devicePixelRatio || 1), px = Math.round(s * dpr);
      if (cv.width !== px || cv.height !== px) { cv.width = cv.height = px; }
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, s];
    }

    // ---------- the loop: the take, the previews, the list ----------
    function tick(now) {
      raf = requestAnimationFrame(tick);
      let live = null; try { live = opts.live(); } catch (e) { live = null; }
      if (phase === 'count') {
        const left = COUNT - (now - countAt) / 1000;
        big.textContent = String(Math.max(1, Math.ceil(left))); barFill.style.transform = `scaleX(${clamp(1 - left / COUNT, 0, 1).toFixed(3)})`;
        if (left <= 0) { setPhase('take'); lookAt = now; big.textContent = T('Show it now'); say(T('The take runs – show your move three to five times in a row. It ends by itself.')); stopBtn.focus(); }
      } else if (phase === 'take') {
        const room = tk.add(live, !!opts.clutch());
        barFill.style.transform = `scaleX(${clamp(tk.seconds / MAX_TAKE, 0, 1).toFixed(3)})`;
        if (now - lookAt > 400) {                        // how many repetitions so far – and enough of them ends the take
          lookAt = now; const { seg } = tk.look(), n = seg.why ? (seg.why === 'few' ? seg.count : 0) : seg.count;
          big.textContent = n ? T('{n} × seen', { n: Math.min(n, MV.MAX_REPS) }) : T('Show it now');
          if (n > MV.MAX_REPS) { stop(); return; }
        }
        if (!room) stop();
      }
      if (now - lastDraw < 45 || document.hidden) return;
      lastDraw = now;
      const moves = opts.moves(), key = JSON.stringify(moves.map(m => [m.id, m.name, m.piece]));
      if (key !== listKey) { listKey = key; rowsKey = ''; drawList(moves); }
      const rows = opts.rows(), rk = JSON.stringify(rows.map(r => [r.src, r.dst]));
      if (rk !== rowsKey) { rowsKey = rk; drawTargets(rows); }
      const col = cols();
      if (phase === 'review') for (const r of reps) { const g = r.cv && fit(r.cv); if (g) drawRep(g[0], g[1], r.frames, r.box, aspect(), calm ? 0 : (now / 1000 / Math.max(0.3, found.seg.period)) % 1, col, TEXT); }
      const rec = live && live.rec;
      for (const [id, it] of items) {
        const sure = rec && rec.g && Number.isFinite(rec.g[id]) ? rec.g[id] : 0, on = !!rec && rec.gesture === id;
        it.fill.style.transform = `scaleX(${clamp(sure, 0, 1).toFixed(2)})`; if (it.li.classList.contains('mt-on') !== on) it.li.classList.toggle('mt-on', on);
        if (!it.frames || (calm && it.still)) continue;
        const g = fit(it.cv); if (!g) continue;
        const secs = Math.max(0.3, it.frames[it.frames.length - 1].t + 1 / R.RATE);
        drawRep(g[0], g[1], it.frames, it.box, it.aspect, calm ? 0 : (now / 1000 / secs) % 1, col, TEXT); it.still = true;
      }
    }
    setPhase('idle'); raf = requestAnimationFrame(tick);
    return { start, cancel: () => { if (phase !== 'idle') cancel(T('Thrown away – nothing kept.')); }, get phase() { return phase; }, stop: () => cancelAnimationFrame(raf) };
  }

  const api = { mount, take, spans, moveFile, assign, targetOf, why, bounds, FORMAT, VERSION, COUNT, MAX_TAKE };
  if (node) module.exports = api;
  else root.MoveTeach = api;
})(typeof window !== 'undefined' ? window : globalThis);
