/* Dream – the performers of Flowtrack (#253): learn what one person's movement is like, and fit Flowtrack to them.

   A part of the page of Flowtrack (static/flowtrack.html – it reads the stage through the bridge of the window that
   opened it). "Learn" takes the live movement for a minute or two – or a session the lab recorded before – and
   measures the person (flowprofile.js: speed, size, turning and planes, tempo, the energy over the session, their
   figures); with the name the user gave it the profile is kept on this Mac (flowprofiles.py: numbers and that name,
   never a camera picture). The list shows every profile with its energy curve, its name and what the person plays with
   (both to change there), what was learned, and the buttons to use, export and delete it. The profile in use is also
   chosen in the panel's Movement card.

   `describe`, `effect`, `sessionName` and `curvePoints` are pure (tests/js/flowprofiles.test.mjs). Looks:
   flowprofiles.css – only transform and opacity move. A global `FlowProfiles`. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const P = node ? require('./flowprofile.js') : root.DreamFlowProfile, R = node ? require('./dancerec.js') : root.DreamDanceRec;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const MAX_TAKE = 180;                                // seconds: the longest live take (it stops and learns by itself)
  const BUILT_IN = 8;                                  // shoulder widths a second: the speed that is full energy without a profile (dance.js)
  const KIND = { on: () => T('Fire/LED'), marker: () => T('LED markers'), hand: () => T('Hands (AI)') };
  const kindName = k => (Object.prototype.hasOwnProperty.call(KIND, k) ? KIND[k]() : String(k));
  // a number as the page's language writes it (2.1 – 2,1)
  const num = (x, digits) => x.toLocaleString(root.I18N && root.I18N.lang ? root.I18N.lang : 'en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  let mounted = 0;

  // ---------- a profile in words ----------
  // what was learned of the person, in a few short pieces
  function describe(p) {
    const s = p.stats, out = [];
    if (s.tempo) out.push(Math.round(s.tempo.hi) - Math.round(s.tempo.lo) >= 8 ? T('{a}–{b} a minute', { a: Math.round(s.tempo.lo), b: Math.round(s.tempo.hi) }) : T('{n} a minute', { n: Math.round(s.tempo.mid) }));
    if (s.turn.share > 0.4) out.push(s.turn.dir > 0.3 ? T('turns anticlockwise') : s.turn.dir < -0.3 ? T('turns clockwise') : T('turns both ways'));
    const plane = ['wall', 'wheel', 'floor'].reduce((a, k) => (s.planes[k] > s.planes[a] ? k : a));
    if (s.planes[plane] >= 0.5) out.push(plane === 'wall' ? T('mostly circles seen face-on') : plane === 'wheel' ? T('mostly upright lines') : T('mostly lying lines'));
    if (p.figures.length) out.push(p.figures.length === 1 ? T('1 figure of their own') : T('{n} figures of their own', { n: p.figures.length }));
    out.push(T('learned from {s} s of movement', { s: Math.round(s.seconds) }));
    return out;
  }
  // what the profile changes while Flowtrack runs, as sentences (c: the compiled profile)
  function effect(c) {
    const x = c.speed / BUILT_IN, out = [];
    out.push(x < 0.9 ? T('The effects reach their full strength at {p} % of the speed Dream expects without a profile.', { p: Math.round(x * 100) })
      : x > 1.1 ? T('The effects keep their range up to {x} times the speed Dream expects without a profile.', { x: num(x, 1) })
        : T('This person moves about as fast as Dream expects without a profile.'));
    if (c.smooth < 0.95) out.push(T('The effects answer faster (smoothing × {k}).', { k: num(c.smooth, 2) }));
    else if (c.smooth > 1.05) out.push(T('The effects answer more calmly (smoothing × {k}).', { k: num(c.smooth, 2) }));
    out.push(T('The automatic waits {s} s when the performer is out of sight and expects the detection “{k}”.', { s: num(c.auto.hold, 1), k: kindName(c.auto.kind) }));
    return out;
  }
  // a session of the lab in the list to learn from: "2026-11-24 12:00 · 85 s"
  function sessionName(m) {
    const d = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)/.exec(String(m && m.id));
    return (d ? `${d[1]}-${d[2]}-${d[3]} ${d[4]}:${d[5]}` : String(m && m.id)) + ' · ' + T('{s} s', { s: Math.round((m && m.seconds) || 0) });
  }
  // the energy over the session as the points of a line in a w × h box
  const curvePoints = (curve, w, h) => curve.map((y, i) => `${(i / (curve.length - 1) * w).toFixed(1)},${(h - 1 - Math.min(1, Math.max(0, y)) * (h - 2)).toFixed(1)}`).join(' ');
  const WHY = {
    nosession: () => T('That is not a session to learn from.'),
    nobody: () => T('Nobody was found in it – is the camera running in the mode Flowtrack, and does it see the performer?'),
    short: v => T('Too little movement to learn from: {s} s of at least {n} s. Let the performer move for a minute or two.', v),
  };

  // ---------- the part of the page ----------
  // opts: {live() (the stage's live record with the detector's input, or null), keys (the stream's sources),
  //   state() ({mode, profile, profiles, fitted}), setProfile(id), changed()}
  function mount(box, opts) {
    const doc = box.ownerDocument, n = ++mounted, el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const id = k => `fp${n}-${k}`;
    box.classList.add('fp');
    const h = el('h2', '', T('Performers')); h.id = id('h'); box.setAttribute('aria-labelledby', h.id);
    const intro = el('div', 'hint', T('A profile is what Dream learned of one person’s way of moving – how fast, how wide, how they turn, their tempo and their figures. With it the effects and the automatic fit that person. It is numbers and the name you give it, kept on this Mac only – never a camera picture.'));
    // the profile in use
    const useRow = el('div', 'fp-use'), useLab = el('label', '', T('Flowtrack is fitted to')), use = el('select'), fit = el('div', 'hint fp-fit');
    use.id = id('use'); useLab.htmlFor = use.id; fit.setAttribute('role', 'status');
    useRow.append(useLab, use, fit);
    const list = el('ul', 'fp-list'); list.setAttribute('aria-label', T('The profiles kept on this Mac'));
    // learning
    const h3 = el('h3', '', T('Learn a new profile')), form = el('div', 'fp-form');
    const name = el('input'), from = el('select'), go = el('button', 'btn', T('Learn'));
    name.type = 'text'; name.maxLength = 32; name.placeholder = T('Name, e.g. “Anna – Poi”'); name.setAttribute('aria-label', T('Name of the new profile')); name.autocomplete = 'off';
    from.setAttribute('aria-label', T('What to learn from')); go.type = 'button';
    form.append(name, from, go);
    const bar = el('div', 'fp-bar'), fill = el('i'); bar.setAttribute('aria-hidden', 'true'); bar.append(fill);
    const said = el('div', 'hint fp-say'); said.setAttribute('role', 'status'); said.setAttribute('aria-live', 'polite');
    // the foot: where they are kept, and a profile from a file
    const foot = el('div', 'fp-foot'), where = el('div', 'hint'), imp = el('button', 'btn', T('Take in a profile file …')), file = el('input');
    imp.type = 'button'; file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true; file.setAttribute('aria-hidden', 'true'); file.tabIndex = -1;
    foot.append(where, imp, file);
    box.append(h, intro, useRow, list, h3, form, bar, said, foot);

    const say = text => { said.textContent = text; };
    use.onchange = () => opts.setProfile(use.value);
    const api = {
      list: () => fetch('/flow/profiles').then(r => r.json()),
      add: p => fetch('/flow/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(r => r.json().then(d => ({ ok: r.ok, ...d }))),
      change: (pid, ch) => fetch('/flow/profiles/' + pid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ch) }).then(r => r.json().then(d => ({ ok: r.ok, ...d }))),
      exp: pid => fetch('/flow/profiles/' + pid + '/export', { method: 'POST' }).then(r => r.json().then(d => ({ ok: r.ok, ...d }))),
      del: pid => fetch('/flow/profiles/' + pid, { method: 'DELETE' }).then(r => r.ok),
      sessions: () => fetch('/dance/sessions').then(r => r.json()),
      session: sid => fetch('/dance/sessions/' + sid).then(r => (r.ok ? r.json() : null)),
    };
    const failed = () => say(T('Dream did not answer – is it still running?'));
    api.list().then(d => { if (d && d.folder) where.textContent = T('Kept in {f}. A profile is personal data: an export goes to the folder “exports” beside it – keep it in a private place, never in Dream’s code folder or a public repository.', { f: d.folder }); }).catch(() => {});

    // ---------- the list ----------
    // (drawn anew only when the stage has another list, another choice or another mode – not every frame)
    let lastList = null, lastId = null, lastMode = null, shownFit = null;
    function draw(st) {
      const profiles = st.profiles || [], fresh = profiles !== lastList || st.profile !== lastId;
      if (!fresh && st.mode === lastMode && (use.value === st.profile || doc.activeElement === use)) return;
      lastList = profiles; lastId = st.profile; lastMode = st.mode;
      root.MoveCard.fillProfiles(use, profiles, st.profile);
      if (fresh) {
        const act = doc.activeElement, keep = act && list.contains(act) ? [act.closest('li').dataset.id, act.dataset.part] : null;
        list.textContent = '';
        if (!profiles.length) list.append(el('li', 'hint', T('No profile yet. Let a performer move in front of the camera and press “Learn”.')));
        for (const p of profiles) list.append(item(p, p.id === st.profile));
        if (keep) { const again = list.querySelector(`[data-id="${keep[0]}"] [data-part="${keep[1]}"]`); if (again) again.focus(); }
      }
      const p = profiles.find(x => x.id === st.profile), c = p ? P.compile(p, p.id) : null;
      const text = !st.profile ? T('No profile: Flowtrack answers everyone alike.') : !c ? T('This profile is not there (any more) – Flowtrack runs without one.')
        : (st.mode === 'flowtrack' ? '' : T('Used as soon as the mode is Flowtrack.') + ' ') + effect(c).join(' ');
      if (text !== shownFit) { shownFit = text; fit.textContent = text; }
    }
    function item(p, inUse) {
      const li = el('li', 'fp-item' + (inUse ? ' on' : '')); li.dataset.id = p.id;
      const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), line = doc.createElementNS(ns, 'polyline');
      svg.setAttribute('viewBox', '0 0 96 28'); svg.setAttribute('class', 'fp-curve'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      line.setAttribute('points', curvePoints(p.stats.curve, 96, 28)); svg.append(line);
      const title = el('title'); title.textContent = T('The energy over the session it was learned from'); svg.prepend(title);
      const nm = el('input'), prop = el('select'), about = el('div', 'hint fp-about', describe(p).join(' · '));
      nm.type = 'text'; nm.maxLength = 32; nm.value = p.name; nm.dataset.part = 'name'; nm.setAttribute('aria-label', T('Name of the profile “{n}”', { n: p.name }));
      prop.dataset.part = 'prop'; prop.setAttribute('aria-label', T('What “{n}” plays with', { n: p.name }));
      for (const k of Object.keys(P.PROPS)) { const o = el('option', '', P.propName(k)); o.value = k; prop.append(o); }
      prop.value = p.prop;
      const btns = el('div', 'btns'), useBtn = el('button', 'btn' + (inUse ? ' on' : ''), inUse ? T('In use') : T('Use')), exp = el('button', 'btn', '⬇'), del = el('button', 'btn', '🗑');
      for (const b of [useBtn, exp, del]) b.type = 'button';
      useBtn.dataset.part = 'use'; useBtn.setAttribute('aria-pressed', String(inUse)); useBtn.title = inUse ? T('Flowtrack is fitted to “{n}”. Press to run without a profile.', { n: p.name }) : T('Fit Flowtrack to “{n}”', { n: p.name });
      exp.dataset.part = 'exp'; exp.title = T('Write a copy of this profile to the exports folder on this Mac'); exp.setAttribute('aria-label', T('Export the profile “{n}”', { n: p.name }));
      del.dataset.part = 'del'; del.title = T('Delete this profile'); del.setAttribute('aria-label', T('Delete the profile “{n}”', { n: p.name }));
      nm.onchange = () => {
        const v = nm.value.trim().replace(/\s+/g, ' ');
        if (v === p.name) { nm.value = p.name; return; }
        if (!P.NAME.test(v)) { nm.value = p.name; say(T('A name: letters, digits, spaces and . + - \' , at most 32 characters.')); return; }
        api.change(p.id, { name: v }).then(r => { if (r.ok) { opts.changed(); say(T('“{a}” is now called “{b}”.', { a: p.name, b: r.name })); } else { nm.value = p.name; say(r.error || ''); } }).catch(failed);
      };
      prop.onchange = () => api.change(p.id, { prop: prop.value }).then(r => { if (r.ok) { opts.changed(); say(T('“{n}” plays with: {p}.', { n: p.name, p: P.propName(r.prop) })); } else { prop.value = p.prop; say(r.error || ''); } }).catch(failed);
      useBtn.onclick = () => { opts.setProfile(inUse ? '' : p.id); say(inUse ? T('Flowtrack runs without a profile.') : T('Flowtrack is fitted to “{n}”.', { n: p.name })); };
      exp.onclick = () => api.exp(p.id).then(r => say(r.ok ? T('Written: {f}. It is personal data – move it to a private place, never into Dream’s code folder or a public repository.', { f: r.file }) : r.error || '')).catch(failed);
      del.onclick = () => {
        if (del.dataset.sure) { api.del(p.id).then(ok => { if (ok) { opts.changed(); say(T('“{n}” deleted.', { n: p.name })); name.focus(); } }).catch(failed); return; }
        del.dataset.sure = '1'; del.textContent = T('Really delete?'); setTimeout(() => { delete del.dataset.sure; del.textContent = '🗑'; }, 3000);
      };
      btns.append(useBtn, exp, del);
      li.append(svg, nm, prop, btns, about);
      return li;
    }

    // ---------- learning ----------
    let take = null, took = 0, busy = false, sessionsKey = '';
    function sessions() {
      api.sessions().then(d => {
        const all = (d && Array.isArray(d.sessions) ? d.sessions : []).filter(m => m && m.kind === 'session' && m.seconds >= P.MIN_SECONDS), key = JSON.stringify(all.map(m => m.id));
        if (key === sessionsKey && from.options.length) return;
        sessionsKey = key;
        const was = from.value; from.textContent = '';
        const o = el('option', '', T('live: what the camera sees from now on')); o.value = ''; from.append(o);
        for (const m of all) { const x = el('option', '', T('the session {s}', { s: sessionName(m) })); x.value = m.id; from.append(x); }
        if ([...from.options].some(x => x.value === was)) from.value = was;
      }).catch(() => { if (!from.options.length) { const o = el('option', '', T('live: what the camera sees from now on')); o.value = ''; from.append(o); } });
    }
    sessions();
    from.addEventListener('focus', sessions);
    function button() {
      go.disabled = busy; go.classList.toggle('rec', !!take);
      go.textContent = busy ? T('Learning …') : take ? T('Stop and learn ({t})', { t: Math.floor(took / 60) + ':' + String(Math.floor(took % 60)).padStart(2, '0') }) : T('Learn');
      fill.style.transform = `scaleX(${take ? Math.min(1, took / MAX_TAKE).toFixed(3) : 0})`;
      name.disabled = from.disabled = !!take || busy;
    }
    // the session is measured a moment later, so the button shows "Learning …" first (a long one takes about a second)
    function learnFrom(session, called) {
      busy = true; button(); say(T('Learning from {s} s …', { s: Math.round((session && session.seconds) || 0) }));
      setTimeout(() => {
        let got; try { got = P.learn(session); } catch (e) { got = { why: 'nosession' }; }
        const done = text => { busy = false; button(); say(text); };
        if (got.why) { done(WHY[got.why === 'short' ? 'short' : got.why === 'nobody' ? 'nobody' : 'nosession']({ s: Math.round(got.seconds || 0), n: P.MIN_SECONDS })); return; }
        const p = P.profile(called, got.prop, got);
        api.add(p).then(r => {
          if (!r.ok) { done(r.error || ''); return; }
          opts.changed(); opts.setProfile(r.id); name.value = '';
          done(T('Learned “{n}”: {about}. Flowtrack is fitted to it now. Dream takes it for “{p}” – change that in the list if it is something else.', { n: r.name, about: describe(r).join(', '), p: P.propName(r.prop) }));
        }).catch(() => { busy = false; button(); failed(); });
      }, 30);
    }
    function stop() {
      if (!take) return;
      const session = take.rec.stop(), called = take.name; take = null; took = 0;
      learnFrom(session, called);
    }
    go.onclick = () => {
      if (busy) return;
      if (take) { stop(); return; }
      const called = name.value.trim().replace(/\s+/g, ' ');
      if (!P.NAME.test(called)) { say(T('Give the profile a name first, e.g. “Anna – Poi” (letters, digits, spaces and . + - \' , at most 32 characters).')); name.focus(); return; }
      if (from.value) {
        busy = true; button(); say(T('Reading the session …'));
        api.session(from.value).then(s => { busy = false; if (s) learnFrom(s, called); else { button(); say(WHY.nosession()); } }).catch(() => { busy = false; button(); failed(); });
        return;
      }
      if (!opts.live()) { say(T('Nothing to learn from right now: the camera does not see anyone. Switch to Flowtrack, let the performer step into the picture, then press “Learn”.')); return; }
      take = { rec: R.recorder(opts.keys, [], 16 / 9), name: called }; took = 0; button();
      say(T('Taking the movement of “{n}” … Let them play as in a show – calm and wild, a minute or two (at least {s} s of movement). Then press the button again.', { n: called, s: P.MIN_SECONDS }));
    };
    imp.onclick = () => file.click();
    file.onchange = () => {
      const f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      if (f.size > 64 * 1024) { say(T('That is not a performer’s profile.')); return; }
      f.text().then(text => { let p = null; try { p = JSON.parse(text); } catch (e) { /* said below */ }
        if (!P.usable(p)) { say(T('That is not a performer’s profile.')); return; }
        return api.add(p).then(r => { if (r.ok) { opts.changed(); say(T('Taken in: “{n}”.', { n: r.name })); } else say(r.error || ''); });
      }).catch(failed);
    };

    // every frame of the page: the list follows the stage; a live take takes the stage's frame
    let shownSec = -1;
    function tick() {
      let st; try { st = opts.state(); } catch (e) { return; }
      draw(st);
      if (!take) return;
      let live = null; try { live = opts.live(); } catch (e) { /* the stage is reloading */ }
      if (live && live.rec && Number.isFinite(live.rec.t)) {
        take.rec.add(live.rec.t, t => R.pack(t, opts.keys, live.rec, live.input, null, {}));
        took = take.rec.seconds;
      }
      if (took >= MAX_TAKE) { stop(); return; }
      if (Math.floor(took) !== shownSec) { shownSec = Math.floor(took); button(); }
    }
    button();
    return { tick, get taking() { return !!take; } };
  }

  const api = { mount, describe, effect, sessionName, curvePoints, MAX_TAKE };
  if (node) module.exports = api;
  else root.FlowProfiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
