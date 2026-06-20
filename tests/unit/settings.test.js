import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSettings, normalizeBooleanSetting, normalizeOpacityPercent, normalizeVolumeSliderMode } from '../../src/shared/settings.js';
import { clampVolume, snapTo5 } from '../../src/shared/volume.js';

test('saved volume parsing and clamping', () => {
  const storage = new JSDOM('', { url:'https://example.com' }).window.localStorage;
  const settings = createSettings(storage, { volume:'v', mode:'m', location:'l', replacePlacement:'p', snap:'s', expanded:'e' });
  assert.equal(settings.savedVolume, null);
  storage.setItem('v', '125px'); assert.equal(settings.savedVolume, 100);
  storage.setItem('v', '-8'); assert.equal(settings.savedVolume, 0);
  storage.setItem('v', 'nope'); assert.equal(settings.savedVolume, null);
});

test('settings defaults and boolean normalization', () => {
  assert.equal(normalizeBooleanSetting('true'), true);
  assert.equal(normalizeBooleanSetting(false), false);
  assert.equal(normalizeBooleanSetting('other'), null);
  assert.equal(normalizeVolumeSliderMode('replace-native'), 'replace-native');
  assert.equal(normalizeVolumeSliderMode('invalid'), null);
  assert.equal(normalizeOpacityPercent(120, 45), 100);
  assert.equal(normalizeOpacityPercent('invalid', 45), 45);
});

test('volume clamping and snap-to-five', () => {
  assert.equal(clampVolume(110), 100); assert.equal(clampVolume(-1), 0);
  assert.equal(snapTo5(47), 45); assert.equal(snapTo5(98), 100); assert.equal(snapTo5(0), 0);
});
