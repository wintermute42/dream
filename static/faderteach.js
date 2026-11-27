/* Dream – base movements of one's own (#267): a fader taught by showing the states of the body it goes between.

   A part of the page of Dream Dance (static/dance.html – it reads the stage through the bridge of the window that
   opened it), beside the moves of one's own (moveteach.js) and in their look (moveteach.css). The way:
   1. name it, and name its states: the one at 0 and the one at 1 ("upright" ↔ "deep in the knees"), and, if you like,
      up to three steps between them (evenly spaced);
   2. show each state: Dream counts down, then you hold it for a moment – swaying a little is good, Dream learns it
      the steadier; what the body showed is a handful of numbers (dancefaders.js), never a camera picture;
   3. try it: a live level follows you between the states, with the states marked on it and what Dream reads the
      fader from (e.g. "knees ↕") – [Keep] keeps it on this Mac (dancefaders.py: the small regression and the names)
      and makes it a base movement (a base sentence, with the effect chosen before or the first one that fits),
      [Again] shows the states once more.
   The list shows every base movement of one's own with its pictogram, its name (change it there), its states, a live
   level of what the stage reads right now, [Teach again] (the same name and sentences, new states) and the button to
   delete it (its sentences go with it). The part is folded under its title, "for the advanced" – the four built-in base
   movements need none of it; it says so when opened and opens by itself when teaching starts.

   `stateValues`, `nameProblem` and `fileOf` are pure (tests/js/faderteach.test.mjs). Looks: moveteach.css – only
   transform and opacity move. A global `FaderTeach`. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const FD = node ? require('./dancefaders.js') : root.DreamFaders;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const FORMAT = 'dream-dance-fader', VERSION = 1;
  const MAX = 12;                                      // as many as Dream keeps (dancefaders.py MAX_FADERS)
  const COUNT = 3, HOLD = 2.5, WAIT = 4;               // seconds: the countdown, holding a state, and waiting for the body
  const SMOOTH = 0.12;                                 // seconds: the live level glides as the stage's does (dance.js)
  const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N}_ .+-]{0,31}$/u;   // dancefaders.py NAME
  const clean = v => String(v || '').trim().replace(/\s+/g, ' ');

  // The values of n states, evenly from 0 to 1 (rounded as Dream keeps them)
  const stateValues = n => Array.from({ length: n }, (_, k) => Math.round(k / (n - 1) * 1e5) / 1e5);
  // What is wrong with the names of a base movement and its states: null, or {what: 'name' | 'state' | 'taken' | 'twice', i?}
  // taken: the names of the other base movements (compared without regard to case)
  function nameProblem(name, states = [], taken = []) {
    if (!NAME_OK.test(clean(name))) return { what: 'name' };
    if (taken.some(t => String(t).toLowerCase() === clean(name).toLowerCase())) return { what: 'taken' };
    for (let i = 0; i < states.length; i++) if (!NAME_OK.test(clean(states[i]))) return { what: 'state', i };
    const low = states.map(s => clean(s).toLowerCase());
    const i = low.findIndex((s, k) => low.indexOf(s) !== k);
    return i >= 0 ? { what: 'twice', i } : null;
  }
  // What is sent to Dream to be kept: the name, the states with their values, the regression
  const fileOf = (name, states, model) => ({ format: FORMAT, version: VERSION, name: clean(name), states: states.map((s, k) => ({ name: clean(s), y: stateValues(states.length)[k] })), model });
  const PARTS = { head: () => T('head'), elbows: () => T('elbows'), hands: () => T('hands'), hips: () => T('hips'), knees: () => T('knees'), feet: () => T('feet'), shoulders: () => T('shoulders') };
  // What Dream reads a fader from, in words: "knees ↕ 60 % · feet ↕ 35 %"
  const readFrom = md => FD.explain(md).slice(0, 3).map(x => `${(PARTS[x.part] || (() => x.part))()} ${x.axis} ${Math.round(x.share * 100)} %`).join(' · ');
  const WHY = {
    states: () => T('A base movement needs at least two states.'),
    few: () => T('Dream did not see you long enough in one of the states – show them again, in the picture from head to toe.'),
    nobody: () => T('Dream saw no part of your body through all states – is the detection running, and are you in the picture?'),
    same: () => T('The states look alike to Dream – make them more different (e.g. deeper in the knees).'),
    unsteady: () => T('The states run into each other – hold each one steadier, or make them more different.'),
  };

  // opts: {live() → the lab's live frame ({rec, input}), sure() → the stage's live record ({v: {"f.<id>": value}}),
  //        faders() → [{id, name, states, model}], changed() – a base movement was kept, renamed or deleted,
  //        keep({src, fx, i, fresh}) – put what was taught on a base sentence, pictogram(src) → svg (danceslots.js)}
  function mount(box, opts) {
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const btn = (text, title, cls = '') => { const b = el('button', 'btn ' + cls, text); b.type = 'button'; if (title) b.title = title; return b; };
    const calm = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const json = r => r.json().catch(() => null);
    const api = opts.api || {
      add: f => fetch('/dance/faders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }).then(json),
      change: (id, what) => fetch('/dance/faders/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(what) }).then(json),
      del: id => fetch('/dance/faders/' + id, { method: 'DELETE' }).then(r => r.ok),
    };
    const list0 = () => { try { return opts.faders() || []; } catch (e) { return []; } };

    box.classList.add('mt', 'ft'); box.setAttribute('role', 'region'); box.setAttribute('aria-label', T('Your base movements')); box.textContent = '';
    // folded by default – for the advanced (the four built-in base movements need none of it); it opens by its title
    // and by itself when teaching starts (e.g. from "＋ A base movement of your own …" in a sentence)
    const head = el('header', 'mt-head'), title = el('h2', 'ft-title'), fold = btn('', T('Show or hide your base movements of your own'), 'ft-fold');
    const body = el('div', 'ft-body'); body.id = 'ft-body'; body.hidden = true;
    fold.setAttribute('aria-expanded', 'false'); fold.setAttribute('aria-controls', body.id);
    const chev = el('span', 'ft-chev', '▸'); chev.setAttribute('aria-hidden', 'true');
    fold.append(chev, el('span', 'ft-name', T('🎚 Your base movements')), el('span', 'ft-adv', T('For the advanced')));
    title.append(fold); head.append(title);
    const why = el('p', 'ft-why-own', T('Optional. The four built-in base movements – moving a lot, opening the arms, circling the hands, raising the arms – work right away, and “📏 Measure me …” fits them to you. A base movement of your own is only for a movement Dream does not know yet, e.g. upright ↔ deep in the knees or leaning left ↔ right: you show Dream its ends once, and between them it acts like a dimmer.'));
    const teachBtn = btn(T('＋ Teach a base movement …'), T('Show Dream two or more states of your body – it learns a fader that goes between them'), 'ft-new');
    const state = el('div', 'mt-state'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
    const opened = open => { body.hidden = !open; fold.setAttribute('aria-expanded', String(open)); box.classList.toggle('ft-open', open); };
    fold.onclick = () => opened(body.hidden);
    const wiz = el('div', 'mt-wiz'); wiz.hidden = true; wiz.setAttribute('role', 'region'); wiz.setAttribute('aria-label', T('Teach a base movement'));
    const stepBar = el('ol', 'mt-steps'); [T('1 · Name it'), T('2 · Show the states'), T('3 · Try it')].forEach(t => stepBar.append(el('li', '', t)));
    const big = el('div', 'mt-big'), small = el('div', 'mt-say'), bar = el('div', 'mt-bar'), barFill = el('i');
    bar.setAttribute('aria-hidden', 'true'); bar.append(barFill); small.setAttribute('aria-live', 'polite');
    const pane = el('div', 'mt-pane'), btns = el('div', 'btns mt-btns'), closeBtn = btn('✕', T('Stop teaching (Esc) – nothing is kept'), 'mt-x mt-close');
    closeBtn.setAttribute('aria-label', T('Stop teaching'));
    wiz.append(closeBtn, stepBar, big, small, bar, pane, btns);
    const list = el('ul', 'mt-list ft-list'); list.setAttribute('aria-label', T('The base movements you taught'));
    const hint = el('div', 'hint', T('A base movement of your own is a fader between states of your body you show (e.g. upright ↔ deep in the knees, leaning left ↔ leaning right). Dream keeps it as a few numbers on this Mac – never a camera picture – and reads it from your skeleton like the built-in base movements. It becomes a base sentence: “When I go towards “…” → …”. Best with “Hands (AI)”, the whole body in the picture.'));
    const row = el('div', 'btns ft-row'); row.append(teachBtn);
    body.append(why, row, state, wiz, list, hint); box.append(head, body);

    // ---------- the wizard ----------
    let w = null, phase = 'idle', raf = 0, lastAt = 0, lastDraw = 0, listKey = '', busy = false;
    const say = text => { if (state.textContent !== text) state.textContent = text; };
    const add = (b, focus) => { btns.append(b); if (focus) b.focus(); return b; };
    function show(p, step, bigText, smallText) {
      phase = p; wiz.hidden = p === 'idle'; teachBtn.disabled = p !== 'idle';
      [...stepBar.children].forEach((li, k) => { li.className = k === step ? 'cur' : k < step ? 'done' : ''; if (k === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
      big.textContent = bigText || ''; small.textContent = smallText || ''; pane.textContent = ''; btns.textContent = '';
      bar.hidden = !['count', 'hold'].includes(p); barFill.style.transform = 'scaleX(0)';
      box.classList.toggle('mt-taking', p === 'hold');
      big.classList.toggle('mt-huge', p === 'count');   // the countdown is read from where the dancer stands
    }
    // o: {id – teach this one again, fx, i – the effect and the base sentence it was asked for}
    function wizard(o = {}) {
      opened(true);
      if (phase !== 'idle' || busy) { wiz.scrollIntoView({ block: 'nearest' }); return; }
      const was = o.id ? list0().find(f => f.id === o.id) : null;
      if (!was && list0().length >= MAX) { say(T('Too many base movements are kept – delete one first.')); return; }
      w = { id: was ? was.id : null, name: was ? was.name : '', states: was ? was.states.map(s => s.name) : ['', ''], fx: o.fx || null, i: o.i, samples: [], k: 0, model: null };
      wiz.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
      names();
    }
    function stopAll(text) { w = null; show('idle', -1); say(text || ''); teachBtn.focus(); }
    closeBtn.onclick = () => stopAll(T('Teaching stopped – nothing changed.'));
    wiz.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); stopAll(T('Teaching stopped – nothing changed.')); } });
    teachBtn.onclick = () => wizard({});

    // 1 · name it and its states
    function names() {
      show('name', 0, w.id ? T('Teach “{n}” again', { n: w.name }) : T('A new base movement'), T('Name it, and name the state at 0 and the one at 1 – steps between them if you like.'));
      const nameIn = el('input'), field = el('label', 'mt-field');
      nameIn.type = 'text'; nameIn.maxLength = 32; nameIn.autocomplete = 'off'; nameIn.id = 'ft-name'; nameIn.placeholder = T('e.g. Knees'); nameIn.value = w.name;
      field.htmlFor = 'ft-name'; field.append(el('span', '', T('Name of the base movement')), nameIn);
      const rows = el('ol', 'ft-states'), more = btn(T('＋ A step in between'), T('One more state between the others (at most three) – the states are spread evenly from 0 to 1'), 'ft-more');
      rows.setAttribute('aria-label', T('The states, from 0 to 1'));
      const why = el('div', 'ft-why'); why.setAttribute('role', 'status'); why.setAttribute('aria-live', 'polite');
      const draw = (focusAt, fresh = -1) => {          // fresh: the row just added – only it comes in
        rows.textContent = '';
        const ys = stateValues(w.states.length);
        w.states.forEach((s, k) => {
          const li = el('li', 'ft-staterow' + (k === fresh ? ' ft-in' : '')), inp = el('input'), tag = el('span', 'ft-y', (Math.round(ys[k] * 100) / 100).toLocaleString(root.I18N ? root.I18N.lang : 'en'));
          tag.setAttribute('aria-hidden', 'true');
          inp.type = 'text'; inp.maxLength = 32; inp.autocomplete = 'off'; inp.value = s; inp.dataset.k = k;
          inp.placeholder = k === 0 ? T('e.g. upright') : k === w.states.length - 1 ? T('e.g. deep in the knees') : T('e.g. halfway');
          inp.setAttribute('aria-label', k === 0 ? T('State at 0') : k === w.states.length - 1 ? T('State at 1') : T('Step {n} in between', { n: k }));
          inp.oninput = () => { w.states[k] = inp.value; };
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
          li.append(tag, inp);
          if (k > 0 && k < w.states.length - 1) {
            const x = btn('✕', '', 'mt-x'); x.setAttribute('aria-label', T('Remove step {n}', { n: k })); x.title = T('Remove this step');
            x.onclick = () => { w.states.splice(k, 1); draw(Math.min(k, w.states.length - 2)); };
            li.append(x);
          }
          rows.append(li);
        });
        more.disabled = w.states.length >= FD.MAX_STATES;
        if (focusAt != null) { const f = rows.querySelector(`input[data-k="${focusAt}"]`); if (f) f.focus(); }
      };
      more.onclick = () => { w.states.splice(w.states.length - 1, 0, ''); draw(w.states.length - 2, w.states.length - 2); };
      nameIn.oninput = () => { w.name = nameIn.value; };
      nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      const go = () => {
        const taken = list0().filter(f => f.id !== w.id).map(f => f.name), p = nameProblem(w.name, w.states, taken);
        if (p) {
          why.textContent = p.what === 'taken' ? T('“{n}” exists already – choose another name.', { n: clean(w.name) })
            : p.what === 'twice' ? T('Two states have the same name – each needs its own.')
            : T('A name: letters, digits, spaces and . + - , at most 32 characters.');
          (p.what === 'name' || p.what === 'taken' ? nameIn : rows.querySelector(`input[data-k="${p.i}"]`) || nameIn).focus();
          return;
        }
        w.name = clean(w.name); w.states = w.states.map(clean); w.samples = []; w.k = 0;
        countdown();
      };
      pane.append(field, rows, more, why); draw(null);
      add(btn(T('Show the states →'), T('Dream counts down, then you hold each state for a moment'), 'on')).onclick = go;
      add(btn(T('Cancel'), T('Stop teaching – nothing is kept'))).onclick = () => stopAll(T('Teaching stopped – nothing changed.'));
      (w.name ? rows.querySelector('input') : nameIn).focus();
    }
    // the states as chips – done ones ticked, the one at hand lit
    function chips() {
      const ol = el('ol', 'ft-chips'); ol.setAttribute('aria-label', T('The states'));
      w.states.forEach((s, k) => { const li = el('li', k < w.k ? 'done' : k === w.k ? 'cur' : '', (k < w.k ? '✓ ' : '') + s); ol.append(li); });
      pane.append(ol);
    }
    // 2 · show each state: count down, then hold it
    let countAt = 0, holdAt = 0, taken = [], lastRec = -1;
    function countdown() {
      countAt = performance.now();
      show('count', 1, String(COUNT), T('Next: “{s}” – take the position, then hold it.', { s: w.states[w.k] }));
      chips();
      add(btn(T('Stop'), T('Stop teaching – nothing is kept')), true).onclick = () => stopAll(T('Teaching stopped – nothing changed.'));
    }
    function hold() {
      holdAt = performance.now(); taken = []; lastRec = -1;
      show('hold', 1, T('Hold “{s}”', { s: w.states[w.k] }), T('Hold it – sway a little, so Dream learns it steadily.'));
      chips();
      add(btn(T('Stop'), T('Stop teaching – nothing is kept')), true).onclick = () => stopAll(T('Teaching stopped – nothing changed.'));
    }
    function held() {
      if (taken.length < FD.MIN_SAMPLES) {
        show('lost', 1, T('Dream did not see you'), T('Through “{s}” Dream saw too little of you – is the detection running, and are you in the picture from head to toe?', { s: w.states[w.k] }));
        chips();
        add(btn(T('Again'), T('Show this state once more'), 'on'), true).onclick = countdown;
        add(btn(T('Stop'), T('Stop teaching – nothing is kept'))).onclick = () => stopAll(T('Teaching stopped – nothing changed.'));
        return;
      }
      const y = stateValues(w.states.length)[w.k];
      for (const f of taken) w.samples.push({ ...f, y });
      w.k++;
      if (w.k < w.states.length) countdown(); else tryIt();
    }
    // 3 · try it: the live level between the states
    let level = null;
    function tryIt() {
      const md = FD.fit(w.samples);
      if (md.why) {
        show('why', 2, T('Not yet a fader'), (WHY[md.why] || WHY.unsteady)());
        add(btn(T('Again'), T('Show the states once more'), 'on'), true).onclick = () => { w.samples = []; w.k = 0; countdown(); };
        add(btn(T('Change the states'), T('Back to the names of the states'))).onclick = names;
        return;
      }
      w.model = md; w.c = FD.compile(md, 'try'); w.v = null;
      show('try', 2, T('Try “{n}”', { n: w.name }), T('Move between the states – the level follows you. Keep it, or show the states again.'));
      level = meter(w.states, md);
      const from = el('div', 'ft-from', T('Dream reads it from: {p}', { p: readFrom(md) }));   // no hint: it is what the fader is
      pane.append(level.box, from);
      add(btn(T('Keep'), T('Keep this base movement on this Mac – numbers only, no camera picture'), 'on'), true).onclick = keepIt;
      add(btn(T('Again'), T('Show the states once more'))).onclick = () => { w.samples = []; w.k = 0; countdown(); };
    }
    // a level with the states marked on it: {box, set(value | null)}
    function meter(states, md, cls = '') {
      const box = el('div', 'ft-level ' + cls), track = el('div', 'ft-track'), fill = el('i'), marks = el('div', 'ft-marks');
      track.append(fill);
      const ys = (md && md.states ? md.states.map(s => s.y) : stateValues(states.length));
      states.forEach((s, k) => { const m = el('span', 'ft-mark', s); m.style.left = (ys[k] * 100).toFixed(1) + '%'; m.classList.toggle('end', k === states.length - 1); marks.append(m); });
      box.append(track, marks);
      box.setAttribute('role', 'img');
      let shown = null, tens = null;
      return { box, set(v) {
        const q = v == null ? -1 : Math.round(clamp(v, 0, 1) * 100) / 100;
        if (q !== shown) { shown = q; fill.style.transform = `scaleX(${Math.max(0, q)})`; box.classList.toggle('off', q < 0); }
        const n = q < 0 ? -1 : Math.round(q * 10);       // what it says is read in steps of ten: no chatter
        if (n !== tens) { tens = n; box.setAttribute('aria-label', n < 0 ? T('Level: not seen right now') : T('Level: {v} %', { v: n * 10 })); }
      } };
    }
    async function keepIt() {
      if (busy || !w || !w.model) return;
      busy = true;
      const file = fileOf(w.name, w.states, w.model), fresh = !w.id;
      let r = null; try { r = fresh ? await api.add(file) : await api.change(w.id, file); } catch (e) { r = null; }
      busy = false;
      if (!w) return;
      if (!r || !r.id) { small.textContent = (r && r.error) || T('Could not be kept.'); return; }
      const { fx, i, name } = w;
      w = null; show('idle', -1);
      try { opts.changed(); } catch (e) { /* the stage is reloading */ }
      try { opts.keep({ src: 'f.' + r.id, fx, i, fresh }); } catch (e) { /* the page is gone */ }
      say(fresh ? T('“{n}” is kept and is a base movement now – engage the clutch and try it.', { n: name }) : T('“{n}” is taught anew – its sentences stay.', { n: name }));
      teachBtn.focus();
    }

    // ---------- the list ----------
    const items = new Map();
    function drawList(fs) {
      const keepFocus = document.activeElement && list.contains(document.activeElement) ? [document.activeElement.closest('li').dataset.id, document.activeElement.dataset.part] : null;
      for (const id of [...items.keys()]) if (!fs.some(f => f.id === id)) { items.get(id).li.remove(); items.delete(id); }
      if (!fs.length && !list.querySelector('.mt-none')) list.append(el('li', 'mt-none', T('No base movement of your own yet – “＋ Teach a base movement …” above, or “＋ A base movement of your own …” in the base movements.')));
      if (fs.length && list.querySelector('.mt-none')) list.querySelector('.mt-none').remove();
      for (const f of fs) {
        let it = items.get(f.id);
        const key = JSON.stringify([f.states, f.model.states]);
        if (it && it.key !== key) { it.li.remove(); items.delete(f.id); it = null; }   // taught anew: other states
        if (!it) {
          const li = el('li', 'mt-move ft-move'), pict = el('span', 'mt-pict ft-pict'), body = el('div', 'mt-body'), name = el('input');
          const sub = el('span', 'ft-sub'), lv = meter(f.states.map(s => s.name), f.model, 'ft-small');
          const again = btn(T('🎓 Teach again'), T('Show the states anew – the name and the sentences stay'), 'mt-tune'), del = btn('🗑', T('Delete this base movement'), 'mt-del');
          li.dataset.id = f.id; if (opts.pictogram) pict.innerHTML = opts.pictogram('f.' + f.id);
          name.type = 'text'; name.maxLength = 32; name.autocomplete = 'off';
          name.dataset.part = 'name'; del.dataset.part = 'del'; again.dataset.part = 'again';
          it = { li, name, del, again, lv, sub, key, f: null };
          name.onchange = () => {
            const v = clean(name.value), p = nameProblem(v, [], list0().filter(x => x.id !== f.id).map(x => x.name));
            if (p) { say(p.what === 'taken' ? T('“{n}” exists already – choose another name.', { n: v }) : T('A name: letters, digits, spaces and . + - , at most 32 characters.')); name.value = it.f.name; return; }
            api.change(f.id, { name: v }).then(r => { if (r && r.id) { opts.changed(); say(T('Saved.')); } else say((r && r.error) || T('Could not be kept.')); }).catch(() => say(T('Could not be kept.')));
          };
          again.onclick = () => wizard({ id: f.id });
          del.onclick = () => {                           // asks once more on the button itself – no dialog in the way
            if (del.dataset.sure) { api.del(f.id).then(ok => { if (ok) { opts.changed(); say(T('“{n}” deleted – its sentences are empty now.', { n: it.f.name })); } }); return; }
            del.dataset.sure = '1'; del.textContent = T('Really delete?'); setTimeout(() => { delete del.dataset.sure; del.textContent = '🗑'; }, 3000);
          };
          body.append(name, sub);
          li.append(pict, body, again, del, lv.box); list.append(li); items.set(f.id, it);
        }
        it.f = f;
        if (document.activeElement !== it.name && it.name.value !== f.name) it.name.value = f.name;
        const from = readFrom(f.model), subKey = f.states.map(s => s.name).join(' ↔ ') + '|' + from;
        if (it.sub.dataset.k !== subKey) {                 // the states, and below them what it is read from
          it.sub.dataset.k = subKey; it.sub.textContent = '';
          it.sub.append(el('span', '', f.states.map(s => s.name).join(' ↔ ')), ...(from ? [el('span', '', T('reads {p}', { p: from }))] : []));
        }
        it.name.setAttribute('aria-label', T('Name of the base movement “{n}”', { n: f.name }));
        it.del.setAttribute('aria-label', T('Delete the base movement “{n}”', { n: f.name }));
        it.again.setAttribute('aria-label', T('Teach the base movement “{n}” again', { n: f.name }));
      }
      if (keepFocus) { const back = list.querySelector(`[data-id="${keepFocus[0]}"] [data-part="${keepFocus[1]}"]`); if (back) back.focus(); }
    }

    // ---------- the loop: the wizard, the live levels, the list ----------
    function tick(now) {
      raf = requestAnimationFrame(tick);
      const dt = lastAt ? Math.min(0.1, (now - lastAt) / 1000) : 1 / 60; lastAt = now;
      if (phase === 'count') {
        const left = COUNT - (now - countAt) / 1000;
        big.textContent = String(Math.max(1, Math.ceil(left))); barFill.style.transform = `scaleX(${clamp(1 - left / COUNT, 0, 1).toFixed(3)})`;
        if (left <= 0) hold();
      } else if (phase === 'hold' || phase === 'try') {
        let live = null; try { live = opts.live(); } catch (e) { live = null; }
        const rec = live && live.rec, f = rec && rec.t !== lastRec ? FD.features(live.input && live.input.pose, rec.hands, (live.input && live.input.aspect) || 16 / 9) : null;
        if (rec) lastRec = rec.t;
        if (phase === 'hold') {
          if (f && f.seen.filter(Boolean).length >= 4) taken.push(f);
          const secs = (now - holdAt) / 1000;
          barFill.style.transform = `scaleX(${clamp(secs / HOLD, 0, 1).toFixed(3)})`;
          if ((secs >= HOLD && taken.length >= FD.MIN_SAMPLES) || secs >= HOLD + WAIT) held();
        } else if (level) {
          const r = f ? FD.read(w.c, f) : null;
          if (r && r.c > 0) w.v = w.v == null ? r.value : w.v + (r.value - w.v) * Math.min(1, dt / SMOOTH);
          else if (!live) w.v = null;
          level.set(w.v);
        }
      }
      if (now - lastDraw < 45 || document.hidden) return;
      lastDraw = now;
      const fs = list0(), key = JSON.stringify(fs.map(f => [f.id, f.name, f.states]));
      if (key !== listKey) { listKey = key; drawList(fs); }
      let rec = null; try { rec = opts.sure(); } catch (e) { rec = null; }
      for (const [id, it] of items) { const v = rec && rec.v && Number.isFinite(rec.v['f.' + id]) ? rec.v['f.' + id] : null; it.lv.set(v); }
    }
    show('idle', -1); raf = requestAnimationFrame(tick);
    return { wizard, cancel: () => { if (phase !== 'idle') stopAll(T('Teaching stopped – nothing changed.')); }, get phase() { return phase; }, stop: () => cancelAnimationFrame(raf) };
  }

  const api = { mount, stateValues, nameProblem, fileOf, readFrom, FORMAT, VERSION, COUNT, HOLD, MAX };
  if (node) module.exports = api;
  else root.FaderTeach = api;
})(typeof window !== 'undefined' ? window : globalThis);
