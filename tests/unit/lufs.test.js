import test from 'node:test';
import assert from 'node:assert/strict';
import { createLufsMeter } from '../../src/shared/lufs-meter.js';
import { createLufsGainController } from '../../scripts/lib/legacy-normalization.mjs';

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

test('brief loud passages do not replace the established listening level', () => {
  const target = 10 ** ((-18 + .691) / 10);
  for (const seconds of [.05, .25, .5, 1]) for (const excess of [12, 20]) {
    const controller = createLufsGainController(), recent = [];
    const update = power => {
      recent.push(power);
      if (recent.length > 8) recent.shift();
      return controller.update({ power, rawPower: power / 2, duration: .05,
        momentaryPower: recent.reduce((sum, value) => sum + value, 0) / recent.length });
    };
    let established, gain;
    for (let i = 0; i < 100; i++) established = update(target * 2);
    for (let i = 0; i < Math.round(seconds * 20); i++) {
      gain = update(target * 2 * 10 ** (excess / 10));
      assert.ok(gain <= Math.max(.1, established * 10 ** (-excess / 20)) + 1e-9, 'loud audio still cuts immediately');
    }
    for (let i = 0; i < 30; i++) gain = update(target * 2);
    assert.ok(Math.abs(20 * Math.log10(gain / established)) < 1,
      `${seconds}s event at +${excess} LU: ordinary audio recovers within 1 dB in 1.5 seconds`);
  }
});

