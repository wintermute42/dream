// Synthetic performers for the tests of the performers' profiles (#253): invented people, each with a way of moving
// of their own, as the numbers the detection would hand to static/dance.js – no camera, no model, nobody real.
// A performance is a plan: stretches of seconds, each with a tempo (repetitions a second), a size and a label.
import { createRequire } from 'node:module';
import { OWN_MOVES, rng } from './dance-sim.mjs';

const require = createRequire(import.meta.url);
const D = require('../../static/dance.js'), R = require('../../static/dancerec.js');
const ASPECT = 16 / 9;
const gauss = r => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

// each: (a: the angle of the repetition, k: size) → {l: [u, v], r: [u, v]} in shoulder widths, v up
export const WAYS = {
  // two poi, the same way round, half a turn apart
  poi: (a, k) => ({ l: [0.9 + 0.7 * k * Math.cos(a), 0.1 + 0.7 * k * Math.sin(a)], r: [-0.9 + 0.7 * k * Math.cos(a + Math.PI), 0.1 + 0.7 * k * Math.sin(a + Math.PI)] }),
  // a staff turned about its middle: its two ends
  staff: (a, k) => ({ l: [1.1 * k * Math.cos(a), 0.2 + 1.1 * k * Math.sin(a)], r: [-1.1 * k * Math.cos(a), 0.2 - 1.1 * k * Math.sin(a)] }),
  // large circles of both arms (fans), mirrored
  fans: (a, k) => ({ l: [0.3 + 1.4 * k * Math.cos(a), 0.2 + 1.4 * k * Math.sin(a)], r: [-0.3 - 1.4 * k * Math.cos(a), 0.2 + 1.4 * k * Math.sin(a)] }),
  // both hands up and down on a line
  line: (a, k) => ({ l: [0.7, 0.2 + 0.9 * k * Math.sin(a)], r: [-0.7, 0.2 + 0.9 * k * Math.sin(a)] }),
  // small, flowing hands
  gentle: (a, k) => ({ l: [0.5 + 0.25 * k * Math.sin(a), -0.3 + 0.2 * k * Math.sin(2 * a)], r: [-0.5 - 0.25 * k * Math.sin(a + 1), -0.3 + 0.2 * k * Math.cos(a)] }),
  // the right hand draws a lying eight (a figure of dance-sim.mjs)
  eight: (a, k) => OWN_MOVES.eight(a / (2 * Math.PI), { f: 1, k }),
  rest: () => ({ l: [0.6, -1.4], r: [-0.6, -1.4] }),
};

// plan: [{secs, way, f, k, label}]. opts: src ('pose' with a body | 'light' without one), S, at, jitter, seed, fps.
// → frames for dance.js ({t, hands, body, label}); the angle runs on from one stretch to the next – no jump.
export function perform(plan, opts = {}) {
  const { src = 'pose', S = 0.1, at = [0.5, 0.45], jitter = 0.002, seed = 1, fps = 30, from = 0 } = opts;
  const rnd = rng(seed), out = [];
  let a = rnd() * 6, t = from;
  for (const step of plan) {
    for (let i = 0; i < Math.round(step.secs * fps); i++, t += 1 / fps) {
      a += 2 * Math.PI * (step.f || 0) / fps * (1 + 0.05 * gauss(rnd));
      const m = WAYS[step.way](a, step.k == null ? 1 : step.k);
      const pt = ([u, v]) => ({ x: at[0] + (u * S) / ASPECT + jitter * gauss(rnd), y: at[1] - v * S + jitter * gauss(rnd), c: src === 'light' ? 0.6 : 0.9, src });
      out.push({ t, hands: step.gone ? { l: null, r: null } : { l: pt(m.l), r: pt(m.r) }, body: src === 'pose' && !step.gone ? { x: at[0], y: at[1], s: S, c: 0.9 } : null, label: step.label || step.way });
    }
  }
  return out;
}

// the session the lab would keep of such a performance (dancerec.js) – what a profile is learned from
export function session(frames) {
  const det = D.create(), t0 = frames[0].t;
  return R.session('session', frames.map(f => R.pack(f.t - t0, D.SOURCES, det.step(f), f, null, {})), [], [], D.SOURCES, ASPECT);
}
