// #204: the picture chain of the stage (index.html) and the output windows (output.html), drawn on the graphics card.
// One WebGL 2 canvas takes the place of the stacked pictures and canvases: the last two AI pictures with their motion
// (#194) and cross-fade → smoothing → the effects of fx.js as shaders (same names, same numbers) → the touch layers →
// colour rotation and negative → brightness, saturation and master. Without WebGL 2, or when the context is lost, the
// same call draws with Canvas 2D as before (fx.js); `renderer` tells which one is at work.
// #210: the chain shares the graphics card with the AI, so it draws sparingly – its canvas is only as fine as what it
// shows (an AI picture of 512 px stays 512 px on a Retina screen; the browser scales it up as it does a picture
// element), a frame in which nothing moves is not drawn, the smoothing rests once it has caught up, and a preview
// beside the real output draws at a lower rate.
window.DreamStage = (() => {
  'use strict';
  const Fx = window.DreamFx;

  // ---------- shaders: v runs 0…1 with the picture's top at 0, P = v * R are canvas pixels as fx.js counts them ----------
  const VERT = `#version 300 es
in vec2 pos; out vec2 v; uniform float flip;
void main() { v = pos * .5 + .5; if (flip > .5) v.y = 1. - v.y; gl_Position = vec4(pos, 0., 1.); }`;
  const HEAD = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
float inside(vec2 u) { return u.x >= 0. && u.y >= 0. && u.x <= 1. && u.y <= 1. ? 1. : 0.; }
`;
  // one effect: fx(P) is the picture with the effect drawn over it at strength a – what FX[name] in fx.js leaves behind
  const EFFECT = body => `${HEAD}
uniform sampler2D src, prev, small;
uniform vec2 R, c, grid;
uniform float a, pulse, bass, spin, t, dir, loc, ang, opt, ns;
uniform vec3 sl[9];
#define S(P) texture(src, (P) / R).rgb
${body}
void main() { o = vec4(fx(v * R), 1.); }`;
  // kaleidoscope: n mirrored wedges around the centre, turned by sp; rgb and whether the wedge covers this pixel
  const WEDGE = `
vec4 wedge(vec2 P, float n, float sp, float scale) {
  vec2 q = P - c; float rad = length(max(c, R - c)) + 2., r = length(q);
  if (r > rad * scale) return vec4(0.);
  float A = 6.28318530718 / n, th = atan(q.y, q.x) - sp, i = floor(th / A + .5), ph = th - i * A;
  vec2 l = r * vec2(cos(ph), sin(ph));
  if (mod(i, 2.) > .5) l.y = -l.y;
  float cs = cos(sp * .5), sn = sin(sp * .5), k = scale * 2. * rad / min(R.x, R.y);
  vec2 u = vec2(l.x * cs - l.y * sn, l.x * sn + l.y * cs) / (R * k) + .5;
  return vec4(texture(src, u).rgb, 1.) * inside(u);
}`;
  // where a point comes from in a picture turned and scaled around m.xy (m: pivot, angle, scale; box: its size in pixels)
  const MOVED = `
uniform vec2 box;
vec2 moved(vec2 u, vec4 m) {
  vec2 q = (u - m.xy) * box; float cs = cos(m.z), sn = sin(m.z);
  return m.xy + vec2(q.x * cs + q.y * sn, q.y * cs - q.x * sn) / (m.w * box);
}`;
  const FRAG = {
    // the picture covering the buffer, blended from the one before it (the cross-fade stays visible in the effects);
    // #215: the one before lies as it was shown against the new one (mOld), the new one under its edges
    cover: `${HEAD}${MOVED}
uniform sampler2D tOld, tNew; uniform vec4 cOld, cNew, mOld; uniform float mixv;
void main() {
  vec3 n = texture(tNew, v * cNew.xy + cNew.zw).rgb;
  if (mixv < 1.) { vec2 u = moved(v, mOld); n = mix(mix(n, texture(tOld, u * cOld.xy + cOld.zw).rgb, inside(u)), n, mixv); }
  o = vec4(n, 1.);
}`,
    // #215: the smoothed picture laid out anew when a new picture takes over (see smoother.rebase in fx.js)
    rebase: `${HEAD}${MOVED}
uniform sampler2D tOld, tNew; uniform vec4 cNew, mOld;
void main() {
  vec2 u = moved(v, mOld);
  o = vec4(mix(texture(tNew, v * cNew.xy + cNew.zw).rgb, texture(tOld, u).rgb, inside(u)), 1.);
}`,
    // the picture as a few coarse cells (mosaic, print raster): each cell takes the picture at its middle, as fx.js does
    down: `${HEAD}
uniform sampler2D src;
void main() { o = vec4(texture(src, v).rgb, 1.); }`,
    mirror: EFFECT(`
vec3 m(vec2 P) { return P.x > R.x * .5 ? mix(S(P), S(vec2(R.x - P.x, P.y)), a) : S(P); }
vec3 fx(vec2 P) { return opt > .5 && P.y > R.y * .5 ? mix(m(P), m(vec2(P.x, R.y - P.y)), a) : m(P); }`),
    kaleido: EFFECT(`${WEDGE}
vec3 fx(vec2 P) { vec4 k = wedge(P, 6., spin, 1.); return mix(S(P), k.rgb, a * k.a); }`),
    mandala: EFFECT(`${WEDGE}
vec3 fx(vec2 P) {
  vec4 k = wedge(P, opt, spin * .7, 1.), k2 = wedge(P, opt * 2., -spin * 1.3, .45 + .05 * pulse);
  return mix(mix(S(P), k.rgb, a * k.a), k2.rgb, a * .8 * k2.a);
}`),
    tunnel: EFFECT(`
vec3 fx(vec2 P) {
  float ph = fract(t * (.18 + .5 * pulse)); vec3 k = S(P);
  for (int i = 0; i < 6; i++) {
    float sc = pow(.66, float(i) + ph) * 1.5; vec2 u = (P - c * (1. - sc)) / (R * sc);
    k = mix(k, texture(src, u).rgb, a * inside(u));
  }
  return k;
}`),
    waves: EFFECT(`
float shift(float i) {
  float u = i / 48. - c.y / R.y, near = exp(-u * u / .03);
  return sin(i * .33 - loc * abs(u) * 18. + t * 2.6) * R.x * .035 * (.4 + bass + pulse) * (1. - loc + loc * (.25 + 1.6 * near));
}
vec3 strip(vec3 k, vec2 P, float i) { float x = P.x - shift(i); return x >= 0. && x <= R.x ? mix(k, S(vec2(x, P.y)), a) : k; }
vec3 fx(vec2 P) {
  float sh = R.y / 48., i = min(47., floor(P.y / sh)); vec3 k = S(P);
  if (i > 0. && P.y - i * sh < 1.) k = strip(k, P, i - 1.);   // each strip is a pixel taller than its share
  return strip(k, P, i);
}`),
    glitch: EFFECT(`
vec3 fx(vec2 P) {
  vec3 k = S(P);
  for (int i = 0; i < 9; i++) {
    if (float(i) >= ns) break;
    float y = sl[i].x * R.y, x = P.x - sl[i].z * R.x * (.3 + pulse);
    if (P.y >= y && P.y < y + sl[i].y * R.y && x >= 0. && x <= R.x) k = mix(k, S(vec2(x, P.y)), a);
  }
  return k;
}`),
    pixel: EFFECT(`
vec3 fx(vec2 P) { return mix(S(P), texture(small, v).rgb, a); }`),
    raster: EFFECT(`
const vec3 LUM = vec3(.3, .59, .11);
vec3 fx(vec2 P) {
  vec3 k = S(P) * (1. - a); vec2 cs = R / grid, cell = min(floor(P / cs), grid - 1.);
  if (opt > .5) {                                     // dots: the neighbours' dots reach into this cell
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 q = cell + vec2(i, j);
      if (q.x < 0. || q.y < 0. || q.x >= grid.x || q.y >= grid.y) continue;
      vec3 col = texelFetch(small, ivec2(q), 0).rgb;
      float cov = clamp(max(.5, cs.x * .62 * sqrt(dot(col, LUM))) - distance(P, (q + .5) * cs) + .5, 0., 1.);
      k = mix(k, col, a * cov);
    }
  } else {                                            // lines, as thick as the cell is bright
    vec3 col = texelFetch(small, ivec2(cell), 0).rgb;
    float th = cs.y * (.2 + .8 * dot(col, LUM)), y0 = cell.y * cs.y + (cs.y - th) * .5;
    k = mix(k, col, a * clamp(min(P.y - y0, y0 + th - P.y) + .5, 0., 1.));
  }
  return k;
}`),
    rgb: EFFECT(`
vec3 at(vec2 P) { return S(P) * inside(P / R); }
vec3 fx(vec2 P) {
  vec2 off = R.x * .012 * (.4 + 1.6 * pulse) * vec2(cos(ang), sin(ang));
  return mix(S(P), vec3(at(P + off).r, S(P).g, at(P - off).b), a);
}`),
    feedback: EFFECT(`
vec3 fx(vec2 P) {
  float th = .035 * dir * (.5 + pulse), cs = cos(th), sn = sin(th); vec2 q = P - c;
  vec2 u = (c + vec2(q.x * cs + q.y * sn, q.y * cs - q.x * sn) / (1.05 + .04 * pulse)) / R;
  vec3 s = S(P);
  return mix(mix(s, texture(prev, u).rgb, .78 * a * inside(u)), s, 1. - .55 * a);
}`),
    trails: EFFECT(`
vec3 fx(vec2 P) { vec3 s = S(P); return max(mix(s, texture(prev, v).rgb, .88 * a), s); }`),
    // what the audience sees: the two pictures as they lie over each other (b over a), each moved by its motion; the
    // smoothed picture; the touch layers; the effects with colour rotation and negative; brightness, saturation, master
    final: `${HEAD}${MOVED}
uniform sampler2D tA, tB, tS, tF, tL0, tL1, tL2;
uniform vec4 cA, cB, mA, mB, mF, rect;
uniform vec3 lay;
uniform float oA, oB, smoothOn, k, inv, br, master;
uniform mat3 hue, sat;
vec3 layer(vec3 col, sampler2D tex, vec2 u, float mode) {   // 1 = over, 2 = screen (the textures hold colour times alpha)
  if (mode < .5) return col;
  vec4 l = texture(tex, u) * inside(u);
  return mode > 1.5 ? col + l.rgb * (1. - col) : col * (1. - l.a) + l.rgb;
}
void main() {
  vec2 u = (v - rect.xy) / rect.zw;                    // the picture's place on the canvas; a moving picture may reach past it
  vec2 ua = moved(u, mA), ub = moved(u, mB), uf = moved(u, mF);
  float ab = oB * inside(ub), inF = inside(uf);
  vec3 col = texture(tA, ua * cA.xy + cA.zw).rgb * oA * inside(ua) * (1. - ab) + texture(tB, ub * cB.xy + cB.zw).rgb * ab;
  if (smoothOn > .5) col = mix(col, texture(tS, uf).rgb, inF);
  col = layer(layer(layer(col, tL0, u, lay.x), tL1, u, lay.y), tL2, u, lay.z);
  if (k > 0.) { vec3 f = clamp(hue * texture(tF, uf).rgb, 0., 1.); col = mix(col, f * (1. - 2. * inv) + inv, k * inF); }
  o = vec4(clamp(sat * clamp(col * br, 0., 1.), 0., 1.) * master, 1.);
}`,
  };
  // the colour matrices of the CSS filters hue-rotate and saturate (row by row), so both drawings give the same colours
  const hueMatrix = deg => {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    return [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072];
  };
  const satMatrix = s => [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
  const REST = [0.5, 0.5, 0, 1], FULL = [1, 1, 0, 0];
  // a picture of iw × ih covering a buffer of w × h: scale and offset of its texture coordinates
  const cover = (iw, ih, w, h) => {
    const s = Math.max(w / iw, h / ih), sx = w / (iw * s), sy = h / (ih * s);
    return [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
  };

  // ---------- the chain on one WebGL 2 canvas; null when the browser has none ----------
  function glChain(cv, software, rnd) {
    const gl = cv.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !software });
    if (!gl || gl.isContextLost()) return null;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERT); gl.compileShader(vs);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const progs = {};
    function prog(name) {
      if (progs[name]) return progs[name];
      const fs = gl.createShader(gl.FRAGMENT_SHADER), p = gl.createProgram();
      gl.shaderSource(fs, FRAG[name]); gl.compileShader(fs);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, 'pos'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`shader ${name}: ${gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p)}`);
      return (progs[name] = { p, loc: {} });
    }
    // the shaders are built one by one ahead of their use, so the first frame of an effect is not held up by it
    // (one that cannot be built is left alone here: drawing with it fails, and the view turns to Canvas 2D)
    const waiting = Object.keys(FRAG);
    (function warm() {
      if (gl.isContextLost() || !waiting.length) return;
      try { prog(waiting.shift()); } catch (e) { return; }
      setTimeout(warm, 30);
    })();
    const loc = (pr, n) => n in pr.loc ? pr.loc[n] : (pr.loc[n] = gl.getUniformLocation(pr.p, n));
    // one pass: the shader `name` with its numbers and textures, drawn into the buffer t (null: the canvas itself)
    function draw(name, vals, texs, t) {
      const pr = prog(name); gl.useProgram(pr.p);
      for (const n in vals) {
        const l = loc(pr, n), x = vals[n];
        if (l === null) continue;
        if (typeof x === 'number') gl.uniform1f(l, x);
        else if (x.length === 2) gl.uniform2fv(l, x); else if (x.length === 4) gl.uniform4fv(l, x);
        else if (x.length === 9) gl.uniformMatrix3fv(l, true, x); else gl.uniform3fv(l, x);
      }
      Object.keys(texs).forEach((n, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texs[n]); gl.uniform1i(loc(pr, n), unit); });
      gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null); gl.viewport(0, 0, t ? t.w : cv.width, t ? t.h : cv.height);
      gl.uniform1f(loc(pr, 'flip'), t ? 0 : 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function texture(filter) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return tex;
    }
    // a buffer to draw into; fit() tells whether it had to be made anew (then it is empty)
    function target(filter = gl.LINEAR) {
      const t = { tex: texture(filter), fbo: gl.createFramebuffer(), w: 1, h: 1 };
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      return t;
    }
    function fit(t, w, h) {
      if (t.w === w && t.h === h) return false;
      gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      t.w = w; t.h = h; return true;
    }
    // the pictures and layers as textures: loaded anew only when the element shows something else
    const pic = () => ({ tex: texture(gl.LINEAR_MIPMAP_LINEAR), src: '', w: 0, h: 0, n: 0 });
    function load(p, el) {
      if (el.src === p.src || !el.complete || !el.naturalWidth) return;
      gl.bindTexture(gl.TEXTURE_2D, p.tex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el); gl.generateMipmap(gl.TEXTURE_2D);
      p.src = el.src; p.w = el.naturalWidth; p.h = el.naturalHeight; p.n++; shown = '';
    }
    const pics = new Map(), layerTex = [texture(gl.LINEAR), texture(gl.LINEAR), texture(gl.LINEAR)];
    const smooth = target(), relaid = target(), bufs = [target(), target(), target()], small = target(gl.NEAREST), st = {};
    const SETTLED = 1 / 512;                             // what is left of the older pictures in the smoothed one: nothing to see
    let smoothReady = false, smoothOf = null, rest = 1, prevAt = -1, shown = '', last = null, drawn = 0;

    // the effects in their order, from the smoothed picture or the two cross-fading ones; returns the buffer with the
    // result. The smoothed picture is read where it is; the two pictures are first laid into a buffer, covering it.
    function effects(f, front, back) {
      const [w, h] = f.fxSize, p = f.fx, R = [w, h];
      if (bufs.map(b => fit(b, w, h)).some(Boolean)) prevAt = -1;
      const free = [0, 1, 2].filter(i => i !== prevAt), prev = prevAt < 0 ? null : bufs[prevAt];
      let out = free[0], spare = free[1], from = smooth, done = -1;
      const pass = (name, vals, texs) => { draw(name, vals, texs, bufs[out]); from = bufs[out]; done = out; [out, spare] = [spare, out]; };
      if (!f.smoothing) pass('cover', { cNew: cover(front.w, front.h, w, h), cOld: back.w ? cover(back.w, back.h, w, h) : FULL,
        mixv: back.w && f.mix < 0.99 ? Math.max(0, f.mix) : 1, mOld: f.mOld, box: R }, { tOld: back.tex, tNew: front.tex });
      const common = { R, c: [w * (p.cx == null ? 0.5 : p.cx), h * (p.cy == null ? 0.5 : p.cy)], pulse: +p.pulse || 0, bass: +p.bass || 0,
        spin: +p.spin || 0, t: +p.t || 0, dir: p.dir || 1, loc: p.loc || 0, ang: p.ang || 0 };
      const seed = Math.abs(Math.round(+p.seed || 0));
      for (const name of Fx.ORDER) {
        const a = Math.min(1, (p.amts && p.amts[name]) || 0);
        if (a < 0.02 || ((name === 'feedback' || name === 'trails') && !prev)) continue;
        const vals = { ...common, a };
        if (name === 'mirror') vals.opt = seed % 2;
        if (name === 'mandala') vals.opt = 8 + 2 * (seed % 3);
        if (name === 'glitch') { const sl = Fx.slices(st, p, rnd); vals.ns = sl.length; vals.sl = sl.flat(); }
        if (name === 'pixel' || name === 'raster') {
          vals.grid = name === 'pixel' ? Fx.pixelGrid(w, h, a, p) : Fx.rasterGrid(w, h); vals.opt = seed % 3 !== 0 ? 1 : 0;
          fit(small, vals.grid[0], vals.grid[1]);
          draw('down', {}, { src: from.tex }, small);
        }
        pass(name, vals, { src: from.tex, prev: (prev || from).tex, small: small.tex });
      }
      // nothing drawn (only feedback or trails asked for, and no frame before this one): they need a first frame to read
      if (done < 0) pass('cover', { cNew: FULL, cOld: FULL, mixv: 1 }, { tOld: smooth.tex, tNew: smooth.tex });
      prevAt = done;
      return from;
    }
    const present = () => { if (last) draw('final', last.vals, last.texs, null); };
    return {
      // f: {a, b, front (elements), oA, oB (their opacity), mA, mB (their motion), rebase (#215: a new picture took over –
      //     how the one before lies against it, or null), tau, dt, fx, k, br, sat, master,
      //     layers: [{el, screen} or null], view (the canvas in CSS pixels), dpr (device pixels per CSS pixel),
      //     rect (the picture's place on the canvas, as shares), fxSize, smoothSize (the buffers at their largest)}
      draw(f) {
        for (const el of [f.a, f.b]) { if (!pics.has(el)) pics.set(el, pic()); load(pics.get(el), el); }
        const A = pics.get(f.a), B = pics.get(f.b), front = pics.get(f.front), back = front === A ? B : A;
        const p = f.fx, k = p ? f.k : 0, on = f.layers.map(l => l && l.el.width ? l : null);
        // #210: the canvas is as fine as the finest thing on it – a picture covering its place at its own resolution, the
        // effects' buffer, a touch layer – and never finer than the screen: every pixel more is work the AI waits for
        const [vw, vh] = f.view, bw = vw * f.rect[2], bh = vh * f.rect[3], own = q => q.w ? Math.min(q.w / bw, q.h / bh) : 0;
        const fine = Math.min(f.dpr, Math.max(own(A), own(B), k > 0 ? f.fxSize[0] / bw : 0, ...on.map(l => l ? l.el.width / bw : 0)) || f.dpr);
        const [w, h] = Fx.fit(vw * fine, vh * fine, 2560);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; shown = ''; }
        if (!front.w) { smoothReady = false; prevAt = -1; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); last = null; return; }
        const smoothing = f.tau > 0.02;
        if (smoothing) {                                 // a little of the newest picture into what is shown
          const ks = Math.min(1, own(front) * bw / f.smoothSize[0]);   // no finer than the picture itself
          const sw = Math.max(2, Math.round(f.smoothSize[0] * ks)), sh = Math.max(2, Math.round(f.smoothSize[1] * ks));
          if (fit(smooth, sw, sh)) smoothReady = false;
          if (smoothReady && f.rebase) {                 // what is shown stays where it is; the new picture joins it there
            fit(relaid, sw, sh);
            draw('rebase', { cNew: cover(front.w, front.h, sw, sh), mOld: f.rebase, box: [sw, sh] }, { tOld: smooth.tex, tNew: front.tex }, relaid);
            [smooth.tex, relaid.tex, smooth.fbo, relaid.fbo] = [relaid.tex, smooth.tex, relaid.fbo, smooth.fbo];
          }
          if (!smoothReady || smoothOf !== front.tex || smooth.n !== front.n) rest = 1;   // a new picture to catch up with
          smoothOf = front.tex; smooth.n = front.n;
          if (rest > SETTLED) {                          // once it has caught up, it rests until the next picture
            const share = smoothReady ? 1 - Math.exp(-f.dt / Math.max(0.016, f.tau)) : 1;
            gl.enable(gl.BLEND); gl.blendColor(0, 0, 0, share); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
            draw('cover', { cNew: cover(front.w, front.h, sw, sh), cOld: FULL, mixv: 1 }, { tOld: front.tex, tNew: front.tex }, smooth);
            gl.disable(gl.BLEND); smoothReady = true; rest *= 1 - share; shown = '';
          }
        } else smoothReady = false;
        let result = null;
        // the picture before against the front one: the effects are drawn as the front one lies
        const mF = f.front === f.a ? f.mA : f.mB, mO = f.front === f.a ? f.mB : f.mA;
        if (k > 0) result = effects({ ...f, smoothing, mix: f.front === f.a ? f.oA : f.oB, mOld: [mF[0], mF[1], mO[2] - mF[2], mO[3] / mF[3]] }, front, back); else prevAt = -1;
        const lay = [0, 0, 0];
        on.forEach((l, i) => {
          if (!l) return;
          gl.bindTexture(gl.TEXTURE_2D, layerTex[i]); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, l.el); lay[i] = l.screen ? 2 : 1;
        });
        const hue = p && p.hue ? Math.round(p.hue) : 0, inv = p && p.inv > 0.02 ? Math.min(0.85, p.inv) : 0;
        const box = [w * f.rect[2], h * f.rect[3]];
        const vals = { cA: A.w ? cover(A.w, A.h, ...box) : FULL, cB: B.w ? cover(B.w, B.h, ...box) : FULL, mA: f.mA, mB: f.mB, mF,
          rect: f.rect, box, oA: A.w ? f.oA : 0, oB: B.w ? f.oB : 0, smoothOn: smoothing ? 1 : 0, k, inv, br: f.br, master: f.master, lay,
          hue: hueMatrix(hue), sat: satMatrix(f.sat) };
        // a still picture (no motion or fade, the smoothing caught up, no effect or layer at work) is not drawn again
        const still = (!smoothing || rest <= SETTLED) && !result && !lay.some(Boolean) ? JSON.stringify(vals) : '';
        if (still && still === shown) return;
        shown = still; drawn++;
        last = { vals, texs: { tA: A.tex, tB: B.tex, tS: smooth.tex, tF: (result || smooth).tex, tL0: layerTex[0], tL1: layerTex[1], tL2: layerTex[2] } };
        present();
      },
      present,                                         // the last picture once more (a copy of the canvas needs it fresh)
      get drawn() { return drawn; },                   // how many frames were really drawn
      lost: () => gl.isContextLost(),
    };
  }

  // ---------- one view: the elements of a page, drawn by the chain or – without WebGL 2 – by fx.js as before ----------
  // o: {box, a, b, smooth, fx, gl (elements), layers: [{el, screen, on()}], contain (the picture letterboxed in the
  //     window), fxMax, smoothMax (buffer widths), canvas (true: never WebGL – the address ?render=canvas asks for
  //     that too), software (true: a software WebGL counts too), random, onRenderer(name, why)}
  function create(o) {
    const { box, a, b, smooth, fx, gl: glcv, layers = [], fxMax = 960, smoothMax = 1920, random = Math.random } = o;
    const engine = Fx.create(fx, fxMax, random), smoother = Fx.smoother(smooth, smoothMax);
    const stacked = [a, b, smooth, fx, ...layers.map(l => l.el)];
    const asked = new URLSearchParams(location.search).get('render');
    const canvasOnly = o.canvas || asked === 'canvas';
    let chain = null, master = null, front = a, fxK = 0, rect = [0, 0, 1, 1], drawnAt = -1e9, owed = 0;
    let rebase = null;                                 // #215: a new picture took over: how the one before lies against it (Fx.morph.rel)
    // the picture's place in the window when it is shown letterboxed ("contain")
    function place(el) {
      const iw = front.naturalWidth || 16, ih = front.naturalHeight || 9, s = Math.min(innerWidth / iw, innerHeight / ih);
      Object.assign(el.style, { width: iw * s + 'px', height: ih * s + 'px', left: (innerWidth - iw * s) / 2 + 'px', top: (innerHeight - ih * s) / 2 + 'px' });
    }
    function turnTo(c, why) {
      chain = c; master = null;
      glcv.style.display = c ? 'block' : 'none';
      for (const el of stacked) el.style.visibility = c ? 'hidden' : '';
      if (c) {                                           // what the Canvas 2D drawing left on the elements
        for (const el of [a, b, smooth, fx]) el.style.transform = '';
        smooth.style.display = 'none'; smoother.reset(); engine.reset(); fx.style.opacity = 0; fx.style.filter = '';
        box.style.filter = ''; box.style.opacity = '';
      }
      if (o.onRenderer) o.onRenderer(c ? 'webgl2' : 'canvas', why);
    }
    const start = why => { let c = null; try { c = canvasOnly ? null : glChain(glcv, o.software, random); } catch (e) { console.warn('Dream: WebGL 2 not usable –', e); } turnTo(c, why); };
    glcv.addEventListener('webglcontextlost', e => { e.preventDefault(); if (chain) turnTo(null, 'lost'); });
    glcv.addEventListener('webglcontextrestored', () => start('restored'));
    start('start');

    function drawCanvas(f, back) {
      const { now, tau, fx: p } = f;
      Fx.morph.apply(front, now); Fx.morph.apply(back, now); Fx.morph.apply(front, now, smooth); Fx.morph.apply(front, now, fx);
      const smoothing = tau > 0.02 && !!front.naturalWidth;
      if (smoothing) { if (o.contain) place(smooth); smooth.style.display = 'block'; smoother.rebase(rebase, front); smoother.push(front); smoother.step(f.dt, tau); }
      else if (smooth.style.display !== 'none') { smooth.style.display = 'none'; smoother.reset(); }
      if (p) {
        if (o.contain) place(fx);                        // only over the picture itself
        if (smoothing && smoother.ready) engine.render(smooth, p); else engine.render(front, p, back, +getComputedStyle(front).opacity, Fx.morph.rel(back, front, now));
        fx.style.filter = Fx.cssFilter(p);
      } else if (fx.width) { engine.reset(); fx.style.filter = ''; }
      fx.style.opacity = fxK.toFixed(3);
      box.style.filter = f.br !== 1 || f.sat !== 1 ? `brightness(${f.br.toFixed(3)}) saturate(${f.sat.toFixed(3)})` : '';
      box.style.opacity = f.master;
    }
    function drawGl(f) {
      if (o.contain) place(fx);
      const motion = el => { const m = Fx.morph.at(el, f.now); return m ? [m.px, m.py, m.r * Math.PI / 180, m.s] : REST; };
      // the master fader glides for an eighth of a second, like the CSS transition of the Canvas 2D drawing
      master = master === null ? f.master : master + Math.max(-f.dt / 0.12, Math.min(f.dt / 0.12, f.master - master));
      // the canvas fills the whole box; the picture has its place on it where the (hidden) effects canvas lies
      const cw = Math.max(1, glcv.clientWidth), ch = Math.max(1, glcv.clientHeight), dpr = devicePixelRatio || 1, pw = fx.clientWidth, ph = fx.clientHeight;
      rect = [fx.offsetLeft / cw, fx.offsetTop / ch, Math.max(1, pw) / cw, Math.max(1, ph) / ch];
      chain.draw({ a, b, front, oA: +getComputedStyle(a).opacity, oB: +getComputedStyle(b).opacity, mA: motion(a), mB: motion(b),
        rebase: rebase && [rebase.px, rebase.py, rebase.r * Math.PI / 180, rebase.s],
        tau: f.tau, dt: f.dt, fx: f.fx, k: fxK, br: f.br, sat: f.sat, master, layers: layers.map(l => l.on() ? l : null),
        view: [cw, ch], dpr, rect, fxSize: Fx.fit(pw, ph, fxMax), smoothSize: Fx.fit(pw, ph, smoothMax) });
    }
    return {
      // one screen frame. f: {front (the picture element now shown), now (ms), dt (s), tau (smoothing, s), fx (the
      // effects' numbers as fx.js takes them, or null), k (how much of the effects shows, 0…1), sc (zoom of the whole
      // box), br, sat (brightness and saturation, 1 = unchanged), master (0…1), fps (#210: the WebGL chain draws at
      // most this often – a preview beside the real output; 0 or missing: every frame)}
      draw(f) {
        if (f.front !== front) rebase = Fx.morph.rel(front, f.front, f.now);   // kept until a frame is really drawn
        front = f.front; fxK = f.fx ? Math.max(0, Math.min(1, f.k)) : 0;
        box.style.transform = f.sc !== 1 ? `scale(${f.sc.toFixed(4)})` : '';
        if (!chain) { drawCanvas(f, front === a ? b : a); rebase = null; return; }
        if (f.fps > 0 && f.now - drawnAt < 1000 / f.fps - 4) { owed += f.dt; return; }   // its time counts for the next one
        const dt = f.dt + owed; owed = 0; drawnAt = f.now;
        try { drawGl(dt === f.dt ? f : { ...f, dt }); } catch (e) { console.warn('Dream: WebGL 2 drawing failed –', e); turnTo(null, 'error'); }
        rebase = null;
      },
      // what the audience sees right now, drawn into another canvas (the movement detection looks at it)
      snapshot(ctx, w, h) {
        if (chain) { chain.present(); ctx.drawImage(glcv, rect[0] * glcv.width, rect[1] * glcv.height, rect[2] * glcv.width, rect[3] * glcv.height, 0, 0, w, h); return; }
        const src = smoother.ready ? smooth : front;
        if (src.naturalWidth || src.width) ctx.drawImage(src, 0, 0, w, h);
        if (fx.width && fxK > 0.02) { ctx.globalAlpha = fxK; ctx.drawImage(fx, 0, 0, w, h); ctx.globalAlpha = 1; }
      },
      get renderer() { return chain ? 'webgl2' : 'canvas'; },
      get drawn() { return chain ? chain.drawn : 0; },   // frames the WebGL chain really drew (it skips still ones)
    };
  }
  return { create };
})();
