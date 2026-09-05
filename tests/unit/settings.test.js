import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBooleanSetting, normalizeOpacityPercent, normalizeOverlaySizePercent, normalizeSliderThicknessPercent, normalizeVolumeAppearance, normalizeVolumeSliderMode } from '../../src/shared/settings.js';
import { clampVolume, getVolumeTickInterval, normalizeVolumeStep, snapToStep, stepVolume } from '../../src/shared/volume.js';

test('settings defaults and boolean normalization', () => {
  assert.equal(normalizeBooleanSetting('true'), true);
  assert.equal(normalizeBooleanSetting(false), false);
  assert.equal(normalizeBooleanSetting('other'), null);
  assert.equal(normalizeVolumeStep('2'), 2);
  assert.equal(normalizeVolumeStep(10), 10);
  assert.equal(normalizeVolumeStep(3), null);
  assert.equal(normalizeVolumeSliderMode('replace-native'), 'replace-native');
  assert.equal(normalizeVolumeSliderMode('invalid'), null);
  assert.equal(normalizeVolumeAppearance('new'), 'new');
  assert.equal(normalizeVolumeAppearance('classic'), 'classic');
  assert.equal(normalizeVolumeAppearance('old'), null);
  assert.equal(normalizeOpacityPercent(120, 45), 100);
  assert.equal(normalizeOpacityPercent('invalid', 45), 45);
  assert.equal(normalizeOverlaySizePercent(250, 100), 200);
  assert.equal(normalizeOverlaySizePercent(60, 100), 100);
  assert.equal(normalizeOverlaySizePercent('invalid', 100), 100);
  assert.equal(normalizeSliderThicknessPercent(20, 50), 25);
  assert.equal(normalizeSliderThicknessPercent(180, 50), 125);
  assert.equal(normalizeSliderThicknessPercent('invalid', 50), 50);
});

test('volume clamping, custom steps, and adaptive tick intervals', () => {
  assert.equal(clampVolume(110), 100); assert.equal(clampVolume(-1), 0);
  assert.equal(snapToStep(47, 1), 47);
  assert.equal(snapToStep(47, 2), 48);
  assert.equal(snapToStep(47, 5), 45);
  assert.equal(snapToStep(96, 10), 100);
  assert.equal(stepVolume(53, 1, 2), 54);
  assert.equal(stepVolume(53, -1, 2), 52);
  assert.equal(stepVolume(50, 1, 10), 60);
  assert.equal(stepVolume(50, -1, 10), 40);
  assert.equal(getVolumeTickInterval(1), 10);
  assert.equal(getVolumeTickInterval(2), 2);
  assert.equal(getVolumeTickInterval(5), 5);
  assert.equal(getVolumeTickInterval(10), 10);
});
