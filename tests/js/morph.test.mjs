// #215: the motion between the AI pictures (static/morph.js) never moves back – no browser, no pictures, only the
// numbers the stage and the output windows draw with.
// Run: node --test tests/js/morph.test.mjs   (the CI runs it too)
// A stand-in for the stage plays what index.html does: every request is built from the picture shown at that moment
// plus one step of zoom and turn (feedback()), the answers come back in order after the AI's time, and each picture is
// shown with the record the camera gives it while the one before goes on at the same pace (DreamFx.morph.show). What
// the audience sees of a picture is its own phase plus how far it is shown moved; that must never decrease.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const M = createRequire(import.meta.url)('../../static/morph.js');
const ZOOM = 0.03, ROT = 1.5, STEP = { r: ROT, l: Math.log(1 + ZOOM) }, FRAME = 1000 / 60;
const EPS = 1e-3;                                      // a thousandth of a step: the rounding of the records, nothing to see
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// gap(i): ms from picture i − 1 to picture i; depth: requests on their way at once; gain: the slider.
// Returns what was on the stage, frame by frame: {t, r, l (the front picture, in steps), old (the one before, in
// steps), from (at a hand-over: what the picture before showed at that moment)}
function play({ gap, depth = 1, pictures = 90, gain = 1 }) {
  let now = 0, fps = 0, lastT = -400, cam = null, front = null, old = null;
  const queue = [], seen = [];
  const moved = (el, t) => (el.rec ? M.moved(el.rec, t - el.born) : M.zero());
  const steps = (el, t) => { const m = moved(el, t); return { r: (el.phase.r + m.r) / STEP.r, l: (el.phase.l + m.l) / STEP.l }; };
  const look = (t, from = null) => seen.push({ t, ...steps(front, t), old: old ? steps(old, t) : null, from });
  function show(phase, t) {                            // showFrame() of index.html
    const from = front ? steps(front, t) : null;
    cam = M.arrive(cam, phase, t, 1000 / Math.max(0.3, fps));
    const rec = M.record(cam, gain, 0.5, 0.5);
    if (front) { const m = moved(front, t); old = { phase: front.phase, born: t, rec: rec ? { ...rec, r0: m.r, l0: m.l } : null }; }   // DreamFx.morph.show
    front = { phase: cam.phase, rec, born: t };
    fps = fps * 0.8 + (1000 / (t - lastT)) * 0.2; lastT = t;
    look(t, from);
  }
  const ask = () => { while (queue.length < depth) queue.push(M.step(front.phase, ZOOM, ROT)); };   // tick() and feedback()
  show(null, 0); ask();
  for (let i = 0; i < pictures; i++) {
    const next = now + gap(i);
    for (let t = (Math.floor(now / FRAME) + 1) * FRAME; t < next; t += FRAME) look(t);
    now = next; show(queue.shift(), now); ask();
  }
  return seen;
}
// the worst step back (≤ 0, in steps of the dream) and the largest jump ahead at a hand-over, once the pace is found
function judge(seen, settle = 10) {
  const from = seen.filter(s => s.from)[settle].t;
  let back = 0, ahead = 0;
  for (let i = 1; i < seen.length; i++) {
    const s = seen[i], was = s.from || seen[i - 1];
    if (s.t < from) continue;
    for (const a of ['r', 'l']) {
      back = Math.min(back, s[a] - was[a]);
      if (s.from) ahead = Math.max(ahead, s[a] - was[a]);
      if (!s.from && s.old && seen[i - 1].old && !seen[i - 1].from) back = Math.min(back, s.old[a] - seen[i - 1].old[a]);
    }
  }
  return { back, ahead };
}

const r = rng(5);
const CASES = {
  '1 picture per second': { gap: () => 1000 },
  '2 pictures per second': { gap: () => 500 },
  '3 pictures per second': { gap: () => 333 },
  '5 pictures per second': { gap: () => 200 },
  '8 pictures per second': { gap: () => 125 },
  '3 pictures per second, uneven (±40 %)': { gap: () => 333 * (0.6 + 0.8 * r()), ahead: 0.3 },
  '8 pictures per second, uneven (±40 %)': { gap: () => 125 * (0.6 + 0.8 * r()), ahead: 0.3 },
  'every seventh picture three times as late': { gap: i => (i % 7 === 6 ? 1000 : 333), ahead: 0.3 },
  'two requests at once': { gap: () => 250 * (0.8 + 0.4 * r()), depth: 2, ahead: 0.3 },
  'three requests at once': { gap: () => 200 * (0.8 + 0.4 * r()), depth: 3, ahead: 0.3 },
  'two requests at once, every ninth picture late': { gap: i => (i % 9 === 8 ? 900 : 250), depth: 2, ahead: 0.4 },
  'a pause of five seconds': { gap: i => (i === 40 ? 5000 : 333) },
  'the pictures get three times as fast': { gap: i => (i < 40 ? 500 : 166), ahead: 1.01 },
  'the motion shows at half strength': { gap: () => 333, gain: 0.5, ahead: 0.51 },
};
for (const [name, c] of Object.entries(CASES)) {
  test(`the motion never goes back: ${name}`, t => {
    const seen = play(c), { back, ahead } = judge(seen);
    t.diagnostic(`worst step back ${back.toFixed(4)}, largest jump ahead at a new picture ${ahead.toFixed(3)} (in steps of the dream)`);
    assert.ok(back > -EPS, `the stage moved back by ${(-back).toFixed(3)} of a step`);
    assert.ok(ahead <= (c.ahead || 0.02), `a new picture jumped ahead by ${ahead.toFixed(3)} of a step (≤ ${c.ahead || 0.02})`);
  });
}

