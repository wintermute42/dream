// #195: the beat tracker (static/beat.js) on synthesised music – no browser, no audio files, no dependencies.
// Run: node tests/js/beat.test.mjs   (the CI runs it too)
// The music is made here (kick, snare, hi-hat, bass, a pad, room reverb and crowd noise) and fed through a stand-in
// for the browser's AnalyserNode (Blackman window, FFT, dB), frame by frame as the page does it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { BeatTracker, BeatGrid } = require('../../static/beat.js');
const SR = 48000;

// ---------- music ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function kick(buf, t, g, r) {
  const i0 = Math.round(t * SR); let ph = 0;
  for (let i = 0; i < 0.3 * SR && i0 + i < buf.length; i++) {
    const x = i / SR; ph += 2 * Math.PI * (45 + 85 * Math.exp(-x * 30)) / SR;
    buf[i0 + i] += g * (Math.sin(ph) * Math.exp(-x * 9) + (i < 96 ? (r() * 2 - 1) * 0.5 * (1 - i / 96) : 0));
  }
}
function noise(buf, t, g, r, decay, hp, tone) {
  const i0 = Math.round(t * SR); let lp = 0, ph = 0;
  for (let i = 0; i < Math.min(0.6, 6 / decay) * SR && i0 + i < buf.length; i++) {
    const x = i / SR, w = r() * 2 - 1; lp += (w - lp) * hp; ph += 2 * Math.PI * (tone || 0) / SR;
    buf[i0 + i] += g * Math.exp(-x * decay) * (w - lp + (tone ? 0.6 * Math.sin(ph) * Math.exp(-x * 25) : 0));
  }
}
function tone(buf, t, dur, f, g) {
  const i0 = Math.round(t * SR), n = Math.round(dur * SR); let ph = 0, lp = 0;
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    ph = (ph + f / SR) % 1; lp += (2 * ph - 1 - lp) * 0.08;
    buf[i0 + i] += g * Math.min(1, i / 240) * Math.min(1, (n - i) / 480) * lp;
  }
}
const STYLES = {
  house: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], bass: [2, 6, 10, 14] },
  rock: { kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 6, 8] },
  halftime: { kick: [0], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0] },
  backbeat: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 8] },
  dnb: { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0] },
};
const ROOTS = [55, 65.4, 49, 73.4];
/** bars of music at bpm; sections: [{ from, bars, style, drums: false }]; returns audio and the true beats (s) */
function music({ bpm, bars, style, sections = [], seed = 5, noiseDb = 12 }) {
  const r = rng(seed), P = 60 / bpm, beats = [], downbeats = [];
  for (let b = 0; b < bars * 4; b++) { beats.push(1 + b * P); if (b % 4 === 0) downbeats.push(1 + b * P); }
  const buf = new Float32Array(Math.ceil((beats[beats.length - 1] + 2) * SR));
  for (let bar = 0; bar < bars; bar++) {
    const sec = sections.find(s => bar >= s.from && bar < s.from + s.bars) || {}, st = STYLES[sec.style || style];
    const at = s => downbeats[bar] + s * P / 4 + (r() - 0.5) * 0.006;
    if (sec.drums !== false) {
      st.kick.forEach(s => kick(buf, at(s), 0.9, r));
      st.snare.forEach(s => noise(buf, at(s), 0.5, r, 22, 0.15, 190));
      st.hat.forEach(s => noise(buf, at(s), 0.17, r, 70, 0.7));
      if (bar % 8 === 0) noise(buf, at(0), 0.27, r, 2.5, 0.5);                   // a crash on the phrase
      st.bass.forEach(s => tone(buf, at(s), P / 2, ROOTS[bar % 4], 0.28));
    } else [4, 5, 6].forEach(m => tone(buf, downbeats[bar], 4 * P, ROOTS[bar % 4] * m, 0.05));   // a pad in the break
  }
  // the room: a short echo cloud, crowd noise, a microphone without deep bass
  let rms = 0; for (let i = 0; i < buf.length; i += 11) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / (buf.length / 11));
  const out = new Float32Array(buf.length), na = rms * Math.pow(10, -noiseDb / 20), taps = [1301, 2111, 3203, 4507, 6011];
  let pink = 0, hp = 0, prev = 0;
  for (let i = 0; i < buf.length; i++) {
    let y = buf[i];
    for (let k = 0; k < taps.length; k++) if (i >= taps[k]) y += 0.35 * Math.pow(0.7, k) * buf[i - taps[k]];
    pink = 0.98 * pink + 0.2 * (r() * 2 - 1); y += pink * na;
    hp = 0.995 * (hp + y - prev); prev = y; out[i] = Math.tanh(hp * 1.5) / 1.5;
  }
  return { audio: out, beats, downbeats };
}

