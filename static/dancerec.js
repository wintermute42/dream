// #243: the dance lab's memory – sessions of the dance as numbers. Pure computation, no DOM: the lab (dancelab.js)
// records with it, plays back with it and cuts the last seconds out for a "good"/"bad"; the Node tests use it the same
// way (tests/js/dancerec.test.mjs).
//
// A session is trajectories, never pictures: per frame the feature stream's record (dance.js), what the detection's
// sources saw of the hands and the body (the detector's input – points and confidences), the points of the skeleton
// and of the two hands for the stick figure, and what the mapping asked of each target. With marks on its time line
// (feedback "good"/"bad", who gave it) and the mapping table that was in use. The same format serves a feedback moment
// (kind "feedback": the last seconds before the mark), a test file for the detection (`testFile`) and, later, taught
// movements and learning by showing.
//
//   {format: "dream-dance", version: 1, kind: "session" | "feedback", rate, aspect, seconds, keys: [feature names],
//    frames: [{t, v: [per key], c: [per key], g, gc, s, b, o: {target: value}, i: {…input}, p: {b, l, r}}],
//    marks: [{t, mark: "good" | "bad", by, secs}], map: [rows]}
(function (root) {
  'use strict';
  const FORMAT = 'dream-dance', VERSION = 1, RATE = 30, MAX_SECONDS = 300;
  // the pose model's points kept for the stick figure (nose, shoulders, elbows, wrists, hips, knees, ankles) and its bones
  const BODY = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const BONES = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12]];
  const WRIST = { l: 5, r: 6 };                        // where the wrists are in BODY
  const HAND_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  const TIPS = [4, 8, 12, 16, 20];
  const SRC = ['pose', 'marker', 'light', 'pose+marker'];
  const r3 = x => Math.round(x * 1000) / 1000, r4 = x => Math.round(x * 10000) / 10000, r5 = x => Math.round(x * 100000) / 100000;
  const SHARE = 0.3;                                   // a gesture is "the" gesture of a stretch when it was on for this share of it
  const flat = (pts, fx = 1) => pts.flatMap(p => [r4(p[0] * fx), r4(p[1])]);
  const pairs = (a, fx = 1) => { const out = []; for (let i = 0; i + 1 < a.length; i += 2) out.push([a[i] * fx, a[i + 1]]); return out; };

  // One frame as a session keeps it. rec: the feature stream's record; input: what the detector was fed (dance.js
  // `step`); landmarks: the pose model's 33 points (or null); out: what the mapping asked of the targets; t: seconds
  // since the session began.
  function pack(t, keys, rec, input, landmarks, out) {
    const cand = c => [r4(c.x), r4(c.y), r3(c.c), Math.max(0, SRC.indexOf(c.src)), r4(c.len || 0)];
    const hand = h => { const c = input && input.hands && input.hands[h]; return (Array.isArray(c) ? c : c ? [c] : []).map(cand); };
    const asp = (input && input.aspect) || 16 / 9, fing = h => input && input.fingers && input.fingers[h];
    const b = input && input.body, s = input && input.sensor;
    const o = {}; for (const k of Object.keys(out || {})) if (Math.abs(out[k]) >= 0.005) o[k] = r3(out[k]);
    return { t: r5(t), v: keys.map(k => r4(rec.v[k] || 0)), c: keys.map(k => r3(rec.c[k] || 0)), g: rec.gesture || null, gc: r3(rec.gc || 0), s: r3(rec.size || 0), b: rec.bpm || 0, o,
      i: { h: { l: hand('l'), r: hand('r') }, b: b ? [r4(b.x), r4(b.y), r4(b.s), r3(b.c)] : null, s: s && s.g ? s.g.map(r3) : null,
        f: { l: fing('l') ? r3(fing('l').c) : 0, r: fing('r') ? r3(fing('r').c) : 0 }, d: input && input.dark ? 1 : 0, a: r4(asp) },
      // the points to draw: all in the picture's 0…1 (the hands' x back from picture heights)
      p: { b: landmarks && landmarks.length >= 29 ? BODY.flatMap(i => [r4(landmarks[i].x), r4(landmarks[i].y)]) : null,
        l: fing('l') ? flat(fing('l').pts, 1 / asp) : null, r: fing('r') ? flat(fing('r').pts, 1 / asp) : null } };
  }
  // … and back: the record a kept frame was made from (as far as the lab and the mapping read it)
  function unpack(frame, keys) {
    const v = {}, c = {}, src = {};
    keys.forEach((k, n) => { v[k] = frame.v[n]; c[k] = frame.c[n]; src[k] = ''; });
    return { t: frame.t, v, c, src, bpm: frame.b || 0, gesture: frame.g || null, gc: frame.gc || 0, size: frame.s || 0, g: {}, hands: { l: null, r: null }, events: [] };
  }
  // … and what the detector was fed in that frame: feeding a session's inputs to a fresh detector gives its features again
  function input(frame) {
    const i = frame.i, asp = i.a || 16 / 9;
    const hand = h => i.h[h].map(([x, y, c, s, len]) => ({ x, y, c, src: SRC[s] || 'pose', len }));
    const fing = h => (frame.p[h] && i.f[h] ? { pts: pairs(frame.p[h], asp), c: i.f[h] } : null);
    return { t: frame.t, hands: { l: hand('l'), r: hand('r') }, body: i.b ? { x: i.b[0], y: i.b[1], s: i.b[2], c: i.b[3] } : null,
      fingers: { l: fing('l'), r: fing('r') }, sensor: i.s ? { g: i.s, age: 0 } : null, dark: !!i.d, aspect: asp };
  }
  const body = frame => (frame.p.b ? pairs(frame.p.b) : null);
  const hand21 = (frame, h) => (frame.p[h] ? pairs(frame.p[h]) : null);
  // where a hand is in the picture in this frame: the skeleton's wrist, else what the first source saw
  function wrist(frame, h) {
    if (frame.p.b) return [frame.p.b[WRIST[h] * 2], frame.p.b[WRIST[h] * 2 + 1]];
    const c = frame.i.h[h][0]; return c ? [c[0], c[1]] : null;
  }

  const session = (kind, frames, marks, map, keys, aspect = 16 / 9) => ({ format: FORMAT, version: VERSION, kind, rate: RATE, aspect: r4(aspect),
    seconds: frames.length ? frames[frames.length - 1].t : 0, keys, frames, marks, map });
  const good = s => !!s && s.format === FORMAT && s.version === VERSION && Array.isArray(s.frames) && Array.isArray(s.keys) && Array.isArray(s.marks)
    && s.frames.every(f => f && Array.isArray(f.v) && Array.isArray(f.c) && f.i && f.i.h && Array.isArray(f.i.h.l) && Array.isArray(f.i.h.r) && f.i.f && f.p);

  // The last seconds, always: what a "good"/"bad" cuts its moment from. Frames come in with their own clock (seconds).
  function ring(seconds = 30) {
    const frames = [];
    return {
      push(frame) { frames.push(frame); while (frames.length && frame.t - frames[0].t > seconds) frames.shift(); },
      // the last `secs` seconds as frames of their own, their time starting at 0
      last(secs) {
        if (!frames.length) return [];
        const end = frames[frames.length - 1].t, cut = frames.filter(f => end - f.t <= secs), t0 = cut[0].t;
        return cut.map(f => ({ ...f, t: r5(f.t - t0) }));
      },
      // … and as they are (their own clock, nothing copied): what a display reads every frame
      tail(secs) { const end = frames.length ? frames[frames.length - 1].t : 0; let i = frames.length; while (i > 0 && end - frames[i - 1].t <= secs) i--; return frames.slice(i); },
      get length() { return frames.length; }, clear() { frames.length = 0; },
    };
  }
  // A feedback moment: the last `secs` seconds with the mark at their end, the mapping in use
  function moment(rng, mark, by, secs, map, keys, aspect) {
    const frames = rng.last(secs), end = frames.length ? frames[frames.length - 1].t : 0;
    return session('feedback', frames, [{ t: end, mark, by, secs }], map, keys, aspect);
  }
  // A recording: at most RATE frames a second and MAX_SECONDS long (then it says it is full)
  function recorder(keys, map, aspect) {
    const frames = [], marks = []; let t0 = null, lastT = -1;
    return {
      add(now, make) {                                 // make(t): the frame, only built when it is kept
        if (t0 == null) t0 = now;
        const t = now - t0;
        if (t - lastT < 1 / RATE - 1e-3 || t > MAX_SECONDS) return t <= MAX_SECONDS;
        lastT = t; frames.push(make(t)); return true;
      },
      mark(now, mark, by, secs) { if (t0 != null) marks.push({ t: r5(Math.max(0, now - t0)), mark, by, secs }); },
      get seconds() { return frames.length ? frames[frames.length - 1].t : 0; }, get frames() { return frames.length; },
      stop: () => session('session', frames, marks, map, keys, aspect),
    };
  }

  // Playing a session: a position in seconds that runs at `speed`, pauses, jumps, and loops over a stretch [a, b]
  function player(s) {
    const st = { pos: 0, speed: 1, playing: true, loop: null };
    const at = t => {                                  // the frame shown at second t: the last one not after it
      let lo = 0, hi = s.frames.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s.frames[mid].t <= t + 1e-9) lo = mid; else hi = mid - 1; }
      return lo;
    };
    return {
      get pos() { return st.pos; }, get speed() { return st.speed; }, get playing() { return st.playing; }, get loop() { return st.loop; },
      get seconds() { return s.seconds; }, get session() { return s; }, get index() { return at(st.pos); }, get frame() { return s.frames[at(st.pos)] || null; },
      at,
      play(on = true) { st.playing = !!on; if (on && !st.loop && st.pos >= s.seconds) st.pos = 0; },
      setSpeed(k) { st.speed = Math.min(2, Math.max(0.05, +k || 1)); },
      seek(t) { st.pos = Math.min(s.seconds, Math.max(0, +t || 0)); },
      setLoop(a, b) { st.loop = a == null || b == null || !(b - a > 0.05) ? null : [Math.max(0, a), Math.min(s.seconds, b)]; if (st.loop && (st.pos < st.loop[0] || st.pos > st.loop[1])) st.pos = st.loop[0]; },
      // dt: real seconds gone by. Returns the frame to show; at the end it stops (or starts the stretch again)
      tick(dt) {
        if (st.playing && s.frames.length) {
          st.pos += dt * st.speed;
          const [a, b] = st.loop || [0, s.seconds];
          if (st.pos >= b) { if (st.loop) st.pos = b - a > 0 ? a + ((st.pos - a) % (b - a)) : a; else { st.pos = b; st.playing = false; } }
        }
        return s.frames[at(st.pos)] || null;
      },
    };
  }

  // The stretches a gesture was recognised in: [{t0, t1, name}] – the band on the time line
  function gestures(s) {
    const out = []; let cur = null;
    for (const f of s.frames) {
      if (cur && f.g !== cur.name) { out.push(cur); cur = null; }
      if (f.g && !cur) cur = { t0: f.t, t1: f.t, name: f.g };
      if (cur) cur.t1 = f.t;
    }
    if (cur) out.push(cur);
    return out;
  }
  // What happened around each mark: the gesture recognised most in its seconds (and how sure), the targets that were
  // asked for most, the mean energy – the list of feedback moments
  function review(s) {
    return s.marks.map(m => {
      const fr = s.frames.filter(f => f.t <= m.t + 1e-9 && f.t >= m.t - (m.secs || 4)), count = {}, sure = {}, tg = {};
      for (const f of fr) {
        if (f.g) { count[f.g] = (count[f.g] || 0) + 1; sure[f.g] = Math.max(sure[f.g] || 0, f.gc); }
        for (const k of Object.keys(f.o || {})) tg[k] = Math.max(tg[k] || 0, Math.abs(f.o[k]));
      }
      const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0], g = top && count[top] >= SHARE * fr.length ? top : null, e = s.keys.indexOf('energy');
      return { t: m.t, mark: m.mark, by: m.by, secs: m.secs || 4, gesture: g, share: g ? r3(count[g] / fr.length) : 0, sure: g ? sure[g] : 0,
        targets: Object.keys(tg).sort((a, b) => tg[b] - tg[a]).slice(0, 3).map(k => [k, r3(tg[k])]),
        energy: fr.length && e >= 0 ? r3(fr.reduce((a, f) => a + f.v[e], 0) / fr.length) : 0 };
    });
  }
  // n frames spread evenly over [t0, t1]: the poses of a multiple exposure
  function poses(s, t0, t1, n) {
    const p = player(s), out = [];
    for (let k = 0; k < n; k++) { const i = p.at(t0 + (t1 - t0) * (n === 1 ? 0 : k / (n - 1))); if (out[out.length - 1] !== i) out.push(i); }
    return out;
  }
  // A session as a test file for the detection: only what the detector was fed, and what is expected of it – from the
  // marks: after a "good" the gesture that was recognised then must be recognised again in those seconds (or none, if
  // none was); a "bad" is listed with what was recognised and `want: null` – a person writes in what it should have been.
  function testFile(s, name = '') {
    return { format: FORMAT + '-test', version: VERSION, name, rate: s.rate, aspect: s.aspect, seconds: s.seconds,
      frames: s.frames.map(f => ({ t: f.t, i: f.i, p: { l: f.p.l, r: f.p.r } })),
      expect: review(s).map(m => ({ t0: r3(Math.max(0, m.t - m.secs)), t1: m.t, mark: m.mark, was: m.gesture, want: m.mark === 'good' ? (m.gesture || 'none') : null })) };
  }
  // … and whether a detector does what the file expects: [{t0, t1, want, got, ok}] for every line with a `want`
  function check(file, makeDetector) {
    const d = makeDetector(), outs = file.frames.map(f => ({ t: f.t, g: d.step(input({ ...f, p: { b: null, ...f.p } })).gesture }));
    return file.expect.filter(e => e.want).map(e => {
      const win = outs.filter(o => o.t >= e.t0 - 1e-9 && o.t <= e.t1 + 1e-9), n = {};
      for (const o of win) if (o.g) n[o.g] = (n[o.g] || 0) + 1;
      const top = Object.keys(n).sort((a, b) => n[b] - n[a])[0], got = top && n[top] >= SHARE * win.length ? top : 'none';
      return { t0: e.t0, t1: e.t1, want: e.want, got, ok: got === e.want };
    });
  }
  // What a spoken word means as feedback: "good", "bad" or nothing. words: {good, bad, not} – lists of words; the lab
  // adds the ones of the page's language (from the translations) to these. A sentence is not a verdict, and "not good" is bad.
  const WORDS = { good: ['good', 'great', 'yes', 'nice', 'super', 'top', 'right'], bad: ['bad', 'no', 'nope', 'wrong'], not: ['not'] };
  function verdict(text, words = WORDS) {
    const w = String(text || '').toLowerCase().replace(/[^\p{L} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length || w.length > 3) return null;
    const bad = w.some(x => words.bad.includes(x)), good = w.some(x => words.good.includes(x));
    if (bad === good) return null;
    return bad !== w.some(x => words.not.includes(x)) ? 'bad' : 'good';        // "not good" is bad, "not bad" is good
    return null;
  }
  // A wristband's one button: one press is "good", two presses right after each other are "bad". press(now) answers
  // "bad" on the second press; due(now), asked every frame, answers "good" once a single press has waited out the gap.
  function clutch(gap = 0.5) {
    let pending = null;
    return {
      press(now) { if (pending != null && now - pending <= gap) { pending = null; return 'bad'; } pending = now; return null; },
      due(now) { if (pending != null && now - pending > gap) { pending = null; return 'good'; } return null; },
    };
  }

  const api = { FORMAT, VERSION, RATE, MAX_SECONDS, BODY, BONES, HAND_BONES, TIPS, WRIST, pack, unpack, input, body, hand21, wrist, session, good, ring, moment,
    recorder, player, gestures, review, poses, testFile, check, verdict, clutch, WORDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamDanceRec = api;
})(typeof window !== 'undefined' ? window : globalThis);
