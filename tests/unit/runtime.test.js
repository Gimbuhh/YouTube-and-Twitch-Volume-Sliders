import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../helpers/runtime.js';

test('runtime teardown disconnects observers that were restarted after disconnect', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.close());
  let deliveries = 0;
  const observer = new runtime.window.MutationObserver(() => deliveries++);
  observer.observe(runtime.document.body, { attributes: true });
  runtime.document.body.setAttribute('data-first', '1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deliveries, 1, 'the real observer delivers mutations before teardown');

  observer.disconnect();
  observer.observe(runtime.document.body, { attributes: true });
  runtime.document.body.setAttribute('data-after-restart', '1');
  runtime.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deliveries, 1, 'closing the runtime cancels pending restarted-observer callbacks');
});
