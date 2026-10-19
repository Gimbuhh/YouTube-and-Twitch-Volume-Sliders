import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolumeNormalizer } from '../../src/shared/normalization.js';
import { mockAudioCapture } from '../helpers/audio.js';

function fixture() {
  let now = 0;
  const timers = new Map();
  let timerId = 0;
  const window = {
    EventTarget, document: new EventTarget(), performance: { now: () => now },
    setInterval: callback => { timers.set(++timerId, callback); return timerId; },
    clearInterval: id => timers.delete(id)
  };
  const video = Object.assign(new EventTarget(), { isConnected: true, muted: false, volume: 0.5 });
  const audio = mockAudioCapture(window, video);
  let raw = 50;
  const errors = {};
  const writes = [];
  const statuses = [];
  const normalizer = createVolumeNormalizer({
    window, getVolume: () => { if (errors.read) throw errors.read; return raw; }, isMuted: () => video.muted,
    onStatusChanged: () => statuses.push(normalizer.getStatus()),
    setVolume: (target, value, options) => { if (errors.write) throw errors.write; assert.equal(target, video); raw = value; writes.push({ value, options, time: now }); }
  });
  const advance = async (seconds = 5) => {
    for (let i = 0; i < seconds * 20; i++) {
      now += 50;
      await new Promise(resolve => setImmediate(resolve));
      for (const callback of [...timers.values()]) callback();
    }
  };
  const start = async () => { normalizer.setEnabled(true); normalizer.bind(video); await new Promise(resolve => setImmediate(resolve)); };
  return { window, video, audio, normalizer, timers, writes, statuses, errors, advance, start, jump(seconds) { now += seconds * 1000; }, get raw() { return raw; }, nativeVolume(value) { raw = value; } };
}

function nativeCaptureWithSuspendedContext(f, blockedWorklet = false) {
  const Context = f.window.AudioContext, readers = [];
  f.window.AudioContext = class extends Context {
    constructor() { super(); this.state = 'suspended'; }
    resume() { return Promise.resolve(); } // Activation remains unavailable.
  };
  if (blockedWorklet) f.audio.loadError = true;
  else delete f.window.AudioWorkletNode;
  f.window.MediaStreamTrackProcessor = class {
    constructor() {
      let input;
      const capture = { cancelled: 0, frames: [], send() {
        const frame = { sampleRate: 48000, numberOfFrames: 4800, numberOfChannels: 1, closed: 0,
          copyTo(destination) { for (let i = 0; i < destination.length; i++) destination[i] = .5 * Math.sin(2 * Math.PI * 1000 * i / 48000); },
          close() { this.closed++; } };
        this.frames.push(frame); input.enqueue(frame);
      } };
      this.readable = new ReadableStream({ start(controller) { input = controller; }, cancel() { capture.cancelled++; } });
      readers.push(capture);
    }
  };
  return readers;
}

test('a temporary capture failure recovers automatically without a toggle or playback event', async () => {
  const f = fixture();
  f.audio.captureError = new Error('Player capture not ready');
  await f.start();
  assert.match(f.normalizer.getStatus(), /unavailable/i);
  f.audio.captureError = null;
  await f.advance(.9);
  assert.equal(f.audio.captures, 1, 'do not retry on every output tick');
  await f.advance(.3);
  assert.equal(f.audio.captures, 2);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.ok(f.raw < 20);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 50);
  f.normalizer.setEnabled(false);
  assert.equal(f.raw, 50); assert.equal(f.timers.size, 0);
});

test('native startup and stalled-frame failures reconnect and use fresh frames without a toggle', async () => {
  for (const started of [false, true]) {
    const f = fixture(), readers = nativeCaptureWithSuspendedContext(f);
    await f.start();
    if (started) { readers[0].send(); await f.advance(.1); }
    await f.advance(started ? .7 : 3.2);
    assert.match(f.normalizer.getStatus(), /unavailable/i);
    assert.equal(f.raw, 50); assert.equal(readers[0].cancelled, 1);
    await f.advance(1);
    assert.equal(readers.length, 2);
    readers[1].send(); await f.advance(.1);
    assert.equal(f.normalizer.getStatus(), 'Active'); assert.ok(f.raw < 20);
    f.normalizer.setEnabled(false);
    assert.ok(f.audio.contexts.every(context => context.closed));
    assert.ok(readers.every(reader => reader.cancelled === 1));
    assert.equal(f.timers.size, 0);
  }
});

