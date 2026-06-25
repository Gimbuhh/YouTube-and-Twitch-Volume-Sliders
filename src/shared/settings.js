export const MODES = ['off', 'on', 'replace-native'];
export const LOCATIONS = ['controls', 'video'];

export function normalizeChoice(value, choices) {
  return choices.includes(value) ? value : null;
}

export function normalizeBooleanSetting(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

export function normalizeVolumeSliderMode(mode) {
  return normalizeChoice(mode, MODES);
}

export function normalizeReplaceNativePlacement(placement) {
  return normalizeChoice(placement, ['native', 'custom']);
}

export function normalizeSliderLocation(location) {
  return normalizeChoice(location, LOCATIONS);
}

export function normalizeOpacityPercent(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, number));
}

export function normalizeOverlaySizePercent(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(200, Math.max(100, number));
}

export function createSettings(storage, keys) {
  const read = (key) => { try { return storage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { storage.setItem(key, value); } catch { /* storage may be unavailable */ } };
  return {
    get mode() { return normalizeChoice(read(keys.mode), MODES) ?? 'on'; },
    set mode(value) { write(keys.mode, normalizeChoice(value, MODES) ?? 'on'); },
    get location() { return normalizeChoice(read(keys.location), LOCATIONS) ?? 'controls'; },
    set location(value) { write(keys.location, normalizeChoice(value, LOCATIONS) ?? 'controls'); },
    get replacePlacement() { return normalizeChoice(read(keys.replacePlacement), ['native', 'custom']) ?? 'native'; },
    set replacePlacement(value) { write(keys.replacePlacement, normalizeChoice(value, ['native', 'custom']) ?? 'native'); },
    get snapToFive() { return normalizeBooleanSetting(read(keys.snap)) ?? false; },
    set snapToFive(value) { write(keys.snap, value ? 'true' : 'false'); },
    get alwaysExpanded() { return normalizeBooleanSetting(read(keys.expanded)) ?? false; },
    set alwaysExpanded(value) { write(keys.expanded, value ? 'true' : 'false'); },
    get savedVolume() {
      const raw = read(keys.volume);
      if (raw === null) return null;
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? null : Math.min(100, Math.max(0, parsed));
    },
    saveVolume(value) { write(keys.volume, String(Math.round(Math.min(100, Math.max(0, value))))); },
    get savedMute() {
      if (!keys.mute) return null;
      return normalizeBooleanSetting(read(keys.mute));
    },
    saveMute(value) { if (keys.mute) write(keys.mute, value ? 'true' : 'false'); }
  };
}

export function createVolumeSettings({
  document,
  storage,
  userSettings,
  keys,
  defaults,
  overlayId,
  onPlacementChanged,
  onModeChanged,
  clearExpandedHold,
  setOverlayExpanded,
  collapseOverlayIfIdle
}) {
  const read = (key) => { try { return storage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { storage.setItem(key, value); } catch { /* storage may be unavailable */ } };
  const remove = (key) => { try { storage.removeItem(key); } catch { /* storage may be unavailable */ } };

  function getSavedVolumeSliderMode() {
    return normalizeVolumeSliderMode(read(keys.mode)) || 'on';
  }

  function getVolumeSliderMode() {
    return normalizeVolumeSliderMode(userSettings.volumeSliderMode) || getSavedVolumeSliderMode();
  }

  function getReplaceNativePlacement() {
    return normalizeReplaceNativePlacement(userSettings.replaceNativePlacement) ||
      normalizeReplaceNativePlacement(read(keys.replacePlacement)) || 'native';
  }

  function getSliderLocation() {
    return normalizeSliderLocation(userSettings.sliderLocation) ||
      normalizeSliderLocation(read(keys.location)) || 'controls';
  }

  const isSliderOnVideo = () => getSliderLocation() === 'video';

  function setSliderLocation(location) {
    write(keys.location, normalizeSliderLocation(location) || 'controls');
    onPlacementChanged();
  }

  function setReplaceNativePlacement(placement) {
    write(keys.replacePlacement, normalizeReplaceNativePlacement(placement) || 'native');
    onPlacementChanged();
  }

  function isSnapTo5Enabled() {
    const override = normalizeBooleanSetting(userSettings.snapToFive);
    return override ?? (read(keys.snap) === 'true');
  }

  const setSnapTo5Enabled = (enabled) => write(keys.snap, enabled ? 'true' : 'false');

  function isAlwaysExpandedEnabled() {
    const override = normalizeBooleanSetting(userSettings.alwaysExpanded);
    return override ?? (read(keys.expanded) === 'true');
  }

  function setAlwaysExpandedEnabled(enabled) {
    write(keys.expanded, enabled ? 'true' : 'false');
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;
    clearExpandedHold(overlay);
    if (enabled) setOverlayExpanded(overlay, true);
    else collapseOverlayIfIdle(overlay, true);
  }

  function getSavedOverlayOpacityPercent(focused) {
    const fallback = focused ? defaults.activeOpacity : defaults.idleOpacity;
    const setting = focused ? userSettings.overlayOpacityFocused : userSettings.overlayOpacityUnfocused;
    if (setting !== 'saved') return normalizeOpacityPercent(setting, fallback);
    return normalizeOpacityPercent(read(focused ? keys.activeOpacity : keys.idleOpacity), fallback);
  }

  function updateOverlayOpacity(overlay) {
    if (!overlay) return;
    overlay.style.opacity = isSliderOnVideo()
      ? String(getSavedOverlayOpacityPercent(isOverlayInteractionFocused(overlay)) / 100)
      : '1';
    updateOverlaySize(overlay);
  }

  function setSavedOverlayOpacityPercent(focused, value) {
    const fallback = focused ? defaults.activeOpacity : defaults.idleOpacity;
    write(focused ? keys.activeOpacity : keys.idleOpacity, String(normalizeOpacityPercent(value, fallback)));
    updateOverlayOpacity(document.getElementById(overlayId));
  }

  function resetSavedOverlayOpacityPercent(focused) {
    remove(focused ? keys.activeOpacity : keys.idleOpacity);
    updateOverlayOpacity(document.getElementById(overlayId));
  }

  function getSavedOverlaySizePercent() {
    if (userSettings.overlaySize !== 'saved') {
      return normalizeOverlaySizePercent(userSettings.overlaySize, defaults.overlaySize);
    }
    return normalizeOverlaySizePercent(read(keys.overlaySize), defaults.overlaySize);
  }

  function updateOverlaySize(overlay) {
    if (!overlay) return;
    const scale = isSliderOnVideo() ? getSavedOverlaySizePercent() / 100 : 1;
    overlay.style.setProperty('--tm-overlay-scale', String(scale));
  }

  function setSavedOverlaySizePercent(value) {
    write(keys.overlaySize, String(normalizeOverlaySizePercent(value, defaults.overlaySize)));
    updateOverlaySize(document.getElementById(overlayId));
  }

  function resetSavedOverlaySizePercent() {
    remove(keys.overlaySize);
    updateOverlaySize(document.getElementById(overlayId));
  }

  function isOverlayInteractionFocused(overlay) {
    return overlay?.dataset.tmDragging === 'true' ||
      overlay?.dataset.tmHovering === 'true' ||
      overlay?.matches?.(':hover') ||
      overlay?.contains?.(document.activeElement);
  }

  function setVolumeSliderMode(mode) {
    const normalizedMode = normalizeVolumeSliderMode(mode) || 'on';
    write(keys.mode, normalizedMode);
    onModeChanged(normalizedMode);
  }

  const isOverlayEnabled = () => getVolumeSliderMode() !== 'off';
  const isNativeVolumeReplacementEnabled = () => getVolumeSliderMode() === 'replace-native';
  const shouldUseNativeReplacementSlot = () => isNativeVolumeReplacementEnabled() && getReplaceNativePlacement() === 'native';

  return {
    getSavedVolumeSliderMode, getVolumeSliderMode, getReplaceNativePlacement, getSliderLocation,
    isSliderOnVideo, setSliderLocation, setReplaceNativePlacement, isSnapTo5Enabled,
    setSnapTo5Enabled, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled,
    getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent,
    getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent,
    updateOverlaySize, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode,
    isOverlayEnabled, isNativeVolumeReplacementEnabled, shouldUseNativeReplacementSlot
  };
}