test('at an even pace a new picture joins exactly where the one before is shown', () => {
  const seen = play({ gap: () => 400 }), joins = seen.filter(s => s.from).slice(10);
  for (const s of joins) { assert.ok(Math.abs(s.l - s.from.l) < EPS); assert.ok(Math.abs(s.r - s.from.r) < EPS); }
  const first = joins[0], last = joins[joins.length - 1];
  assert.ok(Math.abs((last.l - first.l) / (joins.length - 1) - 1) < EPS, 'one step of the dream per picture');
});

test('two requests at once: each picture brings half a step, and the camera runs at that pace', () => {
  // without the phase the second of two pictures built from the same one started the motion anew: a whole step back
  const seen = play({ gap: () => 250, depth: 2 }), joins = seen.filter(s => s.from).slice(10);
  const pace = (joins[joins.length - 1].l - joins[0].l) / (joins.length - 1);
  assert.ok(Math.abs(pace - 0.5) < 0.01, `half a step per picture (${pace.toFixed(3)})`);
  for (const s of joins) assert.ok(Math.abs(s.l - s.from.l) < 0.01, 'no jump at a new picture');
});

test('a late picture is shown moved by what the camera went on meanwhile', () => {
  let cam = M.arrive(null, null, 0, 400), phase = cam.phase;
  for (let i = 1; i <= 12; i++) { phase = M.step(phase, ZOOM, ROT); cam = M.arrive(cam, phase, i * 400, 400); }
  const onTime = M.arrive(cam, M.step(phase, ZOOM, ROT), 13 * 400, 400), late = M.arrive(cam, M.step(phase, ZOOM, ROT), 13 * 400 + 300, 400);
  assert.ok(late.lead.l > onTime.lead.l + 0.5 * STEP.l && late.lead.r > onTime.lead.r + 0.5 * STEP.r, 'the late one is shown further along');
  const rec = M.record(late, 1, 0.5, 0.5);
  assert.ok(Math.abs(rec.l0 - late.lead.l) < 1e-5 && rec.vl > 0 && rec.vr > 0);
});

test('a picture built on no other one rests, and the dream starts from it', () => {
  let cam = M.arrive(null, null, 0, 400);
  assert.equal(M.record(cam, 1, 0.5, 0.5), null);
  cam = M.arrive(cam, M.step(cam.phase, ZOOM, ROT), 400, 400);
  cam = M.arrive(cam, null, 800, 400);                 // "New": a fresh start
  assert.deepEqual(cam.lead, { r: 0, l: 0 });
  assert.equal(M.record(cam, 1, 0.5, 0.5), null);
});

test('records: the slider scales them, a broken one is refused, a picture ahead of the camera waits', () => {
  let cam = M.arrive(null, null, 0, 400), phase = cam.phase;
  for (let i = 1; i <= 8; i++) { phase = M.step(phase, ZOOM, ROT); cam = M.arrive(cam, phase, i * 400, 400); }
  const full = M.record(cam, 1, 0.3, 0.7), half = M.record(cam, 0.5, 0.3, 0.7);
  assert.ok(M.valid(full) && full.px === 0.3 && full.py === 0.7 && full.period === 400);
  assert.ok(Math.abs(half.vl - full.vl / 2) < 1e-8 && Math.abs(half.vr - full.vr / 2) < 1e-6);
  assert.equal(M.record(cam, 0, 0.5, 0.5), null);
  for (const bad of [null, 'x', {}, { ...full, vl: NaN }, { ...full, period: 0 }, { ...full, px: '0.5' }]) assert.equal(M.valid(bad), false);
  // zooming in, a picture is never shown smaller than the stage; zooming out, never larger
  assert.equal(M.moved({ ...full, l0: -0.01, vl: 0.00001 }, 100).l, 0);
  assert.equal(M.moved({ ...full, l0: 0.01, vl: -0.00001 }, 100).l, 0);
  // past the expected time the motion eases out instead of running away
  const far = M.moved({ ...full, r0: 0, l0: 0 }, 60000), due = M.moved({ ...full, r0: 0, l0: 0 }, 400);
  assert.ok(far.l > due.l && far.l <= due.l * 2.01);
});

test('zooming out and turning the other way never goes back either', () => {
  let cam = M.arrive(null, null, 0, 300), phase = cam.phase, shown = null;
  for (let i = 1; i <= 40; i++) {
    const t = i * 300 + (i % 5 === 0 ? 150 : 0);
    const before = shown && (() => { const m = M.moved(shown.rec, t - shown.born); return { r: shown.phase.r + m.r, l: shown.phase.l + m.l }; })();
    phase = M.step(phase, -0.02, -1); cam = M.arrive(cam, phase, t, 300);
    const rec = M.record(cam, 1, 0.5, 0.5), m = M.moved(rec, 0), now = { r: phase.r + m.r, l: phase.l + m.l };
    if (before && i > 10) { assert.ok(now.l <= before.l + EPS * 0.02, `zoom ${now.l - before.l}`); assert.ok(now.r <= before.r + EPS, `turn ${now.r - before.r}`); }
    shown = { phase, rec, born: t };
  }
});
