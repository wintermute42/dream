#!/usr/bin/env node
// #218: a film of painted fire for a browser's fake camera – to see what Dreamy Eyes do with a flame without lighting
// one. It is the test pictures' own story (tests/js/fire-frames.mjs, film()): a lamp, a torch that catches fire, is
// carried across, flares up, burns on, flares up again and dies down.
//   node scripts/fire_video.mjs fire.y4m            (about 90 MB, 70 s)
//   chromium --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=fire.y4m
//   … and open Dreamy Eyes in it (README, "Tests").
import { closeSync, openSync, writeSync } from 'node:fs';
import { FILM_SECS, FPS, film } from '../tests/js/fire-frames.mjs';

const out = process.argv[2], W = 320, H = 180;
if (!out) { console.error('usage: node scripts/fire_video.mjs <file.y4m>'); process.exit(2); }
const fd = openSync(out, 'w'), story = film();
writeSync(fd, `YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
const y = Buffer.alloc(W * H), u = Buffer.alloc(W * H / 4), v = Buffer.alloc(W * H / 4);
for (let i = 0; i < FILM_SECS * FPS; i++) {
  const d = story.frame(i, W, H, 1);
  for (let p = 0, q = 0; p < W * H; p++, q += 4) y[p] = 16 + 0.257 * d[q] + 0.504 * d[q + 1] + 0.098 * d[q + 2];
  for (let yy = 0, c = 0; yy < H; yy += 2) for (let xx = 0; xx < W; xx += 2, c++) {
    let r = 0, g = 0, b = 0;
    for (const o of [0, 4, W * 4, W * 4 + 4]) { const q = (yy * W + xx) * 4 + o; r += d[q]; g += d[q + 1]; b += d[q + 2]; }
    u[c] = 128 + (-0.148 * r - 0.291 * g + 0.439 * b) / 4; v[c] = 128 + (0.439 * r - 0.368 * g - 0.071 * b) / 4;
  }
  writeSync(fd, 'FRAME\n'); writeSync(fd, y); writeSync(fd, u); writeSync(fd, v);
}
closeSync(fd);
console.log(`${out}: ${FILM_SECS} s at ${FPS} pictures a second`);
