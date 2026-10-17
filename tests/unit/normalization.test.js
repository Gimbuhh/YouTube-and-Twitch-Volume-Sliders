import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoudnessTracker, createVolumeNormalizer, measureAudioLevel } from '../../src/shared/normalization.js';
import { mockAudioCapture } from '../helpers/audio.js';

function runTracker(amplitude, seconds = 15) {
  const tracker = createLoudnessTracker();
  let gain;
  for (let i = 0; i < seconds * 10; i++) gain = tracker.update(new Float32Array(64).fill(amplitude), 0.1);
  return gain;
}

test('loudness correction converges toward a common level with bounded gain', () => {
  const loud = runTracker(0.5);
  const quiet = runTracker(0.08);
  assert.ok(Math.abs(0.5 * loud - 0.08 * quiet) < 0.005);
  assert.ok(runTracker(0.02) > 4.8, 'quiet sources can use available native volume range');
  assert.ok(Math.abs(runTracker(1) - 0.1) < 0.005, 'very loud sources reach the target instead of stopping at -12 dB');
  assert.ok(runTracker(0.5, 1) < 0.5, 'loud sources attenuate promptly');
});

test('silence, noise floor, and invalid samples never increase gain', () => {
  for (const amplitude of [0, 0.005, NaN, Infinity]) assert.equal(runTracker(amplitude), 1);
  const tracker = createLoudnessTracker();
  const before = tracker.update(new Float32Array(64).fill(0.5), 0.1);
  for (let i = 0; i < 100; i++) assert.equal(tracker.update(new Float32Array(64), 0.1), before);
  const quiet = createLoudnessTracker();
  for (let i = 0; i < 3; i++) assert.equal(quiet.update(new Float32Array(64).fill(0.03), 0.1), 1, 'wait for sustained audio before raising volume');
});

test('channel energy survives opposite-phase stereo and center-only dialogue', () => {
  const left = new Float32Array(64).fill(0.5);
  const right = new Float32Array(64).fill(-0.5);
  const silent = new Float32Array(64);
  assert.equal(measureAudioLevel([left, right]), 0.25);
  assert.equal(measureAudioLevel([silent, silent, left, silent, silent, silent]), 0.25);
});

test('quiet sources reach similar output to loud ones at 30% and 40% within five seconds', () => {
  for (const preferred of [30, 40]) {
    const quiet = createLoudnessTracker(), loud = createLoudnessTracker();
    let quietGain, loudGain;
    for (let i = 0; i < 50; i++) {
      quietGain = quiet.update(new Float32Array(64).fill(0.04), 0.1, 100 / preferred);
      loudGain = loud.update(new Float32Array(64).fill(0.9), 0.1, 100 / preferred);
    }
    const quietOutput = 0.04 * quietGain * preferred / 100;
    const loudOutput = 0.9 * loudGain * preferred / 100;
    assert.ok(Math.abs(20 * Math.log10(quietOutput / loudOutput)) < 1.5, 'remaining source difference is under 1.5 dB');
    assert.ok(quietGain * preferred <= 100 + 1e-6);
  }
});

test('speech gaps and quiet word endings do not drive gain upward', () => {
  const tracker = createLoudnessTracker();
  let gain;
  for (let i = 0; i < 30; i++) gain = tracker.update(new Float32Array(64).fill(0.25), 0.1);
  const before = gain;
  for (let i = 0; i < 30; i++) {
    // Each half-second phrase ends in a very quiet syllable and a pause.
    const amplitude = i % 5 < 3 ? 0.25 : i % 5 === 3 ? 0.02 : 0;
    gain = tracker.update(new Float32Array(64).fill(amplitude), 0.1);
  }
  assert.ok(Math.abs(20 * Math.log10(gain / before)) < 0.2);
});

test('sudden loud passages attenuate before the history window fills', () => {
  const tracker = createLoudnessTracker();
  for (let i = 0; i < 50; i++) tracker.update(new Float32Array(64).fill(0.04), 0.1, 100 / 30);
  let gain;
  for (let i = 0; i < 5; i++) gain = tracker.update(new Float32Array(64).fill(0.9), 0.1, 100 / 30);
  assert.ok(0.9 * gain < 0.115, 'new loud level is close to target after 500 ms');
});

