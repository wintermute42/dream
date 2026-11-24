// #238: who computes right now – the Mac or the cloud GPU – and at which step a cloud GPU is. One place for the panel
// (index.html) and Dream Control (remote.html): the stage takes from it where its pictures are painted, and both pages
// draw the same badge from it (compute.css). No build step: a page loads this file and calls DreamCompute.…; the texts
// go through T() of i18n.js.
//
//   cloud    the status the server pushes (cloud.py): { state, busy, type, minutes, cost_eur, …, work: { phase,
//            eta_min, percent } } – work.phase is the step the cloud GPU is at (cloud.py names them)
//   backend  what the owner chose: 'local' or 'cloud'
//   bridge   the setting "cloud_bridge": while the cloud GPU sends no pictures, the Mac paints
window.DreamCompute = (() => {
  'use strict';
  const STEPS = ['machine', 'download', 'loading', 'compiling', 'ready'];
  const stepName = (step, percent) => step === 'machine' ? T('GPU starts')
    : step === 'download' ? (percent != null ? T('Model is downloaded ({p} %)', { p: percent }) : T('Model is downloaded'))
    : step === 'loading' ? T('Model loads') : step === 'compiling' ? T('Is optimised') : T('Ready');

  // Who paints, and what the badge says: { paints: 'mac' | 'cloud' | null (nobody), kind (the badge's colour: mac,
  // cloud, bridge, wait, down), text, sub, steps: [{ name, at: 'done' | 'now' | 'todo' }] while the cloud GPU prepares
  // (else null), offer: the cloud GPU is ready and the Mac still paints }
  function now(backend, cloud, bridge) {
    const work = (cloud && cloud.work) || {}, phase = work.phase || null;
    const preparing = STEPS.includes(phase) && phase !== 'ready', ready = phase === 'ready', wanted = backend === 'cloud';
    const paints = !wanted ? 'mac' : ready ? 'cloud' : bridge ? 'mac' : null;
    const step = preparing ? stepName(phase, work.percent) : '';
    const left = work.eta_min ? T('about {n} min left (it costs already)', { n: work.eta_min }) : T('it costs already');
    let kind = 'mac', text = T('Computing now: Mac'), sub = '';
    if (wanted && ready) { kind = 'cloud'; text = T('Computing now: Cloud ✓'); }
    else if (preparing && !wanted) sub = T('The cloud prepares: {step} · {left}', { step, left });
    else if (preparing && bridge) { kind = 'bridge'; text = T('The Mac bridges – cloud: {step} …', { step }); sub = T('{left} · the cloud takes over by itself', { left }); }
    else if (preparing) { kind = 'wait'; text = T('The cloud prepares: {step} …', { step }); sub = T('{left} · no pictures until then', { left }); }
    else if (phase === 'unreachable' && !wanted) sub = T('The cloud GPU does not answer – it costs until you delete it.');
    else if (phase === 'unreachable') {
      kind = 'down'; text = bridge ? T('Cloud not reachable – the Mac computes') : T('Cloud not reachable – no pictures');
      sub = T('The cloud GPU does not answer – it costs until you delete it.');
    }
    else if (ready) sub = T('The cloud GPU is ready (it costs).');
    else if (wanted) {                                 // no cloud GPU there: not started, deleted, or the start failed
      kind = bridge ? 'mac' : 'wait'; text = bridge ? T('No cloud GPU started – the Mac computes') : T('No cloud GPU started – no pictures');
      sub = bridge ? T('Start one below.') : T('Start one below, or switch to “Local”.');
    }
    const at = STEPS.indexOf(phase);
    return { paints, kind, text, sub, offer: ready && !wanted,
      steps: preparing ? STEPS.map((s, i) => ({ name: stepName(s, s === phase ? work.percent : null), at: i < at ? 'done' : i === at ? 'now' : 'todo' })) : null };
  }

  // "Start" makes sense while no cloud GPU is there – or one is there and does not answer (it connects again)
  const canStart = c => !c.busy && c.state !== 'setup' && (!c.work || c.work.phase === 'unreachable');
  // the cloud GPU has just become ready (the page tells it once): before and after are two statuses in a row
  const becameReady = (before, after) => !!(after && after.work && after.work.phase === 'ready' && before && before.work
    && before.work.phase !== 'ready' && before.work.phase !== 'stopping');

  // The badge in box (an element with class "compute"): built once, then only what changed is written, so a screen
  // reader hears the headline when it changes and not with every status. onSwitch: the tap on "switch to the cloud".
  const MARK = { done: '✓', now: '●', todo: '○' };
  function draw(box, info, onSwitch) {
    let p = box._parts;
    if (!p) {
      const el = (tag, cls) => { const e = document.createElement(tag); e.className = cls; box.append(e); return e; };
      p = box._parts = { now: el('p', 'compute-now'), sub: el('p', 'compute-sub'), steps: el('ol', 'compute-steps'), offer: el('button', 'compute-offer') };
      p.now.setAttribute('role', 'status');
      p.dot = document.createElement('span'); p.dot.className = 'compute-dot'; p.dot.setAttribute('aria-hidden', 'true');
      p.text = document.createElement('span'); p.now.append(p.dot, p.text);
      p.offer.type = 'button';
    }
    const set = (el, t) => { if (el.textContent !== t) el.textContent = t; };
    box.dataset.kind = info.kind;
    set(p.text, info.text);
    set(p.sub, info.sub); p.sub.hidden = !info.sub;
    const steps = JSON.stringify(info.steps);
    if (p.steps._drawn !== steps) {
      p.steps._drawn = steps;
      p.steps.textContent = '';
      p.steps.setAttribute('aria-label', T('Steps of the cloud GPU'));
      for (const s of info.steps || []) {
        const li = document.createElement('li'), mark = document.createElement('span');
        li.className = s.at; if (s.at === 'now') li.setAttribute('aria-current', 'step');
        mark.className = 'compute-mark'; mark.textContent = MARK[s.at]; mark.setAttribute('aria-hidden', 'true');
        li.append(mark, s.name);
        p.steps.append(li);
      }
    }
    p.steps.hidden = !info.steps;
    set(p.offer, T('☁ Cloud ready – switch?')); p.offer.hidden = !info.offer; p.offer.onclick = onSwitch;
  }

  return { STEPS, now, canStart, becameReady, draw };
})();
