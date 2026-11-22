// #218: how Dreamy Eyes find fire and what they feel about it (static/dreamfire.js) – on painted camera pictures
// (tests/js/fire-frames.mjs: flames, lamps, skin; no real pictures) and on fires that are only told.
// Run: node --test tests/js/fire.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { FPS, H, SCENES, SKIN, W, flame, rng, scene } from './fire-frames.mjs';

const require = createRequire(import.meta.url);
const F = require('../../static/dreamfire.js');
const MS = 1000 / FPS;

// the eyes watch a scene for some seconds; what they made of every picture
function watch(sc, secs, each) {
  const s = F.sense(), log = [];
  for (let i = 0; i < secs * FPS; i++) {
    F.look(s, sc.frame(i), W, H, i * MS, sc.face(i));
    log.push({ i, t: i * MS, on: s.on, level: s.level, x: s.x, y: s.y, move: s.move, trend: s.trend, flare: s.flare && s.flare.at, k: s.flare && s.flare.k, share: s.e / (W * H) });
    if (each) each(s, i);
  }
  return log;
}
const firstOn = log => { const f = log.find(r => r.on); return f ? f.t / 1000 : Infinity; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

test('the rule is looser than it was: dimmer, paler and less orange light counts – but not inside a face', () => {
  const was = (r, g, b) => r > 200 && Math.max(r, g, b) > 215 && r >= g && g > b * 1.15 && (r - Math.min(g, b)) / r > 0.42 && g - b > 35;   // #162
  for (const rgb of [[190, 120, 60], [200, 150, 110], [204, 140, 100], [185, 140, 100]]) {
    assert.ok(!was(...rgb), `${rgb} was no flame light`);
    assert.ok(F.warm(...rgb) > 0.5, `${rgb} is flame light now`);
    assert.equal(F.warm(...rgb, F.STRICT), 0, `${rgb} is none inside a face`);
  }
  for (const rgb of [[255, 150, 40], [240, 200, 90], [255, 120, 20]]) assert.equal(F.warm(...rgb, F.STRICT), 1, `${rgb} is a flame anywhere`);
  for (const rgb of [[255, 255, 255], [120, 80, 40], [90, 140, 255], [200, 60, 180], [230, 228, 200], [60, 200, 60]]) assert.equal(F.warm(...rgb), 0, `${rgb} is not warm`);
  for (const k of ['red', 'sat', 'warm']) assert.ok(F.LOOSE[k][0] < F.STRICT[k][0] && F.LOOSE[k][1] < F.STRICT[k][1], k);
});

for (const [name, sc] of Object.entries(SCENES).filter(([, x]) => x.fire === true)) {
  test(`fire: ${name}`, () => {
    const log = watch(sc.make(), 20), at = firstOn(log);
    assert.ok(at <= 1.6, `seen after ${at} s`);
    const after = log.filter(r => r.t / 1000 > at);
    assert.ok(mean(after.map(r => +r.on)) === 1, 'and never lost while it burns');
    assert.ok(Math.min(...after.slice(15).map(r => r.level)) > 0.05, 'its strength never drops to nothing');
    if (sc.at) {
      const err = Math.max(...after.map(r => Math.hypot(r.x - sc.at[0], r.y - sc.at[1])));
      assert.ok(err < 0.12, `the flame is where they look (off by ${err.toFixed(3)})`);
    }
  });
}
for (const [name, sc] of Object.entries(SCENES).filter(([, x]) => x.fire === false)) {
  test(`no fire: ${name}`, () => {
    const log = watch(sc.make(), 40);
    assert.equal(firstOn(log), Infinity, 'never taken for fire');
    assert.ok(Math.max(...log.map(r => r.level)) < 0.02, 'and nothing of it shows');
  });
}

test('small and distant flames count: far less of the picture than #162 asked for', () => {
  for (const name of ['distant flame', 'poi']) {
    const log = watch(SCENES[name].make(), 10).filter(r => r.on);
    assert.ok(log.length > 100, name);
    assert.ok(Math.max(...log.map(r => r.share)) < 0.004, `${name}: under 0.4 % of the picture`);
  }
});

test('a candle in still air is the limit: no more than a lamp while it does not flicker', () => {
  const calm = scene({ seed: 13, things: [flame({ cx: 67, cy: 44, wd: 3.2, ht: 8, lively: 0, seed: 6 })] });
  assert.equal(firstOn(watch(calm, 30)), Infinity);
});

test('the reaction follows the strength of the fire: the more flame, the higher the level – without steps', () => {
  const level = name => mean(watch(SCENES[name].make(), 10).slice(45).map(r => r.level));
  const [far, candle, torch, camp] = ['distant flame', 'candle', 'torch', 'campfire'].map(level);
  assert.ok(far > 0.08 && far < candle && candle < torch && torch < camp && camp > 0.95, `${far} < ${candle} < ${torch} < ${camp}`);
  // one flame growing slowly: the level grows with it, in small steps
  const log = watch(scene({ seed: 2, things: [flame({ cx: 48, cy: 56, wd: 6, ht: 12, seed: 4, grow: i => 1 + 2 * Math.min(1, i / (12 * FPS)) })] }), 14);
  const at = s => mean(log.filter(r => r.t >= s * 1000 && r.t < (s + 2) * 1000).map(r => r.level));
  assert.ok(at(2) < at(5) && at(5) < at(8) && at(8) < at(11), 'it rises all the way');
  const steps = new Set(log.map(r => Math.round(r.level * 20)));
  assert.ok(steps.size >= 8, `${steps.size} of 20 levels seen`);
});

test('flaring up is noticed at once, a steady flame makes none', () => {
  const up = 8 * FPS;
  const log = watch(scene({ seed: 3, things: [flame({ cx: 60, cy: 52, wd: 7, ht: 14, seed: 5, grow: i => i < up ? 1 : 1.8 })] }), 16);
  const flares = [...new Set(log.map(r => r.flare).filter(x => x !== null))];
  assert.equal(flares.length, 2, 'catching fire and flaring up');
  assert.ok(flares[0] < 1500, 'the first: it catches');
  const late = flares[1] - up * MS;
  assert.ok(late >= 0 && late <= 200, `the second: ${late} ms after the flame leapt`);
  assert.ok(log.find(r => r.flare === flares[1]).k >= 0.5, 'a strong one');
  const steady = watch(SCENES.torch.make(), 60);
  assert.equal(new Set(steady.map(r => r.flare).filter(x => x !== null)).size, 1, 'a torch that only burns: no flaring up');
});

test('dying down is felt before it is gone; gone is gone after 1.5 s', () => {
  const end = 10 * FPS, out = 14 * FPS;
  const log = watch(scene({ seed: 4, things: [flame({ cx: 40, cy: 54, wd: 9, ht: 20, seed: 6, until: out, grow: i => i < end ? 1 : Math.max(0.25, 1 - (i - end) / (3 * FPS)) })] }), 20);
  assert.ok(Math.abs(mean(log.filter(r => r.t > 6000 && r.t < 10000).map(r => r.trend))) < 0.05, 'steady: no trend');
  assert.ok(mean(log.filter(r => r.t > 11500 && r.t < 13500).map(r => r.trend)) < -0.1, 'dying down: the trend falls');
  assert.ok(log.find(r => r.t >= 13800).on, 'still fire while it is small');
  const off = log.find(r => r.t > 14000 && !r.on).t - out * MS;
  assert.ok(off >= 1500 && off <= 2300, `off ${off} ms after the last flame`);
  assert.ok(log.at(-1).level < 0.01);
});

test('the gaze: where the flame is, and after it within about 100 ms when it jumps or wanders', () => {
  const jump = 6 * FPS;
  const log = watch(scene({ seed: 5, things: [flame({ wd: 7, ht: 14, seed: 7, path: i => i < jump ? [26, 50] : [56, 44] })] }), 10);   // a third of the picture at once
  const before = mean(log.filter(r => r.t > 3000 && r.i < jump).map(r => r.x)), after = mean(log.filter(r => r.t > 8000).map(r => r.x));
  assert.ok(Math.abs(before - 26 / W) < 0.03 && Math.abs(after - 56 / W) < 0.03, `${before} → ${after}`);
  const way = i => (log[i].x - before) / (after - before);
  assert.ok(way(jump) > 0.6, `most of the way with the first picture that shows it (${way(jump).toFixed(2)})`);
  assert.ok(way(jump + 1) > 0.9, `there with the second, 67 ms later (${way(jump + 1).toFixed(2)})`);
  assert.ok(log.slice(jump).every(r => r.on), 'the same fire, not a new one');
  // a torch carried from side to side: the gaze is never far behind
  const path = i => [48 + 30 * Math.sin(i / FPS * 2), 44];
  const walk = watch(scene({ seed: 6, things: [flame({ wd: 7, ht: 14, seed: 8, path })] }), 12).filter(r => r.t > 2000);
  assert.ok(walk.every(r => r.on));
  assert.ok(Math.max(...walk.map(r => Math.abs(r.x - path(r.i)[0] / W))) < 0.08, 'within a twelfth of the picture');
  assert.ok(mean(walk.map(r => r.move)) > F.MOVING, 'and they know it moves');
});

test('a flame beside a face: it is the flame they look at, and the face alone is nothing', () => {
  const sc = SCENES['flame beside a face'];
  const log = watch(sc.make(), 10).filter(r => r.on);
  assert.ok(Math.max(...log.map(r => Math.abs(r.x - sc.at[0]))) < 0.08);
  for (const rgb of Object.values(SKIN)) assert.ok(F.warm(...rgb, F.STRICT) <= F.warm(...rgb), 'skin never counts more inside a face');
});

// ---------- moods and getting used to it: fires that are only told ----------
// a fire that burns from t = 0: steady unless `flares` (times, ms) or `moving` say otherwise
function burn(secs, { flares = [], moving = () => false, spirit = () => false, seed = 1 } = {}) {
  const m = F.mind(), s = { on: true, since: 0, flare: { at: 0, k: 1 }, move: 0 }, rnd = rng(seed), log = [];
  for (let t = 0; t <= secs * 1000; t += MS) {
    const f = flares.filter(x => x <= t).pop();
    if (f !== undefined) s.flare = { at: f, k: 0.8 };
    s.move = moving(t) ? 0.8 : 0.05;
    F.think(m, s, t, rnd, { spirit: spirit(t) });
    log.push({ t, mood: m.mood, habit: m.habit });
  }
  return log;
}
const turns = log => log.filter((r, i) => i === 0 || r.mood !== log[i - 1].mood);

test('while the fire is lively the mood changes every 10–20 s, never the same twice in a row', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const log = burn(600, { moving: () => true, seed }), ch = turns(log);
    assert.ok(ch.length >= 30 && ch.length <= 61, `${ch.length} moods in ten minutes`);
    for (let i = 1; i < ch.length; i++) {
      const len = ch[i].t - ch[i - 1].t;
      assert.ok(len >= 10000 - MS && len <= 20000 + MS, `a mood of ${len} ms`);
      assert.notEqual(ch[i].mood, ch[i - 1].mood);
    }
    const seen = new Set(ch.map(r => r.mood));
    assert.deepEqual([...seen].sort(), ['dream', 'love', 'play', 'spell'], 'spellbound, playful, dreamy, in love – and no spirit unless she can come');
    assert.ok(log.every(r => r.habit === 0), 'never used to a fire that moves');
  }
});

