/* Dream – the introduction to the page of Dream Dance (#265): a short guided tour over the real page the first time it
   is opened, in the order of the signal's way – what Dream sees, the clutch, the sentences, the beat, recording and
   teaching. Each step lights up one part of the page (the rest is dimmed) and says one sentence; [Next] goes on.
   "Help off" ends it and hides the page's explanations; the "?" in the head brings both back and starts it again. What
   was chosen is remembered in this browser (localStorage: only "on" or "off", nothing else).

   `STEPS`, `wanted` are pure (tests/js/danceslots.test.mjs). Looks: danceslots.css – only transform and opacity move.
   A global `DanceIntro`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : text);
  const KEY = 'dream.dance.help';
  // the steps: where on the page (a selector – the first one that is shown counts) and the one sentence
  const STEPS = [
    { k: 'camera', at: ['#dancelab .dl-cam', '#dancelab'], say: () => T('This is what Dream sees: move a hand, and the skeleton follows.') },
    { k: 'clutch', at: ['.mp-clutch'], say: () => T('Only engaged does your dance act: press K – the lock opens and the traffic light turns green.') },
    { k: 'slots', at: ['#slots .ds-lanes', '#slots'], say: () => T('Movement → effect: throw your arms up, and its sentence lights up.') },
    { k: 'beat', at: ['#beatcard'], say: () => T('Two dots blink – your beat and the music’s; when they blink together, you dance in time.') },
    { k: 'learn', at: ['#slots .ds-learn', '#dancelab .dl-bar'], say: () => T('“Record” keeps a session to look at later; “Teach a movement …” teaches Dream one of yours.') },
  ];
  // Whether the tour comes by itself: the first time, and as long as the help was not switched off.
  const wanted = stored => stored !== 'off';
  const read = () => { try { return root.localStorage.getItem(KEY); } catch (e) { return null; } };
  const write = v => { try { root.localStorage.setItem(KEY, v); } catch (e) { /* a private window: asked again next time */ } };

  // helpBtn: the "?" of the page's head
  function mount(helpBtn) {
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const veil = el('div', 'di-veil'), spot = el('div', 'di-spot'), tip = el('div', 'di-tip'), text = el('p', 'di-text'), count = el('span', 'di-count');
    const next = el('button', 'btn on', T('Next')), off = el('button', 'btn', T('Help off'));
    next.type = off.type = 'button';
    tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-modal', 'false'); tip.setAttribute('aria-label', T('Introduction to the page'));
    spot.setAttribute('aria-hidden', 'true'); veil.setAttribute('aria-hidden', 'true');
    const row = el('div', 'btns'); row.append(next, off); tip.append(count, text, row);
    veil.append(spot); document.body.append(veil, tip);
    let at = -1;
    const help = on => { document.body.classList.toggle('mp-nohelp', !on); helpBtn.setAttribute('aria-pressed', String(on)); };
    function target(step) {
      for (const sel of step.at) { const e = document.querySelector(sel); if (e && e.offsetParent !== null && e.getClientRects().length) return e; }
      return null;
    }
    function place() {
      if (at < 0) return;
      const e = target(STEPS[at]);
      if (!e) { go(at + 1); return; }
      e.scrollIntoView({ block: 'center', behavior: 'auto' });
      follow();
    }
    let was = '';
    function follow() {
      const e = target(STEPS[at]);
      if (!e) return;
      const r = e.getBoundingClientRect(), pad = 6, key = [r.left, r.top, r.width, r.height].map(Math.round).join();
      if (key === was) return;
      was = key;
      spot.style.width = `${r.width + 2 * pad}px`; spot.style.height = `${r.height + 2 * pad}px`;
      spot.style.transform = `translate(${r.left - pad}px, ${r.top - pad}px)`;
      const below = r.bottom + 12 + 140 < innerHeight, x = Math.min(Math.max(12, r.left), innerWidth - 12 - Math.min(380, innerWidth - 24));
      tip.style.transform = `translate(${x}px, ${below ? r.bottom + 12 : Math.max(12, r.top - 12 - tip.offsetHeight)}px)`;
    }
    function go(i) {
      at = i;
      if (at >= STEPS.length) { end(); return; }
      veil.classList.add('on'); tip.classList.add('on');
      count.textContent = T('{i} of {n}', { i: at + 1, n: STEPS.length });
      text.textContent = STEPS[at].say();
      next.textContent = at === STEPS.length - 1 ? T('Done') : T('Next');
      place(); next.focus();
    }
    function end() { at = -1; veil.classList.remove('on'); tip.classList.remove('on'); helpBtn.focus(); }
    next.onclick = () => go(at + 1);
    off.onclick = () => { write('off'); help(false); end(); };
    tip.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); end(); } });
    addEventListener('resize', place); addEventListener('scroll', () => { if (at >= 0) place(); }, { passive: true });
    setInterval(() => { if (at >= 0) follow(); }, 300);   // the page still grows (the lab's views): the spot follows
    helpBtn.onclick = () => { write('on'); help(true); go(0); };
    const on = wanted(read());
    help(on);
    return { start() { if (on && read() == null) { write('on'); go(0); } }, go, end, get step() { return at; } };
  }

  const api = { mount, STEPS, wanted, KEY };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DanceIntro = api;
})(typeof window !== 'undefined' ? window : globalThis);