test('repeated failures back off to 30 seconds and pause or disable prevents reconnection', async () => {
  const f = fixture(); f.audio.captureError = new Error('Capture unavailable');
  await f.start();
  for (const delay of [1, 2, 4, 8, 16, 30, 30]) {
    const captures = f.audio.captures;
    await f.advance(delay - .1); assert.equal(f.audio.captures, captures);
    await f.advance(.1); assert.equal(f.audio.captures, captures + 1);
  }
  f.audio.paused = true; const captures = f.audio.captures;
  await f.advance(35); assert.equal(f.audio.captures, captures);
  f.audio.captureError = null; f.audio.paused = false;
  await f.advance(.2); assert.equal(f.normalizer.getStatus(), 'Active');
  f.audio.processorError = true; await f.advance(.1);
  assert.match(f.normalizer.getStatus(), /unavailable/i);
  f.normalizer.setEnabled(false); await f.advance(35);
  assert.equal(f.audio.captures, captures + 1); assert.equal(f.timers.size, 0);
});

test('a player gesture retries a transient failure immediately and stable capture resets backoff', async () => {
  const f = fixture(); f.audio.captureError = new Error('Not ready');
  await f.start(); await f.advance(1);
  assert.equal(f.audio.captures, 2);
  f.audio.captureError = null;
  f.window.document.dispatchEvent(new Event('pointerdown'));
  await f.advance(3.2);
  assert.equal(f.audio.captures, 3); assert.equal(f.normalizer.getStatus(), 'Active');
  f.audio.processorError = true; await f.advance(.1);
  f.audio.processorError = false; await f.advance(1.1);
  assert.equal(f.audio.captures, 4, 'stable analysis resets the retry delay to one second');
  assert.equal(f.normalizer.getStatus(), 'Active');
  f.normalizer.setEnabled(false);
});

test('native analysis works with a suspended context through mute, pause, source reset and disable', async () => {
  for (const blockedWorklet of [false, true]) {
    const f = fixture(), readers = nativeCaptureWithSuspendedContext(f, blockedWorklet);
    await f.start(); readers[0].send(); await f.advance(.1);
    assert.equal(f.audio.contexts[0].state, 'suspended');
    assert.equal(f.normalizer.getStatus(), 'Active');
    assert.ok(f.raw < 20, 'native samples normalize without activating the unused context');
    const output = f.raw;
    f.video.muted = true; readers[0].send(); await f.advance(.1);
    assert.equal(f.normalizer.getStatus(), 'Muted'); assert.equal(f.raw, output);
    f.video.muted = false; f.audio.paused = true; readers[0].send(); await f.advance(.1);
    assert.equal(f.normalizer.getStatus(), 'Waiting for playback'); assert.equal(f.raw, output);
    f.audio.paused = false; f.normalizer.setPreferredVolume(f.video, 0, { preserveMute: true });
    readers[0].send(); await f.advance(.1);
    assert.equal(f.raw, 0); assert.equal(f.normalizer.getStatus(), 'Muted');
    f.normalizer.setPreferredVolume(f.video, 50, { preserveMute: true });
    f.video.dispatchEvent(new Event('emptied')); await f.advance(.05);
    await new Promise(resolve => setImmediate(resolve)); // Allow a rejected module to hand off to native frames.
    assert.equal(readers[0].cancelled, 1); assert.equal(f.audio.contexts[0].closed, true);
    readers[1].send(); await f.advance(.1);
    assert.equal(f.audio.contexts[1].state, 'suspended');
    assert.equal(f.normalizer.getStatus(), 'Active'); assert.ok(f.raw < 20);
    assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 50);
    f.video.muted = true; f.normalizer.setEnabled(false); await f.advance(.05);
    assert.equal(f.raw, 50); assert.equal(f.video.muted, true);
    assert.ok(f.audio.contexts.every(context => context.closed));
    assert.ok(readers.every(reader => reader.cancelled === 1 && reader.frames.every(frame => frame.closed === 1)));
    assert.equal(f.timers.size, 0);
  }
});

