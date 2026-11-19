// #217: what the sliders do to the picture, shown without a word – for the panel and for Dream Control.
//
//   const signs = DreamSigns.create();
//   const sliders = DreamSliders.create({ on, painted: signs.paint });   every drawn slider tells its sign (sliders.js)
//   signs.shape(element);                              the four-axis shape of the picture's character lives in it
//   signs.tempo({ pics, bpm });                        AI pictures per second and the music's tempo, when the page knows
//
// A sign is a small moving mark beside the name of a slider, in the real tempo of what the setting does: the rotation
// mark turns as fast as the picture turns, the zoom rings grow as fast as the picture is pulled in, the colour wheel
// circles with the colours, the trail is as long as the afterglow of the smoothing, the form grows as fast as the
// picture becomes a new one, the bars bounce on the beat. At 0, or while the switch of the setting is off, the sign
// stands still. The shape has one axis each for change, motion, colour and music, marked with the same signs; a corner
// takes the heat colour of its slider (sliders.js) – there is no other colour rule.
// Only transform and opacity are animated (Web Animations: the browser's compositor moves them, and a change of the
// tempo never makes a sign jump). A sign that is not on screen (panel hidden, card folded, scrolled away, tab in the
// background) pauses; with "reduce motion" every sign stands still and shows only the strength.
(function (root) {
  'use strict';

  // ---------- the rules: pure, tested in tests/js/signs.test.mjs ----------
  const PICS = 4;           // AI pictures per second while the page does not know better
  const BPM = 120;          // the beat while no music tempo is known
  const ORBIT = 2.4;        // seconds the dot of the trail takes for one round
  const RING = 3;           // a zoom ring has grown this many times when its cycle ends
  const NEW = 0.05;         // the share of the old picture that is left when the growing form is full
  const FASTEST = 0.4;      // no sign cycles faster than this (seconds)
  const SIGNS = { rot: 'turn', zoom: 'rings', hue: 'wheel', smooth: 'trail', strength: 'grow', sens: 'bars' };
  // the axes of the picture's character, clockwise from the top, each with the sign that marks it and its sliders
  const AXES = [
    { name: 'change', mark: 'grow', keys: ['strength', 'drift'] },
    { name: 'motion', mark: 'turn', keys: ['zoom', 'rot'] },
    { name: 'colour', mark: 'wheel', keys: ['hue'] },
    { name: 'music', mark: 'bars', keys: ['sens'] },
  ];
  // what moves in a sign: its parts (each one cycle behind the first by its share) and their key frames
  const TURN = [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }];
  const PARTS = {
    turn: { lags: [0], frames: TURN },
    wheel: { lags: [0], frames: TURN },
    trail: { lags: [0, 0, 0, 0, 0], frames: TURN },       // the dot and four that follow it; how far behind: tailLags()
    rings: { lags: [0, 1 / 3, 2 / 3], frames: [{ transform: 'scale(.3)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'scale(1)', opacity: 0 }] },
    grow: { lags: [0], frames: [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1)', opacity: 1, offset: 0.8 }, { transform: 'scale(1)', opacity: 0 }] },
    bars: { lags: [0, 0.5, 0.25], frames: [{ transform: 'scaleY(.25)' }, { transform: 'scaleY(1)', offset: 0.3 }, { transform: 'scaleY(.25)' }] },
  };

  const clamp01 = x => Math.min(1, Math.max(0, x));
  // how far a value is from zero, as a share of the way to that end of the range: 0 … 1
  function amount(s, v) {
    if (!s || !v) return 0;
    const end = v > 0 ? s.hi : s.lo;
    return end && end * v > 0 ? clamp01(v / end) : 0;
  }
  // the afterglow of the smoothing in seconds (the stage blends its pictures with it)
  const smoothTau = v => Math.pow(clamp01(v), 1.5) * 1.6;
  // the sign of a slider: its kind, the strength it shows (0 … 1), the direction (-1 backwards) and the seconds of one
  // cycle – Infinity: it stands still. acts: the switch the setting needs is on.
  function sign(key, s, v, { acts = true, pics = PICS, bpm = BPM } = {}) {
    const kind = SIGNS[key];
    if (!kind || !s) return null;
    const a = acts ? amount(s, v) : 0, mag = Math.abs(v);
    let period = Infinity, tail = 0;
    if (a > 0) {
      if (kind === 'turn' || kind === 'wheel') period = 360 / (mag * pics);                 // degrees per picture
      else if (kind === 'rings') period = Math.log(RING) / (pics * Math.log(1 + mag));      // the pull per picture
      else if (kind === 'grow') period = Math.log(NEW) / Math.log(1 - Math.min(mag, 0.99)) / pics;   // pictures until all is new
      else if (kind === 'bars') period = 60 / bpm;
      else { period = ORBIT; tail = smoothTau(v); }
      period = Math.max(FASTEST, period);
    }
    return { kind, amount: a, dir: v < 0 ? -1 : 1, period, tail, still: !(a > 0) };
  }
  // where a sign stands while it does not move, as a share of its cycle: the strength, as far as the sign can show it
  function pose(sg) {
    return sg.kind === 'turn' ? sg.amount / 2 : sg.kind === 'grow' ? sg.amount * 0.8 : sg.kind === 'bars' ? 0.3 : sg.kind === 'rings' ? 0.5 : 0.125;
  }
  // how far the followers of the trail are behind the dot (shares of the round) and how bright each one is
  function tailLags(tail, n = PARTS.trail.lags.length) {
    const reach = Math.min(tail / ORBIT, 0.7);
    return Array.from({ length: n }, (_, i) => ({ lag: reach * i / (n - 1), opacity: i === 0 ? 1 : tail > 0 ? 0.8 * (1 - i / n) : 0 }));
  }
  // the character of the picture: every axis as long as its strongest slider (0 … 1); u: the strongest influence
  // (sliders.js) on that axis, for the colour of its corner. values: key → { s, v, acts, u }
  function axes(values) {
    return AXES.map(ax => {
      const on = ax.keys.map(k => values[k]).filter(Boolean);
      return { name: ax.name, mark: ax.mark,
        amount: Math.max(0, ...on.map(x => (x.acts === false ? 0 : amount(x.s, x.v)))), u: Math.max(0, ...on.map(x => x.u || 0)) };
    });
  }
  // the corners of the shape in a square of -50 … 50: top, right, bottom, left
  const INNER = 5, OUTER = 30;
  function corners(ax) {
    return ax.map((x, i) => { const r = INNER + (OUTER - INNER) * x.amount, t = i * Math.PI / 2; return [+(Math.sin(t) * r).toFixed(1) + 0, +(-Math.cos(t) * r).toFixed(1) + 0]; });   // + 0: never -0
  }
  const rules = { PICS, BPM, ORBIT, SIGNS, AXES, PARTS, amount, smoothTau, sign, pose, tailLags, axes, corners };

  // ---------- the page ----------
  const CYCLE = 1000, BASE = 100;                     // a cycle lasts a second at rate 1; every part starts 100 cycles in
  function create({ doc = root.document } = {}) {
    const T = root.T || (t => t);
    const calm = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const drawn = new Map(), values = {}, shapes = [];          // slider item → its sign on the page
    let tempo = { pics: PICS, bpm: BPM }, queued = false;
    const seen = root.IntersectionObserver ? new IntersectionObserver(list => {
      for (const e of list) for (const d of drawn.values()) if (d.el === e.target) { d.onscreen = e.isIntersecting; run(d); }
    }) : null;

    const el = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e; };
    // the picture of a sign: <span class="sg sg-turn"><span class="sg-in"><i></i>…</span></span>
    function glyph(kind) {
      const box = el('span', 'sg sg-' + kind), inner = el('span', 'sg-in');
      box.setAttribute('aria-hidden', 'true');
      inner.append(...PARTS[kind].lags.map(() => doc.createElement('i')));
      box.append(inner);
      return box;
    }
    function add(item) {
      const kind = SIGNS[item.key], box = glyph(kind), parts = [...box.querySelectorAll('i')];
      const val = item.label.querySelector('.val');
      if (val) val.before(box); else item.label.append(box);
      const d = { el: box, kind, parts, sg: null, onscreen: !seen, anims: parts.map(p => (p.animate
        ? p.animate(PARTS[kind].frames, { duration: CYCLE, iterations: Infinity }) : null)).filter(Boolean) };
      d.anims.forEach(a => a.pause());
      drawn.set(item, d);
      if (seen) seen.observe(box);
      return d;
    }
    const moving = d => !d.sg.still && d.onscreen && !calm.matches && !doc.hidden;
    // every part at its place in the cycle: now is the first part's place, the others are behind by their lag
    function place(d, now) {
      const lags = d.kind === 'trail' ? tailLags(d.sg.tail) : PARTS[d.kind].lags.map(lag => ({ lag }));
      d.anims.forEach((a, i) => {
        a.currentTime = now - lags[i].lag * CYCLE;
        if (lags[i].opacity !== undefined) d.parts[i].style.opacity = lags[i].opacity;
      });
    }
    function run(d) {
      const go = moving(d);
      for (const a of d.anims) {
        a.playbackRate = go ? 1 / d.sg.period : 1;                             // keeps its place in the cycle
        if (go) a.play(); else a.pause();
      }
      if (!go) place(d, (BASE + pose(d.sg)) * CYCLE);                       // it stands and shows only the strength
      else if (d.kind === 'trail' && d.anims[0]) place(d, d.anims[0].currentTime);
      d.el.classList.toggle('sg-still', !go);
    }
    function show(item, d) {
      const sg = d.sg = sign(item.key, item.s, +item.input.value, { acts: item.acts !== false, ...tempo });
      const st = d.el.style;
      st.setProperty('--amt', sg.amount.toFixed(3));
      d.el.classList.toggle('sg-back', sg.dir < 0);
      for (const a of d.anims) if (a.effect && a.effect.updateTiming) a.effect.updateTiming({ direction: sg.dir < 0 ? 'reverse' : 'normal' });
      run(d);
    }
    // called by sliders.js for every slider whose drawing changed
    function paint(item) {
      values[item.key] = { s: item.s, v: +item.input.value, acts: item.acts !== false, u: item.u, c: item.box.style.getPropertyValue('--c') };
      if (SIGNS[item.key] && item.s && item.label) show(item, drawn.get(item) || add(item));
      if (!queued) { queued = true; Promise.resolve().then(() => { queued = false; shapes.forEach(drawShape); }); }
    }
    const again = () => drawn.forEach(run);
    if (calm.addEventListener) calm.addEventListener('change', again);
    doc.addEventListener('visibilitychange', again);

    // the four-axis shape: a square on its corner, the axes marked with the signs, the corners in the sliders' colours
    const SVG = 'http://www.w3.org/2000/svg';
    const svg = (tag, attrs) => { const e = doc.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    function shape(host) {
      host.classList.add('sg-shape'); host.setAttribute('role', 'img'); host.textContent = '';
      const pic = svg('svg', { viewBox: '-50 -50 100 100', 'aria-hidden': 'true', focusable: 'false' });
      const full = corners(AXES.map(() => ({ amount: 1 }))).map(p => p.join(',')).join(' ');
      const area = svg('polygon', { class: 'sg-area' });
      const dots = AXES.map(() => svg('circle', { class: 'sg-dot', r: 3.2 }));
      pic.append(svg('polygon', { class: 'sg-rim', points: full }), svg('path', { class: 'sg-cross', d: `M0 ${-OUTER}V${OUTER}M${-OUTER} 0H${OUTER}` }), area, ...dots);
      host.append(pic, ...AXES.map(ax => { const g = glyph(ax.mark); g.classList.add('sg-still', 'sg-axis', 'sg-axis-' + ax.name); return g; }));
      const sh = { host, area, dots, said: '' };
      shapes.push(sh); drawShape(sh);
    }
    function drawShape(sh) {
      const ax = axes(values), pts = corners(ax);
      sh.area.setAttribute('points', pts.map(p => p.join(',')).join(' '));
      ax.forEach((x, i) => {
        const strongest = AXES[i].keys.map(k => values[k]).filter(v => v && v.u === x.u && x.u > 0)[0];
        sh.dots[i].setAttribute('cx', pts[i][0]); sh.dots[i].setAttribute('cy', pts[i][1]);
        sh.dots[i].style.fill = strongest && strongest.c ? strongest.c : '';
      });
      const pc = ax.map(x => Math.round(x.amount * 100));
      const said = T('Character of the picture: change {a} %, motion {b} %, colour {c} %, music {d} %', { a: pc[0], b: pc[1], c: pc[2], d: pc[3] });
      if (said !== sh.said) { sh.said = said; sh.host.setAttribute('aria-label', said); }
    }
    // pictures per second of the AI and beats per minute of the music, as far as the page knows them
    function setTempo({ pics, bpm } = {}) {
      const next = { pics: pics > 0 ? Math.min(30, Math.max(0.5, Math.round(pics * 2) / 2)) : PICS, bpm: bpm > 0 ? Math.min(240, Math.max(40, Math.round(bpm))) : BPM };
      if (next.pics === tempo.pics && next.bpm === tempo.bpm) return;
      tempo = next;
      for (const [item, d] of drawn) show(item, d);
    }
    return { paint, shape, tempo: setTempo };
  }

  const api = { rules, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamSigns = api;
})(typeof window !== 'undefined' ? window : globalThis);
