import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createLufsAnalysis } from '../../src/shared/lufs-analysis.js';

function fixture() {
  let resolve, reject;
  const loaded = new Promise((yes, no) => { resolve = yes; reject = no; });
  const nodes = [], connected = new Set(), frames = [], failures = [];
  let loads = 0, revoked = 0, sourceBuilds = 0, moduleBlob;
  const window = {
    Blob,
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } },
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
  const context = { state: 'running', audioWorklet: { addModule() { loads++; return loaded; } },
    createMediaStreamSource() { sourceBuilds++; return source; } };
  const source = { connect(node) { connected.add(node); }, disconnect() { connected.clear(); } };
  const track = {};
  const create = () => createLufsAnalysis({ window, context, track, onFrame: frame => frames.push(frame), onFailure: () => failures.push(true) });
  return { window, context, nodes, connected, frames, failures, create, resolve, reject,
    track, get loads() { return loads; }, get revoked() { return revoked; }, get sourceBuilds() { return sourceBuilds; }, get moduleBlob() { return moduleBlob; } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function capturedFrames(f) {
  let input, cancelled = 0;
  const readable = new ReadableStream({ start(controller) { input = controller; }, cancel() { cancelled++; } });
  f.window.MediaStreamTrackProcessor = class {
    constructor(options) {
      assert.equal(options.track, f.track);
      assert.equal(options.maxBufferSize, 1);
      this.readable = readable;
    }
  };
  const frames = [];
  return { readable, get cancelled() { return cancelled; },
    fail() { input.error(new Error('Capture failed')); },
    send(levels, rate = 48000, broken = false) {
      const frame = { sampleRate: rate, numberOfChannels: levels.length, numberOfFrames: rate / 10, closed: 0,
        copyTo(destination, { planeIndex, format }) {
          assert.equal(format, 'f32-planar');
          if (broken) throw new Error('Unreadable AudioData');
          for (let i = 0; i < destination.length; i++) destination[i] = levels[planeIndex] * Math.sin(2 * Math.PI * 1000 * i / rate);
        }, close() { this.closed++; }
      };
      frames.push(frame); input.enqueue(frame); return frame;
    }, frames
  };
}

test('a blocked worklet reads native audio frames through the same LUFS meter', async () => {
  const f = fixture(), capture = capturedFrames(f), owned = f.create();
  f.reject(new Error('CSP blocked blob:')); await flush();
  capture.send([0.1, -0.1], 96000); await flush();
  assert.equal(f.frames.filter(frame => frame.power != null).length, 2);
  assert.equal(f.frames.filter(frame => frame.attackPower != null).length, 20);
  assert.ok(f.frames.filter(frame => frame.power != null).every(frame => frame.power > 0 && Math.abs(frame.rawPower - .005) < 1e-8));
  assert.equal(f.nodes.length, 0, 'direct analysis creates no audio output node');
  assert.equal(f.sourceBuilds, 0, 'native frames allocate no unused Web Audio input graph');
  assert.equal(f.revoked, 1);
  assert.deepEqual(f.failures, []);
  owned.dispose(); await flush();
  assert.equal(capture.cancelled, 1);
  assert.equal(capture.readable.locked, false);
  assert.ok(capture.frames.every(frame => frame.closed === 1));
});

test('direct frame analysis matches stereo speaker mixing at both sample rates', async () => {
  for (const rate of [48000, 96000]) {
    // Identical stereo and duplicated mono have the same power. Quad mixes
    // front/rear at 0.5; 5.1 center at sqrt(0.5); LFE is excluded.
    for (const [levels, expectedLufs] of [
      [[.1], -20], [[.1, -.1], -20], [[0, 0, .2, -.2], -20],
      [[0, 0, .1, 0, 0, 0], -23.01], [[0, 0, 0, .9, 0, 0], -Infinity]
    ]) {
      const f = fixture(), capture = capturedFrames(f);
      delete f.window.AudioWorkletNode;
      const owned = f.create(); capture.send(levels, rate); await flush();
      const frame = f.frames.at(-1);
      const lufs = -.691 + 10 * Math.log10(frame.power);
      assert.ok(lufs === expectedLufs || Math.abs(lufs - expectedLufs) < .05, `${levels} at ${rate}: ${lufs} LUFS`);
      owned.dispose(); await flush();
      assert.deepEqual(f.failures, []);
      assert.equal(capture.readable.locked, false);
    }
  }
});

test('direct capture errors close frames, cancel the reader and fail only once', async () => {
  for (const mode of ['constructor', 'read', 'copy']) {
    const f = fixture(), capture = capturedFrames(f);
    delete f.context.audioWorklet;
    if (mode === 'constructor') f.window.MediaStreamTrackProcessor = class { constructor() { throw new Error('Unsupported track'); } };
    const owned = f.create();
    if (mode === 'read') capture.fail();
    if (mode === 'copy') capture.send([.1], 48000, true);
    await flush(); owned.dispose(); await flush();
    assert.equal(f.failures.length, 1);
    assert.ok(capture.frames.every(frame => frame.closed === 1));
    assert.equal(capture.readable.locked, false);
  }
});

test('disposal during module loading does not start a late native reader', async () => {
  const f = fixture(), capture = capturedFrames(f), owned = f.create();
  owned.dispose(); f.reject(new Error('CSP')); await flush();
  assert.equal(capture.readable.locked, false);
  assert.deepEqual(f.failures, []);
  assert.equal(f.frames.length, 0);
});

test('disposing during a native audio frame suppresses its remaining callbacks', async () => {
  const f = fixture(), capture = capturedFrames(f);
  delete f.window.AudioWorkletNode;
  let owned;
  owned = createLufsAnalysis({ window: f.window, context: f.context, track: f.track,
    onFrame: frame => { f.frames.push(frame); owned.dispose(); }, onFailure: () => f.failures.push(true) });
  capture.send([.1, -.1]); await flush();
  assert.equal(f.frames.length, 1, 'the disposed owner cannot deliver the rest of a large AudioData frame');
  assert.equal(capture.frames[0].closed, 1);
  assert.equal(capture.readable.locked, false);
  assert.deepEqual(f.failures, []);
});

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