test('missing native frames still time out when the unused audio context is suspended', async () => {
  for (const started of [false, true]) {
    const f = fixture(), readers = nativeCaptureWithSuspendedContext(f);
    await f.start();
    if (started) { readers[0].send(); await f.advance(.1); assert.equal(f.normalizer.getStatus(), 'Active'); }
    await f.advance(started ? .7 : 3.2);
    assert.match(f.normalizer.getStatus(), /unavailable/i);
    assert.equal(f.raw, 50); assert.equal(f.audio.contexts[0].closed, true);
    assert.equal(readers[0].cancelled, 1);
    f.normalizer.setEnabled(false);
  }
});

test('continuous audio crossing the noise floor stays Active without rebuilding capture', async () => {
  const f = fixture(); await f.start(); await f.advance(1);
  f.statuses.length = 0;
  for (let i = 0; i < 8; i++) {
    f.audio.amplitude = i % 2 ? 0.025 : 0.005;
    await f.advance(0.5);
    assert.ok(f.normalizer.getStatus().startsWith('Active'));
  }
  assert.ok(f.statuses.every(status => status.startsWith('Active')));
  assert.equal(f.audio.captures, 1);
  assert.equal(f.audio.contexts.length, 1);
  assert.equal(f.audio.contexts[0].closed, false);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 50);
  f.normalizer.setEnabled(false);
});

test('silent samples hold the correction while capture remains Active', async () => {
  const f = fixture(); await f.start(); await f.advance();
  const output = f.raw;
  f.audio.amplitude = 0; await f.advance(5);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.raw, output);
  assert.equal(f.audio.captures, 1);
  f.normalizer.setEnabled(false);
});

test('loud measurements cut output immediately while recovery waits for the output timer', async () => {
  const f = fixture(); await f.start();
  const frame = (power, rawPower = power / 2) => f.audio.nodes[0].port.onmessage({ data: { power, rawPower, momentaryPower: power, duration: .02 } });
  // Keep this timer-ownership check independent of programme history: a fast
  // spike cuts output without teaching the controller a new source level.
  f.audio.nodes[0].port.onmessage({ data: { attackPower: 1 } });
  assert.ok(f.raw < 10, 'a cut does not wait for any polling timer');
  const reduced = f.raw;
  for (let i = 0; i < 200; i++) frame(.002);
  assert.equal(f.raw, reduced, 'measurements alone never raise volume');
  f.audio.amplitude = Math.sqrt(.001);
  await f.advance(.05);
  assert.ok(f.raw > reduced, 'the regular output tick applies gradual recovery');
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 50);
  f.normalizer.setEnabled(false);
});

test('fast cuts respect native volume intent before the next polling tick', async () => {
  const f = fixture(); await f.start();
  f.nativeVolume(70);
  f.audio.nodes[0].port.onmessage({ data: { power: 1, rawPower: .5, momentaryPower: 1, duration: .02 } });
  assert.ok(f.raw < 15);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 70);
  assert.ok(f.writes.every(write => write.options.preserveMute));
  f.normalizer.setEnabled(false);
  assert.equal(f.raw, 70);
});

test('ordinary fast measurements avoid player API reads without losing native intent on real cuts', async () => {
  const f = fixture(); await f.start(); await f.advance(.1);
  f.errors.read = new Error('This fast observation must not read the player');
  const port = f.audio.nodes[0].port;
  for (let i = 0; i < 100; i++) port.onmessage({ data: { attackPower: .0001 } });
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.audio.contexts[0].closed, false);
  delete f.errors.read;
  f.nativeVolume(70);
  port.onmessage({ data: { attackPower: 10 } });
  assert.ok(f.raw < 20);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 100);
  f.normalizer.setEnabled(false);
});

