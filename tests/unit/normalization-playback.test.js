import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createAudiblePlayback } from '../../src/shared/normalization-playback.js';
import { createRuntime } from '../helpers/runtime.js';
import { mockAudioCapture } from '../helpers/audio.js';

test('generated worklet stops startup messages within the first measured block at every sample rate', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.close());
  const video = runtime.document.createElement('video');
  runtime.document.body.append(video);
  mockAudioCapture(runtime.window, video);
  let module;
  runtime.window.Blob = Blob;
  runtime.window.URL.createObjectURL = blob => { module = blob; return 'blob:meter-test'; };
  const playback = createAudiblePlayback({ window: runtime.window, video, selected: .3,
    onMetrics() {}, onFailure: error => assert.fail(error) });
  t.after(() => playback.dispose());
  await playback.ready;
  const code = await module.text();

  for (const sampleRate of [44100, 48000, 96000]) for (const size of [128, 4096]) {
    const messages = [];
    let Processor;
    runInNewContext(code, { sampleRate, registerProcessor: (_, value) => { Processor = value; },
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } } });
    const processor = new Processor(), samples = new Float32Array(size).fill(.1);
    for (let offset = 0; offset < sampleRate * .2; offset += size) processor.process([[samples, samples]]);
    const first = messages.findIndex(value => value.rawPower >= 1e-9 && value.power >= 1e-9);
    assert.ok(first > 0, `${sampleRate}/${size}: startup and programme measurements required`);
    assert.ok(messages.slice(0, first).some(value => value.attackPower > 0));
    assert.equal(messages.slice(first + 1).filter(value => value.attackPower != null).length, 0,
      `${sampleRate}/${size}: stale startup callback survived the first programme frame`);
    processor.port.onmessage();
    assert.equal(processor.process([[samples, samples]]), false, 'stopped worklet must terminate');
  }
});

test('pausing during initial activation retains protected output and resumes the same source', async t => {
  const runtime = createRuntime(); t.after(() => runtime.close());
  const video = runtime.document.createElement('video'); runtime.document.body.append(video);
  const audio = mockAudioCapture(runtime.window, video), BaseContext = runtime.window.AudioContext, failures = [];
  let finish;
  runtime.window.AudioContext = class extends BaseContext {
    constructor() { super(); this.state = 'suspended'; }
    resume() { return new Promise(resolve => { finish = () => { this.state = 'running'; resolve(); }; }); }
  };
  const playback = createAudiblePlayback({ window: runtime.window, video, selected: .3, onMetrics() {}, onFailure: error => failures.push(error) });
  t.after(() => playback.dispose());
  audio.paused = true;
  playback.setState({ selected: .3, muted: false, paused: true });
  finish(); await playback.ready;
  assert.deepEqual(failures, []);
  assert.equal(playback.connected, true);
  assert.equal(playback.context.state, 'suspended');
  assert.equal(playback.context.sources.size, 1);
  playback.context.resume = BaseContext.prototype.resume;
  audio.paused = false; video.dispatchEvent(new runtime.window.Event('play'));
  playback.setState({ selected: .3, muted: false, paused: false });
  await playback.resume();
  assert.equal(playback.running, true);
  assert.equal(playback.context.sources.size, 1);
});
