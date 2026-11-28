// #276: recording the output – the engine in the stage (static/recorder.js) with a fake stream, a fake MediaRecorder
// and a fake Dream: the pieces arrive in order and joined, the stop hands in the last piece, a recording ends by itself
// after 15 minutes, Dream's "the time is up" or "the disk is full" stops it, an upload that fails stops it without
// losing what is there; and the card's words (static/reccard.js).
// Run: node --test tests/js/recorder.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const R = require('../../static/recorder.js');
const C = require('../../static/reccard.js');
const tick = () => new Promise(res => setTimeout(res, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };

class FakeRecorder {
  static made = [];
  constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; this.n = FakeRecorder.made.push(this); }
  start(slice) { this.slice = slice; this.state = 'recording'; }
  piece(text) { this.ondataavailable({ data: new Blob([text]) }); }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    setTimeout(() => { this.ondataavailable({ data: new Blob([`end-of-${this.n}`]) }); this.onstop(); }, 0);
  }
}

// Dream as recording.py answers, in memory: one file per recording, its pieces in order
function fakeDream({ refuse = {} } = {}) {
  const d = { files: {}, ends: [], n: 0, stop: '' };
  d.post = async (url, body) => {
    const q = new URL(url, 'http://x');
    if (refuse[q.pathname]) return refuse[q.pathname]();
    if (q.pathname === '/rec/start') {
      d.started = JSON.parse(body);
      const id = `r${++d.n}`;
      d.files[id] = [];
      return { ok: true, status: 200, json: { id, name: 'dream-rec-x.mp4', w: 1920, h: 1080, bps: 8e6, abps: 128000, max_secs: 900 } };
    }
    const [, kind, id] = q.pathname.match(/^\/rec\/(chunk|end)\/(\w+)$/);
    if (kind === 'chunk') {
      assert.equal(+q.searchParams.get('seq'), d.files[id].length, 'pieces in order');
      d.files[id].push(await body.text());
      return { ok: true, status: 200, json: { ok: true, ...(d.stop ? { stop: d.stop } : {}) } };
    }
    d.ends.push([id, q.searchParams.get('reason')]);
    return { ok: true, status: 200, json: { ok: true } };
  };
  return d;
}

function engine(d, extra = {}) {
  let clock = 0;
  const errors = [];
  const rec = R.create({
    post: d.post, MediaRecorder: FakeRecorder, supported: t => t.startsWith('video/mp4'), now: () => clock,
    stream: (w, h, audio) => ({ w, h, audio }), onError: code => errors.push(code), later: (f, ms) => setTimeout(f, 0), ...extra,
  });
  return { rec, errors, at: t => { clock = t; } };
}

test('the best format the browser has: H.264 in MP4, else WebM; with sound only when asked', () => {
  assert.equal(R.pickType(() => true, false), 'video/mp4;codecs=avc1.640028');
  assert.equal(R.pickType(() => true, true), 'video/mp4;codecs=avc1.640028,mp4a.40.2');
  assert.equal(R.pickType(t => t.startsWith('video/webm'), true), 'video/webm;codecs=vp9,opus');
  assert.equal(R.pickType(t => t === 'video/webm', false), 'video/webm');
  assert.equal(R.pickType(() => { throw new Error('odd'); }, false), '');
  assert.equal(R.pickType(() => false, false), '');
});

