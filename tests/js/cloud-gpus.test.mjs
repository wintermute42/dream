// #231: the cloud GPUs the pages offer come from one place (static/common.js, fillGpus). Scaleway accepts no new GPU
// instances for the time being: its types are not offered, RunPod's RTX 4090 is chosen – and one constant brings
// Scaleway back. No browser: common.js runs against a stand-in for the page.
// Run: node --test tests/js/cloud-gpus.test.mjs   (the CI runs it too)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../static/common.js', import.meta.url), 'utf8');
const SCALEWAY = ['L4-1-24G', 'L40S-1-48G', 'H100-1-80G'];

function offered(src) {
  const window = {}, select = { innerHTML: '', value: '' };
  vm.runInNewContext(src, { window, document: { currentScript: null }, T: text => text });
  window.DreamCommon.fillGpus(select);
  return { values: [...select.innerHTML.matchAll(/<option value="([^"]+)">/g)].map(m => m[1]), html: select.innerHTML, chosen: select.value };
}

test('the pages offer only RunPod, the RTX 4090 chosen', () => {
  const { values, html, chosen } = offered(SRC);
  assert.equal(chosen, 'runpod:RTX-4090');
  assert.equal(values[0], 'runpod:RTX-4090');
  assert.equal(values.length, 6);
  assert.ok(values.every(v => v.startsWith('runpod:')), values.join(' '));
  assert.ok(!/scaleway/i.test(html));
});

test('one constant shows Scaleway again, RunPod stays the default', () => {
  assert.equal(SRC.split('const SCALEWAY_OFFERED = false;').length, 2);
  const { values, html, chosen } = offered(SRC.replace('const SCALEWAY_OFFERED = false;', 'const SCALEWAY_OFFERED = true;'));
  assert.deepEqual(values.slice(-3), SCALEWAY);
  assert.ok(html.includes('<optgroup label="Scaleway (Paris)">'));
  assert.equal(chosen, 'runpod:RTX-4090');
});

test('the pages keep no list of their own', () => {
  for (const page of ['index.html', 'remote.html']) {
    const html = readFileSync(new URL('../../static/' + page, import.meta.url), 'utf8');
    assert.match(html, /<select id="gpu" aria-label="Cloud GPU"><\/select>/, page);
    assert.match(html, /DreamCommon\.fillGpus\(/, page);
    for (const type of [...SCALEWAY, 'runpod:RTX-4090']) assert.ok(!html.includes(`value="${type}"`), `${page} lists ${type}`);
  }
});
