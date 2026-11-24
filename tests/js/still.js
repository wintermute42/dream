// #224: a real page of Dream inside a test page (tests/js/browser.mjs puts this before everything else of it): the
// clock stands until the test steps it (`__step(ms, frames)`), the random is seeded, and instead of the network there
// is the test – `__say(msg)` is Dream's word to the page, as it would come over its socket.
(() => {
  let a = 20261123;
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let now = 100000;
  const queue = [], socks = [], T0 = 1795000000000;
  performance.now = () => now; Date.now = () => T0 + now;
  window.requestAnimationFrame = f => { queue.push(f); return queue.length; };
  window.__step = (ms, frames = 1) => { for (let i = 0; i < frames; i++) { now += ms; for (const f of queue.splice(0)) f(now); } return now; };
  window.WebSocket = class { constructor() { this.readyState = 0; socks.push(this); } send() {} close() {} };
  window.__say = msg => { for (const s of socks) if (s.onmessage) s.onmessage({ data: JSON.stringify(msg) }); };
})();
