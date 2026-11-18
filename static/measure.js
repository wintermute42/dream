// #180: during a measurement run a page counts its own frames and reports them: frames per second, the mean and the
// slowest 5 % of frame times, and the share of slow frames (over 33 ms, i.e. below 30 fps). #204: a page that draws
// the dream picture also tells what draws it (renderer() gives "webgl2" or "canvas").
window.DreamMeasure = function (kind, send, renderer) {
  let running = false;
  return function onMessage(m) {
    if (!m || !m.measure || running) return;
    running = true;
    const until = performance.now() + Math.max(1000, Math.min(+m.measure.ms || 60000, 300000)), times = [];
    let last = performance.now();
    (function frame(t) {
      times.push(t - last); last = t;
      if (t < until) { requestAnimationFrame(frame); return; }
      running = false;
      const n = times.length, sorted = times.slice(1).sort((a, b) => a - b), sum = sorted.reduce((a, b) => a + b, 0);
      const avg = sum / Math.max(1, sorted.length), p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
      send({ measure_report: { kind, render: renderer ? renderer() : '', fps: Math.round(n / ((+m.measure.ms || 60000) / 1000) * 10) / 10,
        ms_avg: Math.round(avg * 10) / 10, ms_p95: Math.round(p95 * 10) / 10,
        slow_pct: Math.round(sorted.filter(x => x > 33.4).length / Math.max(1, sorted.length) * 1000) / 10 } });
    })(performance.now());
  };
};