test('steady capture avoids repeated track scans and still picks up a replacement', async () => {
  const f = fixture(); await f.start();
  const stream = f.audio.streams[0];
  let scans = 0;
  for (const key of ['getAudioTracks', 'getVideoTracks']) {
    const method = stream[key].bind(stream);
    stream[key] = () => { scans++; return method(); };
  }
  await f.advance(3);
  assert.equal(scans, 0);
  const old = stream.getTracks().find(track => track.kind === 'audio');
  old.stop();
  stream.tracks.push(new old.constructor('audio'));
  await f.advance(.1);
  assert.ok(scans > 0, 'an ended track still triggers replacement detection without an addtrack event');
  assert.equal(f.audio.nodes.length, 2);
  assert.equal(f.audio.nodes[0].port.closed, true);
  f.normalizer.setEnabled(false);
});

test('fast measurements leave paused, muted and detached players alone', async () => {
  for (const state of ['paused', 'muted', 'detached']) {
    const f = fixture(); await f.start();
    if (state === 'paused') f.audio.paused = true;
    if (state === 'muted') f.video.muted = true;
    if (state === 'detached') f.video.isConnected = false;
    f.audio.nodes[0].port.onmessage({ data: { power: 1, rawPower: .5, momentaryPower: 1, duration: .02 } });
    assert.equal(f.raw, 50);
    f.normalizer.setEnabled(false);
  }
});

test('a failed immediate volume write releases analysis without escaping its callback', async () => {
  const f = fixture(); await f.start();
  f.errors.write = new Error('Player rejected the fast cut');
  assert.doesNotThrow(() => f.audio.nodes[0].port.onmessage({ data: { power: 1, rawPower: .5, momentaryPower: 1, duration: .02 } }));
  assert.match(f.normalizer.getStatus(), /unavailable/i);
  assert.equal(f.audio.nodes[0].port.closed, true);
  assert.equal(f.audio.contexts[0].closed, true);
  f.normalizer.setEnabled(false);
});

test('default off allocates nothing; enabling adjusts output without changing the preferred volume', async () => {
  const f = fixture();
  f.normalizer.bind(f.video);
  assert.equal(f.audio.captures, 0);
  assert.equal(f.timers.size, 0);
  await f.start(); await f.advance();
  assert.ok(f.raw < 20);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 50);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.match(f.normalizer.getDetails(), /^Reducing loud audio\nOutput \d+% · Selected 50%$/);
  assert.ok(f.writes.every(write => write.options.preserveMute));
  assert.equal(f.audio.streams[0].getVideoTracks()[0].readyState, 'ended');
  f.normalizer.setEnabled(false);
  assert.equal(f.raw, 50);
  assert.equal(f.timers.size, 0);
  assert.equal(f.audio.contexts[0].closed, true);
  assert.equal(f.normalizer.getDetails(), '');
  assert.ok(f.audio.streams[0].getTracks().every(track => track.readyState === 'ended'));
});

test('custom volume changes are absolute; native changes scale intent and output is capped at 100', async () => {
  const f = fixture(); await f.start(); await f.advance();
  f.normalizer.setPreferredVolume(f.video, 40, { preserveMute: true });
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 40);
  assert.ok(f.raw < 40);
  f.nativeVolume(70);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 100);
  f.normalizer.setPreferredVolume(f.video, 70, { preserveMute: true });
  f.video.dispatchEvent(new Event('emptied'));
  f.audio.amplitude = 0.02; await f.advance(30);
  assert.equal(f.raw, 100);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 70);
  assert.equal(f.normalizer.getStatus(), 'Active — at volume limit');
  f.normalizer.setEnabled(false);
  assert.equal(f.raw, 70);
});

