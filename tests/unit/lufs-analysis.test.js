import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createLufsAnalysis } from '../../src/shared/lufs-analysis.js';

function fixture() {
  let resolve, reject;
  const loaded = new Promise((yes, no) => { resolve = yes; reject = no; });
  const nodes = [], connected = new Set(), frames = [], failures = [];
  let loads = 0, revoked = 0, moduleBlob;
  const window = {
    Blob,
    URL: { createObjectURL: blob => { moduleBlob = blob; return 'blob:meter'; }, revokeObjectURL: () => revoked++ },
    AudioWorkletNode: class {
      constructor(context, name, options) {
        this.options = options;
        this.port = { onmessage: null, closed: false, messages: [],
          postMessage(value) { this.messages.push(value); }, close() { this.closed = true; } };
        this.disconnect = () => {};
        nodes.push(this);
      }
    }
  };
  const context = { state: 'running', audioWorklet: { addModule() { loads++; return loaded; } } };
  const source = { connect(node) { connected.add(node); }, disconnect(node) { connected.delete(node); } };
  const create = () => createLufsAnalysis({ window, context, source, onFrame: frame => frames.push(frame), onFailure: () => failures.push(true) });
  return { window, context, nodes, connected, frames, failures, create, resolve, reject,
    get loads() { return loads; }, get revoked() { return revoked; }, get moduleBlob() { return moduleBlob; } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('worklet is analysis-only, reuses its context module, and releases ports and connections', async () => {
  const f = fixture(), first = f.create();
  f.resolve(); await flush();
  assert.equal(f.nodes[0].options.numberOfOutputs, 0);
  assert.equal(f.nodes[0].options.channelCount, 2);
  f.nodes[0].port.onmessage({ data: { power: 1 } });
  assert.deepEqual(f.frames, [{ power: 1 }]);
  first.dispose(); first.dispose();
  assert.equal(f.nodes[0].port.closed, true);
  assert.deepEqual(f.nodes[0].port.messages, ['stop']);
  assert.equal(f.connected.size, 0);
  const second = f.create(); await flush();
  assert.equal(f.loads, 1);
  assert.equal(f.revoked, 1);
  assert.equal(f.nodes.length, 2);
  second.dispose();
});

test('closing a source during module loading prevents late node creation', async () => {
  const f = fixture(), owned = f.create();
  owned.dispose(); f.resolve(); await flush();
  assert.equal(f.nodes.length, 0);
  assert.equal(f.revoked, 1);
  assert.deepEqual(f.failures, []);
});

test('blocked loading and processor errors trigger fallback once and clean up', async () => {
  const blocked = fixture(); blocked.create(); blocked.reject(new Error('CSP')); await flush();
  assert.equal(blocked.failures.length, 1);
  assert.equal(blocked.revoked, 1);
  const f = fixture(); f.create(); f.resolve(); await flush();
  const failed = f.nodes[0].onprocessorerror;
  failed(); failed();
  assert.equal(f.failures.length, 1);
  assert.equal(f.nodes[0].port.closed, true);
  assert.equal(f.connected.size, 0);
  const unsupported = fixture(); delete unsupported.context.audioWorklet;
  assert.equal(unsupported.create(), null);
  assert.equal(unsupported.loads, 0);
});

test('a synchronous module-loading exception still revokes the Blob URL', async () => {
  const f = fixture();
  f.context.audioWorklet.addModule = () => { throw new Error('Context unavailable'); };
  f.create(); await flush();
  assert.equal(f.revoked, 1);
  assert.equal(f.failures.length, 1);
  assert.equal(f.nodes.length, 0);
});

test('the generated processor stops processing when its owner disposes it', async () => {
  const f = fixture(), owned = f.create();
  let Processor;
  vm.runInNewContext(await f.moduleBlob.text(), { sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor(name, implementation) { assert.equal(name, 'tm-lufs-analysis'); Processor = implementation; }
  });
  const processor = new Processor();
  assert.equal(processor.process([[new Float32Array(128), new Float32Array(128)]]), true);
  f.resolve(); await flush(); owned.dispose();
  processor.port.onmessage({ data: f.nodes[0].port.messages[0] });
  assert.equal(processor.process([]), false, 'disposing an inputless processor clears its active-source flag');
});
