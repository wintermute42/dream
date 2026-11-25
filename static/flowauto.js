// #252: Flowtrack's automatic – everything set for following ONE performer (flow, fire, dance), decided from what the
// camera shows. Pure computation, no DOM, no camera, no model: the stage hands it a small sample of the camera picture
// a few times a second (kept nowhere) and acts on what comes back; the Node tests paint synthetic scenes the same way
// (tests/js/flowauto.test.mjs).
//
// Four choices, each with its reason in words, each one overridable by hand (the stage then simply does not follow):
// - the kind of detection: two LED markers in two colours → markers; a dark room with bright (warm) light → fire/LED;
//   a room bright enough → the hand AI. A new proposal must hold a few seconds before it takes over – no flapping.
// - the exposure: short and fixed for lights (the room turns black, no motion blur), normal for the hand AI.
// - the one person: of everything that is detected only what belongs to the performer counts – whoever stands at the
//   edge of the picture (the audience) is ignored.
// - the calibration: the camera's view is compared with the one it had when it was calibrated; when it no longer
//   matches, the automatic says so (it never calibrates by itself).
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const D = node ? require('./dance.js') : root.DreamDance;
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const KINDS = ['on', 'marker', 'hand'];
  const DARK = 0.16, LIGHT = 0.24;                     // the room's brightness (0 … 1): below – dark, above – bright enough for the hand AI
  const SETTLE = 3;                                    // seconds a new proposal must hold before the kind changes
  const EDGE = 0.14;                                   // this near the left or right edge is "at the edge"
  const REACH = 0.3;                                   // what belongs to the person: this near its middle (picture widths)
  const GW = 16, GH = 9;                               // the view's signature: a grid of mean brightnesses

  // ---------- what a camera picture shows, in a few numbers ----------
  // data: RGBA pixels of a small sample (w × h). Returns {lum (mean brightness 0 … 1), bright (share of bright pixels),
  // warm (share of bright pixels in fire's colours), clipped (share burnt out to white), markers (the marker colours
  // seen as one clear spot)}.
  function survey(data, w, h) {
    const n = w * h; let sum = 0, bright = 0, warm = 0, clipped = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sum += (r * 3 + g * 6 + b) / 10;
      if (mn > 245) clipped++;
      if (mx < 170) continue;
      bright++;
      if (r >= g && g >= b && r - b > 0.25 * mx) warm++;   // red … orange … yellow, and not white
    }
    const found = D.findMarkers(data, w, h, Object.fromEntries(Object.keys(D.MARKER_HUES).map(c => [c, c])));
    return { lum: sum / n / 255, bright: bright / n, warm: warm / n, clipped: clipped / n,
      markers: Object.keys(found).filter(c => found[c] && found[c].c >= 0.5) };
  }

  // ---------- the view's signature: where the picture is lighter and darker than its surroundings ----------
  // gray: brightness per pixel (w × h); skip(x, y) → true for places that do not count (Dream's own projection: it
  // changes all the time). Returns a text of GW × GH characters: "0" … "9" for a cell's brightness, "-" for a skipped one.
  function signature(gray, w, h, skip = null) {
    let out = '';
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      if (skip && skip((gx + 0.5) / GW, (gy + 0.5) / GH)) { out += '-'; continue; }
      const x0 = Math.floor(gx * w / GW), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * w / GW)), y0 = Math.floor(gy * h / GH), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * h / GH));
      let s = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += gray[y * w + x];
      out += String(clamp(Math.floor(s / ((x1 - x0) * (y1 - y0)) / 25.6), 0, 9));
    }
    return out;
  }
  // Do two signatures show the same view? {known, score}: the correlation of the cells both have (−1 … 1) – whatever
  // the brightness and the contrast of the two pictures; not known when too little of the view has any structure.
  function sameView(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== GW * GH || b.length !== GW * GH) return { known: false, score: 0 };
    const xs = [], ys = [];
    for (let i = 0; i < a.length; i++) { if (a[i] === '-' || b[i] === '-') continue; xs.push(+a[i]); ys.push(+b[i]); }
    if (xs.length < 40) return { known: false, score: 0 };
    const mean = v => v.reduce((s, x) => s + x, 0) / v.length, mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    if (sxx / xs.length < 0.6 || syy / xs.length < 0.6) return { known: false, score: 0 };   // a flat picture (dark, a white wall) says nothing
    return { known: true, score: sxy / Math.sqrt(sxx * syy) };
  }
  // inside the four corners of Dream's picture in the camera picture (quad: [[x, y] × 4], in order)?
  function inQuad(quad, x, y) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = quad[i], [bx, by] = quad[(i + 1) % 4], c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (Math.abs(c) < 1e-9) continue;
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
    return sign !== 0;
  }

  // ---------- the reasons, in words ----------
  const COLOUR = { cyan: () => T('cyan'), magenta: () => T('magenta'), green: () => T('green'), blue: () => T('blue') };
  const colour = c => (Object.prototype.hasOwnProperty.call(COLOUR, c) ? COLOUR[c]() : String(c == null ? '' : c));
  const WHY = {
    markers: v => T('Two LED markers in two colours ({a}, {b}) are in the picture.', { a: colour(v.a), b: colour(v.b) }),
    fire: () => T('The room is dark and there is bright, warm light: fire.'),
    lights: () => T('The room is dark and there are bright lights: LEDs.'),
    room: () => T('The room is bright enough for the hand AI, and there are no markers.'),
    wait: () => T('Dark and nothing bright yet – it stays as it is.'),
    first: () => T('Not decided yet – looking at the room.'),
    shortLights: () => T('Lights: a short, fixed exposure – the room turns black, the lights stay sharp.'),
    shortBurnt: () => T('The lights burn out to white: a short exposure keeps their colour.'),
    normalHand: () => T('The hand AI needs a normally exposed picture.'),
    normalLook: () => T('Nothing bright for a while: a normal exposure to look at the room again.'),
    noOne: () => T('Nobody found yet.'),
    one: () => T('Following the performer in the middle.'),
    edge: v => T('Following the performer – ignoring {n} at the edge or far away.', v),
    lone: () => T('Only someone at the edge is there: taken as the performer.'),
    calibNone: () => T('Not calibrated.'),
    calibOk: () => T('The camera sees what it saw when it was calibrated.'),
    calibMoved: () => T('The camera’s view no longer matches the calibration – camera or projector were moved? Calibrate again.'),
    calibDark: () => T('Too dark or too plain to tell whether the camera was moved.'),
  };
  const why = (code, vars) => (Object.prototype.hasOwnProperty.call(WHY, code) ? WHY[code](vars || {}) : '');

  // ---------- the automatic ----------
  function create() {
    let kind = null, want = null, wantAt = 0, room = null, litAt = null, centre = null, lostAt = null, loneAt = null, off = 0, viewCode = 'calibNone';

    // obs: a survey; now: {kind, short, hand} – what the camera is set to, and whether the kind was chosen by hand;
    // t: seconds. Returns {kind: {value, code, vars}, short: {value, code}} – the kind and the exposure the automatic
    // would choose. The exposure goes with the kind that really runs: a kind chosen by hand gets the exposure it needs.
    function look(obs, now, t) {
      if (!now.short || room == null) room = obs.lum;   // under a short exposure every room is black: the last known brightness counts
      const lit = obs.bright > 0.0008, two = obs.markers.length >= 2;
      let p;
      if (two) p = { value: 'marker', code: 'markers', vars: { a: obs.markers[0], b: obs.markers[1] } };
      else if (room < DARK && lit) p = { value: 'on', code: obs.warm > 0.5 * obs.bright ? 'fire' : 'lights' };
      else if (room > LIGHT) p = { value: 'hand', code: 'room' };
      else p = { value: kind ? kind.value : 'hand', code: kind ? 'wait' : 'room' };
      if (!kind) kind = p;                             // the first look decides at once
      else if (p.value === kind.value) { want = null; if (p.code !== 'wait') kind = p; }
      else if (!want || want.value !== p.value) { want = p; wantAt = t; }
      else if (t - wantAt >= SETTLE) { kind = p; want = null; }
      // the exposure
      if (lit || now.kind === 'hand') litAt = t; else if (litAt == null) litAt = t;
      let short; const runs = now.hand && KINDS.includes(now.kind) ? now.kind : kind.value;
      if (runs === 'hand') short = { value: false, code: 'normalHand' };
      else if (t - litAt > 20) short = { value: false, code: 'normalLook' };   // lights gone for long: look at the room again
      else short = { value: true, code: obs.clipped > 0.002 && !now.short ? 'shortBurnt' : 'shortLights' };
      return { kind, short, room };
    }

    // The one person. cands: [{x, y, w}] – what was detected (0 … 1 in the camera picture; w: how much it weighs).
    // Returns {centre: [x, y] | null, keep: [indices of what belongs to the person], ignored, code, vars}.
    function person(cands, t) {
      const ok = (cands || []).map((c, i) => ({ ...c, i })).filter(c => Number.isFinite(c.x + c.y));
      const edge = c => c.x < EDGE || c.x > 1 - EDGE;
      if (centre) {
        const mine = ok.filter(c => Math.hypot(c.x - centre[0], c.y - centre[1]) <= REACH);
        if (mine.length) {
          lostAt = null;
          const mx = mine.reduce((s, c) => s + c.x, 0) / mine.length, my = mine.reduce((s, c) => s + c.y, 0) / mine.length;
          centre = [centre[0] + (mx - centre[0]) * 0.35, centre[1] + (my - centre[1]) * 0.35];   // it follows the performer – also to the edge
          const ignored = ok.length - mine.length;
          return { centre, keep: mine.map(c => c.i), ignored, code: ignored ? 'edge' : 'one', vars: { n: ignored } };
        }
        if (lostAt == null) lostAt = t;
        if (t - lostAt < 2.5) return { centre, keep: [], ignored: ok.length, code: ok.length ? 'edge' : 'one', vars: { n: ok.length } };   // gone for a moment: nobody else steps in
        centre = null; lostAt = null;
      }
      const inner = ok.filter(c => !edge(c));
      if (inner.length) {
        loneAt = null;
        const best = inner.reduce((a, c) => ((c.w || 1) * (1 - Math.abs(c.x - 0.5)) > (a.w || 1) * (1 - Math.abs(a.x - 0.5)) ? c : a));
        centre = [best.x, best.y];
        return person(cands, t);
      }
      if (ok.length) {                                 // only someone at the edge: the performer, if they stay
        if (loneAt == null) loneAt = t;
        if (t - loneAt >= 3) { const c = ok.reduce((a, b) => ((b.w || 1) > (a.w || 1) ? b : a)); centre = [c.x, c.y]; loneAt = null; return { ...person(cands, t), code: 'lone' }; }
        return { centre: null, keep: [], ignored: ok.length, code: 'edge', vars: { n: ok.length } };
      }
      loneAt = null;
      return { centre: null, keep: [], ignored: 0, code: 'noOne' };
    }

    // The calibration: was (the signature kept with the calibration, or none), now (the view's signature right now).
    // Called only in quiet moments. Says "moved" after three looks in a row that do not match.
    function view(was, nowSig) {
      if (!was) { off = 0; viewCode = 'calibNone'; return { code: viewCode, hint: false }; }
      const s = sameView(was, nowSig);
      if (!s.known) { viewCode = off >= 3 ? 'calibMoved' : 'calibDark'; return { code: viewCode, hint: off >= 3, score: null }; }
      off = s.score < 0.35 ? off + 1 : 0;
      viewCode = off >= 3 ? 'calibMoved' : 'calibOk';
      return { code: viewCode, hint: off >= 3, score: s.score };
    }
    return { look, person, view, reset() { kind = null; want = null; room = null; litAt = null; centre = null; lostAt = null; loneAt = null; off = 0; viewCode = 'calibNone'; },
      get kind() { return kind; }, get centre() { return centre; } };
  }

  const api = { create, survey, signature, sameView, inQuad, why, KINDS, DARK, LIGHT, SETTLE, EDGE, REACH, GW, GH };
  if (node) module.exports = api;
  else root.DreamFlowAuto = api;
})(typeof window !== 'undefined' ? window : globalThis);