test('a recording: the pieces go to Dream in order, the stop hands in the last one and closes the file', async () => {
  FakeRecorder.made = [];
  const d = fakeDream(), { rec, errors } = engine(d);
  assert.equal(await rec.start({ pw: 512, ph: 512, audio: true }), true);
  assert.equal(rec.on, true);
  assert.deepEqual(d.started, { pw: 512, ph: 512, mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', audio: true });
  const r = FakeRecorder.made[0];
  assert.equal(r.slice, 1000);                                 // a piece about every second …
  assert.equal(r.opts.videoKeyFrameIntervalDuration, 1000);    // … and a key frame as often (MP4 fragments)
  assert.equal(r.opts.mimeType, 'video/mp4;codecs=avc1.640028,mp4a.40.2');
  assert.equal(r.opts.videoBitsPerSecond, 8e6); assert.equal(r.opts.audioBitsPerSecond, 128000);   // as Dream says
  assert.deepEqual(r.stream, { w: 1920, h: 1080, audio: true });
  r.piece('a'); r.piece('b'); r.piece('c');
  await settle();
  assert.deepEqual(d.files.r1, ['a', 'b', 'c']);               // on Dream's disk while it still records
  await rec.stop();
  assert.deepEqual(d.files.r1, ['a', 'b', 'c', 'end-of-1']);
  assert.deepEqual(d.ends, [['r1', 'stop']]);
  assert.equal(rec.on, false);
  assert.deepEqual(errors, []);
  assert.equal(await rec.start({ pw: 1, ph: 1 }), true);       // the next one is a file of its own
  await rec.stop();
  assert.deepEqual(d.ends, [['r1', 'stop'], ['r2', 'stop']]);
});

test('a recording ends by itself after 15 minutes (the time Dream gives) – never a second file', async () => {
  FakeRecorder.made = [];
  const d = fakeDream(), e = engine(d);
  await e.rec.start({ pw: 16, ph: 9 });
  const r = FakeRecorder.made[0];
  r.piece('a');
  e.rec.tick(899_000); await settle();
  assert.equal(r.state, 'recording');                          // not yet
  e.rec.tick(900_000); await settle(40);
  assert.equal(r.state, 'inactive');
  assert.equal(e.rec.on, false);
  assert.deepEqual(d.files.r1, ['a', 'end-of-1']);
  assert.deepEqual(d.ends, [['r1', 'time']]);
  assert.equal(FakeRecorder.made.length, 1);
});

for (const why of ['time', 'disk']) {
  test(`Dream says "${why}": the recording stops by itself, the page says nothing more`, async () => {
    FakeRecorder.made = [];
    const d = fakeDream(), e = engine(d);
    await e.rec.start({ pw: 1, ph: 1 });
    const r = FakeRecorder.made[0];
    d.stop = why;
    r.piece('x'); await settle(40);
    assert.equal(r.state, 'inactive');
    assert.equal(e.rec.on, false);
    assert.deepEqual(d.ends, [['r1', why]]);
    assert.deepEqual(e.errors, []);                            // Dream knows already
  });
}

test('an upload that keeps failing stops the recording and says so; what Dream has stays', async () => {
  FakeRecorder.made = [];
  let failing = false;
  const d = fakeDream(), post = d.post;
  d.post = async (url, body) => { if (failing && url.startsWith('/rec/chunk')) throw new Error('offline'); return post(url, body); };
  const e = engine(d);
  await e.rec.start({ pw: 1, ph: 1 });
  const r = FakeRecorder.made[0];
  r.piece('kept'); await settle();
  failing = true;
  r.piece('lost'); await settle(80);
  assert.equal(e.rec.on, false);
  assert.equal(r.state, 'inactive');
  assert.deepEqual(d.files.r1, ['kept']);
  assert.deepEqual(e.errors, ['upload']);
  assert.deepEqual(d.ends, [['r1', 'error']]);                 // Dream closes the file at once
});

test('the upload falls behind too far: it stops before the memory runs out', async () => {
  FakeRecorder.made = [];
  const d = fakeDream(), slow = d.post;
  d.post = (url, body) => url.startsWith('/rec/chunk') ? new Promise(() => {}) : slow(url, body);   // never answers
  const e = engine(d, { maxBehind: 10 });
  await e.rec.start({ pw: 1, ph: 1 });
  const r = FakeRecorder.made[0];
  r.piece('123456'); r.piece('789012');
  assert.equal(e.rec.on, false);
  assert.deepEqual(e.errors, ['behind']);
});

test('no MediaRecorder, or Dream refuses the start: nothing records, the reason is told when Dream does not know it', async () => {
  const errs = [], d = fakeDream();
  const none = R.create({ post: d.post, MediaRecorder: undefined, stream: () => ({}), onError: c => errs.push(c) });
  assert.equal(await none.start({ pw: 1, ph: 1 }), false);
  assert.deepEqual(errs, ['nosupport']);
  const busy = fakeDream({ refuse: { '/rec/start': () => ({ ok: false, status: 409, json: { error: 'busy' } }) } });
  const e = engine(busy);
  assert.equal(await e.rec.start({ pw: 1, ph: 1 }), false);
  assert.deepEqual(e.errors, []);                              // another stage records: Dream knows
});

test('the card: one button with the running time, a warning in the last minute, what was saved', () => {
  assert.equal(C.clock(0), '00:00'); assert.equal(C.clock(134), '02:14'); assert.equal(C.clock(3725), '1:02:05');
  assert.equal(C.size(312e6), '312 MB'); assert.equal(C.size(1.44e9), '1.4 GB');
  assert.deepEqual(C.button(false), { text: 'Record', sr: '', dot: '●' });
  assert.deepEqual(C.button(true, 134), { text: '02:14', sr: ' Recording – stop', dot: '●' });   // how long it runs, not a countdown
  assert.equal(C.soon({ max_secs: 900 }, 839), false); assert.equal(C.soon({ max_secs: 900 }, 840), true);   // the last minute blinks
  assert.equal(C.say({ on: true, max_secs: 900 }, 600), '');                    // nothing else to read while it runs …
  assert.match(C.say({ on: true, max_secs: 900 }, 845), /One minute left/);    // … but the last minute is told
  assert.equal(C.say({ left_min: 3 }), '');                                     // no disk minutes, no quality
  assert.match(C.say({ error: 'nostage' }), /stage is not open/);
  assert.match(C.say({ error: 'disk' }), /disk is nearly full/);               // a plain message only when it happens
  assert.equal(C.say({ error: 'disk', last: { reason: 'disk', name: 'a.mp4' } }), '');   // the note says it already
  assert.equal(C.say({ error: '__proto__' }), '');
  assert.equal(C.doneText({ name: 'dream-rec-20261126-221530.mp4', bytes: 4e8, secs: 75, reason: 'stop' }),
    'Saved: dream-rec-20261126-221530.mp4 (400 MB, 01:15)');
  assert.equal(C.doneText({ name: 'a.mp4', bytes: 1.5e9, secs: 900, reason: 'time' }),
    'Stopped by itself after 15 minutes – saved: a.mp4 (1.5 GB, 15:00)');
  assert.equal(C.doneText({ name: 'a.mp4', bytes: 9e8, secs: 300, reason: 'disk' }),
    'Stopped: the disk is nearly full – saved: a.mp4 (900 MB, 05:00)');
  assert.equal(C.doneText({ name: '', bytes: 0 }), '');
  assert.equal(C.doneText(null), '');
});
