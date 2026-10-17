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
  const writes = [];
  const statuses = [];
  const normalizer = createVolumeNormalizer({
    window, getVolume: () => raw, isMuted: () => video.muted,
    onStatusChanged: () => statuses.push(normalizer.getStatus()),
    setVolume: (target, value, options) => { assert.equal(target, video); raw = value; writes.push({ value, options }); }
  });
  const advance = async (seconds = 5) => {
    for (let i = 0; i < seconds * 20; i++) {
      now += 50;
      await new Promise(resolve => setImmediate(resolve));
      for (const callback of [...timers.values()]) callback();
    }
  };
  const start = async () => { normalizer.setEnabled(true); normalizer.bind(video); await new Promise(resolve => setImmediate(resolve)); };
  return { window, video, audio, normalizer, timers, writes, statuses, advance, start, get raw() { return raw; }, nativeVolume(value) { raw = value; } };
}

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

test('custom and native volume changes become preferred intent; output is capped at 100', async () => {
  const f = fixture(); await f.start(); await f.advance();
  f.normalizer.setPreferredVolume(f.video, 40, { preserveMute: true });
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 40);
  assert.ok(f.raw < 40);
  f.nativeVolume(70);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 70);
  f.audio.amplitude = 0.02; await f.advance(30);
  assert.equal(f.raw, 100);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 70);
  assert.equal(f.normalizer.getStatus(), 'Active — at volume limit');
  f.normalizer.setEnabled(false);
  assert.equal(f.raw, 70);
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
    assert.equal(f.audio.captures, mode === 'unsupported' ? 0 : 1, 'failed analysis is not retried on every tick');
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
