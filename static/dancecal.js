/* Dream – measuring a dancer (#266): where their calm and their wild lie, per base movement – their own measures.

   A part of the learning assistant on the page of Dream Dance (static/dance.html – it reads the stage through the
   bridge of the window that opened it). The base movements – energy, opening, hands circling, height – reach the sentences
   through ranges Dream picks for an average dancer; one dancer's calm is another's warm-up. Measuring takes about 45
   seconds, step by step, each with a countdown bar and the base movement it measures:
   1. stand still, arms hanging (your calm: energy, height and the hands at rest),
   2. dance wild (your wild: the top of your energy),
   3. arms closed and 4. arms wide open (the range of your opening),
   5. arms up high (the top of your height),
   6. circling the hands (the top of their circling).
   Beside the big words of each step a small skeleton shows what is meant – the countdown already shows the first.
   While Dream does not see the dancer, the step waits. The result shows per base movement the standard range and
   yours on one bar, with a dot where you are right now and how far that is between your calm (0 %) and your wild
   (100 %); [Keep] keeps it under the dancer's name (danceprofiles.py – numbers only), in use from now on. The profiles
   are a row of chips above: "Standard measures" brings the built-in ranges back at any time. The engine reads the
   dance through the profile in use (dancemap.js `calibrate`), on the stage – not only on this page.

   `STEPS`, `figure`, `take`, `quantile`, `bounds`, `percent` and `nameProblem` are pure (tests/js/dancecal.test.mjs). Looks: the
   learning assistant's (moveteach.css) and dancecal.css – only transform and opacity move. A global `DanceCal`. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const FEATURES = ['energy', 'open', 'turn', 'height'];   // the base movements (dance.py BASE_SOURCES)
  const RATE = 30;                                     // samples a second that are kept of a step
  const SETTLE = 1.5;                                  // seconds at a step's start to get there – not measured
  const COUNT = 3;                                     // seconds of the countdown before the first step
  const MIN_N = 12;                                    // samples a bound needs (less: the standard stays)
  const SURE = 0.25;                                   // how sure the stream must be of a value to count it (dancemap.js)
  const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N}_ .+\-–]{0,31}$/u;   // danceprofiles.py NAME (settings.SET_NAME)
  // The steps: the words, how long, and what each one measures – [base movement, its lower ('lo') or upper ('hi')
  // bound, the quantile of what the step saw]. A calm bound reads high in the calm (a twitch is still calm), a wild one
  // a little below the top (100 % is reached without the one wildest moment); a held pose is its middle.
  const STEPS = [
    { k: 'calm', secs: 10, say: () => T('Stand still – arms hanging loosely'), sub: () => T('Your calm: whatever you do now is 0 %.'),
      takes: [['energy', 'lo', 0.8], ['height', 'lo', 0.5], ['turn', 'lo', 0.8]] },
    { k: 'wild', secs: 10, say: () => T('Dance wild!'), sub: () => T('As wild as you dance in a show – that is your 100 %.'), takes: [['energy', 'hi', 0.85]] },
    { k: 'closed', secs: 5, say: () => T('Arms closed – hands together in front of you'), sub: () => T('Your arms fully closed.'), takes: [['open', 'lo', 0.5]] },
    { k: 'open', secs: 5, say: () => T('Arms wide open'), sub: () => T('Your arms fully open.'), takes: [['open', 'hi', 0.5]] },
    { k: 'up', secs: 5, say: () => T('Arms up high'), sub: () => T('As high as your arms go.'), takes: [['height', 'hi', 0.5]] },
    { k: 'turn', secs: 8, say: () => T('Circle your hands'), sub: () => T('As big and as fast as your hands circle in your dance – that is your 100 %.'),
      takes: [['turn', 'hi', 0.9]] },
  ];
  const r3 = x => Math.round(x * 1000) / 1000;

  // ---------- the demo figure: a small skeleton that shows each step (dancecal.css moves it) ----------
  // Its arms are an upper arm and a forearm hanging from the shoulder; the right one is the left one mirrored, so one
  // rotation per pose serves both. The signs (arrows, motion lines) show the movement when motion is reduced.
  const SIGNS = { wild: 'M-24 -26 l-5 -4 M24 -26 l5 -4 M-26 8 h-6 M26 8 h6', closed: 'M-26 6 h7 M-22 3 l3 3 l-3 3 M26 6 h-7 M22 3 l-3 3 l3 3',
    open: 'M-33 -16 l-3 4 l3 4 M33 -16 l3 4 l-3 4', up: 'M-14 -37 v-5 M-17 -39 l3 -3 l3 3 M14 -37 v-5 M11 -39 l3 -3 l3 3',
    turn: 'M-11.5 -11.5 a11 11 0 1 0 0.1 0 M11.5 -11.5 a11 11 0 1 1 -0.1 0' };
  function figure(k) {
    if (!STEPS.some(s => s.k === k)) return '';
    const arm = '<g class="dcf-up"><path d="M0 0 V11"/><g transform="translate(0 11)"><g class="dcf-fore"><path d="M0 0 V11"/></g></g></g>';
    return `<svg viewBox="-36 -46 72 90" aria-hidden="true" focusable="false"><g transform="translate(0 37)"><ellipse class="dcf-ground" rx="13" ry="2.2"/></g>`
      + `<g class="dcf-body"><circle cx="0" cy="-24" r="7"/><path d="M0 -17 V12 M-6 -10 H6 M0 12 L-9 34 M0 12 L9 34"/>`
      + `<g transform="translate(-6 -10)">${arm}</g><g class="dcf-r" transform="translate(6 -10) scale(-1 1)">${arm}</g></g>`
      + (SIGNS[k] ? `<path class="dcf-sign" d="${SIGNS[k]}"/>` : '') + '</svg>';
  }

  // ---------- a measure in the making ----------
  // add(step, t, live): what the stream says right now (the bridge's live(): {v, c, seen}) joins the step `step` at its
  // t seconds – after its first SETTLE seconds, at most RATE a second; a value counts only while the stream is sure of
  // it. samples: {step: [{feature: value | null}]}.
  function take() {
    const samples = Object.fromEntries(STEPS.map(s => [s.k, []])), last = {};
    return {
      add(step, t, live) {
        if (!(step in samples) || !(t >= SETTLE) || !live || !live.v) return false;
        if (last[step] != null && t - last[step] < 1 / RATE - 1e-3) return false;
        last[step] = t;
        const c = live.c || {};
        samples[step].push(Object.fromEntries(FEATURES.map(f => [f, Number.isFinite(live.v[f]) && c[f] >= SURE ? live.v[f] : null])));
        return true;
      },
      get samples() { return samples; },
    };
  }
  // the value below which a share q of the list lies (linear between neighbours)
  function quantile(xs, q) {
    const s = xs.slice().sort((a, b) => a - b);
    if (!s.length) return NaN;
    const at = clamp(q, 0, 1) * (s.length - 1), i = Math.floor(at);
    return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (at - i) : s[i];
  }
  // The bounds a measure stands for: samples (take().samples), std: the standard ranges ({feature: [lo, hi]}), min: the
  // narrowest range that may act. → {bounds: {feature: [lo, hi]}, why: {feature: null | 'unseen' | 'narrow'}, ok}: a base
  // movement Dream did not see well enough, or whose calm and wild lie too close together, keeps the standard range.
  function bounds(samples, std, min = 0.08) {
    const got = { lo: {}, hi: {} };
    for (const s of STEPS) for (const [f, end, q] of s.takes) {
      const xs = ((samples && samples[s.k]) || []).map(x => x && x[f]).filter(Number.isFinite).map(x => (f === 'turn' ? Math.abs(x) : x));
      if (xs.length >= MIN_N) got[end][f] = clamp(quantile(xs, q), 0, 1);
    }
    const out = {}, why = {};
    for (const f of FEATURES) {
      const lo = got.lo[f], hi = got.hi[f];
      why[f] = lo == null || hi == null ? 'unseen' : hi - lo < min ? 'narrow' : null;
      out[f] = why[f] ? (std[f] || [0, 1]).slice(0, 2) : [r3(lo), r3(hi)];
    }
    return { bounds: out, why, ok: FEATURES.some(f => !why[f]) };
  }
  // Where a raw value lies between a dancer's calm (0) and wild (1) – turning by how far, either way.
  function percent(x, b, f) {
    if (!Number.isFinite(x) || !Array.isArray(b) || !(b[1] > b[0])) return 0;
    return clamp(((f === 'turn' ? Math.abs(x) : x) - b[0]) / (b[1] - b[0]), 0, 1);
  }
  // What is wrong with a dancer's name: null, or 'chars' (letters, digits, spaces and . + - –, at most 32)
  const nameProblem = name => (NAME_OK.test(String(name || '').trim().replace(/\s+/g, ' ')) ? null : 'chars');

  // ---------- the page part ----------
  // opts: {bridge (profiles(), profilesDo(op), setProfile(name), live()), label(feature) → its name, pictogram(src) → svg}
  function mount(box, opts) {
    const { bridge } = opts, label = f => (opts.label ? opts.label(f) : f);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const btn = (text, title, cls = '') => { const b = el('button', 'btn ' + cls, text); b.type = 'button'; if (title) b.title = title; return b; };
    const calm = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const info = () => { try { return bridge.profiles() || null; } catch (e) { return null; } };
    const std = () => (info() && info().std) || { energy: [0.1, 0.8], open: [0.45, 0.95], turn: [0, 1], height: [0.55, 1] };

    box.classList.add('mt', 'dc'); box.setAttribute('role', 'region'); box.setAttribute('aria-label', T('Your measures')); box.textContent = '';
    const head = el('header', 'mt-head'), title = el('h2', '', T('📏 Your measures'));
    const measureBtn = btn(T('📏 Measure me …'), T('Measure your calm and your wild for each base movement (about 45 seconds, key M)'), 'on dc-go');
    head.append(title, measureBtn);
    const state = el('div', 'mt-state'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
    const chips = el('div', 'dc-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', T('Whose measures the dance reads'));
    // ---- the wizard ----
    const wiz = el('div', 'mt-wiz'); wiz.hidden = true; wiz.setAttribute('role', 'region'); wiz.setAttribute('aria-label', T('Measure your base movements'));
    const NAMES = [...STEPS.map((s, i) => `${i + 1} · ${{ calm: T('Calm'), wild: T('Wild'), closed: T('Arms closed'), open: T('Arms open'), up: T('Arms up'), turn: T('Hands circle') }[s.k]}`), `${STEPS.length + 1} · ${T('Result')}`];
    const stepBar = el('ol', 'mt-steps'); NAMES.forEach(t => stepBar.append(el('li', '', t)));
    const big = el('div', 'mt-big'), small = el('div', 'mt-say'), bar = el('div', 'mt-bar'), barFill = el('i');
    bar.setAttribute('aria-hidden', 'true'); bar.append(barFill); small.setAttribute('aria-live', 'polite');
    const pane = el('div', 'mt-pane'), btns = el('div', 'btns mt-btns'), closeBtn = btn('✕', T('Stop measuring (Esc) – your measures stay as they were'), 'mt-x mt-close');
    closeBtn.setAttribute('aria-label', T('Stop measuring'));
    // the demo figure beside the big words: what the step means, shown (only while counting down and measuring)
    const fig = el('div', 'dc-fig'), words = el('div', 'dc-words'), showRow = el('div', 'dc-show');
    fig.setAttribute('aria-hidden', 'true'); fig.hidden = true; words.append(big, small); showRow.append(fig, words);
    wiz.append(closeBtn, stepBar, showRow, bar, pane, btns);
    // ---- the ranges: the standard's and yours, per base movement, with where you are now ----
    const ranges = el('div', 'dc-ranges'), legend = el('div', 'hint dc-legend');
    for (const [cls, text] of [['dc-std', T('standard')], ['dc-you', T('yours')], ['dc-dot', T('you now')]]) { const i = el('i', cls); i.setAttribute('aria-hidden', 'true'); legend.append(i, el('span', '', text)); }
    const hint = el('div', 'hint', T('Dream measures how little you move when calm and how much when wild – for each base movement – and keeps it under your name on this Mac: numbers only, never a camera picture. With your measures in use, your calm is 0 % and your wild 100 % for every sentence; “Standard measures” brings the built-in ones back.'));
    box.append(head, state, chips, wiz, ranges, legend, hint);
    const say = text => { if (state.textContent !== text) state.textContent = text; };

    // ---------- the profiles: a row of chips ----------
    let chipsKey = '', sure = '';
    function drawChips() {
      const i = info() || { use: '', names: [] }, key = JSON.stringify([i.use, i.names, sure]);
      if (key === chipsKey) return;
      const had = chips.contains(document.activeElement) ? document.activeElement.dataset.name + '|' + document.activeElement.dataset.part : '';
      chipsKey = key; chips.textContent = '';
      for (const n of ['', ...i.names]) {
        const b = el('button', 'dc-chip' + (n === i.use ? ' on' : '')); b.type = 'button'; b.dataset.name = n; b.dataset.part = 'pick';
        b.setAttribute('aria-pressed', String(n === i.use));
        b.textContent = n ? n : T('Standard measures');
        b.title = n ? T('The measures of “{n}”', { n }) + (n === i.use ? ' – ' + T('in use') : '') : T('The built-in ranges, for every dancer') + (n === i.use ? ' – ' + T('in use') : '');
        b.onclick = () => { if (n !== (info() || {}).use) { bridge.setProfile(n); say(n ? T('“{n}” in use – the dance reads your base movements with these measures.', { n }) : T('Standard measures in use.')); } };
        chips.append(b);
        if (n && n === i.use) {
          const del = btn(sure === n ? T('Really delete?') : '🗑', '', 'dc-mini'); del.dataset.name = n; del.dataset.part = 'del';
          del.setAttribute('aria-label', sure === n ? T('Really delete the measures of “{n}”?', { n }) : T('Delete the measures of “{n}”', { n }));
          del.title = del.getAttribute('aria-label');
          del.onclick = () => {                            // asks once more on the button itself – no dialog in the way
            if (sure !== n) { sure = n; drawChips(); setTimeout(() => { if (sure === n) { sure = ''; drawChips(); } }, 3000); return; }
            sure = ''; bridge.profilesDo({ op: 'delete', name: n }); say(T('The measures of “{n}” are deleted – standard measures in use.', { n }));
          };
          chips.append(del);
        }
      }
      if (had) { const [n, part] = had.split('|'), again = chips.querySelector(`[data-name="${CSS.escape(n)}"][data-part="${part}"]`) || chips.querySelector('[aria-pressed="true"]'); if (again) again.focus(); }
    }

    // ---------- the ranges ----------
    const rows = {};
    for (const f of FEATURES) {
      const row = el('div', 'dc-row'), pict = el('span', 'mt-pict'), name = el('span', 'dc-name', label(f)), track = el('span', 'dc-track');
      const sb = el('i', 'dc-std'), yb = el('i', 'dc-you'), dot = el('i', 'dc-at'), now = el('span', 'dc-now', '–'), note = el('span', 'dc-note');
      if (opts.pictogram) pict.innerHTML = opts.pictogram(f);
      pict.setAttribute('aria-hidden', 'true'); track.setAttribute('role', 'img'); dot.setAttribute('aria-hidden', 'true');
      dot.append(el('i', 'dc-dot')); track.append(sb, yb, dot); row.append(pict, name, track, now, note); ranges.append(row);
      rows[f] = { row, sb, yb, dot, now, note, track, key: '', x: -1, p: -1 };
    }
    const pct = x => `${Math.round(x * 100)} %`;
    // b: the bounds shown as yours; why: per base movement null or why it kept the standard
    function drawRanges(b, why = {}) {
      const s = std();
      for (const f of FEATURES) {
        const r = rows[f], mine = b && b[f] ? b[f] : s[f], key = JSON.stringify([mine, s[f], why[f] || null]);
        if (key === r.key) continue;
        r.key = key;
        const place = (e, [a, z]) => { e.style.transform = `translateX(${(a * 100).toFixed(2)}%) scaleX(${Math.max(0.005, z - a).toFixed(4)})`; };
        place(r.sb, s[f]); place(r.yb, mine);
        r.row.classList.toggle('dc-same', !b || why[f] != null || (mine[0] === s[f][0] && mine[1] === s[f][1]));
        r.note.textContent = why[f] === 'unseen' ? T('not seen – the standard stays') : why[f] === 'narrow' ? T('calm and wild too close – the standard stays') : '';
        r.track.setAttribute('aria-label', T('{f}: yours from {a} to {b}, the standard from {c} to {d}', { f: label(f), a: pct(mine[0]), b: pct(mine[1]), c: pct(s[f][0]), d: pct(s[f][1]) }));
      }
    }
    let shown = null;                                  // the bounds the ranges show: the measure's, the profile's or null
    function liveRanges(live) {
      const b = shown || std();
      for (const f of FEATURES) {
        const r = rows[f], x = live && live.v && Number.isFinite(live.v[f]) && (live.c || {})[f] >= SURE ? live.v[f] : null;
        const at = x == null ? -1 : Math.round(clamp(f === 'turn' ? Math.abs(x) : x, 0, 1) * 200) / 200, p = x == null ? -1 : Math.round(percent(x, b[f], f) * 100);
        if (at !== r.x) { r.x = at; r.dot.style.opacity = at < 0 ? '0' : '1'; if (at >= 0) r.dot.style.transform = `translateX(${(at * 100).toFixed(1)}%)`; }
        if (p !== r.p) { r.p = p; r.now.textContent = p < 0 ? '–' : T('now {p} %', { p }); }
      }
    }

    // ---------- the wizard ----------
    let phase = 'idle', i = 0, t = 0, at = 0, last = 0, tk = null, result = null, raf = 0;
    function show(p, step, bigText, smallText) {
      phase = p; wiz.hidden = p === 'idle';
      [...stepBar.children].forEach((li, k) => { li.className = k === step ? 'cur' : k < step ? 'done' : ''; if (k === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
      big.textContent = bigText || ''; small.textContent = smallText || ''; pane.textContent = ''; btns.textContent = '';
      const k = p === 'count' || p === 'step' ? STEPS[step].k : '';   // the countdown already shows the first step
      if (fig.dataset.k !== k) { fig.dataset.k = k; fig.innerHTML = figure(k); }
      fig.hidden = !k;
      bar.hidden = !(p === 'count' || p === 'step'); barFill.style.transform = 'scaleX(0)';
      box.classList.toggle('mt-taking', p === 'step');
      big.classList.toggle('mt-huge', p === 'count');   // read from where the dancer stands
      measureBtn.disabled = p !== 'idle';
    }
    function start() {
      if (phase !== 'idle') { wiz.scrollIntoView({ block: 'nearest' }); return; }
      tk = take(); result = null; at = performance.now();
      show('count', 0, String(COUNT), T('Step back so Dream sees all of you – then follow the big words.'));
      wiz.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
      closeBtn.focus();
    }
    function stop(text) { tk = null; result = null; shown = null; show('idle', -1); say(text || ''); measureBtn.focus(); }
    closeBtn.onclick = () => stop(T('Measuring stopped – your measures stay as they were.'));
    wiz.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); stop(T('Measuring stopped – your measures stay as they were.')); } });
    function step(k) {
      i = k; t = 0; last = performance.now();
      const s = STEPS[k];
      show('step', k, s.say(), T('Get there …'));
      for (const [f] of s.takes) rows[f].row.classList.add('dc-cur');   // the base movements this step measures
    }
    function done() {
      for (const f of FEATURES) rows[f].row.classList.remove('dc-cur');
      result = bounds(tk.samples, std(), (info() && info().min) || 0.08); shown = result.bounds;
      const cur = (info() || {}).use || '';
      show('result', STEPS.length, result.ok ? T('Your measures') : T('Nothing measured'), result.ok
        ? T('Your range per base movement, beside the standard. Move: the dot shows where you are – your calm is 0 %, your wild 100 %.')
        : T('Dream did not see you well enough – step into the picture, check the detection, and measure again.'));
      drawRanges(result.bounds, result.why);
      const field = el('label', 'mt-field'), nameIn = el('input'), why = el('span', 'hint dc-why');
      nameIn.type = 'text'; nameIn.maxLength = 32; nameIn.autocomplete = 'off'; nameIn.id = 'dc-name'; nameIn.placeholder = T('e.g. Kim'); nameIn.value = cur;
      field.htmlFor = 'dc-name'; field.append(el('span', '', T('Whose measures? (a name)')), nameIn);
      why.setAttribute('role', 'status'); why.setAttribute('aria-live', 'polite');
      const same = () => { const n = nameIn.value.trim().replace(/\s+/g, ' '); why.textContent = n && ((info() || {}).names || []).includes(n) ? T('Replaces the measures of “{n}”.', { n }) : ''; };
      nameIn.oninput = same; same();
      if (result.ok) pane.append(field, why);
      const keep = add(btn(T('Keep'), T('Keep these measures under this name on this Mac – numbers only – and use them from now on'), 'on'));
      keep.hidden = !result.ok;
      add(btn(T('Measure again'), T('Start the measuring once more'))).onclick = () => { tk = take(); show('count', 0, String(COUNT), T('Step back so Dream sees all of you – then follow the big words.')); at = performance.now(); };
      add(btn(T('Throw away'), T('Keep nothing – your measures stay as they were'))).onclick = () => stop(T('Thrown away – your measures stay as they were.'));
      const save = () => {
        const name = nameIn.value.trim().replace(/\s+/g, ' ');
        if (nameProblem(name)) { why.textContent = T('A name: letters, digits, spaces and . + - –, at most 32 characters.'); nameIn.focus(); return; }
        bridge.profilesDo({ op: 'save', name, bounds: result.bounds });
        tk = null; result = null; shown = null; show('idle', -1);
        say(T('“{n}” in use – your calm is 0 %, your wild 100 %.', { n: name })); measureBtn.focus();
      };
      keep.onclick = save; nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });   // the Enter must not press the button focus goes to
      (result.ok ? nameIn : btns.querySelector('.btn:not([hidden])')).focus();
    }
    const add = b => { btns.append(b); return b; };
    measureBtn.onclick = start;

    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (box.hidden || document.hidden) return;
      let live = null; try { live = bridge.live(); } catch (e) { live = null; }
      drawChips();
      if (phase === 'count') {
        const left = COUNT - (now - at) / 1000;
        big.textContent = String(Math.max(1, Math.ceil(left))); barFill.style.transform = `scaleX(${clamp(1 - left / COUNT, 0, 1).toFixed(3)})`;
        if (left <= 0) step(0);
      } else if (phase === 'step') {
        const s = STEPS[i], dt = Math.min(0.1, (now - last) / 1000), seen = !!live && !!live.seen;
        last = now;
        if (seen) t += dt;                             // while Dream does not see the dancer, the step waits
        tk.add(s.k, t, live);
        const txt = !seen ? T('Dream does not see you – step into the picture, the measure waits.') : t < SETTLE ? T('Get there …') : s.sub();
        if (small.textContent !== txt) small.textContent = txt;
        small.classList.toggle('dc-lost', !seen);
        barFill.style.transform = `scaleX(${clamp(t / s.secs, 0, 1).toFixed(3)})`;
        if (t >= s.secs) { for (const [f] of s.takes) rows[f].row.classList.remove('dc-cur'); if (i + 1 < STEPS.length) step(i + 1); else done(); }
      }
      // the ranges of the measures in use – while measuring too (what the new measure is made beside); the result shows its own
      if (phase !== 'result') { const p = info(); shown = p && p.use && p.data && p.data[p.use] ? p.data[p.use] : null; drawRanges(shown); }
      if (now - liveAt > 66) { liveAt = now; liveRanges(live); }
    }
    let liveAt = 0;
    show('idle', -1); raf = requestAnimationFrame(tick);
    return { start, get phase() { return phase; }, cancel: () => { if (phase !== 'idle') stop(T('Measuring stopped – your measures stay as they were.')); }, stop: () => cancelAnimationFrame(raf) };
  }

  const api = { mount, figure, take, quantile, bounds, percent, nameProblem, STEPS, FEATURES, SETTLE, MIN_N, SURE, RATE };
  if (node) module.exports = api;
  else root.DanceCal = api;
})(typeof window !== 'undefined' ? window : globalThis);