test('a loud return after boosted quiet audio cuts gain on the first measurement', () => {
  for (const dt of [0.05, 0.1, 0.2]) {
    const tracker = createLoudnessTracker();
    let gain;
    for (let time = 0; time < 5; time += dt) gain = tracker.update(new Float32Array(64).fill(0.04), dt, 5);
    assert.ok(gain > 2, 'sustained quiet sources still receive useful normalization');
    gain = tracker.update(new Float32Array(64).fill(0.8), dt, 5);
    assert.ok(0.8 * gain <= 0.101, `the first loud measurement has no smoothed overshoot at ${dt}s`);
  }
});

test('a brief quiet introduction does not receive a volume boost', () => {
  const tracker = createLoudnessTracker();
  let gain;
  for (let i = 0; i < 15; i++) {
    gain = tracker.update(new Float32Array(64).fill(0.03), 0.05);
    assert.equal(gain, 1, 'wait for sustained measurable audio before increasing volume');
  }
  for (let i = 0; i < 300; i++) gain = tracker.update(new Float32Array(64).fill(0.03), 0.05);
  assert.ok(0.03 * gain > 0.095, 'a sustained quieter source can still reach the target');
});

test('an established source recovers cautiously after a long quiet passage', () => {
  const tracker = createLoudnessTracker();
  let gain;
  for (let i = 0; i < 80; i++) gain = tracker.update(new Float32Array(64).fill(0.4), 0.05, 5);
  for (let i = 0; i < 100; i++) {
    const before = gain;
    gain = tracker.update(new Float32Array(64).fill(0.04), 0.05, 5);
    if (i >= 80) assert.ok(20 * Math.log10(gain / before) < 0.35, 'quiet periods do not re-enter the faster startup ramp');
  }
});

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
  const advance = (seconds = 5) => {
    for (let i = 0; i < seconds * 10; i++) {
      now += 100;
      for (const callback of [...timers.values()]) callback();
    }
  };
  const start = () => { normalizer.setEnabled(true); normalizer.bind(video); };
  return { window, video, audio, normalizer, timers, writes, statuses, advance, start, get raw() { return raw; }, nativeVolume(value) { raw = value; } };
}

test('continuous audio crossing the noise floor stays Active without rebuilding capture', () => {
  const f = fixture(); f.start(); f.advance(1);
  f.statuses.length = 0;
  for (let i = 0; i < 8; i++) {
    f.audio.amplitude = i % 2 ? 0.025 : 0.005;
    f.advance(0.5);
    assert.ok(f.normalizer.getStatus().startsWith('Active'));
  }
  assert.ok(f.statuses.every(status => status.startsWith('Active')));
  assert.equal(f.audio.captures, 1);
  assert.equal(f.audio.contexts.length, 1);
  assert.equal(f.audio.contexts[0].closed, false);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 50);
  f.normalizer.setEnabled(false);
});

test('silent samples hold the correction while capture remains Active', () => {
  const f = fixture(); f.start(); f.advance();
  const output = f.raw;
  f.audio.amplitude = 0; f.advance(5);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.raw, output);
  assert.equal(f.audio.captures, 1);
  f.normalizer.setEnabled(false);
});

test('default off allocates nothing; enabling adjusts output without changing the preferred volume', () => {
  const f = fixture();
  f.normalizer.bind(f.video);
  assert.equal(f.audio.captures, 0);
  assert.equal(f.timers.size, 0);
  f.start(); f.advance();
  assert.ok(f.raw < 20);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 50);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.match(f.normalizer.getDetails(), /Reducing loud audio.*your 50% setting/);
  assert.ok(f.writes.every(write => write.options.preserveMute));
  assert.equal(f.audio.streams[0].getVideoTracks()[0].readyState, 'ended');
  f.normalizer.setEnabled(false);
  assert.equal(f.raw, 50);
  assert.equal(f.timers.size, 0);
  assert.equal(f.audio.contexts[0].closed, true);
  assert.equal(f.normalizer.getDetails(), '');
  assert.ok(f.audio.streams[0].getTracks().every(track => track.readyState === 'ended'));
});