test('native adjustments retain established leveling and scale the preferred listening level', async () => {
  for (const amplitude of [.17, .03]) for (const delta of [-5, 5]) {
    const f = fixture(); f.audio.amplitude = amplitude;
    f.nativeVolume(30); await f.start(); await f.advance(30);
    const before = f.raw, requested = before + delta;
    f.nativeVolume(requested);
    const preferred = Math.round(30 * requested / before);
    assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), preferred);
    assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), preferred, 'repeated reads do not compound intent');
    await f.advance(.2);
    assert.ok(Math.abs(f.raw - requested) <= 1, `${amplitude}: native ${before} → ${requested} settles at ${f.raw}`);
    assert.equal(Math.sign(f.raw - before), Math.sign(delta));
    f.normalizer.setEnabled(false);
    assert.equal(f.raw, preferred);
  }
});

test('native zero, unzero and clamped intent remain finite and preserve mute', async () => {
  const f = fixture(); await f.start(); await f.advance();
  f.nativeVolume(0); await f.advance(.1);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 0); assert.equal(f.raw, 0);
  f.nativeVolume(40);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 40);
  await f.advance(.2); assert.ok(f.raw > 0 && f.raw < 40);
  f.nativeVolume(100);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 100);
  f.video.muted = true; f.normalizer.setEnabled(false);
  assert.equal(f.raw, 100); assert.equal(f.video.muted, true);
});

test('unchanged output describes adjustment rather than claiming measured loudness is on target', async () => {
  const f = fixture(); f.audio.amplitude = .03;
  await f.start(); await f.advance(30);
  assert.equal(f.normalizer.getStatus(), 'Active — at volume limit');
  f.normalizer.setPreferredVolume(f.video, 100, { preserveMute: true });
  await f.advance(.05);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.normalizer.getDetails(), 'No volume adjustment\nOutput 100% · Selected 100%');
  await f.advance(1);
  assert.equal(f.normalizer.getDetails(), 'No volume adjustment\nOutput 100% · Selected 100%');
  f.normalizer.setEnabled(false);
});

test('gradual recovery coalesces small writes, settles promptly and never delays cuts or user input', async t => {
  const f = fixture(), target = 10 ** ((-18 + .691) / 10);
  f.nativeVolume(100); f.audio.amplitude = Math.sqrt(target / 2);
  await f.start(); await f.advance(5); f.writes.length = 0;
  const port = f.audio.nodes[0].port;
  port.onmessage({ data: { attackPower: 10 } });
  assert.equal(f.raw, 10, 'protective cut is immediate');
  await f.advance(3);
  const busySecond = Math.max(...f.writes.map(write => f.writes.filter(next => next.time >= write.time && next.time < write.time + 1000).length));
  t.diagnostic(`protective-cut recovery: ${f.writes.length} writes in 3s, busiest second ${busySecond}`);
  assert.ok(busySecond <= 15, `recovery writes per second: ${busySecond}`);
  assert.equal(f.raw, 100, 'the final small increase must not remain stuck in the deadband');
  port.onmessage({ data: { attackPower: 10 } });
  assert.equal(f.raw, 10, 'another cut bypasses the write interval');
  f.normalizer.setPreferredVolume(f.video, 50, { preserveMute: true });
  assert.equal(f.raw, 5, 'explicit custom input is immediate');
  f.normalizer.setEnabled(false);
  assert.equal(f.raw, 50, 'restoration is immediate');
});

test('pause and mute stop adjustments; zero preference remains zero', async () => {
  const f = fixture(); await f.start(); await f.advance();
  const before = f.raw;
  f.video.muted = true; f.audio.amplitude = 0.02; await f.advance(10);
  assert.equal(f.raw, before); assert.equal(f.normalizer.getStatus(), 'Muted');
  f.audio.paused = true; await f.advance(); assert.equal(f.raw, before);
  f.normalizer.setPreferredVolume(f.video, 0, { preserveMute: true });
  f.audio.paused = false; f.video.muted = false; await f.advance();
  assert.equal(f.raw, 0);
  f.normalizer.setEnabled(false); assert.equal(f.raw, 0);
});

test('low positive preferences never round into an automatic mute', async () => {
  const f = fixture(); await f.start(); await f.advance();
  f.normalizer.setPreferredVolume(f.video, 1, {}); await f.advance();
  assert.equal(f.raw, 1);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 1);
  f.normalizer.setEnabled(false);
});

