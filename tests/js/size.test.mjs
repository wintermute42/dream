// #247: the picture the stage builds always has a size. The size list of the panel has four values; set to anything
// else (640 over /ctl) a list has no choice and reads as '' – the picture was 0×0 and the stage stood still. The size
// of a picture comes from one place (static/common.js, picSize). No browser: common.js runs against a stand-in.
// Run: node --test tests/js/size.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(readFileSync(new URL('../../static/common.js', import.meta.url), 'utf8'),
  { window, document: { currentScript: null }, T: text => text });
const { SIZES, picSize } = window.DreamCommon;
const plain = o => ({ w: o.w, h: o.h });

test('a size of the list is taken as it is, 16:9 widens it to a multiple of 64', () => {
  assert.deepEqual([...SIZES], [384, 512, 768, 1024]);
  assert.deepEqual(plain(picSize('512', false)), { w: 512, h: 512 });
  assert.deepEqual([...SIZES].map(s => picSize(s, true).w), [704, 896, 1344, 1792]);
  for (const s of SIZES) for (const wide of [false, true]) {
    const { w, h } = picSize(String(s), wide);
    assert.equal(h, s); assert.equal(w % 64, 0); assert.equal(h % 64, 0);
  }
});

test('a list without a choice still gives a picture: never 0×0, never NaN', () => {
  for (const odd of ['', null, undefined, 'abc', NaN, 0, -5, Infinity, '0']) {
    assert.deepEqual(plain(picSize(odd, false)), { w: 512, h: 512 }, String(odd));
    assert.deepEqual(plain(picSize(odd, true)), { w: 896, h: 512 }, String(odd));
  }
});

test('a size between the sizes is the nearest one, as in the server', () => {
  const near = { 640: 512, 641: 768, 500: 512, 448: 384, 449: 512, 896: 768, 897: 1024, 256: 384, 1: 384, 5000: 1024 };
  for (const [size, h] of Object.entries(near)) assert.equal(picSize(size, false).h, h, size);
});

test('the stage asks this one place for its picture', () => {
  const stage = readFileSync(new URL('../../static/index.html', import.meta.url), 'utf8');
  assert.ok(stage.includes('const dims = () => DreamCommon.picSize(ui.size.value, wide());'));
});
