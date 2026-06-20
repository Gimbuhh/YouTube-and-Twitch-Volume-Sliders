export const clampVolume = (value) => Math.min(100, Math.max(0, Number(value) || 0));
export const snapTo5 = (value) => Math.round(clampVolume(value) / 5) * 5;

export function getSpeakerIconMode(value, muted) {
  const percent = clampVolume(value);
  if (muted || percent === 0) return 'muted';
  return percent <= 50 ? 'low' : 'high';
}

export function restoreSavedVolume(platform, video, settings) {
  const value = settings.savedVolume;
  if (value !== null) platform.restoreVolume(video, value);
  if (settings.savedMute !== null) platform.setMuted(video, settings.savedMute);
  return value;
}

export function setVolumeFromUser(platform, video, settings, value) {
  const next = clampVolume(value);
  platform.setVolumeFromUser(video, next);
  settings.saveVolume(next);
  if (settings.savedMute !== null) settings.saveMute(false);
  return next;
}

export function createVolumePersistence({ window, storage, storageKey, debounceMs, isSnapEnabled }) {
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

  function readSnappedSliderValue(slider) {
    let value = Number(slider.value) || 0;
    if (isSnapEnabled()) {
      value = snapTo5(value);
      slider.value = String(value);
    }
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

  return { getSavedVolume, readSnappedSliderValue, saveVolume, scheduleSaveVolume, cancelScheduledSaveVolume };
}
