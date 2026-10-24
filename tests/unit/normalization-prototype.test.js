import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLookaheadGain, programmeCommands, renderRefined, REFINED_PROFILE } from '../../scripts/normalization-prototype.mjs';

function tone(rate, seconds, amplitude) {
  const audio = new Float32Array(Math.round(rate * seconds) * 2);
  for (let i = 0; i < audio.length / 2; i++) {
    audio[i * 2] = amplitude * Math.sin(2 * Math.PI * 997 * i / rate);
    audio[i * 2 + 1] = -.5 * audio[i * 2];
  }
  return audio;
}

function meanPower(audio, rate, start, seconds) {
  let energy = 0, count = 0;
  for (let i = Math.floor(start * rate) * 2; i < Math.floor((start + seconds) * rate) * 2; i++) {
    energy += audio[i] ** 2;
    count++;
  }
  return 10 * Math.log10(energy / count);
}

for (const rate of [44100, 48000, 96000]) {
  test(`prototype lookahead contains impulses at seven onset phases at ${rate} Hz`, () => {
    for (const phaseMs of [0, 1, 3, 5, 9, 13, 19]) {
      const ceiling = .3 * 10 ** (REFINED_PROFILE.peakDb / 20);
      const stage = createLookaheadGain({ rate, ceiling });
      const frames = rate / 2, impulse = Math.floor(rate * (.2 + phaseMs / 1000));
      let count = 0, peak = 0, stereoError = 0;
      for (let i = 0; i < frames + stage.delay; i++) {
        let value = i < frames ? .04 * Math.sin(2 * Math.PI * 997 * i / rate) : 0;
        if (i === impulse) value = 1.15;
        const output = stage.push(value, -.5 * value, .3);
        if (!output) continue;
        assert.ok(Number.isFinite(output[0]) && Number.isFinite(output[1]));
        peak = Math.max(peak, Math.abs(output[0]), Math.abs(output[1]));
        stereoError = Math.max(stereoError, Math.abs(output[1] + .5 * output[0]));
        count++;
      }
      assert.equal(stage.delay, Math.round(rate * .02));
      assert.equal(count, frames);
      assert.ok(peak <= ceiling + 1e-7);
      assert.ok(stereoError < 1e-6);
      assert.equal(stage.stats.emergencyCuts, 0);
    }
  });
}

test('prototype defaults match the selected profile and reject an invalid peak ceiling', () => {
  const audio = tone(48000, 1, .05), { commands } = programmeCommands(audio);
  const implicit = renderRefined(audio, commands);
  const explicit = renderRefined(audio, commands, REFINED_PROFILE);
  assert.ok(implicit.output.every(Number.isFinite));
  assert.deepEqual(implicit.output, explicit.output);
  assert.throws(() => createLookaheadGain({ ceiling: NaN }), RangeError);
});

test('prototype zero volume stays silent with finite diagnostics', () => {
  const audio = tone(48000, 1, .05), { commands } = programmeCommands(audio, 48000, 0);
  const result = renderRefined(audio, commands, { selected: 0 });
  assert.ok(result.output.every(value => value === 0));
  assert.ok(Object.values(result.stats).every(Number.isFinite));
  assert.equal(result.stats.emergencyCuts, 0);
});

test('prototype recovers after a brief loud event without the former transient controller', () => {
  const rate = 48000, audio = tone(rate, 14, .05);
  for (let i = rate * 8; i < rate * 8.3; i++) {
    audio[i * 2] = Math.sin(2 * Math.PI * 997 * i / rate);
    audio[i * 2 + 1] = -.5 * audio[i * 2];
  }
  const { output } = renderRefined(audio, programmeCommands(audio).commands);
  const established = meanPower(output, rate, 7, .5);
  assert.ok(meanPower(output, rate, 9.3, .15) - established > -.5);
  assert.ok(Math.abs(meanPower(output, rate, 9.8, .15) - established) < .5);
});

test('prototype keeps silence protected and opens meaningful audio without a prolonged fade', () => {
  const rate = 48000;
  for (const amplitude of [0, 1e-6]) {
    const audio = new Float32Array(rate * 2).fill(amplitude);
    const { commands } = programmeCommands(audio);
    assert.ok(commands.every(value => value === 0));
    assert.ok(renderRefined(audio, commands).output.every(value => value === 0));
  }
  const audio = tone(rate, 2, .1);
  audio.fill(1e-6, 0, rate / 4 * 2);
  const { output } = renderRefined(audio, programmeCommands(audio).commands);
  const initial = meanPower(output, rate, .4, .1), established = meanPower(output, rate, 1.5, .1);
  assert.ok(initial - established > -3);
});

test('prototype leaves an unrestricted steady tone unchanged after its opening fade', () => {
  const rate = 48000, audio = tone(rate, 2, .08), stage = createLookaheadGain();
  let seen = 0, error = 0;
  for (let i = 0; i < rate * 2 + stage.delay; i++) {
    const left = i < rate * 2 ? audio[i * 2] : 0;
    const output = stage.push(left, -.5 * left, .3);
    if (!output) continue;
    if (seen > rate / 10 && seen < rate * 2) error = Math.max(error, Math.abs(output[0] - audio[seen * 2] * .3));
    seen++;
  }
  assert.ok(error < 1e-8);
});

test('development lookahead prototype is absent from both standalone userscripts', () => {
  for (const platform of ['youtube', 'twitch']) {
    const script = readFileSync(new URL(`../../dist/${platform}-volume-slider.user.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(script, /createLookaheadGain|REFINED_PROFILE|programmeCommands|emergencyCuts/);
  }
});
