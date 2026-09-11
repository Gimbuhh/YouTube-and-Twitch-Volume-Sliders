import { normalizeVolumeStep } from './volume.js';

const MODES = ['off', 'on', 'replace-native'];
const LOCATIONS = ['controls', 'video'];
const APPEARANCES = ['new', 'classic'];

function normalizeChoice(value, choices) {
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

export function normalizeVolumeAppearance(appearance) {
  return normalizeChoice(appearance, APPEARANCES);
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

export function normalizeSliderThicknessPercent(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(125, Math.max(25, number));
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
  collapseOverlayIfIdle,
  ensureOverlay
}) {
  const sessionValues = new Map();
  const read = (key) => {
    const cached = sessionValues.get(key);
    // Unsaved choices own this session; stale storage must not revert them.
    if (cached?.unsaved) {
      return cached.value;
    }
    try {
      const value = storage.getItem(key);
      sessionValues.set(key, { value, unsaved: false });
      return value;
    } catch {
      return cached?.value ?? null;
    }
  };
  const write = (key, value) => {
    const cached = { value, unsaved: true };
    sessionValues.set(key, cached);
    try {
      if (value === null) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, value);
      }
      cached.unsaved = false;
    } catch { /* keep the choice, including resets, for this session */ }
  };
  const remove = (key) => write(key, null);
  const getOverlay = () => ensureOverlay?.() || document.getElementById(overlayId);

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

  function getVolumeAppearance() {
    return normalizeVolumeAppearance(userSettings.volumeAppearance) ||
      normalizeVolumeAppearance(read(keys.appearance)) || 'new';
  }

  function updateOverlayAppearance(overlay) {
    if (!overlay) return;
    const appearance = getVolumeAppearance();
    const classic = appearance === 'classic';
    overlay.dataset.tmAppearance = appearance;
    overlay.classList.toggle('tm-volume-appearance-classic', classic);
    overlay.classList.toggle('tm-volume-appearance-new', !classic);

    const topRow = overlay.querySelector?.('.tm-volume-top-row');
    if (topRow) topRow.style.width = classic ? '96px' : '50px';

    const arcTrack = overlay.querySelector?.('.tm-volume-arc-track');
    if (arcTrack) {
      arcTrack.setAttribute('r', classic ? '13' : '14.5');
      arcTrack.setAttribute('stroke-width', classic ? '4' : '3');
      if (classic) {
        arcTrack.setAttribute('stroke-dasharray', '100 100');
        arcTrack.setAttribute('pathLength', '100');
      } else {
        arcTrack.removeAttribute('stroke-dasharray');
        arcTrack.removeAttribute('pathLength');
      }
    }

    const arc = overlay.querySelector?.('.tm-volume-arc');
    if (arc) {
      arc.setAttribute('r', classic ? '13' : '14.5');
      arc.setAttribute('stroke-width', classic ? '4' : '3');
    }

    const label = overlay.querySelector?.('#tm-volume-slider-value');
    if (!label) return;
    Object.assign(label.style, classic ? {
      left: '36px',
      top: '50%',
      width: '58px',
      height: 'auto',
      overflow: 'visible',
      clipPath: 'none',
      transform: 'translateY(-50%)',
      whiteSpace: 'nowrap'
    } : {
      left: '0',
      top: '0',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      clipPath: 'inset(50%)',
      transform: 'none',
      whiteSpace: 'nowrap'
    });
  }

  function setVolumeAppearance(appearance) {
    write(keys.appearance, normalizeVolumeAppearance(appearance) || 'new');
    updateOverlayAppearance(getOverlay());
  }

  function setSliderLocation(location) {
    write(keys.location, normalizeSliderLocation(location) || 'controls');
    onPlacementChanged();
  }

  function setReplaceNativePlacement(placement) {
    write(keys.replacePlacement, normalizeReplaceNativePlacement(placement) || 'native');
    onPlacementChanged();
  }

  function getSavedVolumeStep() {
    const savedStep = normalizeVolumeStep(read(keys.step));
    if (savedStep) return savedStep;
    return normalizeBooleanSetting(read(keys.legacySnap)) === true ? 5 : 1;
  }

  function getVolumeStep() {
    const override = normalizeVolumeStep(userSettings.volumeStep);
    if (override) return override;
    const legacyOverride = normalizeBooleanSetting(userSettings.snapToFive);
    if (legacyOverride !== null) return legacyOverride ? 5 : 1;
    return getSavedVolumeStep();
  }

  function updateVolumeStepUi(overlay) {
    if (!overlay) return;
    const step = getVolumeStep();
    const slider = overlay.querySelector?.('#tm-volume-slider-range');
    if (slider) {
      slider.dataset.tmVolumeStep = String(step);
    }
    overlay.querySelector?.('.tm-slider-ticks')?._tmSliderTicksPopulate?.();
  }

  function setVolumeStep(step) {
    write(keys.step, String(normalizeVolumeStep(step) || 1));
    if (keys.legacySnap) remove(keys.legacySnap);
    updateVolumeStepUi(getOverlay());
  }

  function isAlwaysExpandedEnabled() {
    const override = normalizeBooleanSetting(userSettings.alwaysExpanded);
    return override ?? (read(keys.expanded) === 'true');
  }

  function setAlwaysExpandedEnabled(enabled) {
    write(keys.expanded, enabled ? 'true' : 'false');
    const overlay = getOverlay();
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
    updateOverlayOpacity(getOverlay());
  }

  function resetSavedOverlayOpacityPercent(focused) {
    remove(focused ? keys.activeOpacity : keys.idleOpacity);
    updateOverlayOpacity(getOverlay());
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
    syncOverlayTicks(overlay);
    overlay.ownerDocument?.defaultView?.requestAnimationFrame?.(() => {
      syncOverlayTicks(overlay);
    });
  }

  function syncOverlayTicks(overlay) {
    overlay?.querySelector?.('.tm-slider-ticks')?._tmSliderTicksSync?.();
  }

  function setSavedOverlaySizePercent(value) {
    write(keys.overlaySize, String(normalizeOverlaySizePercent(value, defaults.overlaySize)));
    updateOverlaySize(getOverlay());
  }

  function resetSavedOverlaySizePercent() {
    remove(keys.overlaySize);
    updateOverlaySize(getOverlay());
  }

  function getSavedSliderThicknessPercent() {
    if (userSettings.sliderThickness !== 'saved') {
      return normalizeSliderThicknessPercent(userSettings.sliderThickness, defaults.sliderThickness);
    }
    return normalizeSliderThicknessPercent(read(keys.sliderThickness), defaults.sliderThickness);
  }

  function updateSliderThickness(overlay) {
    if (!overlay) return;
    const pct = getSavedSliderThicknessPercent();
    const trackPx = pct * 0.11;
    const thumbPx = Math.min(28, Math.max(14, trackPx * 2));
    const thickness = `${trackPx.toFixed(2)}px`;
    const thumbSize = `${thumbPx.toFixed(2)}px`;
    overlay.style.setProperty('--tm-visual-track-h', thickness);
    overlay.style.setProperty('--tm-thumb-size', thumbSize);
    overlay.querySelectorAll?.('.tm-volume-slider-row')
      .forEach((row) => {
        row.style.setProperty('--tm-visual-track-h', thickness);
        row.style.setProperty('--tm-thumb-size', thumbSize);
      });
    syncOverlayTicks(overlay);
  }

  function restoreOverlayPreview(overlay) {
    if (!overlay) return;
    delete overlay.dataset.tmOptionsPreview;
    if (isAlwaysExpandedEnabled()) setOverlayExpanded(overlay, true, true);
    else collapseOverlayIfIdle(overlay, true);
    updateOverlayOpacity(overlay);
  }

  function setSavedSliderThicknessPercent(value) {
    write(keys.sliderThickness, String(normalizeSliderThicknessPercent(value, defaults.sliderThickness)));
    updateSliderThickness(getOverlay());
  }

  function resetSavedSliderThicknessPercent() {
    remove(keys.sliderThickness);
    updateSliderThickness(getOverlay());
  }

  function beginThicknessSliderPreview() {
    const overlay = getOverlay();
    if (!overlay || isAlwaysExpandedEnabled()) return;
    overlay.dataset.tmOptionsPreview = 'thickness';
    clearExpandedHold(overlay);
    setOverlayExpanded(overlay, true, true);
    updateOverlayOpacity(overlay);
  }

  function endThicknessSliderPreview() {
    const overlay = document.getElementById(overlayId);
    if (overlay?.dataset.tmOptionsPreview !== 'thickness') return;
    restoreOverlayPreview(overlay);
  }

  function beginOpacitySliderPreview(focused) {
    const overlay = getOverlay();
    if (!overlay) return;
    overlay.dataset.tmOptionsPreview = focused ? 'opacity-active' : 'opacity-idle';
    clearExpandedHold(overlay);
    setOverlayExpanded(overlay, focused, true, focused ? {} : { ignoreAlwaysExpanded: true });
    updateOverlayOpacity(overlay);
  }

  function endOpacitySliderPreview() {
    const overlay = document.getElementById(overlayId);
    if (!overlay?.dataset.tmOptionsPreview?.startsWith('opacity-')) return;
    restoreOverlayPreview(overlay);
  }

  function isOverlayInteractionFocused(overlay) {
    return overlay?.dataset.tmOptionsPreview === 'thickness' ||
      overlay?.dataset.tmOptionsPreview === 'opacity-active' ||
      overlay?.dataset.tmDragging === 'true' ||
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
    getVolumeSliderMode, getReplaceNativePlacement,
    isSliderOnVideo, setSliderLocation, setReplaceNativePlacement, getVolumeAppearance, setVolumeAppearance,
    updateOverlayAppearance, getVolumeStep, setVolumeStep,
    isAlwaysExpandedEnabled, setAlwaysExpandedEnabled,
    getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent,
    getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent,
    getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent,
    beginThicknessSliderPreview, endThicknessSliderPreview, beginOpacitySliderPreview, endOpacitySliderPreview,
    updateSliderThickness, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode,
    isOverlayEnabled, isNativeVolumeReplacementEnabled, shouldUseNativeReplacementSlot
  };
}
