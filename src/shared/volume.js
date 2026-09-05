export const clampVolume = (value) => Math.min(100, Math.max(0, Number(value) || 0));
export const VOLUME_STEPS = [1, 2, 5, 10];

export function normalizeVolumeStep(value) {
  const step = Number(value);
  return VOLUME_STEPS.includes(step) ? step : null;
}

export function snapToStep(value, step) {
  const normalizedStep = normalizeVolumeStep(step) || 1;
  return clampVolume(Math.round(clampVolume(value) / normalizedStep) * normalizedStep);
}

export function stepVolume(value, direction, step) {
  const current = clampVolume(value);
  const normalizedStep = normalizeVolumeStep(step) || 1;
  if (direction > 0) {
    return clampVolume((Math.floor(current / normalizedStep) + 1) * normalizedStep);
  }
  if (direction < 0) {
    return clampVolume((Math.ceil(current / normalizedStep) - 1) * normalizedStep);
  }
  return current;
}

export function getVolumeTickInterval(step) {
  const normalizedStep = normalizeVolumeStep(step) || 1;
  // A tick for every 1% stop becomes a solid-looking stripe on compact sliders.
  // All coarser modes can show every valid snapped position without losing clarity.
  return normalizedStep === 1 ? 10 : normalizedStep;
}

export function createVolumePersistence({ window, storage, storageKey, debounceMs, getVolumeStep }) {
  let saveTimer = 0;

  function getSavedVolume() {
    try {
      const saved = storage.getItem(storageKey);
      if (saved === null) return null;
      const value = Math.min(100, Math.max(0, Number.parseInt(saved, 10)));
      return Number.isNaN(value) ? null : value;
    } catch {
      return null;
    }
  }

  function readSteppedSliderValue(slider) {
    const value = snapToStep(slider.value, getVolumeStep());
    slider.value = String(value);
    return value;
  }

  function saveVolume(value) {
    try { storage.setItem(storageKey, String(Math.round(value))); } catch { /* storage may be unavailable */ }
  }

  function cancelScheduledSaveVolume() {
    if (!saveTimer) return;
    window.clearTimeout(saveTimer);
    saveTimer = 0;
  }

  function scheduleSaveVolume(value) {
    cancelScheduledSaveVolume();
    saveTimer = window.setTimeout(() => {
      saveVolume(value);
      saveTimer = 0;
    }, debounceMs);
  }

  return { getSavedVolume, readSteppedSliderValue, saveVolume, scheduleSaveVolume, cancelScheduledSaveVolume };
}