test('sustained louder material establishes a new listening level', () => {
  const target = 10 ** ((-18 + .691) / 10), controller = createLufsGainController();
  const update = power => controller.update({ power, rawPower: power / 2, momentaryPower: power, duration: .05 });
  for (let i = 0; i < 100; i++) update(target * 2);
  for (let i = 0; i < 100; i++) assert.ok(update(target * 8) <= Math.sqrt(1 / 8) + 1e-9);
  let gain;
  for (let i = 0; i < 20; i++) gain = update(target * 2);
  assert.ok(gain < .4, 'a sustained loud passage retains the cautious programme recovery');
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

test('short consonants do not cause repeated deep cuts after quieter word tails', () => {
  for (const rate of [44100, 48000, 96000]) for (const phaseMs of [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]) {
    const controller = createLufsGainController(), meter = createLufsMeter(rate);
    // Voiced speech occupies less than half the active samples. A median of
    // these frames follows the word tails and raises gain before each onset.
    const signal = Float32Array.from({ length: rate * 12 }, (_, index) => {
      const phase = (index / rate + phaseMs / 1000) % .4;
      const amplitude = phase < .005 ? .45 : phase < .15 ? .2 : phase < .35 ? .06 : 0;
      return amplitude * Math.sin(2 * Math.PI * 1000 * index / rate);
    });
    let gain = 1, minimum = Infinity, maximum = 0;
    const update = frame => { gain = controller.update(frame, 4); };
    const chunkSize = Math.round(rate / 1000);
    for (let offset = 0; offset < signal.length; offset += chunkSize) {
      const chunk = signal.subarray(offset, offset + chunkSize);
      meter.process([chunk, chunk], update, attackPower => update({ attackPower }));
      if (offset < rate * 8) continue;
      minimum = Math.min(minimum, gain);
      maximum = Math.max(maximum, gain);
    }
    assert.ok(minimum > .5, 'ordinary voiced audio must not be held at a deep transient cut');
    assert.ok(maximum < .8, 'the established voice must keep a conservative gain before its next word');
    assert.ok(20 * Math.log10(maximum / minimum) < .5,
      `${rate} Hz, ${phaseMs} ms phase: consonants and quieter word tails retain a stable programme gain`);
  }
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

test('moderately quieter backgrounds retain speech reference and sustained quiet material eventually regains boost', () => {
  const target = 10 ** ((-18 + .691) / 10);
  for (const speechPower of [target, target * 2]) for (const preferred of [30, 40]) {
    const controller = createLufsGainController();
    const update = power => controller.update({ power, rawPower: power / 2, momentaryPower: power, duration: .05 }, 100 / preferred);
    for (let i = 0; i < 80; i++) update(speechPower);
    let gain;
    for (let i = 0; i < 160; i++) gain = update(speechPower * 10 ** (-5 / 10));
    assert.ok(10 * Math.log10(speechPower / target * gain ** 2) < 3,
      'the returning voice starts within 3 dB before any reactive measurement');
    // Sustained quiet material must eventually regain useful boost instead
    // of a previous loud source setting the listening level indefinitely.
    for (let i = 0; i < 600; i++) gain = update(target / 16);
    assert.ok(20 * Math.log10(gain) > 5.5);
  }
});

test('established speech returns within 3 dB across all 50 meter phases before a reactive cut', () => {
  const rate = 48000;
  for (const voice of [-18, -15]) for (let phase = 0; phase < 50; phase++) {
    const controller = createLufsGainController(), meter = createLufsMeter(rate);
    let gain = 1;
    const update = frame => { gain = controller.update(frame, 100 / 30); };
    const process = signal => meter.process([signal, signal], update, attackPower => update({ attackPower }));
    process(tone(rate, 4, 10 ** (voice / 20)));
    process(tone(rate, 8 + phase / 1000, 10 ** ((voice - 5) / 20)));
    assert.ok(voice + 18 + 20 * Math.log10(gain) < 3, `${voice} LUFS speech, ${phase} ms phase`);
  }
});

test('repeated brief effects do not cause multi-decibel boost pumping between events', () => {
  const rate = 48000, controller = createLufsGainController(), meter = createLufsMeter(rate);
  let gain = 1;
  const update = frame => { gain = controller.update(frame, 100 / 30); };
  const process = signal => meter.process([signal, signal], update, attackPower => update({ attackPower }));
  process(tone(rate, 10, 10 ** (-24 / 20)));
  const backgroundGains = [];
  for (let ms = 0; ms < 6000; ms += 5) {
    const effect = ms % 500 < 20;
    process(tone(rate, .005, 10 ** ((effect ? -18 : -24) / 20)));
    if (!effect) backgroundGains.push(20 * Math.log10(gain));
  }
  assert.ok(Math.min(...backgroundGains) > 4, 'brief effects do not repeatedly remove all quiet-source boost');
  assert.ok(Math.max(...backgroundGains) - Math.min(...backgroundGains) < 1.5);
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

test('deep cuts recover at a bounded rate without slowing loud-sound protection', () => {
  const target = 10 ** ((-18 + .691) / 10);
  for (const duration of [.025, .05, .1, .25]) {
    const controller = createLufsGainController();
    const frame = { power: target, rawPower: .01, momentaryPower: target, duration };
    for (let i = 0; i < 8 / duration; i++) controller.update(frame);
    let previous = controller.update({ attackPower: target * 100 });
    assert.equal(previous, .1, 'the large spike cuts immediately');
    for (let i = 0; i < 1.5 / duration; i++) {
      const gain = controller.update(frame);
      assert.ok(20 * Math.log10(gain / previous) <= 40 * duration + 1e-9,
        `${duration}s frame: recovery cannot jump faster than 40 dB/s`);
      previous = gain;
    }
    assert.ok(previous > .95, 'the limit still allows prompt recovery after the cut');
    assert.equal(controller.update({ attackPower: target * 100 }), .1, 'another cut remains immediate');
  }
});

test('a brief event recovers promptly with a short captured programme history', () => {
  const controller = createLufsGainController(), powers = [];
  const normal = 10 ** ((-18 + .691) / 10) / 1.26 ** 2;
  const update = power => {
    powers.push(power); if (powers.length > 8) powers.shift();
    return controller.update({ power, rawPower: power / 2, duration: .05,
      momentaryPower: powers.reduce((sum, value) => sum + value, 0) / powers.length });
  };
  let before, recovered;
  for (let i = 0; i < 53; i++) before = update(normal);
  for (let i = 0; i < 7; i++) assert.ok(update(normal * 49) < before / 3, 'the loud event still cuts immediately');
  for (let i = 0; i < 20; i++) recovered = update(normal);
  assert.ok(Math.abs(20 * Math.log10(recovered / before)) < 1.5,
    'one second of returning measurements recovers within 1.5 dB of the previous level');
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

test('established quiet-source boost survives silence without restarting the startup gate', () => {
  const target = 10 ** ((-18 + .691) / 10);
  for (const seconds of [1, 3.5, 10]) {
    const controller = createLufsGainController();
    const update = power => controller.update({ power, rawPower: power / 2, momentaryPower: power, duration: .05 });
    let gain;
    for (let i = 0; i < 600; i++) gain = update(target / 4);
    const established = gain;
    for (let i = 0; i < seconds * 20; i++) assert.equal(update(0), established);
    for (let i = 0; i < 20; i++) {
      gain = update(target / 4);
      assert.ok(Math.abs(20 * Math.log10(gain / established)) < .5, `${seconds}s gap, returning frame ${i}`);
    }
    assert.ok(update(target * 16) <= .25, 'preserving boost must not weaken loud-return protection');
  }
  const fresh = createLufsGainController();
  for (let i = 0; i < 100; i++) fresh.update({ power: 0, rawPower: 0, duration: .05 });
  for (let i = 0; i < 19; i++) assert.equal(fresh.update({ power: target / 4, rawPower: target / 8, duration: .05 }), 1);
});