// ---------- the AnalyserNode stand-in ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len / 2;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const vr = re[i + k + h] * cr - im[i + k + h] * ci, vi = re[i + k + h] * ci + im[i + k + h] * cr;
        re[i + k + h] = re[i + k] - vr; im[i + k + h] = im[i + k] - vi; re[i + k] += vr; im[i + k] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function* frames(audio, fps = 60, N = 2048) {
  const win = Float64Array.from({ length: N }, (_, i) => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N));
  const re = new Float64Array(N), im = new Float64Array(N), r = rng(9);
  for (let t = N / SR * 1000; t < audio.length / SR * 1000; t += 1000 / fps + (r() - 0.5) * 3) {
    const end = Math.floor(t / 1000 * SR / 128) * 128;
    for (let i = 0; i < N; i++) { re[i] = (audio[end - N + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    const db = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / N + 1e-12);
    yield { t, db };
  }
}

// ---------- running and measuring ----------
function run(song, { fps = 60, taps = [] } = {}) {
  const bt = new BeatTracker({ sampleRate: SR, fftSize: 2048 }), got = { beats: [], downbeats: [], held: [], events: [], bpm: [] };
  taps = taps.slice();
  for (const f of frames(song.audio, fps)) {
    const ev = [];
    while (taps.length && taps[0] * 1000 <= f.t) ev.push(...bt.tap(taps.shift() * 1000));
    ev.push(...bt.push(f.db, f.t));
    for (const e of ev) {
      if (e.type !== 'beat') { got.events.push({ ...e, at: f.t / 1000 }); continue; }
      got.beats.push(f.t / 1000);
      if (e.downbeat) got.downbeats.push(f.t / 1000);
      if (e.held) got.held.push(f.t / 1000);
    }
    got.bpm.push([f.t / 1000, bt.locked ? bt.bpm : 0]);
  }
  got.tracker = bt;
  return got;
}
/** F-measure within ±70 ms, both lists from `from` seconds on */
function fmeasure(ref, est, from = 5) {
  ref = ref.filter(x => x >= from); est = est.filter(x => x >= from);
  const used = new Set(); let hit = 0;
  for (const r of ref) {
    let bi = -1, bd = 0.07;
    est.forEach((e, i) => { if (!used.has(i) && Math.abs(e - r) <= bd) { bd = Math.abs(e - r); bi = i; } });
    if (bi >= 0) { used.add(bi); hit++; }
  }
  return est.length && hit ? 2 * hit / (ref.length + est.length) : 0;
}
const tempoShare = (got, bpm, from = 5) => {
  const xs = got.bpm.filter(([t]) => t >= from);
  return xs.filter(([, b]) => Math.abs(b - bpm) / bpm < 0.04).length / xs.length;
};

// ---------- the tests ----------
test('house at 120 BPM in a loud room: beats, tempo and the one', () => {
  const song = music({ bpm: 120, bars: 20, style: 'house' }), got = run(song);
  assert.ok(fmeasure(song.beats, got.beats) > 0.9, 'beats');
  assert.ok(tempoShare(got, 120) > 0.95, 'tempo');
  assert.ok(fmeasure(song.downbeats, got.downbeats, 15) > 0.8, 'downbeats');
  assert.ok(got.tracker.confidence > 0.5, 'confident');
});

test('a 120 Hz display gives the same beats', () => {
  const song = music({ bpm: 120, bars: 16, style: 'house', seed: 6 }), got = run(song, { fps: 120 });
  assert.ok(fmeasure(song.beats, got.beats) > 0.9);
});

test('a kick in dotted quarters does not make 100 BPM into 67 (octave and triplet errors)', () => {
  const song = music({ bpm: 100, bars: 16, style: 'rock', seed: 7 }), got = run(song);
  assert.ok(tempoShare(got, 100) > 0.9, 'tempo');
  assert.ok(fmeasure(song.beats, got.beats) > 0.9, 'beats');
});

test('a half-time section keeps the tempo', () => {
  const song = music({ bpm: 140, bars: 32, style: 'backbeat', seed: 8, sections: [{ from: 8, bars: 16, style: 'halftime' }] });
  const got = run(song);
  assert.ok(tempoShare(got, 140) > 0.95, 'tempo');
  assert.ok(fmeasure(song.beats, got.beats) > 0.9, 'beats');
});

test('a 4-bar break: the beat is held through it, break and drop are heard, the drop is the one', () => {
  const song = music({ bpm: 128, bars: 24, style: 'house', seed: 4, sections: [{ from: 12, bars: 4, drums: false }] });
  const got = run(song), P = 60 / 128, b0 = song.downbeats[12], b1 = song.downbeats[16];
  const inBreak = got.beats.filter(t => t > b0 + 0.2 && t < b1 - 0.2);
  assert.ok(inBreak.length >= 14, `the beat keeps ticking (tempo hold): ${inBreak.length}`);
  assert.ok(fmeasure(song.beats.filter(t => t > b0 && t < b1), inBreak, 0) > 0.9, 'and stays on time');
  assert.ok(got.held.length >= 8, 'held beats do not push the picture');
  const brk = got.events.find(e => e.type === 'break'), drop = got.events.find(e => e.type === 'drop');
  assert.ok(brk && brk.at > b0 && brk.at < b0 + 4 * 4 * P, 'break');
  assert.ok(drop && Math.abs(drop.t / 1000 - b1) < 0.07, `drop on the one: ${drop && drop.t / 1000} vs ${b1}`);
  assert.ok(drop.at - b1 < P, 'heard within its first beat');
  assert.ok(fmeasure(song.beats, got.beats) > 0.9, 'beats overall');
  const after = t => t > b1 - 0.2 && t < song.beats[song.beats.length - 1] + 0.2;
  assert.ok(fmeasure(song.downbeats.filter(after), got.downbeats.filter(after), 0) > 0.9, 'the one after the drop');
});

test('tap as a correction: drum & bass tapped at 174 BPM from the one', () => {
  const song = music({ bpm: 174, bars: 32, style: 'dnb', seed: 3 });
  const i0 = song.beats.indexOf(song.downbeats[8]), taps = song.beats.slice(i0, i0 + 8).map((x, i) => x + [12, -9, 4, -14, 8, -3, 11, -6][i] / 1000);
  const got = run(song, { taps }), from = taps[taps.length - 1] + 1;
  assert.ok(tempoShare(got, 174, from) > 0.95, 'the tapped tempo stays');
  assert.ok(fmeasure(song.beats, got.beats, from) > 0.9, 'beats');
  assert.ok(fmeasure(song.downbeats, got.downbeats, from) > 0.9, 'the first tap set the one');
});

test('music without drums: no confident beat', () => {
  const song = music({ bpm: 120, bars: 12, style: 'house', seed: 2, sections: [{ from: 0, bars: 12, drums: false }] });
  const got = run(song);
  assert.ok(got.tracker.confidence < 0.4, `confidence ${got.tracker.confidence}`);
});

test('tap without music: a beat clock in the tapped tempo; ✕ stops it', () => {
  const bt = new BeatTracker();
  let ev = [];
  for (const t of [1000, 1500, 2000, 2500]) ev = ev.concat(bt.tap(t));
  assert.equal(Math.round(bt.bpm), 120);
  assert.deepEqual(ev.map(e => e.beatInBar), [1, 2, 3], 'the first tap was the one');
  const ticks = [];
  for (let t = 2516; t < 6000; t += 16.7) ticks.push(...bt.tick(t));
  assert.equal(ticks.length, 6);                                  // 3000 … 5500 ms
  assert.ok(ticks.every((e, i) => Math.abs(e.t - (3000 + 500 * i)) < 1));
  assert.deepEqual(ticks.map(e => e.beatInBar), [0, 1, 2, 3, 0, 1]);
  bt.untap(6000);
  assert.equal(bt.tick(9000).length, 0);
});

// ---------- the grid ----------
function fakeTracker() { return { locked: true, period: 500, phraseBars: 8 }; }
const beatEv = (t, beatInBar, barInPhrase = 1) => ({ type: 'beat', t, beatInBar, downbeat: beatInBar === 0, barInPhrase, phraseStart: beatInBar === 0 && barInPhrase === 0 });

test('grid: an action waits for the next bar, phrase or beat', () => {
  const tr = fakeTracker(), g = new BeatGrid(tr), ran = [];
  g.beat(beatEv(0, 0));
  g.at('bar', () => ran.push('bar'), null, 300);
  g.at('beat', () => ran.push('beat'), null, 300);
  g.at('phrase', () => ran.push('phrase'), null, 300);
  g.beat(beatEv(500, 1)); assert.deepEqual(ran, ['beat']);
  g.beat(beatEv(1000, 2)); g.beat(beatEv(1500, 3)); assert.deepEqual(ran, ['beat']);
  g.beat(beatEv(2000, 0)); assert.deepEqual(ran, ['beat', 'bar']);
  g.beat(beatEv(4000, 0, 0)); assert.deepEqual(ran, ['beat', 'bar', 'phrase']);
});

test('grid: off, no beat, pressed just after the one: at once; never waits longer than its unit', () => {
  const tr = fakeTracker(), g = new BeatGrid(tr), ran = [];
  g.at('off', () => ran.push('off'), null, 0);
  g.beat(beatEv(1000, 0));
  g.at('bar', () => ran.push('late'), null, 1060);                // 60 ms after the one: meant the one
  assert.deepEqual(ran, ['off', 'late']);
  g.at('bar', () => ran.push('lost'), null, 1300);
  g.poll(2000); assert.deepEqual(ran, ['off', 'late']);
  g.poll(1300 + 2500); assert.deepEqual(ran, ['off', 'late', 'lost'], 'a lost beat does not swallow it');
  tr.locked = false;
  g.at('phrase', () => ran.push('nobeat'), null, 5000);
  assert.equal(ran[ran.length - 1], 'nobeat');
});

test('grid: the same key twice gives one action', () => {
  const g = new BeatGrid(fakeTracker()), ran = [];
  g.beat(beatEv(0, 1));
  g.at('bar', () => ran.push(1), 'next', 200); g.at('bar', () => ran.push(2), 'next', 300);
  g.beat(beatEv(500, 2)); g.beat(beatEv(1000, 3)); g.beat(beatEv(1500, 0));
  assert.deepEqual(ran, [2]);
});
