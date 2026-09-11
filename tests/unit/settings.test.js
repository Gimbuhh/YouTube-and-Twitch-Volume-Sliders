import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolumeSettings, normalizeBooleanSetting, normalizeOpacityPercent, normalizeOverlaySizePercent, normalizeSliderThicknessPercent, normalizeVolumeAppearance, normalizeVolumeSliderMode } from '../../src/shared/settings.js';
import { clampVolume, getVolumeTickInterval, normalizeVolumeStep, snapToStep, stepVolume } from '../../src/shared/volume.js';

function createSettingsFixture() {
  const values = new Map([['step', '2'], ['thickness', '100']]);
  const failures = { read: false, write: false, remove: false };
  const storage = {
    getItem(key) {
      if (failures.read) throw new Error('Storage read denied');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (failures.write) throw new Error('Storage write denied');
      values.set(key, value);
    },
    removeItem(key) {
      if (failures.remove) throw new Error('Storage removal denied');
      values.delete(key);
    }
  };
  const settings = createVolumeSettings({
    document: { getElementById: () => null }, storage,
    userSettings: { sliderThickness: 'saved' }, overlayId: 'overlay',
    keys: { step: 'step', legacySnap: 'legacy', mode: 'mode', appearance: 'appearance', sliderThickness: 'thickness' },
    defaults: { sliderThickness: 75 }, onModeChanged: () => {}
  });
  return { settings, values, failures };
}

test('failed settings writes retain user choices instead of stale saved values', () => {
  const { settings, values, failures } = createSettingsFixture();
  failures.write = true;
  settings.setVolumeStep(10);
  settings.setVolumeSliderMode('off');
  settings.setVolumeAppearance('classic');
  assert.equal(settings.getVolumeStep(), 10);
  assert.equal(settings.getVolumeSliderMode(), 'off');
  assert.equal(settings.getVolumeAppearance(), 'classic');
  assert.equal(values.get('step'), '2');
  failures.read = true;
  assert.equal(settings.getVolumeStep(), 10);
});

test('failed resets retain defaults in the session and later writes persist normally', () => {
  const { settings, values, failures } = createSettingsFixture();
  assert.equal(settings.getSavedSliderThicknessPercent(), 100);
  failures.remove = true;
  settings.resetSavedSliderThicknessPercent();
  assert.equal(settings.getSavedSliderThicknessPercent(), 75);
  assert.equal(values.get('thickness'), '100');
  failures.remove = false;
  settings.setSavedSliderThicknessPercent(90);
  assert.equal(settings.getSavedSliderThicknessPercent(), 90);
  assert.equal(values.get('thickness'), '90');
  // Healthy reads still observe changes made by other tabs.
  values.set('thickness', '80');
  assert.equal(settings.getSavedSliderThicknessPercent(), 80);
});

test('temporary read failures preserve the last known settings', () => {
  const { settings, values, failures } = createSettingsFixture();
  assert.equal(settings.getVolumeStep(), 2);
  failures.read = true;
  assert.equal(settings.getVolumeStep(), 2);
  settings.setVolumeStep(5);
  assert.equal(settings.getVolumeStep(), 5);
  failures.read = false;
  values.set('step', '10');
  assert.equal(settings.getVolumeStep(), 10);
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
