import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSettings, normalizeBooleanSetting, normalizeOpacityPercent, normalizeOverlaySizePercent, normalizeSliderThicknessPercent, normalizeVolumeAppearance, normalizeVolumeSliderMode } from '../../src/shared/settings.js';
import { clampVolume, getVolumeTickInterval, normalizeVolumeStep, snapToStep, stepVolume } from '../../src/shared/volume.js';

test('saved volume parsing and clamping', () => {
  const storage = new JSDOM('', { url:'https://example.com' }).window.localStorage;
  const settings = createSettings(storage, { volume:'v', mode:'m', location:'l', replacePlacement:'p', step:'step', legacySnap:'s', expanded:'e' });
  assert.equal(settings.savedVolume, null);
  storage.setItem('v', '125px'); assert.equal(settings.savedVolume, 100);
  storage.setItem('v', '-8'); assert.equal(settings.savedVolume, 0);
  storage.setItem('v', 'nope'); assert.equal(settings.savedVolume, null);
});

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

test('saved adjustment step falls back to the legacy snap preference', () => {
  const storage = new JSDOM('', { url:'https://example.com' }).window.localStorage;
  const settings = createSettings(storage, { step:'step', legacySnap:'snap' });
  assert.equal(settings.volumeStep, 1);
  storage.setItem('snap', 'true'); assert.equal(settings.volumeStep, 5);
  storage.setItem('step', '10'); assert.equal(settings.volumeStep, 10);
  settings.volumeStep = 2; assert.equal(storage.getItem('step'), '2');
});
