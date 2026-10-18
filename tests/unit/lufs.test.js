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
      assert.notEqual(frames[7].momentaryLufs, null, 'momentary window still starts at 400 ms');
      assert.notEqual(frames[59].shortTermLufs, null, 'short-term window still starts at three seconds');
      assert.ok(Math.abs(frames.at(-1).momentaryLufs - level) <= 0.1);
      assert.ok(Math.abs(frames.at(-1).shortTermLufs - level) <= 0.1);
    }
  }
});

test('meter results do not depend on audio callback chunk boundaries', () => {
  const signal = tone(48000, 3.2, 0.1, 440);
  assert.deepEqual(measure([signal, signal], 48000, 127), measure([signal, signal], 48000, signal.length));
});

test('changing chunk sizes preserves multichannel measurements at every supported reference rate', () => {
  for (const rate of [44100, 48000, 96000]) for (const count of [1, 2, 4, 5, 6]) {
    const channels = Array.from({ length: count }, (_, channel) =>
      Float32Array.from({ length: Math.round(rate * .63) }, (_, i) =>
        i > rate * .4 ? 0 : .1 * Math.sin(2 * Math.PI * (83 + channel * 317) * i / rate) + .02));
    assert.deepEqual(measure(channels, rate, 127), measure(channels, rate, 1920));
  }
});

test('fast reporting stays at 50 Hz for steady audio and accelerates around a sharp rise', () => {
  const rate = 48000, meter = createLufsMeter(rate), reports = [];
  const warm = tone(rate, 1, .1);
  meter.process([warm, warm], () => {}, () => {});
  for (let ms = 0; ms < 1030; ms++) {
    const signal = Float32Array.from({ length: 48 }, (_, i) => {
      const time = 1 + ms / 1000 + i / rate;
      return (ms >= 1007 ? .8 : .1) * Math.sin(2 * Math.PI * 1000 * time);
    });
    meter.process([signal, signal], () => {}, () => reports.push(ms + 1));
  }
  assert.equal(reports.filter(ms => ms <= 1000).length, 50);
  assert.ok(reports.some(ms => ms >= 1008 && ms <= 1012), 'a sharp rise is reported before the next ordinary 20 ms update');
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
    assert.ok(gain > 1.5 && gain <= 10 ** (6 / 20), 'quiet audio receives bounded boost');
    const first = measure([loud, loud], 48000)[0];
    gain = controller.update(first, 100 / preferred);
    const outputLufs = -0.691 + 10 * Math.log10(first.power * gain * gain);
    assert.ok(outputLufs <= -18 + 1e-8);
  }
});

test('a loud return reaches its safe correction within 15 ms across measurement phases', () => {
  const rate = 48000;
  for (let offsetMs = 0; offsetMs < 50; offsetMs++) {
    const onset = Math.round(rate * (4 + offsetMs / 1000));
    const signal = Float32Array.from({ length: onset + rate / 10 }, (_, i) =>
      (i < onset ? .04 : .8) * Math.sin(2 * Math.PI * 440 * i / rate));
    const controller = createLufsGainController();
    let firstSafe, before;
    const meter = createLufsMeter(rate);
    for (let index = 0; index < signal.length; index += rate / 1000) {
      const time = (index + rate / 1000) / rate;
      const update = frame => {
        const gain = controller.update(frame, 100 / 30);
        if (time < onset / rate) before = gain;
        else if (firstSafe == null && .8 / Math.sqrt(2) * gain <= .1 * 10 ** (1 / 20)) firstSafe = time;
      };
      const chunk = signal.subarray(index, index + rate / 1000);
      meter.process([chunk, chunk], update, attackPower => update({ attackPower }));
    }
    assert.ok(before > 1.5 && before <= 10 ** (6 / 20), 'the quiet lead-in has useful, bounded boost');
    assert.ok(firstSafe != null && firstSafe - onset / rate <= .015001, `${offsetMs} ms phase: ${firstSafe - onset / rate} s`);
  }
});

test('automatic boost stays within 6 dB and the native volume headroom', () => {
  const target = 10 ** ((-18 + .691) / 10);
  for (const preferred of [20, 30, 40, 70, 100]) {
    const controller = createLufsGainController(), limit = Math.min(10 ** (6 / 20), 100 / preferred);
    let gain;
    for (let i = 0; i < 600; i++) {
      gain = controller.update({ power: target / 64, rawPower: target / 128, momentaryPower: target / 64, duration: .05 }, 100 / preferred);
      assert.ok(gain <= limit + 1e-9, `${preferred}%: boost must already be bounded before an unknown loud return`);
    }
    assert.ok(gain >= limit * .99, 'sustained quiet audio still receives useful available boost');
  }
});

