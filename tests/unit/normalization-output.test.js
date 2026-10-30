import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireMediaOutput, fadeInMediaOutput } from '../../src/shared/normalization-output.js';
import { createRuntime } from '../helpers/runtime.js';
import { mockAudioCapture } from '../helpers/audio.js';

function fixture(t, options) {
  const runtime = createRuntime(), video = runtime.document.createElement('video');
  runtime.document.body.append(video);
  const audio = mockAudioCapture(runtime.window, video);
  const output = acquireMediaOutput(runtime.window, video, options);
  t.after(() => runtime.close());
  return { ...runtime, video, audio, output, context: output.context };
}

test('paused routes suspend, resume without gestures and retain their original source', async t => {
  const f = fixture(t);
  await f.output.resume(); f.output.connect(f.context.createGain());
  const source = f.output.source;
  f.audio.paused = true; f.output.setPaused(true);
  await Promise.resolve();
  assert.equal(f.context.state, 'suspended');
  f.document.dispatchEvent(new f.window.Event('pointerdown'));
  assert.equal(f.context.state, 'suspended', 'unrelated clicks must not wake paused DSP');
  f.audio.paused = false;
  f.video.dispatchEvent(new f.window.Event('play'));
  await f.output.resume();
  assert.equal(f.context.state, 'running');
  assert.equal(f.output.source, source);
  assert.equal(f.context.sources.size, 1);
  f.output.restore();
  await fadeInMediaOutput(f.window, f.video);
  const [ordinary] = source.connections;
  assert.equal(ordinary.gain.value, 1);
  assert.ok(ordinary.connections.has(f.context.destination));
  f.audio.paused = true; f.video.dispatchEvent(new f.window.Event('pause'));
  await Promise.resolve();
  assert.equal(f.context.state, 'suspended', 'ordinary routes also sleep when paused');
  f.audio.paused = false; f.video.dispatchEvent(new f.window.Event('play'));
  await f.output.resume();
  assert.equal(f.context.state, 'running', 'ordinary playback must wake the retained context');
});

for (const resumeEarly of [false, true]) test(`protected pause waits for rendered silence${resumeEarly ? ' and an early play cancels suspension' : ''}`, async t => {
  let finish, f;
  const silenced = new Promise(resolve => { finish = resolve; });
  f = fixture(t, { onPause: () => f.output.setPaused(true, silenced) });
  await f.output.resume(); f.output.connect(f.context.createGain());
  f.audio.paused = true; f.video.dispatchEvent(new f.window.Event('pause'));
  assert.equal(f.context.state, 'running', 'the gate must finish rendering before suspension');
  if (resumeEarly) { f.audio.paused = false; f.video.dispatchEvent(new f.window.Event('play')); }
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.context.state, resumeEarly ? 'running' : 'suspended');
  assert.equal(f.context.sources.size, 1);
});

test('a second ordinary playing route prevents shared-context suspension', async t => {
  const f = fixture(t);
  await f.output.resume(); f.output.connect(f.context.createGain());
  const other = f.document.createElement('video'); f.document.body.append(other);
  Object.defineProperties(other, { currentSrc: { value: f.video.currentSrc }, paused: { value: false } });
  const second = acquireMediaOutput(f.window, other);
  await second.resume(); second.connect(f.context.createGain()); second.restore(); await fadeInMediaOutput(f.window, other);
  const [ordinary] = second.source.connections;
  f.audio.paused = true; f.output.setPaused(true);
  await Promise.resolve();
  assert.equal(f.context.state, 'running');
  other.remove(); f.output.setPaused(true);
  await Promise.resolve();
  assert.equal(f.context.state, 'suspended');
  assert.equal(second.source.connections.size, 0, 'detached ordinary routes disconnect');
  assert.equal(ordinary.connections.size, 0, 'the ordinary transition gate also disconnects');
});

test('a new normalizer invalidates an ordinary fade that is still waiting for native volume', async t => {
  const f = fixture(t);
  await f.output.resume(); f.output.connect(f.context.createGain()); f.output.restore();
  const [ordinary] = f.output.source.connections;
  const opening = fadeInMediaOutput(f.window, f.video), replacement = acquireMediaOutput(f.window, f.video);
  await replacement.resume();
  const input = f.context.createGain(); replacement.connect(input);
  await opening;
  assert.equal(ordinary.gain.value, 0, 'an obsolete fade cannot reopen audio');
  assert.equal(ordinary.connections.size, 0);
  assert.deepEqual([...replacement.source.connections], [input]);
});

test('play arriving during asynchronous suspension resumes after suspension settles', async t => {
  const f = fixture(t);
  await f.output.resume(); f.output.connect(f.context.createGain());
  let finish;
  f.context.suspend = () => new Promise(resolve => { finish = () => { f.context.state = 'suspended'; resolve(); }; });
  f.audio.paused = true; f.output.setPaused(true);
  f.audio.paused = false;
  const resumed = f.output.resume();
  finish(); await resumed;
  assert.equal(f.context.state, 'running');
  assert.equal(f.context.sources.size, 1);
});

for (const action of ['pause', 'detach']) test(`${action} during ordinary asynchronous resume settles back to idle`, async t => {
  const f = fixture(t);
  await f.output.resume(); f.output.connect(f.context.createGain()); f.output.restore();
  f.audio.paused = true; f.video.dispatchEvent(new f.window.Event('pause'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.context.state, 'suspended');
  let finish;
  f.context.resume = () => new Promise(resolve => { finish = () => { f.context.state = 'running'; resolve(); }; });
  f.audio.paused = false;
  const resumed = f.output.resume();
  if (action === 'pause') { f.audio.paused = true; f.video.dispatchEvent(new f.window.Event('pause')); }
  else f.video.remove();
  finish(); await resumed;
  assert.equal(f.context.state, 'suspended', 'the completed resume must respect the latest playback state');
  assert.equal(f.context.sources.size, 1);
  if (action === 'detach') assert.equal(f.output.source.connections.size, 0);
});

for (const cancelled of [false, true]) test(`a replacement waits for the outgoing fade${cancelled ? ' and can be cancelled' : ' without an ordinary route'}`, async t => {
  const f = fixture(t);
  await f.output.resume(); f.output.connect(f.context.createGain());
  let finish;
  const fading = new Promise(resolve => { finish = resolve; });
  const restored = f.output.restore(fading), replacement = acquireMediaOutput(f.window, f.video);
  let resumed = false;
  const ready = replacement.resume().then(() => { resumed = true; });
  await Promise.resolve();
  assert.equal(resumed, false, 'the outgoing graph must finish fading before replacement');
  if (cancelled) replacement.restore();
  finish(); await restored; await ready;
  assert.equal(f.output.source.connections.size, cancelled ? 1 : 0,
    'only a cancelled replacement may return to ordinary playback');
  if (cancelled) {
    const [ordinary] = f.output.source.connections;
    assert.equal(ordinary.gain.value, 0, 'ordinary output waits for the native volume restoration');
    f.video.volume = .2; await fadeInMediaOutput(f.window, f.video);
    assert.equal(ordinary.gain.value, 1);
  }
  assert.equal(f.context.sources.size, 1);
});