test('the fire spirit comes now and then – less often than the others, and only when she can', () => {
  const count = {};
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const r of turns(burn(600, { moving: () => true, spirit: () => true, seed }))) count[r.mood] = (count[r.mood] || 0) + 1;
  assert.deepEqual(Object.keys(count).sort(), ['dream', 'love', 'play', 'spell', 'spirit']);
  for (const k of ['dream', 'love', 'play', 'spell']) assert.ok(count.spirit > 8 && count.spirit < count[k], `spirit ${count.spirit}, ${k} ${count[k]}`);
  const some = turns(burn(600, { moving: () => true, spirit: t => t > 300000, seed: 7 }));
  assert.ok(some.filter(r => r.mood === 'spirit').every(r => r.t > 300000));
  const m = F.mind(), s = { on: true, since: 0, flare: { at: 0, k: 1 }, move: 1 };
  F.think(m, s, 0, () => 0.99, { spirit: true });
  assert.equal(m.mood, 'spirit');
  F.skip(m, 100); F.think(m, s, 100, () => 0.99, { spirit: true });
  assert.notEqual(m.mood, 'spirit', 'no way through: another mood at once');
});

test('after about 30 s of a fire that only burns on they are used to it; flaring up or moving wakes them', () => {
  const log = burn(120, { flares: [60000], moving: t => t > 90000 && t < 100000, seed: 3 });
  const at = s => log.find(r => r.t >= s * 1000);
  assert.equal(at(20).habit, 0, 'all new for 20 s');
  assert.ok(at(26).habit > 0.3 && at(26).habit < 0.7, 'fading into the background');
  assert.ok(at(29).mood !== 'glow' && at(30.1).mood === 'glow' && at(30.1).habit === 1, 'the background after 30 s');
  assert.ok(log.filter(r => r.t > 30100 && r.t < 60000).every(r => r.mood === 'glow'), 'and it stays there');
  const before = turns(log.filter(r => r.t < 30100)).filter(r => r.mood !== 'glow').pop().mood;
  assert.equal(at(60.1).habit, 0, 'it flares up: all new at once');
  assert.ok(at(60.1).mood !== 'glow' && at(60.1).mood !== before, `a mood, and not the last one again (${before} → ${at(60.1).mood})`);
  assert.ok(at(65.9).habit === 0 && at(70).habit > 0.4 && at(73.9).mood !== 'glow' && at(74.2).mood === 'glow', 'all new for 6 s, then the background again within 8 s more');
  assert.ok(log.filter(r => r.t > 90200 && r.t < 100000).every(r => r.mood !== 'glow' && r.habit === 0), 'awake as long as it moves');
  assert.ok(at(113.5).mood !== 'glow' && at(114.2).mood === 'glow');
  // the fire goes out: nothing is left of the mood, and a new fire is new
  const m = F.mind(), s = { on: true, since: 0, flare: { at: 0, k: 1 }, move: 0 };
  for (let t = 0; t < 40000; t += MS) F.think(m, s, t, Math.random);
  assert.equal(m.mood, 'glow');
  s.on = false; F.think(m, s, 40000, Math.random);
  assert.equal(m.mood, null); assert.equal(m.habit, 0);
  Object.assign(s, { on: true, since: 50000, flare: { at: 50000, k: 1 } }); F.think(m, s, 50000, Math.random);
  assert.ok(m.habit === 0 && F.MOODS.includes(m.mood));
});

test('seen through the camera: a steady torch becomes the background, a swung flame never does', () => {
  const run = (name, secs) => { const m = F.mind(), rnd = rng(9), log = []; watch(SCENES[name].make(), secs, (s, i) => { F.think(m, s, i * MS, rnd); log.push({ t: i * MS, mood: m.mood, habit: m.habit }); }); return log; };
  const torch = run('torch', 50);
  assert.ok(torch.filter(r => r.t > 34000).every(r => r.mood === 'glow'), 'the torch: background after half a minute');
  assert.ok(turns(torch.filter(r => r.t > 1000 && r.t < 30000)).length >= 2, 'with a change of mood on the way');
  const poi = run('poi', 50);
  assert.ok(poi.filter(r => r.t > 2000).every(r => r.mood && r.mood !== 'glow' && r.habit === 0), 'the poi: never');
});