test('fast K-weighted protection leaves ordinary peaks alone and never raises gain', () => {
  const target = 10 ** ((-18 + .691) / 10), controller = createLufsGainController();
  const normal = { power: target, rawPower: .01, momentaryPower: target, duration: .05 };
  for (let i = 0; i < 80; i++) controller.update(normal);
  const before = controller.update(normal);
  assert.equal(controller.update({ attackPower: target * 8 }), before, 'a 9 LU peak keeps the existing leveling policy');
  assert.equal(controller.update({ attackPower: NaN }), before);
  const reduced = controller.update({ attackPower: target * 16 });
  assert.ok(reduced <= .25, 'a 12 LU spike cuts before the next programme frame');
  assert.equal(controller.update({ attackPower: target }), reduced, 'short-window measurements never raise gain');
  let gain;
  for (let i = 0; i < 20; i++) gain = controller.update(normal);
  assert.ok(gain > .95, 'a brief spike does not change the programme reference or hold recovery down');
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

test('quiet backgrounds do not erase established speech level before the next word', () => {
  const target = 10 ** ((-18 + .691) / 10);
  for (const preferred of [20, 30, 40]) for (const seconds of [1, 5, 10]) {
    const controller = createLufsGainController();
    const update = power => controller.update({ power, rawPower: power / 2, momentaryPower: power, duration: .05 }, 100 / preferred);
    let gain;
    for (let i = 0; i < 160; i++) gain = update(target * 2);
    for (let i = 0; i < seconds * 20; i++) gain = update(target * .025);
    // This is the gain already in effect when the next word starts, before
    // any reactive detector or native-volume write can reduce it.
    const onsetExcessDb = 10 * Math.log10(2 * gain * gain);
    assert.ok(onsetExcessDb < 3, `${preferred}% after ${seconds}s background: ${onsetExcessDb.toFixed(2)} dB excess at speech onset`);
    assert.ok(update(target * 2) <= Math.SQRT1_2 + 1e-9, 'a measured loud return still cuts immediately');
  }
});

test('a cut recovers attenuation quickly but does not immediately restore a large boost', () => {
  const target = 10 ** ((-18 + .691) / 10);
  const controller = createLufsGainController();
  const quiet = { power: target / 16, rawPower: target / 32, momentaryPower: target / 16, duration: .05 };
  let gain;
  for (let i = 0; i < 300; i++) gain = controller.update(quiet, 5);
  assert.ok(gain > 1.9 && gain <= 10 ** (6 / 20), 'a consistently quiet source receives bounded boost');
  assert.equal(controller.update({ attackPower: target * 16 }, 5), .25);
  controller.update(quiet, 5);
  gain = controller.update(quiet, 5);
  assert.ok(gain < .5, `100 ms after the cut: ${gain}`);
  for (let i = 0; i < 100; i++) gain = controller.update(quiet, 5);
  assert.ok(gain > 1.8 && gain <= 10 ** (6 / 20), 'sustained quiet audio gradually regains useful, bounded boost');
});

test('brief peak recovery remains smooth around unity gain', () => {
  const target = 10 ** ((-18 + .691) / 10), recovered = [];
  for (const desired of [.99, 1, 1.01]) {
    const controller = createLufsGainController();
    const frame = { power: target / desired ** 2, rawPower: .01, momentaryPower: target / desired ** 2, duration: .05 };
    for (let i = 0; i < 160; i++) controller.update(frame);
    controller.update({ attackPower: target * 16 });
    let gain;
    for (let i = 0; i < 20; i++) gain = controller.update(frame);
    recovered.push(gain);
    assert.ok(gain > .95, 'a small peak must not leave ordinary programme volume ducked');
  }
  assert.ok(20 * Math.log10(Math.max(...recovered) / Math.min(...recovered)) < .3);
});

test('silence does not erase speech reference before a quiet background starts', () => {
  const target = 10 ** ((-18 + .691) / 10), controller = createLufsGainController();
  const update = power => controller.update({ power, rawPower: power / 2, momentaryPower: power, duration: .05 }, 5);
  let gain;
  for (let i = 0; i < 160; i++) gain = update(target * 2);
  const established = gain;
  for (let i = 0; i < 400; i++) assert.equal(update(0), established);
  for (let i = 0; i < 100; i++) gain = update(target * .025);
  assert.ok(20 * Math.log10(gain / established) < 3);
});

test('one loud startup frame does not become a lasting reference for a quiet source', () => {
  const target = 10 ** ((-18 + .691) / 10), controller = createLufsGainController();
  controller.update({ power: target * 16, rawPower: target * 8, momentaryPower: target * 16, duration: .05 });
  let gain;
  for (let i = 0; i < 100; i++) gain = controller.update({ power: target / 4, rawPower: target / 8, momentaryPower: target / 4, duration: .05 }, 5);
  assert.ok(gain > 1, 'a brief startup event must not keep a quieter recording attenuated');
});
