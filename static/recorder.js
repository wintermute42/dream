/* Dream – recording what the audience sees (#276), the engine in the stage (index.html). The stage hands it a
   MediaStream of its output picture (a canvas it copies the picture into, and the music input's sound if wanted); the
   browser's MediaRecorder encodes it (H.264 in MP4 where the browser can, else WebM), and every piece it gives – about
   one a second – goes to Dream at once (recording.py appends it to the file). So a crash or a closed tab loses at most
   the last seconds. A recording ends by itself after `max_secs` (Dream says how long: 15 minutes).

     const rec = DreamRec.create({ post, MediaRecorder, supported, stream, onError, later, now });
     await rec.start({ pw, ph, audio });   // the picture's size, whether a sound track comes along
     rec.tick(now);                        // every frame: stops it when the time is up
     await rec.stop();                     // the last piece, then Dream closes the file
     rec.on                                // recording now

   post(url, body) → Promise<{ok, status, json}> (body: a Blob, a JSON text or null); stream(w, h, audio) → the
   MediaStream at the size Dream chose; onError(code) for what Dream does not know already. Everything the browser
   does is handed in, so tests/js/recorder.test.mjs runs it with a fake stream, recorder and server. A global
   `DreamRec`. */
(function (root) {
  'use strict';
  // the browser's formats, the best first: H.264 (High, Main, Baseline) in MP4, then VP9 and VP8 in WebM
  const KINDS = [['mp4', 'avc1.640028', 'mp4a.40.2'], ['mp4', 'avc1.4d0028', 'mp4a.40.2'], ['mp4', 'avc1.42e01f', 'mp4a.40.2'],
    ['mp4', 'avc1', 'mp4a.40.2'], ['mp4', '', ''], ['webm', 'vp9', 'opus'], ['webm', 'vp8', 'opus'], ['webm', '', '']];
  function pickType(supported, audio) {
    for (const [box, v, a] of KINDS) {
      const codecs = v ? (audio ? `${v},${a}` : v) : '';
      const type = `video/${box}${codecs ? `;codecs=${codecs}` : ''}`;
      try { if (supported(type)) return type; } catch (e) { /* a browser that throws: not this one */ }
    }
    return '';
  }
  // what Dream refuses for good and reported itself – the page need not say it again
  const KNOWN = new Set(['disk', 'busy', 'gone', 'folder', 'time']);

  function create(o) {
    const slice = o.timeslice || 1000, maxBehind = o.maxBehind || 64 * 1024 * 1024;
    const later = o.later || ((f, ms) => setTimeout(f, ms)), now = o.now || (() => performance.now());
    let take = null, stopping = null, queue = [], behind = 0, pumping = false, waiters = [];

    const wait = ms => new Promise(res => later(res, ms));
    function report(code) { if (!KNOWN.has(code) && o.onError) o.onError(code); }

    function push(item) {
      queue.push(item); behind += item.blob ? item.blob.size : 0;
      if (behind > maxBehind) { abandon('behind'); return; }   // the upload cannot keep up: stop before memory runs out
      pump();
    }
    async function send(it) {
      const url = it.blob ? `/rec/chunk/${it.id}?seq=${it.seq}` : `/rec/end/${it.id}?reason=${it.reason}`;
      for (let i = 0; ; i++) {
        let res = null;
        try { res = await o.post(url, it.blob || null); } catch (e) { res = null; }
        if (res && res.ok) return res.json || {};
        if (res && res.json && res.json.stop) return res.json;    // Dream stopped it itself (time, disk): no retry
        if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 || res && res.status === 507) {
          const err = new Error('refused'); err.code = (res.json && res.json.error) || 'refused'; throw err;
        }
        if (i >= 4) { const err = new Error('upload'); err.code = 'upload'; throw err; }   // Dream does not answer
        await wait(500 * (i + 1));
      }
    }
    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (queue.length) {
          const it = queue[0], answer = await send(it);
          if (queue[0] !== it) continue;              // abandoned meanwhile
          queue.shift(); if (it.blob) behind -= it.blob.size;
          if (answer && answer.stop) stop(answer.stop);   // Dream: the time is up, or the disk is nearly full
        }
      } catch (e) {
        abandon(e.code || 'upload');
      } finally {
        pumping = false;
        if (!queue.length) { const w = waiters; waiters = []; w.forEach(f => f()); }
      }
    }
    const drained = () => (!queue.length && !pumping ? Promise.resolve() : new Promise(res => waiters.push(res)));

    // something broke: the recorder stops, nothing more is sent (what Dream has stays a playable file)
    function abandon(code) {
      if (!take) return;
      const t = take;
      take = null; queue = []; behind = 0;
      try { if (t.rec.state !== 'inactive') t.rec.stop(); } catch (e) { /* stopped */ }
      const w = waiters; waiters = []; w.forEach(f => f());
      // Dream closes the file now rather than waiting for the silence (it may not hear it: then the silence does)
      Promise.resolve().then(() => o.post(`/rec/end/${t.id}?reason=error`, null)).catch(() => {});
      report(code);
    }

    async function start({ pw, ph, audio = false } = {}) {
      if (take || stopping) return false;
      const mime = o.MediaRecorder ? pickType(o.supported || (t => o.MediaRecorder.isTypeSupported(t)), audio) : '';
      if (!mime) { report('nosupport'); return false; }
      let res = null;
      try { res = await o.post('/rec/start', JSON.stringify({ pw, ph, mime, audio: !!audio })); } catch (e) { res = null; }
      if (!res || !res.ok) { report((res && res.json && res.json.error) || 'start'); return false; }
      const j = res.json;
      // a key frame every second: the MP4 is written in fragments of a second, so a crash loses at most that much
      const opts = { mimeType: mime, videoBitsPerSecond: j.bps, videoKeyFrameIntervalDuration: slice };
      if (audio) opts.audioBitsPerSecond = j.abps;
      try {
        const r = new o.MediaRecorder(o.stream(j.w, j.h, !!audio), opts);
        const t = { id: j.id, rec: r, seq: 0, at: now(), maxMs: Math.max(1, +j.max_secs || 900) * 1000, w: j.w, h: j.h };
        t.done = new Promise(resolve => {
          r.ondataavailable = e => { if (take === t && e.data && e.data.size) push({ id: t.id, seq: t.seq++, blob: e.data }); };
          r.onstop = () => resolve();
        });
        r.onerror = () => abandon('encoder');
        take = t;
        r.start(slice);
      } catch (e) {
        take = null;
        o.post(`/rec/end/${j.id}?reason=error`, null).catch(() => {});
        report('encoder'); return false;
      }
      return true;
    }
    function tick(t = now()) {
      if (take && !stopping && t - take.at >= take.maxMs) stop('time');   // at most 15 minutes: it ends by itself
    }
    function stop(reason = 'stop') {
      if (!take) return Promise.resolve();
      if (stopping) return stopping;
      const t = take;
      stopping = (async () => {
        try { if (t.rec.state !== 'inactive') t.rec.stop(); } catch (e) { /* stopped */ }
        await t.done;                                   // its last piece is in the queue now
        if (take === t) push({ id: t.id, end: true, reason });
        await drained();
        if (take === t) take = null;
      })().finally(() => { stopping = null; });
      return stopping;
    }
    return {
      start, stop, tick,
      get on() { return !!take; },
      get size() { return take ? [take.w, take.h] : null; },
    };
  }
  const api = { create, pickType };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DreamRec = api;
})(typeof window !== 'undefined' ? window : globalThis);
