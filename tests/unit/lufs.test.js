import test from 'node:test';
import assert from 'node:assert/strict';
import { createLufsMeter, createLufsGainController } from '../../src/shared/lufs-meter.js';

function tone(rate, seconds, amplitude, frequency = 1000) {
  return Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
}

function measure(channels, rate, chunk = 128) {
  const meter = createLufsMeter(rate), frames = [];
  for (let i = 0; i < channels[0].length; i += chunk) meter.process(channels.map(channel => channel.subarray(i, i + chunk)), frame => frames.push(frame));
  return frames;
}

test('EBU Tech 3341 stereo 1 kHz reference levels match within 0.1 LU at multiple sample rates', () => {
  for (const rate of [44100, 48000, 96000]) {
    for (const level of [-23, -33]) {
      const signal = tone(rate, 4, 10 ** (level / 20));
      const frames = measure([signal, signal], rate);
      assert.equal(frames.length, 80);
      assert.equal(frames[6].momentaryLufs, null);
      assert.equal(frames[58].shortTermLufs, null);
      assert.ok(Math.abs(frames.at(-1).momentaryLufs - level) <= 0.1);
      assert.ok(Math.abs(frames.at(-1).shortTermLufs - level) <= 0.1);
    }
  }
});

test('meter results do not depend on audio callback chunk boundaries', () => {
  const signal = tone(48000, 3.2, 0.1, 440);
  assert.deepEqual(measure([signal, signal], 48000, 127), measure([signal, signal], 48000, signal.length));
});

test('channel energy is summed without phase cancellation and LFE does not inflate loudness', () => {
  const signal = tone(48000, 3.2, 0.1), zero = new Float32Array(signal.length);
  const stereo = measure([signal, signal], 48000).at(-1).shortTermLufs;
  const reverse = measure([signal, signal.map(value => -value)], 48000).at(-1).shortTermLufs;
  const left = measure([signal, zero], 48000).at(-1).shortTermLufs;
  const center = measure([zero, zero, signal, signal, zero, zero], 48000).at(-1).shortTermLufs;
  const surround = measure([zero, zero, zero, signal, zero], 48000).at(-1).shortTermLufs;
  assert.equal(reverse, stereo);
  assert.ok(Math.abs(stereo - left - 10 * Math.log10(2)) < 1e-8);
  assert.equal(center, left);
  assert.ok(Math.abs(surround - left - 10 * Math.log10(1.41)) < 1e-8);
});

test('K weighting distinguishes equal-RMS bass and high frequency content', () => {
  const bass = tone(48000, 3.2, 0.1, 80), high = tone(48000, 3.2, 0.1, 4000);
  const low = measure([bass, bass], 48000).at(-1).shortTermLufs;
  const upper = measure([high, high], 48000).at(-1).shortTermLufs;
  assert.ok(upper - low > 5.6 && upper - low < 5.8);
});

test('momentary and short-term windows remain ungated while the controller holds through silence', () => {
  const signal = tone(48000, 4, 0.2), zero = new Float32Array(signal.length);
  const frames = measure([signal, signal], 48000);
  const gain = createLufsGainController();
  let before;
  for (const frame of frames) before = gain.update(frame);
  for (const frame of measure([zero, zero], 48000)) assert.equal(gain.update(frame), before);
  const silent = measure([zero, zero], 48000).at(-1);
  assert.equal(silent.shortTermLufs, -Infinity);
  assert.equal(silent.momentaryLufs, -Infinity);
  assert.throws(() => createLufsMeter(48000).process([new Float32Array([NaN])], () => {}), /Invalid audio sample/);
});

test('LUFS gain waits before boosting, respects volume headroom, and cuts a loud return on the first frame', () => {
  for (const preferred of [30, 40]) {
    const quiet = tone(48000, 5, 0.04, 440), loud = tone(48000, 0.1, 0.8, 440);
    const controller = createLufsGainController();
    let gain;
    for (const [index, frame] of measure([quiet, quiet], 48000).entries()) {
      gain = controller.update(frame, 100 / preferred);
      if (index < 19) assert.equal(gain, 1);
      assert.ok(gain <= 100 / preferred);
    }
    assert.ok(gain > 2);
    const first = measure([loud, loud], 48000)[0];
    gain = controller.update(first, 100 / preferred);
    const outputLufs = -0.691 + 10 * Math.log10(first.power * gain * gain);
    assert.ok(outputLufs <= -18 + 1e-8);
  }
});

test('temporary spike protection releases without holding the programme at the transient level', () => {
  const target = 10 ** ((-18 + 0.691) / 10), controller = createLufsGainController();
  const recent = [];
  let gain;
  for (let index = 0; index <= 100; index++) {
    const power = target * (index === 80 ? 16 : 1);
    recent.push(power);
    if (recent.length > 8) recent.shift();
    gain = controller.update({ power, rawPower: 0.1, duration: 0.05,
      momentaryPower: recent.reduce((sum, value) => sum + value, 0) / recent.length });
    if (index === 80) assert.ok(gain <= 0.25, 'the first spike frame cuts immediately');
  }
  assert.ok(gain > 0.85, 'normal audio recovers within one second instead of staying at the spike gain');
  assert.ok(gain < 1, 'the programme history still limits recovery conservatively');
});

test('quiet word endings and speech gaps do not drive LUFS gain upward', () => {
  const controller = createLufsGainController();
  const update = power => controller.update({ power, rawPower: power / 2, momentaryPower: power, duration: 0.05 });
  let before;
  for (let i = 0; i < 80; i++) before = update(0.12);
  let gain;
  for (let i = 0; i < 100; i++) gain = update(i % 5 < 3 ? 0.12 : i % 5 === 3 ? 0.0012 : 0);
  assert.ok(Math.abs(20 * Math.log10(gain / before)) < 0.2);
});

test('an established LUFS source keeps cautious recovery after a long quiet passage', () => {
  const controller = createLufsGainController();
  const update = power => controller.update({ power, rawPower: power / 2, momentaryPower: power, duration: 0.05 }, 5);
  let gain;
  for (let i = 0; i < 80; i++) gain = update(0.32);
  for (let i = 0; i < 100; i++) {
    const before = gain;
    gain = update(0.0032);
    if (i >= 80) assert.ok(20 * Math.log10(gain / before) < 0.35, 'quiet periods do not re-enter the faster startup ramp');
  }
});