test('capture/access errors fall back without changing mute or leaving resources alive', async () => {
  const f = fixture(); await f.start(); await f.advance();
  f.video.muted = true;
  f.audio.processorError = true;
  f.video.muted = false; await f.advance();
  assert.equal(f.raw, 50);
  assert.equal(f.audio.contexts[0].closed, true);
  assert.match(f.normalizer.getStatus(), /unavailable/);
  const broken = fixture(); broken.audio.captureError = new Error('CORS'); await broken.start();
  assert.equal(broken.raw, 50); assert.match(broken.normalizer.getStatus(), /unavailable/);
});

test('muted capture and suspended context restore ordinary volume and can recover', async () => {
  const f = fixture(); await f.start(); await f.advance();
  f.audio.streams[0].getAudioTracks()[0].muted = true; await f.advance();
  assert.equal(f.raw, 50); assert.match(f.normalizer.getStatus(), /accessible/);
  f.audio.streams[0].getAudioTracks()[0].muted = false; await f.advance(); assert.ok(f.raw < 20);
  f.audio.contexts[0].state = 'suspended'; await f.advance();
  assert.equal(f.raw, 50); assert.match(f.normalizer.getStatus(), /Click/);
  f.window.document.dispatchEvent(new Event('pointerdown')); await f.advance(); assert.ok(f.raw < 20);
});

test('source changes and detachment release capture; rebinding does not accumulate timers', async () => {
  const f = fixture(); await f.start(); await f.advance();
  f.normalizer.bind(f.video); assert.equal(f.audio.captures, 1);
  f.video.dispatchEvent(new Event('emptied'));
  assert.equal(f.raw, 50); assert.equal(f.audio.contexts[0].closed, true);
  await f.advance(); assert.equal(f.audio.captures, 2); assert.ok(f.raw < 20);
  assert.equal(f.timers.size, 2);
  f.video.isConnected = false; await f.advance(); assert.equal(f.timers.size, 0);
  assert.equal(f.audio.contexts[1].closed, true);
});

test('disabling releases capture even when the outgoing player volume API throws', async () => {
  for (const operation of ['read', 'write']) {
    const f = fixture(); await f.start(); await f.advance();
    assert.ok(f.raw < 20);
    f.errors[operation] = new Error('Outgoing player unavailable');
    assert.doesNotThrow(() => f.normalizer.setEnabled(false));
    assert.equal(f.normalizer.getStatus(), 'Off');
    assert.equal(f.timers.size, 0);
    assert.equal(f.audio.contexts[0].closed, true);
    assert.equal(f.audio.nodes[0].port.closed, true);
    assert.ok(f.audio.streams[0].getTracks().every(track => track.readyState === 'ended'));
    f.video.dispatchEvent(new Event('playing'));
    assert.equal(f.audio.captures, 1, 'outgoing playback listeners are removed');
  }
});

test('source reset releases inaccessible capture and preserves intent when the player API recovers', async () => {
  for (const operation of ['read', 'write']) {
    const f = fixture(); await f.start(); await f.advance();
    f.errors[operation] = new Error('Source is changing');
    f.video.dispatchEvent(new Event('emptied'));
    assert.equal(f.audio.contexts[0].closed, true);
    assert.equal(f.audio.nodes[0].port.closed, true);
    assert.ok(f.audio.streams[0].getTracks().every(track => track.readyState === 'ended'));
    assert.equal(f.normalizer.getStatus(), 'Waiting for playback');
    delete f.errors[operation];
    await f.advance(1);
    assert.equal(f.audio.captures, 2);
    assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 50);
    assert.equal(f.normalizer.getStatus(), 'Active');
    f.normalizer.setEnabled(false);
    assert.equal(f.raw, 50);
    assert.equal(f.timers.size, 0);
  }
});

