// #195: beat tracking from the room (microphone): tempo, beat phase, downbeat ("the one") and phrases, plus a beat
// grid that schedules actions on the next beat, bar or phrase. Pure computation, no DOM, no Web Audio: the page feeds
// it the dB spectrum of an AnalyserNode (getFloatFrequencyData) and a timestamp in ms every frame, and reads the
// events and values; the Node tests feed it spectra of synthesised music the same way.
//
// How it works:
// - onsets: spectral flux (how much each frequency got louder since the last frame, on amplitude^0.3, so a loud kick
//   counts more than a bass note) in four bands, each band measured against its own average (a room microphone
//   without deep bass still counts), the kick band weighted most; collected on a fixed 10 ms grid, so 60 Hz and 120 Hz
//   displays (and uneven frames) give the same curve
// - tempo: autocorrelation of the last 8 s of that curve, read as a comb (1, 2, 3 and 4 beats apart) over 60–180 BPM
//   with a soft preference around 120 BPM and a preference range of 80–160 BPM (double, half and triplet errors are
//   folded into it); the current tempo is sticky, so a half-time section does not halve it
// - phase: a comb over the last 8 beats finds where the beats sit; a phase-locked loop moves the predicted beat gently
//   towards it. The beats come from the prediction, so they keep ticking through short breaks ("tempo hold") and land
//   on time instead of a frame late; when the measured phase stays off for 1.5 s, the loop locks anew
// - confidence: how periodic the onsets are and how clearly they sit on the predicted beats
// - downbeat: per beat position in the bar (1–4) the kick, the change of the bass line (new notes and chords start on
//   the one) and, against it, the snare (backbeat on 2 and 4) are summed up over the last bars; the strongest position
//   is "the one"
// - phrases: per bar the loudness of the four bands and a crash on the one; a clear change between the two bars before
//   and after a bar line is a section boundary; their distances give the phrase length (4, 8 or 16 bars)
// - break: the kicks and highs on the beats far below their usual strength for a bar; the beats are only held then.
//   Drop: in a break, a kick on a beat as strong and loud as before it – it is the one and starts a phrase
// - a tap series (tap tempo) sets tempo and phase directly, its first tap counts as the one, and the tempo stays near
//   the tapped one (the music only moves the phase)
(function (root) {
  'use strict';
  const BANDS = [[30, 120, 1.0], [120, 400, 0.45], [400, 2500, 0.3], [2500, 10000, 0.45]];   // [from Hz, to Hz, weight]
  // hop: the onset grid (ms); windowMs: what the tempo looks at; holdMs: how long the beat keeps ticking without the
  // music beating; latency: how late an onset shows in the spectrum (null: from the FFT size)
  const DEFAULTS = { sampleRate: 48000, fftSize: 2048, minBpm: 60, maxBpm: 180, prefBpm: 120, prefLo: 80, prefHi: 160,
    hop: 10, windowMs: 8000, holdMs: 20000, latency: null };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (a, n) => ((a % n) + n) % n;

  class BeatTracker {
    constructor(opts = {}) {
      this.o = { ...DEFAULTS, ...opts };
      this.N = Math.ceil((this.o.windowMs + 2500) / this.o.hop);
      this.setAudio(this.o.sampleRate, this.o.fftSize);
      this.reset();
    }
    /** another audio source (sample rate, FFT size): the analysis starts anew, tempo, beat and tap stay */
    setAudio(sampleRate, fftSize) {
      const o = Object.assign(this.o, { sampleRate, fftSize }), binHz = sampleRate / fftSize;
      const bin = f => Math.round(f / binHz);
      this.bands = BANDS.map(([lo, hi, w]) => ({ a: Math.max(1, bin(lo)), b: Math.max(2, bin(hi)), w }));
      this.lowBins = [Math.max(1, Math.round(35 / binHz)), Math.max(3, Math.round(300 / binHz))];
      // the analyser looks at the last fftSize samples: an onset shows up in the onset curve about a window late
      // (measured with the synthesised test music, tests/js/beat.test.mjs)
      this.latency = o.latency != null ? o.latency : 1.2 * fftSize / sampleRate * 1000;
      this.env = new Float32Array(this.N); this.lastSlot = -1; this.started = null; this.procAt = null;
      this.prev = null; this.fluxAvg = BANDS.map(() => 0); this.levelAvg = BANDS.map(() => null);
    }
    reset() {
      this.setAudio(this.o.sampleRate, this.o.fftSize);
      this.period = 500; this.next = 0; this.locked = false; this.beat = -1; this.lastBeatAt = 0;
      this.tempoSal = 0; this.phaseSal = 0; this.confidence = 0; this.lastSalientAt = 0;
      this.cand = null; this.candCount = 0; this.offCount = 0; this.updAt = 0; this.acfAt = 0;
      this.down = 0; this.downScore = [0, 0, 0, 0]; this.downConfidence = 0; this.hint = null;
      this.cur = this.newInterval(0); this.intervals = []; this.recent = [];
      this.bars = []; this.nov = []; this.bounds = []; this.phraseBars = 8; this.phraseAnchor = null; this.phraseConfidence = 0;
      this.tapLock = null; this.taps = []; this.tapCount = 0; this.audioAt = -1e9;
      this.weakRun = 0; this.inBreak = false; this.breakBeats = 0; this.breakOver = -1e9;
      this.strengthRef = 0; this.kickRef = 0; this.kickLevel = null; this.refCount = 0;
      this.pending = []; this.dt = 16; this.lastT = null; this.procAt = null;
    }
    get bpm() { return 60000 / this.period; }
    /** position of beat number j in the bar (0 = the one) */
    beatInBar(j = this.beat) { return mod(j - this.down, 4); }
    /** bar number of beat j within its phrase (0 = the first bar); counted from the one until a boundary was heard */
    barInPhrase(j = this.beat) {
      if (this.phraseAnchor == null) return mod(Math.floor((j - this.down) / 4), this.phraseBars);
      return mod(Math.floor((j - this.phraseAnchor) / 4), this.phraseBars);
    }

    /** one analyser frame: spectrum in dB (getFloatFrequencyData, fftSize/2 values), t in ms. Returns the events due
     *  by now: { type: 'beat', t, beat, beatInBar, downbeat, barInPhrase, phraseStart, held, bpm, confidence },
     *  { type: 'break' }, { type: 'breakend' } and { type: 'drop', t, beat }. */
    push(spec, t) {
      if (this.started == null) this.started = t;
      if (this.lastT != null) this.dt += (clamp(t - this.lastT, 1, 100) - this.dt) * 0.05;
      this.lastT = t;
      // fast displays (120 Hz) call twice as often: compare spectra at least 12 ms apart, or the noise of the room
      // (which does not get smaller per frame) drowns the onsets (which do)
      if (this.procAt != null && t - this.procAt < 12) return this.tick(t);
      this.procAt = t;
      const o = this.o, bands = this.bands, flux = [0, 0, 0, 0], lv = [0, 0, 0, 0];
      if (!this.prev) this.prev = new Float32Array(spec.length);
      for (let k = 0; k < bands.length; k++) {
        const B = bands[k], n = B.b - B.a;
        let pow = 0;
        for (let i = B.a; i < B.b; i++) pow += Math.pow(10, Math.max(-140, spec[i]) / 10);
        lv[k] = 10 * Math.log10(pow / n + 1e-14);
        this.levelAvg[k] = this.levelAvg[k] == null ? lv[k] : this.levelAvg[k] + (lv[k] - this.levelAvg[k]) * 0.01;
        const floor = this.levelAvg[k] - 30;                   // what is far below the band's level is noise
        let f = 0;
        for (let i = B.a; i < B.b; i++) {                      // amplitude^0.3 against the band's level: a loud kick
          const v = Math.max(spec[i], floor), p = Math.max(this.prev[i], floor);   // counts more than a bass note
          if (v > p) f += Math.pow(10, (v - this.levelAvg[k]) * 0.015) - Math.pow(10, (p - this.levelAvg[k]) * 0.015);
        }
        flux[k] = f / n;
      }
      for (let i = 0; i < spec.length; i++) this.prev[i] = spec[i];
      let onset = 0;
      for (let k = 0; k < bands.length; k++) {
        this.fluxAvg[k] = this.fluxAvg[k] ? this.fluxAvg[k] + (flux[k] - this.fluxAvg[k]) * 0.004 : flux[k];
        onset += bands[k].w * flux[k] / (this.fluxAvg[k] + 0.05);
      }
      this.addOnset(t, onset);
      // what the downbeat and phrase analysis need: per frame the low spectrum, the band levels, kick and hi onsets
      const low = [];
      for (let i = this.lowBins[0]; i < this.lowBins[1]; i++) low.push(Math.max(spec[i], this.levelAvg[0] - 40));
      const kickNow = flux[0] / (this.fluxAvg[0] + 0.05);
      this.recent.push({ t, kick: kickNow, kickRaw: flux[0], hi: flux[3] / (this.fluxAvg[3] + 0.05), hiRaw: flux[3],
        low: lv[0] });
      this.dropCheck(t, flux[0], lv[0]);
      while (this.recent.length && this.recent[0].t < t - 1500) this.recent.shift();
      const c = this.cur; c.n++; c.lv = c.lv.map((x, k) => x + lv[k]);
      c.low = c.low ? c.low.map((x, i) => x + low[i]) : low;
      if (t - this.updAt >= 100) { this.updAt = t; this.update(t); }
      return this.tick(t);
    }

    addOnset(t, v) {
      const s = Math.floor(t / this.o.hop);
      if (this.lastSlot < 0 || s - this.lastSlot > this.N) { this.env.fill(0); this.lastSlot = s; }
      while (this.lastSlot < s) { this.lastSlot++; this.env[this.lastSlot % this.N] = 0; }
      this.env[s % this.N] += v;
    }
    /** the last n slots of the onset curve, lightly smoothed (index n-1 = the newest slot) */
    curve(n) {
      const N = this.N, raw = new Float32Array(n), y = new Float32Array(n), K = [0.06, 0.24, 0.4, 0.24, 0.06];
      for (let i = 0; i < n; i++) raw[i] = this.env[mod(this.lastSlot - n + 1 + i, N)];
      for (let i = 0; i < n; i++) {
        let s = 0, w = 0;
        for (let d = -2; d <= 2; d++) { const j = i + d; if (j >= 0 && j < n) { s += raw[j] * K[d + 2]; w += K[d + 2]; } }
        y[i] = s / w;
      }
      return y;
    }

    update(t) {
      const o = this.o, hop = o.hop, have = Math.min(Math.floor((t - this.started) / hop), Math.floor(o.windowMs / hop));
      if (have < 2500 / hop) return;
      const y = this.curve(have);
      if (t - this.acfAt >= 250) { this.acfAt = t; this.tempo(y, t); }
      if (this.locked) this.phase(y, t);
      // confidence: how clearly the music beats (tempo and phase), smoothed; it sinks during a break
      const c = this.locked ? Math.sqrt(clamp(this.tempoSal / 0.35, 0, 1) * clamp(this.phaseSal / 0.6, 0, 1)) : 0;
      this.confidence += (c - this.confidence) * 0.08;
      if (this.locked && !this.tapLock && t - this.lastSalientAt > o.holdMs) { this.locked = false; this.confidence = 0; }
    }

    tempo(y, t) {
      const o = this.o, hop = o.hop, n = y.length;
      let mean = 0; for (let i = 0; i < n; i++) mean += y[i]; mean /= n;
      const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = y[i] - mean;
      const lagMin = 60000 / o.maxBpm / hop, lagMax = 60000 / o.minBpm / hop, L = Math.min(n - 50, Math.ceil(lagMax * 4) + 2);
      const r = new Float32Array(L + 1);
      for (let l = 0; l <= L; l++) { let s = 0; for (let i = l; i < n; i++) s += x[i] * x[i - l]; r[l] = s / (n - l); }
      if (r[0] <= 1e-9) { this.tempoSal *= 0.9; return; }
      for (let l = L; l >= 0; l--) r[l] /= r[0];
      const at = v => { if (v >= L) return 0; const i = Math.floor(v), f = v - i; return r[i] * (1 - f) + r[i + 1] * f; };
      const W = [1, 0.7, 0.5, 0.4];
      const comb = tau => {
        let s = 0, w = 0;
        for (let k = 1; k <= 4; k++) if (k * tau < L) { s += W[k - 1] * at(k * tau); w += W[k - 1]; }
        return w ? s / w : 0;
      };
      const cur = this.period / hop;
      let best = -1e9, bestTau = 0, bestRaw = 0;
      for (let tau = lagMin; tau <= lagMax; tau += 0.25) {
        const raw = comb(tau), oct = Math.log2(60000 / (tau * hop) / o.prefBpm);
        let score = raw * Math.exp(-0.5 * (oct / 0.9) ** 2);
        if (this.locked) score *= 1 + 0.5 * Math.exp(-0.5 * (Math.log2(tau / cur) / 0.03) ** 2);   // the tempo is sticky
        if (this.tapLock) score *= Math.abs(Math.log2(tau * hop / this.tapLock)) < 0.06 ? 1 : 0.1;  // tapped: stay near it
        if (score > best) { best = score; bestTau = tau; bestRaw = raw; }
      }
      // octave and triplet errors: outside the preference range, a related tempo inside it that the comb finds nearly
      // as strong wins (a kick pattern in dotted quarters does not make 100 BPM into 67)
      const bpmOf = tau => 60000 / (tau * hop), inPref = tau => bpmOf(tau) >= o.prefLo && bpmOf(tau) <= o.prefHi;
      if (!this.tapLock && !inPref(bestTau)) {
        for (const m of [2, 0.5, 1.5, 2 / 3]) {
          const tau2 = bestTau / m;
          if (tau2 >= lagMin && tau2 <= lagMax && inPref(tau2) && comb(tau2) >= 0.6 * bestRaw) {
            bestTau = tau2; bestRaw = comb(tau2); break;
          }
        }
      }
      this.tempoSal += (Math.max(0, bestRaw) - this.tempoSal) * 0.3;
      if (bestRaw < 0.06) return;                              // nothing periodic: hold the tempo
      this.lastSalientAt = this.audioAt = t;
      const P = bestTau * hop, same = (a, b) => Math.abs(Math.log2(a / b)) < 0.04;
      if (this.cand && same(P, this.cand)) this.candCount++; else { this.cand = P; this.candCount = 1; }
      if (!this.locked) {                                      // the first lock: the same tempo for a second
        if (this.candCount >= 4 && bestRaw > 0.1 && n * hop >= 3500) {
          this.period = P; this.locked = true; this.cand = null; this.next = 0; this.offCount = 0;
        }
        return;
      }
      const d = Math.log2(P / this.period);
      if (Math.abs(d) < 0.05) { this.period += (P - this.period) * 0.2; this.cand = null; return; }
      // another tempo has to hold 2.5 s. Double, half or triplet time: never from inside the preference range to
      // outside it, and inside it only after 6 s while the current tempo has clearly gone weak (a half-time section
      // keeps the tempo); from outside into the range after 2.5 s
      const related = [1, Math.log2(3), Math.log2(1.5), 2].some(r => Math.abs(Math.abs(d) - r) < 0.07);
      const curIn = inPref(cur), newIn = inPref(bestTau);
      if (related && curIn && (!newIn || comb(cur) > 0.7 * bestRaw)) { this.candCount = 0; return; }
      if (this.candCount >= (related && curIn ? 24 : 10)) { this.period = P; this.cand = null; this.offCount = 99; this.newTempo(); }
    }

    phase(y, t) {
      const hop = this.o.hop, n = y.length, Ps = this.period / hop, K = Math.min(8, Math.floor((n - 3) / Ps));
      if (K < 2) return;
      const at = v => { const i = Math.floor(v), f = v - i; return i < 0 || i + 1 >= n ? 0 : y[i] * (1 - f) + y[i + 1] * f; };
      let best = -1, bestPhi = 0, sum = 0, cnt = 0;
      for (let phi = 2; phi < Ps + 2; phi += 0.5) {             // phi slots back from the newest (skip the unfinished ones)
        let s = 0; for (let k = 0; k < K; k++) s += Math.pow(0.88, k) * at(n - 1 - phi - k * Ps);
        sum += s; cnt++;
        if (s > best) { best = s; bestPhi = phi; }
      }
      const meanS = sum / cnt;
      const sal = best > 0 ? (best - meanS) / best : 0;
      this.phaseSal += (sal - this.phaseSal) * 0.2;
      const m = t - bestPhi * hop - this.latency;               // where the last beat was
      const P = this.period;
      if (!this.next) { this.next = m + P * Math.ceil((t - m) / P); return; }
      const e = mod(m - this.next + P / 2, P) - P / 2;           // phase error against the predicted grid
      if (sal < 0.25) return;                                   // a break: keep the prediction (tempo hold)
      if (Math.abs(e) < 0.2 * P) {
        this.next += 0.12 * e; this.period += 0.01 * e; this.offCount = Math.max(0, this.offCount - 1);
      } else if (++this.offCount >= 15) {                       // off for 1.5 s: lock anew
        this.next += e; this.offCount = 0;
        if (this.next <= this.lastBeatAt + 0.5 * P) this.next += P;
      }
    }

    /** advance the clock to t (also without audio: a tapped tempo keeps ticking); returns the beats due */
    tick(t) {
      const ev = this.pending.splice(0);
      if (!this.locked || !this.next) return ev;
      const P = this.period;
      if (t - this.next > 2 * P) this.next += P * Math.floor((t - this.next) / P);   // the page was hidden: no catching up
      while (this.next <= t + this.dt / 2) {                   // the frame nearest to the beat shows it
        if (this.next - this.lastBeatAt > 0.5 * P) ev.push(this.emit(this.next, t));
        this.next += P;
      }
      return ev.concat(this.pending.splice(0));                // a break noticed when a beat interval closed
    }

    emit(at, t) {
      this.closeInterval(at);
      this.beat++; this.lastBeatAt = at;
      const j = this.beat, inBar = this.beatInBar(j), barInPhrase = this.barInPhrase(j);
      const held = this.inBreak || this.weakRun >= 2;
      return { type: 'beat', t: at, beat: j, beatInBar: inBar, downbeat: inBar === 0, barInPhrase,
        phraseStart: inBar === 0 && barInPhrase === 0, held, bpm: this.bpm, confidence: this.confidence };
    }

    newInterval(t) { return { t, n: 0, lv: [0, 0, 0, 0], low: null, beat: this.beat + 1 }; }
    // a beat interval closes when the next beat comes: its features feed the downbeat and phrase analysis
    closeInterval(at) {
      const c = this.cur;
      this.cur = this.newInterval(at);
      if (!c.n || c.beat < 0) return;
      c.lv = c.lv.map(x => x / c.n); c.low = c.low.map(x => x / c.n);
      // the strongest onsets right at the beat; the raw ones (without the band's own average, which sinks in a break)
      // for the break itself
      const near = this.recent.filter(f => f.t >= c.t - 30 + this.latency && f.t <= c.t + 60 + this.latency);
      const most = key => near.reduce((a, f) => Math.max(a, f[key]), key === 'low' ? -200 : 0);
      c.kick = most('kick'); c.hi = most('hi'); c.kickRaw = most('kickRaw'); c.raw = c.kickRaw + 0.6 * most('hiRaw'); c.bassDb = most('low');
      this.breakCheck(c);
      const prev = this.intervals[this.intervals.length - 1];
      c.change = 0;
      if (prev && prev.beat === c.beat - 1) {                     // how much the bass line changed (cosine distance)
        let ab = 0, aa = 0, bb = 0;
        for (let i = 0; i < c.low.length; i++) {
          const a = Math.pow(10, c.low[i] / 20), b = Math.pow(10, prev.low[i] / 20);
          ab += a * b; aa += a * a; bb += b * b;
        }
        c.change = 1 - ab / (Math.sqrt(aa * bb) + 1e-9);
      }
      this.intervals.push(c);
      if (this.intervals.length > 80) this.intervals.shift();
      this.downbeat(c);
      if (mod(c.beat - this.down, 4) === 3) this.bar(c.beat - 3);
    }

    // break: the drums are gone (the beats' onsets far below their usual strength for a bar); the beats are only held
    // then. The usual strength is learned outside breaks only.
    breakCheck(c) {
      const s = c.raw;
      this.weakRun = this.strengthRef && s < 0.5 * this.strengthRef ? this.weakRun + 1 : 0;
      if (!this.inBreak) {
        if (this.intervals.length >= 8 && this.strengthRef && c.beat - this.breakOver >= 8) {
          const last = this.intervals.slice(-4), m4 = last.reduce((a, x) => a + x.raw, 0) / 4;
          if (last.length === 4 && m4 < 0.55 * this.strengthRef && last.every(x => x.raw < 0.9 * this.strengthRef)) {
            this.inBreak = true; this.breakBeats = 0; this.pending.push({ type: 'break', t: c.t, beat: c.beat });
          }
        }
        if (!this.inBreak && s < 3 * (this.strengthRef || s)) {   // a mean at first, then a slow average
          const a = Math.max(0.05, 1 / ++this.refCount);
          this.strengthRef = this.strengthRef ? this.strengthRef + (s - this.strengthRef) * a : s;
          this.kickRef = this.kickRef ? this.kickRef + (c.kickRaw - this.kickRef) * a : c.kickRaw;
          this.kickLevel = this.kickLevel != null ? this.kickLevel + (c.bassDb - this.kickLevel) * 0.05 : c.bassDb;   // dB
        }
      } else {
        this.breakBeats++;
        const last = this.intervals.slice(-4), m4 = last.reduce((a, x) => a + x.raw, 0) / last.length;
        // the drums came back softly: the break ends without a drop
        if (this.breakBeats >= 4 && m4 > 0.8 * this.strengthRef && last.filter(x => x.raw > 0.6 * this.strengthRef).length >= 3) {
          this.inBreak = false; this.breakOver = c.beat; this.pending.push({ type: 'breakend', t: c.t, beat: c.beat });
        }
      }
    }
    // drop: in a break, a strong kick right on a beat. It is the one and starts a phrase; it comes as an event at once,
    // within the first beat.
    dropCheck(t, kick, low) {
      if (!this.inBreak || !this.locked || this.breakBeats < 2 || t - this.lastBeatAt > 150 + this.latency) return;
      // as sudden and as loud as the kicks before the break (a pad or the room's noise may flicker in the bass band too,
      // but not that loud)
      if (kick < 0.9 * this.kickRef || low < this.kickLevel - 4) return;
      const j = this.beat;
      this.inBreak = false; this.weakRun = 0; this.breakOver = j;
      this.hint = j; this.down = mod(j, 4); this.downConfidence = 1;
      this.boundary(j, true);
      this.pending.push({ type: 'drop', t: this.lastBeatAt, beat: j });
    }

    downbeat(c) {
      const iv = this.intervals, avg = key => iv.reduce((a, x) => a + x[key], 0) / iv.length + 1e-6;
      // the one: a kick, a new bass note; a snare (backbeat, high band) rather speaks for beats 2 and 4
      const f = c.kick / avg('kick') - 0.6 * c.hi / avg('hi') + 0.5 * c.change / avg('change');
      const r = mod(c.beat, 4);
      for (let k = 0; k < 4; k++) this.downScore[k] *= 0.97;     // memory of ~8 bars
      this.downScore[r] += f;
      if (this.hint != null) {                                 // a tap series or a drop said where the one is
        this.downScore[mod(this.hint, 4)] = Math.max(...this.downScore) + 25; this.hint = null;
      }
      const s = this.downScore.slice().sort((a, b) => b - a), best = this.downScore.indexOf(s[0]);
      // how far the one leads the runner-up: a lead of about ten beats' worth of evidence is sure
      this.downConfidence = clamp((s[0] - s[1]) / 10, 0, 1);
      if (best !== mod(this.down, 4) && this.downScore[best] > 1.15 * this.downScore[mod(this.down, 4)]) {
        this.down = best;
        if (this.phraseAnchor != null) {                       // the phrase moves with the one (to the nearer side)
          const d = mod(best - this.phraseAnchor, 4);
          this.phraseAnchor += d > 2 ? d - 4 : d;
        }
      }
    }

    // a bar is complete (its first beat number j): section boundaries from changes in the four band levels
    bar(j) {
      const ivs = this.intervals.filter(x => x.beat >= j && x.beat < j + 4);
      if (ivs.length < 4) return;
      const lv = [0, 1, 2, 3].map(k => ivs.reduce((a, x) => a + x.lv[k], 0) / 4);
      this.bars.push({ beat: j, lv, hi: ivs[0].lv[3] });
      if (this.bars.length > 64) this.bars.shift();
      const B = this.bars, n = B.length;
      if (n < 4) return;
      // novelty of the bar line before bar n-2: its two bars against the two before (in dB, summed over the bands)
      const m = (a, b) => [0, 1, 2, 3].map(k => (B[a].lv[k] + B[b].lv[k]) / 2);
      const after = m(n - 2, n - 1), before = m(n - 4, n - 3);
      // plus a crash: the highs on the one clearly louder than on the ones of the bars around
      const his = B.slice(-12).map(x => x.hi).sort((a, b) => a - b), hiMed = his[Math.floor(his.length / 2)];
      const crash = Math.max(0, B[n - 2].hi - hiMed - 1.5) * 2;
      const nov = { beat: B[n - 2].beat, v: after.reduce((a, x, k) => a + Math.abs(x - before[k]), 0) + crash };
      const N = (this.nov = this.nov.concat(nov).slice(-32)), sorted = N.map(x => x.v).sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      // a boundary is the peak of the novelty (one bar later we know it was the peak)
      if (N.length < 3) return;
      const [a, p, c] = N.slice(-3), last = this.bounds[this.bounds.length - 1];
      const peak = p.v > Math.max(3, 2.2 * med) && p.v > a.v && p.v >= c.v;
      if (peak && (last == null || p.beat - last >= 12)) this.boundary(p.beat, false);
    }

    boundary(beat, strong) {
      this.bounds.push(beat); if (this.bounds.length > 8) this.bounds.shift();
      // the phrase length from the distances (in bars) between boundaries: 16 if all fit, else 8, else 4
      const ds = this.bounds.slice(1).map((b, i) => Math.round((b - this.bounds[i]) / 4)).filter(d => d > 0);
      if (ds.length >= 2 && ds.every(d => d % 16 === 0)) this.phraseBars = 16;
      else if (ds.length && ds.filter(d => d % 8 === 0).length >= ds.length * 0.6) this.phraseBars = 8;
      else if (ds.length && ds.filter(d => d % 4 === 0).length >= ds.length * 0.6) this.phraseBars = 4;
      const fits = this.phraseAnchor != null && mod(beat - this.phraseAnchor, 4 * this.phraseBars) === 0;
      this.phraseConfidence = clamp(this.phraseConfidence * 0.7 + (fits || strong ? 0.4 : 0), 0, 1);
      // a boundary off the phrase grid moves it when the grid is not sure yet, or when the last one was off too
      const move = strong || this.phraseAnchor == null || (!fits && (this.phraseConfidence < 0.6 || this.offGrid));
      this.offGrid = !fits && !move;
      if (move) this.phraseAnchor = beat;
    }

    /** a tap (ms). From two taps of a series on: tempo (median of the gaps) and phase from the taps, and the tempo
     *  stays near the tapped one (the music only moves the phase). The first tap of a series is the one. */
    tap(t) {
      if (this.taps.length && t - this.taps[this.taps.length - 1] > 2000) { this.taps = []; this.tapCount = 0; }
      this.taps = this.taps.concat(t).slice(-9); this.tapCount = (this.tapCount || 0) + 1;
      if (this.taps.length < 2) return [];
      const gaps = this.taps.slice(1).map((x, i) => x - this.taps[i]).sort((a, b) => a - b);
      const P = clamp(gaps[Math.floor(gaps.length / 2)], 60000 / this.o.maxBpm, 60000 / this.o.minBpm);
      if (!this.tapLock || Math.abs(Math.log2(P / this.tapLock)) > 0.05) this.newTempo();
      this.period = P; this.tapLock = P; this.locked = true; this.lastSalientAt = t; this.offCount = 0; this.cand = null;
      let ev = [];
      if (t - this.lastBeatAt < 0.3 * P) this.lastBeatAt = t;  // a beat just came: the tap only moves it
      else ev = [this.emit(t, t)];                              // the tap is a beat
      this.next = t + P;
      this.down = mod(this.beat - (this.tapCount - 1), 4); this.hint = this.down; this.downConfidence = 1;
      ev.forEach(e => {
        e.beatInBar = this.beatInBar(e.beat); e.downbeat = e.beatInBar === 0;
        e.phraseStart = e.downbeat && this.barInPhrase(e.beat) === 0;
      });
      return ev;
    }
    /** end the tap tempo: the music alone again; without music in the last seconds the beat stops */
    untap(t) {
      this.tapLock = null; this.taps = []; this.tapCount = 0;
      if (t == null || t - this.audioAt > 3000) { this.locked = false; this.confidence = 0; }
    }
    // the tempo was set anew (a tap, or another tempo took over): what a usual beat sounds like is learned anew
    newTempo() {
      this.strengthRef = 0; this.refCount = 0; this.breakOver = this.beat;
      if (this.inBreak) { this.inBreak = false; this.pending.push({ type: 'breakend', t: this.lastBeatAt, beat: this.beat }); }
    }
    /** what the panel shows */
    state() {
      return { locked: this.locked, bpm: this.bpm, confidence: this.confidence, tapped: !!this.tapLock, inBreak: this.inBreak,
        beatInBar: this.beatInBar(), barInPhrase: this.barInPhrase(), phraseBars: this.phraseBars,
        downConfidence: this.downConfidence, phraseConfidence: this.phraseAnchor == null ? 0 : this.phraseConfidence };
    }
  }

  // ---------- beat grid: run an action on the next beat, bar or phrase ----------
  // at(unit, fn, key): unit 'off'/'now' runs at once; 'beat', 'bar' or 'phrase' on the next such boundary of the
  // tracker. Without a running beat it runs at once, and it never waits longer than one unit (plus a little): a lost
  // beat must not swallow an action. Pressed just after a boundary (up to 250 ms, at most 45 % of a beat) it counts as
  // meant for that boundary and runs at once – also a drop, which the tracker hears within its first beat. A job with
  // a key replaces a waiting job with the same key (two presses of "next" give one change).
  class BeatGrid {
    constructor(tracker, { grace = 250 } = {}) { this.tr = tracker; this.jobs = []; this.grace = grace; this.last = {}; }
    unitMs(unit) {
      const P = this.tr.period;
      return unit === 'beat' ? P : unit === 'bar' ? 4 * P : unit === 'phrase' ? 4 * P * this.tr.phraseBars : 0;
    }
    at(unit, fn, key, now) {
      now = now != null ? now : (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (!['beat', 'bar', 'phrase'].includes(unit) || !this.tr.locked) { fn(); return null; }
      const grace = Math.min(this.grace, 0.45 * this.tr.period);
      if (this.last[unit] != null && now - this.last[unit] < grace) { fn(); return null; }
      if (key) this.jobs = this.jobs.filter(j => j.key !== key);
      const job = { unit, fn, key, due: now + this.unitMs(unit) * 1.1 + 150 };
      this.jobs.push(job);
      return job;
    }
    pending(key) { return this.jobs.some(j => !key || j.key === key); }
    /** feed every beat event of the tracker */
    beat(ev) {
      this.last.beat = ev.t;
      if (ev.downbeat) this.last.bar = ev.t;
      if (ev.phraseStart) this.last.phrase = ev.t;
      this.run(j => j.unit === 'beat' || (j.unit === 'bar' && ev.downbeat) || (j.unit === 'phrase' && ev.phraseStart));
    }
    /** every frame: run what waited too long, or everything when the beat is gone */
    poll(now) { this.run(j => !this.tr.locked || now >= j.due); }
    run(pred) {
      const due = this.jobs.filter(pred);
      if (!due.length) return;
      this.jobs = this.jobs.filter(j => !due.includes(j));
      due.forEach(j => j.fn());
    }
    clear() { this.jobs = []; }
  }

  const api = { BeatTracker, BeatGrid };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamBeat = api;
})(typeof window !== 'undefined' ? window : globalThis);