test('custom and native volume changes become preferred intent; output is capped at 100', () => {
  const f = fixture(); f.start(); f.advance();
  f.normalizer.setPreferredVolume(f.video, 40, { preserveMute: true });
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 40);
  assert.ok(f.raw < 40);
  f.nativeVolume(70);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 70);
  f.audio.amplitude = 0.02; f.advance(30);
  assert.equal(f.raw, 100);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 70);
  assert.equal(f.normalizer.getStatus(), 'Active — at volume limit');
  f.normalizer.setEnabled(false);
  assert.equal(f.raw, 70);
});

test('pause and mute stop adjustments; zero preference remains zero', () => {
  const f = fixture(); f.start(); f.advance();
  const before = f.raw;
  f.video.muted = true; f.audio.amplitude = 0.02; f.advance(10);
  assert.equal(f.raw, before); assert.equal(f.normalizer.getStatus(), 'Muted');
  f.audio.paused = true; f.advance(); assert.equal(f.raw, before);
  f.normalizer.setPreferredVolume(f.video, 0, { preserveMute: true });
  f.audio.paused = false; f.video.muted = false; f.advance();
  assert.equal(f.raw, 0);
  f.normalizer.setEnabled(false); assert.equal(f.raw, 0);
});

test('low positive preferences never round into an automatic mute', () => {
  const f = fixture(); f.start(); f.advance();
  f.normalizer.setPreferredVolume(f.video, 1, {}); f.advance();
  assert.equal(f.raw, 1);
  assert.equal(f.normalizer.getPreferredVolume(f.video, f.raw), 1);
  f.normalizer.setEnabled(false);
});

test('capture/access errors fall back without changing mute or leaving resources alive', () => {
  const f = fixture(); f.start(); f.advance();
  f.video.muted = true;
  f.audio.sampleError = true;
  f.video.muted = false; f.advance();
  assert.equal(f.raw, 50);
  assert.equal(f.audio.contexts[0].closed, true);
  assert.match(f.normalizer.getStatus(), /unavailable/);
  const broken = fixture(); broken.audio.captureError = new Error('CORS'); broken.start();
  assert.equal(broken.raw, 50); assert.match(broken.normalizer.getStatus(), /unavailable/);
});

test('muted capture and suspended context restore ordinary volume and can recover', () => {
  const f = fixture(); f.start(); f.advance();
  f.audio.streams[0].getAudioTracks()[0].muted = true; f.advance();
  assert.equal(f.raw, 50); assert.match(f.normalizer.getStatus(), /accessible/);
  f.audio.streams[0].getAudioTracks()[0].muted = false; f.advance(); assert.ok(f.raw < 20);
  f.audio.contexts[0].state = 'suspended'; f.advance();
  assert.equal(f.raw, 50); assert.match(f.normalizer.getStatus(), /Click/);
  f.window.document.dispatchEvent(new Event('pointerdown')); f.advance(); assert.ok(f.raw < 20);
});

test('source changes and detachment release capture; rebinding does not accumulate timers', () => {
  const f = fixture(); f.start(); f.advance();
  f.normalizer.bind(f.video); assert.equal(f.audio.captures, 1);
  f.video.dispatchEvent(new Event('emptied'));
  assert.equal(f.raw, 50); assert.equal(f.audio.contexts[0].closed, true);
  f.advance(); assert.equal(f.audio.captures, 2); assert.ok(f.raw < 20);
  assert.equal(f.timers.size, 1);
  f.video.isConnected = false; f.advance(); assert.equal(f.timers.size, 0);
  assert.equal(f.audio.contexts[1].closed, true);
});

test('unsupported browsers and protected content leave ordinary playback intact', () => {
  const f = fixture(); delete f.video.captureStream; f.start(); f.advance();
  assert.equal(f.raw, 50); assert.equal(f.audio.captures, 0);
  assert.match(f.normalizer.getStatus(), /Unavailable in this browser/);
  const protectedVideo = fixture(); protectedVideo.video.mediaKeys = {}; protectedVideo.start();
  assert.equal(protectedVideo.audio.captures, 0); assert.equal(protectedVideo.raw, 50);
});