test('unsupported browsers and protected content leave ordinary playback intact', async () => {
  const f = fixture(); delete f.video.captureStream; await f.start(); await f.advance();
  assert.equal(f.raw, 50); assert.equal(f.audio.captures, 0);
  assert.match(f.normalizer.getStatus(), /Unavailable in this browser/);
  const protectedVideo = fixture(); protectedVideo.video.mediaKeys = {}; await protectedVideo.start();
  assert.equal(protectedVideo.audio.captures, 0); assert.equal(protectedVideo.raw, 50);
});

test('startup keeps the selected volume until LUFS frames arrive', async () => {
  const f = fixture();
  f.normalizer.setEnabled(true); f.normalizer.bind(f.video);
  assert.equal(f.raw, 50);
  assert.equal(f.normalizer.getStatus(), 'Starting audio analysis');
  assert.equal(f.normalizer.getDetails(), '');
  await f.advance(1);
  assert.ok(f.raw < 20);
  assert.equal(f.normalizer.getStatus(), 'Active');
  f.normalizer.setEnabled(false);
});

test('unsupported or blocked LUFS restores ordinary volume and releases capture', async () => {
  for (const mode of ['unsupported', 'blocked']) {
    const f = fixture();
    if (mode === 'unsupported') delete f.window.AudioWorkletNode;
    else f.audio.loadError = true;
    await f.start(); await f.advance();
    assert.equal(f.raw, 50);
    assert.match(f.normalizer.getStatus(), /unavailable/i);
    assert.ok(f.audio.contexts.every(context => context.closed));
    assert.ok(f.audio.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
    assert.equal(f.audio.captures, mode === 'unsupported' ? 0 : 3, 'unsupported APIs allocate nothing; blocked analysis retries with backoff');
    f.normalizer.setEnabled(false);
    assert.equal(f.timers.size, 0);
  }
});

test('missing or stalled LUFS frames restore ordinary volume and close the processor', async () => {
  for (const started of [false, true]) {
    const f = fixture();
    f.audio.stalled = !started;
    await f.start();
    if (started) { await f.advance(1); assert.ok(f.raw < 20); f.audio.stalled = true; }
    await f.advance(started ? 0.7 : 3.2);
    assert.equal(f.raw, 50);
    assert.match(f.normalizer.getStatus(), /unavailable/i);
    assert.equal(f.audio.nodes[0].port.closed, true);
    assert.equal(f.audio.contexts[0].closed, true);
    f.normalizer.setEnabled(false);
    assert.equal(f.timers.size, 0);
  }
});

test('a long page task lets queued audio catch up without restoring louder ordinary volume', async () => {
  const f = fixture(); await f.start(); await f.advance(1);
  const output = f.raw;
  f.jump(.65);
  await f.advance(.05); // The overdue timer runs before the queued audio callback.
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.raw, output);
  assert.equal(f.audio.captures, 1);
  assert.equal(f.audio.contexts[0].closed, false);
  f.normalizer.setEnabled(false);
});

test('scheduling catch-up is bounded when the analyzer really stops reporting', async () => {
  const f = fixture(); await f.start(); await f.advance(1);
  f.audio.stalled = true;
  f.jump(.65); await f.advance(.05);
  assert.equal(f.normalizer.getStatus(), 'Active');
  f.jump(.65); await f.advance(.05);
  assert.match(f.normalizer.getStatus(), /unavailable/i, 'another delayed timer cannot extend the grace without new audio');
  assert.equal(f.raw, 50);
  assert.equal(f.audio.contexts[0].closed, true);
  f.normalizer.setEnabled(false);
});

test('long pauses and mute do not make a healthy processor time out on resuming', async () => {
  const f = fixture(); await f.start(); await f.advance(1);
  const output = f.raw;
  for (const state of ['paused', 'muted']) {
    f.audio.stalled = true;
    if (state === 'paused') f.audio.paused = true;
    else f.video.muted = true;
    await f.advance(10);
    assert.equal(f.raw, output);
    assert.equal(f.audio.contexts[0].closed, false);
    f.audio.paused = false; f.video.muted = false; f.audio.stalled = false;
    await f.advance(1);
    assert.equal(f.normalizer.getStatus(), 'Active');
  }
  f.normalizer.setEnabled(false);
});
