import { createOverlayUi } from '../shared/overlay-ui.js';
import { createOptionsUi } from '../shared/options-ui.js';
import { createVolumeSettings } from '../shared/settings.js';
import { createVolumePersistence, getSpeakerIconMode, snapTo5 } from '../shared/volume.js';
import { createOptionsButtonIconSvg, getOptionsPopupFocusable } from '../shared/options.js';
import { createOverlayLifecycle, createVideoLocator } from '../shared/lifecycle.js';
import { createStyleElement } from '../shared/styles.js';

export function startYouTubeVolumeSlider() {
    'use strict';

    const OVERLAY_ID = 'tm-volume-slider-overlay';
    const SLIDER_ID = 'tm-volume-slider-range';
    const VALUE_LABEL_ID = 'tm-volume-slider-value';
    const OPTIONS_STYLE_ID = 'tm-volume-options-style';
    const OPTIONS_BUTTON_ID = 'tm-volume-options-button';
    const OPTIONS_POPUP_ID = 'tm-volume-options-popup';
    const STORAGE_KEY = 'tm-yt-volume';
    const VOLUME_MODE_KEY = 'tm-yt-volume-slider-mode';
    const SLIDER_LOCATION_KEY = 'tm-yt-volume-slider-location';
    const REPLACE_NATIVE_PLACEMENT_KEY = 'tm-yt-volume-slider-replace-placement';
    const SNAP_TO_5_KEY = 'tm-yt-volume-slider-snap-to-5';
    const ALWAYS_EXPANDED_KEY = 'tm-yt-volume-slider-always-expanded';
    const OVERLAY_OPACITY_IDLE_KEY = 'tm-yt-volume-slider-opacity-idle';
    const OVERLAY_OPACITY_ACTIVE_KEY = 'tm-yt-volume-slider-opacity-active';
    const OVERLAY_SIZE_KEY = 'tm-yt-volume-slider-size';
    const SLIDER_THICKNESS_KEY = 'tm-yt-volume-slider-thickness';
    const DEFAULT_OVERLAY_OPACITY_IDLE = 45;
    const DEFAULT_OVERLAY_OPACITY_ACTIVE = 95;
    const DEFAULT_OVERLAY_SIZE = 100;
    const DEFAULT_SLIDER_THICKNESS = 75;
    const STORAGE_WRITE_DEBOUNCE_MS = 150;
    const VOLUME_CHANGE_EXPANDED_HOLD_MS = 1200;
    const NAV_REATTACH_DELAY_MS = 700;
    const NAV_DEBOUNCE_MS = 180;
    const ON_VIDEO_IDLE_BOTTOM_PX = 12;
    const ON_VIDEO_MAX_CONTROLS_OFFSET_PX = 140;
    const VOLUME_ACCENT_LIGHT = '#cc4444';
    const VOLUME_ACCENT_DARK = '#bb3333';
    const VOLUME_ACCENT_MID = '#cc5555';
    const VOLUME_ACCENT_DISABLED = 'rgba(187, 51, 51, 0.55)';
    const VOLUME_ARC_TRACK = 'rgba(255, 255, 255, 0.38)';
    const VOLUME_PANEL_DROP_SHADOW = 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.06))';
    const USER_SETTINGS = {
        // Volume slider mode: 'saved', 'off', 'on', or 'replace-native'. Default: 'saved'
        volumeSliderMode: 'saved',
        // Slider location: 'saved', 'controls', or 'video'. Default: 'saved'
        sliderLocation: 'saved',
        // Replace-native placement: 'saved', 'native', or 'custom'. Default: 'saved'
        replaceNativePlacement: 'saved',
        // Snap slider movement to 5% steps: 'saved', true, or false. Default: 'saved'
        snapToFive: 'saved',
        // Keep the volume pill expanded: 'saved', true, or false. Default: 'saved'
        alwaysExpanded: 'saved',
        // On-video slider opacity when unfocused: 'saved' or 0-100 as a percentage. Default: 45
        overlayOpacityUnfocused: 'saved',
        // On-video slider opacity when focused/hovered: 'saved' or 0-100 as a percentage. Default: 95
        overlayOpacityFocused: 'saved',
        // On-video slider size: 'saved' or 100-200 as a percentage. Default: 100
        overlaySize: 'saved',
        // Bar thickness: 'saved' or 25-125 as a percentage of the 2.5 bar. Default: 75
        sliderThickness: 'saved'
    };

    let cachedYtPlayer = null;
    let navReattachTimer = 0;
    let navDebounceTimer = 0;
    let attachObserver = null;
    let attachObserverTarget = null;
    let attachBootstrapObserver = null;
    let playerControlsObserver = null;
    let playerControlsObserverTarget = null;
    const overlayLifecycle = createOverlayLifecycle();
    const { getVideoElement, resetVideoElement, ensurePlayerPositioning } = createVideoLocator(document, window);

    // -------------------------------
    // Overlay + Options State
    // -------------------------------





    const { getSavedVolumeSliderMode, getVolumeSliderMode, getReplaceNativePlacement, getSliderLocation, isSliderOnVideo, setSliderLocation, setReplaceNativePlacement, isSnapTo5Enabled, setSnapTo5Enabled, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled, getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent, getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent, getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent, beginThicknessSliderPreview, endThicknessSliderPreview, beginOpacitySliderPreview, endOpacitySliderPreview, updateOverlaySize, updateSliderThickness, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode, isOverlayEnabled, isNativeVolumeReplacementEnabled, shouldUseNativeReplacementSlot } = createVolumeSettings({
        document, storage: localStorage, userSettings: USER_SETTINGS, overlayId: OVERLAY_ID,
        keys: { mode: VOLUME_MODE_KEY, location: SLIDER_LOCATION_KEY, replacePlacement: REPLACE_NATIVE_PLACEMENT_KEY, snap: SNAP_TO_5_KEY, expanded: ALWAYS_EXPANDED_KEY, idleOpacity: OVERLAY_OPACITY_IDLE_KEY, activeOpacity: OVERLAY_OPACITY_ACTIVE_KEY, overlaySize: OVERLAY_SIZE_KEY, sliderThickness: SLIDER_THICKNESS_KEY },
        defaults: { idleOpacity: DEFAULT_OVERLAY_OPACITY_IDLE, activeOpacity: DEFAULT_OVERLAY_OPACITY_ACTIVE, overlaySize: DEFAULT_OVERLAY_SIZE, sliderThickness: DEFAULT_SLIDER_THICKNESS },
        onPlacementChanged: () => { attachSliderIfPossible(); applyNativeVolumeVisibility(); },
        onModeChanged: (mode) => { if (mode === 'off') removeOverlay(); else attachSliderIfPossible(); applyNativeVolumeVisibility(); injectVolumeOptionsButton(); refreshOptionsPopupState(); updateOptionsButtonState(); },
        clearExpandedHold: (overlay) => clearExpandedHold(overlay),
        setOverlayExpanded: (overlay, expanded, force, options) => setOverlayExpanded(overlay, expanded, force, options),
        collapseOverlayIfIdle: (overlay, force) => collapseOverlayIfIdle(overlay, force),
        ensureOverlay: () => {
            attachSliderIfPossible();
            return document.getElementById(OVERLAY_ID);
        }
    });
    const { getSavedVolume, readSnappedSliderValue, saveVolume, scheduleSaveVolume, cancelScheduledSaveVolume } = createVolumePersistence({
        window, storage: localStorage, storageKey: STORAGE_KEY, debounceMs: STORAGE_WRITE_DEBOUNCE_MS,
        isSnapEnabled: () => isSnapTo5Enabled()
    });




















    /**
     * Check if the volume slider is enabled (not in Off mode).
     */



    function applyNativeVolumeVisibility() {
        const shouldHideNative = isOverlayEnabled() && isNativeVolumeReplacementEnabled();
        document.querySelectorAll('.ytp-volume-area').forEach((area) => {
            const nextDisplay = shouldHideNative ? 'none' : '';
            if (area.style.display !== nextDisplay) {
                area.style.display = nextDisplay;
            }
        });

        if (shouldHideNative) {
            const overlay = document.getElementById(OVERLAY_ID);
            const player = getPlayerContainer();
            const controlsHost = getYouTubeControlsHost(player);
            if (overlay && player) {
                placeOverlay(overlay, player, controlsHost);
            }
        }
    }

    /**
     * Ensure we always get the active HTMLVideoElement.
     */
    /**
     * Find a suitable container to host the overlay.
     */
    function getPlayerContainer(video = getVideoElement()) {
        const moviePlayer = document.getElementById('movie_player');
        if (moviePlayer) {
            return moviePlayer;
        }
        return video ? video.parentElement : null;
    }

    function getYouTubeControlsHost(player) {
        if (!player) return null;
        return player.querySelector('.ytp-left-controls') || document.querySelector('.ytp-left-controls');
    }

    function getNativeVolumeArea(controlsHost) {
        return controlsHost?.querySelector?.('.ytp-volume-area') || document.querySelector('.ytp-volume-area');
    }

    function positionOverlayAboveScrubber(overlay, player) {
        const progressBar = document.querySelector('.ytp-progress-bar-padding');
        const barEl = progressBar ? (progressBar.closest('.ytp-progress-bar') || progressBar.parentElement) : null;
        const ref = barEl || progressBar;
        if (!overlay || !player || !ref) {
            if (overlay) overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
            return;
        }

        const playerRect = player.getBoundingClientRect();
        const barRect = ref.getBoundingClientRect();
        const hasUsableBarRect =
            barRect.width > 0 &&
            barRect.height > 0 &&
            barRect.top >= playerRect.top &&
            barRect.top < playerRect.bottom;
        if (!hasUsableBarRect) {
            overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
            return;
        }
        const bottomPx = playerRect.bottom - barRect.top + 8;
        const safeBottomPx = Math.min(Math.max(20, bottomPx), ON_VIDEO_MAX_CONTROLS_OFFSET_PX);
        overlay.style.bottom = `${safeBottomPx}px`;
    }

    function updateVideoOverlayPosition(overlay, player) {
        if (!overlay || !player || !isSliderOnVideo()) return;
        if (player.classList.contains('ytp-autohide')) {
            overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
            return;
        }
        positionOverlayAboveScrubber(overlay, player);
    }

    function placeOverlayInControls(overlay, controlsHost) {
        if (!overlay || !controlsHost) return;
        const nativeVolumeArea = getNativeVolumeArea(controlsHost);
        if (shouldUseNativeReplacementSlot() && nativeVolumeArea && nativeVolumeArea.parentElement === controlsHost) {
            if (overlay.parentElement !== controlsHost || overlay.nextElementSibling !== nativeVolumeArea) {
                controlsHost.insertBefore(overlay, nativeVolumeArea);
            }
        } else if (overlay.parentElement !== controlsHost || overlay.nextElementSibling) {
            controlsHost.appendChild(overlay);
        }
    }

    function placeOverlay(overlay, player, controlsHost) {
        if (!overlay || !player) return;

        if (isSliderOnVideo()) {
            ensurePlayerPositioning(player);
            if (overlay.parentElement !== player) {
                player.appendChild(overlay);
            }
            updateVideoOverlayPosition(overlay, player);
        } else if (controlsHost) {
            placeOverlayInControls(overlay, controlsHost);
            overlay.style.bottom = '';
        }

        const expanded = overlay.classList.contains('tm-expanded') || isAlwaysExpandedEnabled();
        setOverlayExpanded(overlay, expanded, true);
        updateOverlayOpacity(overlay);
    }

    function createStylesIfNeeded() {
        const style = createStyleElement(document, 'tm-volume-slider-style');
        if (!style) return;
        const css = `
#${OVERLAY_ID} {
  --tm-pill-expanded-width: clamp(320px, 34vw, 460px);
  filter: ${VOLUME_PANEL_DROP_SHADOW};
}

#${OVERLAY_ID} input[type=range] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  height: 42px;
  border: none;
  border-radius: 999px;
  box-sizing: border-box;
  outline: none;
  position: relative;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  z-index: 2;
  overflow: visible;
}

#${OVERLAY_ID} input[type=range]::-webkit-slider-runnable-track {
  border: none;
  background: transparent;
  height: var(--tm-active-track-h, 9px);
  border-radius: var(--tm-track-radius);
}

#${OVERLAY_ID} input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: var(--tm-thumb-size);
  height: var(--tm-thumb-size);
  border-radius: 50%;
  background: linear-gradient(145deg, #ffffff, #f0f0f0);
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  margin-top: calc((var(--tm-active-track-h, 9px) - var(--tm-thumb-size, 22px)) / 2);
}

#${OVERLAY_ID} input[type=range]::-webkit-slider-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

#${OVERLAY_ID} input[type=range]::-webkit-slider-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

#${OVERLAY_ID} input[type=range]::-moz-range-thumb {
  width: var(--tm-thumb-size);
  height: var(--tm-thumb-size);
  border-radius: 50%;
  background: linear-gradient(145deg, #ffffff, #f0f0f0);
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

#${OVERLAY_ID} input[type=range]::-moz-range-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

#${OVERLAY_ID} input[type=range]::-moz-range-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

#${OVERLAY_ID} input[type=range]::-moz-range-track {
  background: transparent;
  height: var(--tm-active-track-h, 9px);
  border-radius: var(--tm-track-radius);
  border: none;
  outline: none;
}

#${OVERLAY_ID} input[type=range]::-moz-range-progress {
  background: transparent;
  border: none;
}

#${OVERLAY_ID} input[type=range]::-moz-focus-outer {
  border: none;
  outline: none;
}

#${OVERLAY_ID} .tm-volume-panel-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  border: none;
  background: rgba(8, 13, 15, 0.34);
  box-sizing: border-box;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  opacity: 1;
  pointer-events: none;
  transform: none;
  transition: none;
}

#${OVERLAY_ID} .tm-volume-icon-cell {
  position: absolute;
  left: 0;
  top: 0;
  width: 40px;
  height: 40px;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  opacity: 1;
  transition: opacity 0.1s ease;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

#${OVERLAY_ID} .tm-volume-icon-cell:focus-visible {
  outline: 2px solid #fff;
  outline-offset: -4px;
  border-radius: 50%;
}

#${OVERLAY_ID} .tm-volume-indicator {
  position: relative;
  width: 40px;
  height: 40px;
  opacity: 1;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

#${OVERLAY_ID} .tm-volume-indicator svg {
  display: block;
  width: 40px;
  height: 40px;
  shape-rendering: geometricPrecision;
}

#${OVERLAY_ID} .tm-volume-arc {
  stroke-linecap: round;
  transition: stroke-dasharray 0.08s linear;
}

#${OVERLAY_ID} .tm-volume-speaker-icon {
  color: rgba(255, 255, 255, 0.94);
}

#${OVERLAY_ID} .tm-volume-speaker-muted,
#${OVERLAY_ID} .tm-volume-speaker-low,
#${OVERLAY_ID} .tm-volume-speaker-high {
  display: none;
}

#${OVERLAY_ID} .tm-volume-indicator[data-volume-icon="muted"] .tm-volume-speaker-muted,
#${OVERLAY_ID} .tm-volume-indicator[data-volume-icon="low"] .tm-volume-speaker-low,
#${OVERLAY_ID} .tm-volume-indicator[data-volume-icon="high"] .tm-volume-speaker-high {
  display: block;
}

#${OVERLAY_ID} .tm-volume-indicator.muted {
  filter: saturate(0.45);
  opacity: 0.78;
}

#${OVERLAY_ID} .tm-volume-controls {
  position: relative;
  z-index: 2;
}

#${OVERLAY_ID}.tm-collapsed .tm-volume-controls {
  pointer-events: none;
}

#${OVERLAY_ID}.tm-expanded .tm-volume-controls {
  pointer-events: auto;
}

#${OVERLAY_ID} .tm-volume-top-row {
  flex: 0 0 auto;
  position: relative;
  width: 92px;
  height: 40px;
  box-sizing: border-box;
  pointer-events: none !important;
}

#${OVERLAY_ID} #${VALUE_LABEL_ID} {
  position: absolute;
  left: 42px;
  top: 50%;
  width: 46px;
  height: 28px;
  transform: translateY(-50%);
  white-space: nowrap;
  font: 400 14px/16px "YouTube Noto", Roboto, Arial, sans-serif;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  user-select: none;
  letter-spacing: 0;
}

#${OVERLAY_ID} .tm-volume-slider-row {
  --tm-active-track-h: 11px;
  --tm-visual-track-h: 5px;
  --tm-thumb-size: 22px;
  --tm-track-radius: calc(var(--tm-visual-track-h, 5px) / 2);
  flex: 0 0 calc(var(--tm-pill-expanded-width) - 104px);
  width: calc(var(--tm-pill-expanded-width) - 104px);
  min-width: 0;
  height: 40px;
}

#${OVERLAY_ID} .tm-slider-track {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  height: var(--tm-visual-track-h, 5px);
  border-radius: 999px;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

#${OVERLAY_ID} .tm-slider-ticks {
  position: absolute;
  left: calc(var(--tm-thumb-size, 22px) / 2);
  right: calc(var(--tm-thumb-size, 22px) / 2);
  top: 50%;
  transform: translateY(-50%);
  height: var(--tm-visual-track-h, 5px);
  pointer-events: none;
  background: repeating-linear-gradient(to right, rgba(255,255,255,0.25) 0px, transparent 1px, transparent calc(5% - 1px), rgba(255,255,255,0.25) 5%);
  background-size: 100% 100%;
  opacity: 0;
  transition: none;
  z-index: 1;
}
#${OVERLAY_ID}.tm-expanded .tm-slider-ticks {
  opacity: 1;
  transition: opacity 0.12s ease 0.08s;
}

        `;
        style.textContent = css;
    }

    const { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHoldTimer, clearExpandedHold, scheduleExpandedHoldRelease, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg } = createOverlayUi({
        document, window, getSpeakerIconMode, isAlwaysExpandedEnabled, isSliderOnVideo,
        updateOverlayOpacity, updateOverlaySize, finishExpandedHoldIfDue,
        accentLight: VOLUME_ACCENT_LIGHT, accentDark: VOLUME_ACCENT_DARK, accentMid: VOLUME_ACCENT_MID,
        arcTrack: VOLUME_ARC_TRACK, expandedHoldMs: VOLUME_CHANGE_EXPANDED_HOLD_MS
    });





    function areYouTubeControlsHidden() {
        const player = getPlayerContainer();
        return !!player?.classList?.contains('ytp-autohide') ||
            !!player?.classList?.contains('ytp-hide-controls');
    }



    function finishExpandedHoldIfDue(overlay) {
        if (!overlay?.isConnected) {
            clearExpandedHold(overlay);
            return;
        }
        if (isAlwaysExpandedEnabled() || shouldKeepOverlayExpanded(overlay)) {
            return;
        }
        if (Date.now() < (overlay._expandedHoldUntil || 0)) {
            scheduleExpandedHoldRelease(overlay);
            return;
        }
        clearExpandedHold(overlay);
        if (areYouTubeControlsHidden()) {
            setOverlayExpanded(overlay, false);
            return;
        }
        collapseOverlayIfIdle(overlay, true);
    }



    function collapseOverlayIfIdle(overlay, force = false) {
        window.setTimeout(() => {
            if (isAlwaysExpandedEnabled()) {
                setOverlayExpanded(overlay, true);
                return;
            }
            if (overlay.dataset.tmKeepExpanded === 'true' && !areYouTubeControlsHidden()) {
                return;
            }
            if (overlay.dataset.tmKeepExpanded === 'true') {
                clearExpandedHold(overlay);
            }
            if (force || !shouldKeepOverlayExpanded(overlay)) {
                setOverlayExpanded(overlay, false);
            }
        }, 0);
    }

    /**
     * Get the YouTube player API object if available.
     */
    function getYouTubePlayer() {
        if (cachedYtPlayer && cachedYtPlayer.isConnected && typeof cachedYtPlayer.getVolume === 'function') {
            return cachedYtPlayer;
        }
        const player = document.getElementById('movie_player');
        if (player && typeof player.getVolume === 'function') {
            cachedYtPlayer = player;
            return player;
        }
        cachedYtPlayer = null;
        return null;
    }

    /**
     * Get volume from YouTube's player API (0-100), falling back to video element.
     */
    function getVolume(video) {
        const ytPlayer = getYouTubePlayer();
        if (ytPlayer) {
            const isMuted = ytPlayer.isMuted();
            if (isMuted) {
                return 0;
            }
            return ytPlayer.getVolume();
        }
        // Fallback to video element
        const vol = (video.muted ? 0 : video.volume) || 0;
        return Math.round(vol * 100);
    }

    /**
     * Check muted state via YouTube API or video element.
     */
    function isMuted(video) {
        const ytPlayer = getYouTubePlayer();
        if (ytPlayer && typeof ytPlayer.isMuted === 'function') {
            return ytPlayer.isMuted();
        }
        return !!video.muted;
    }

    /**
     * Toggle mute via YouTube API or video element.
     */
    function toggleMute(video) {
        const ytPlayer = getYouTubePlayer();
        if (ytPlayer) {
            if (ytPlayer.isMuted()) {
                ytPlayer.unMute();
            } else {
                ytPlayer.mute();
            }
        } else {
            video.muted = !video.muted;
        }
    }

    /**
     * Set volume using YouTube's player API (0-100), falling back to video element.
     */
    function setVolume(video, value) {
        const ytPlayer = getYouTubePlayer();
        if (ytPlayer) {
            if (ytPlayer.isMuted()) {
                ytPlayer.unMute();
            }
            ytPlayer.setVolume(value);
        } else {
            // Fallback to video element
            video.volume = value / 100;
            video.muted = false;
        }
    }

    /**
     * Read saved volume from localStorage. Returns 0-100 or null.
     */

    /**
     * Restore volume from localStorage and apply to player. Call before syncing slider.
     */
    function restoreSavedVolume(video) {
        const value = getSavedVolume();
        if (value !== null) {
            const wasMuted = isMuted(video);
            setVolume(video, value);
            if (wasMuted && !isMuted(video)) {
                const ytPlayer = getYouTubePlayer();
                if (ytPlayer) ytPlayer.mute();
                else video.muted = true;
            }
        }
    }

    /**
     * Snap value to nearest 5% (5, 10, 15, ... 100).
     */


    /**
     * Save volume to localStorage for persistence across page reloads.
     */


    /**
     * Sync mute button icon (style toggles only, no DOM mutation).
     */

    function setSliderFromPlayer(slider, label, video) {
        const muted = isMuted(video);
        const displayValue = getVolume(video);
        slider.value = String(displayValue);
        if (label) {
            label.textContent = muted ? 'M' : `${displayValue}%`;
        }
        updateSliderBar(slider);
        updateVolumeIndicator(document.getElementById(OVERLAY_ID), displayValue, muted);
    }



    function ensureOptionsStyles() {
        const style = createStyleElement(document, OPTIONS_STYLE_ID);
        if (!style) return;
        style.textContent = `
            #${OPTIONS_BUTTON_ID} {
                opacity: 0.94;
            }
            #${OPTIONS_BUTTON_ID}:hover,
            #${OPTIONS_BUTTON_ID}:focus-visible,
            #${OPTIONS_BUTTON_ID}[aria-expanded="true"] {
                opacity: 1;
            }
            #${OPTIONS_BUTTON_ID}[data-tm-volume-mode="off"] svg {
                opacity: 0.58;
            }
            #${OPTIONS_BUTTON_ID} svg {
                display: block;
                height: 24px;
                width: 24px;
            }
            #${OPTIONS_POPUP_ID} {
                background: rgba(18, 18, 18, 0.97);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.48);
                color: #fff;
                display: flex;
                flex-direction: column;
                font-family: Arial, sans-serif;
                font-size: 14px;
                line-height: 1;
                max-height: 70vh;
                max-width: 320px;
                min-width: 288px;
                overflow: hidden;
                position: absolute;
                user-select: none;
                width: 288px;
                z-index: 10001;
            }
            #${OPTIONS_POPUP_ID},
            #${OPTIONS_POPUP_ID} * {
                box-sizing: border-box;
            }
            #${OPTIONS_POPUP_ID} button {
                -webkit-appearance: none;
                appearance: none;
                font-family: inherit;
                text-transform: none;
            }
            #${OPTIONS_POPUP_ID}[hidden] {
                display: none;
            }
            .tm-volume-options-open .ytp-tooltip {
                display: none !important;
            }
            .tm-volume-options-header {
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                flex-shrink: 0;
                padding: 12px 16px;
            }
            .tm-volume-options-title {
                color: #fff;
                font-size: 14px;
                font-weight: 500;
                line-height: 20px;
            }
            .tm-volume-options-body {
                flex: 1 1 auto;
                min-height: 0;
                overflow-x: hidden;
                overflow-y: auto;
                overscroll-behavior: contain;
                padding: 10px 0 8px;
                scrollbar-color: rgba(255, 255, 255, 0.34) rgba(255, 255, 255, 0.08);
                scrollbar-width: thin;
            }
            .tm-volume-options-body::-webkit-scrollbar {
                width: 8px;
            }
            .tm-volume-options-body::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.06);
                border-radius: 4px;
            }
            .tm-volume-options-body::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.28);
                background-clip: padding-box;
                border: 2px solid transparent;
                border-radius: 4px;
            }
            .tm-volume-options-body::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.42);
                background-clip: padding-box;
            }
            .tm-volume-options-section {
                padding: 10px 16px;
            }
            .tm-volume-options-section:first-child {
                padding-top: 0;
            }
            .tm-volume-options-section:last-child {
                padding-bottom: 0;
            }
            .tm-volume-options-section + .tm-volume-options-section {
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                padding-top: 12px;
            }
            .tm-volume-options-section-label {
                color: rgba(255, 255, 255, 0.55);
                font-size: 11px;
                font-weight: 500;
                letter-spacing: 0.04em;
                line-height: 14px;
                margin: 0 0 10px;
                text-transform: uppercase;
            }
            .tm-volume-options-checklist {
                display: flex;
                flex-direction: column;
            }
            .tm-volume-options-checklist .tm-volume-options-row {
                align-items: center;
                column-gap: 12px;
                display: grid;
                grid-template-columns: 1fr 18px;
                justify-content: stretch;
                margin: 0 -8px;
                min-height: 32px;
                padding: 5px 8px;
                width: calc(100% + 16px);
            }
            .tm-volume-options-checklist .tm-volume-options-row > span:first-child {
                justify-self: start;
                min-width: 0;
            }
            .tm-volume-options-checklist .tm-volume-options-checkbox {
                justify-self: end;
            }
            .tm-volume-options-row {
                align-items: center;
                background: transparent;
                border: 0;
                border-radius: 6px;
                color: #fff;
                cursor: pointer;
                display: flex;
                font-size: 13px;
                font-weight: 400;
                line-height: 18px;
                min-height: 34px;
                padding: 7px 8px;
                text-align: left;
                transition: background 0.12s ease;
            }
            .tm-volume-options-row > span:first-child {
                display: block;
                line-height: 18px;
            }
            .tm-volume-options-row:hover,
            .tm-volume-options-row:focus-visible {
                background: rgba(255, 255, 255, 0.08);
                outline: none;
            }
            .tm-volume-options-row:disabled {
                cursor: not-allowed;
                opacity: 0.45;
            }
            .tm-volume-options-checkbox {
                background: transparent;
                border: 1.5px solid rgba(255, 255, 255, 0.45);
                border-radius: 3px;
                display: grid;
                flex-shrink: 0;
                height: 18px;
                place-items: center;
                transition: all 0.12s ease;
                width: 18px;
            }
            .tm-volume-options-row[aria-checked="true"] .tm-volume-options-checkbox {
                background: ${VOLUME_ACCENT_DARK};
                border-color: ${VOLUME_ACCENT_DARK};
            }
            .tm-volume-options-row[aria-checked="true"] .tm-volume-options-checkbox::after {
                border: solid #fff;
                border-width: 0 0 3px 3px;
                box-sizing: border-box;
                content: '';
                height: 6px;
                transform: translateY(-1px) rotate(-45deg);
                width: 10px;
            }
            .tm-volume-options-segment-stack {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .tm-volume-options-section-label + * {
                padding-top: 2px;
            }
            .tm-volume-options-segment {
                display: flex;
                gap: 6px;
                width: 100%;
            }
            .tm-volume-options-segment .tm-volume-options-radio {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.14);
            }
            .tm-volume-options-segment .tm-volume-options-radio:hover,
            .tm-volume-options-segment .tm-volume-options-radio:focus-visible {
                background: rgba(255, 255, 255, 0.14);
                border-color: rgba(255, 255, 255, 0.2);
            }
            .tm-volume-options-radio {
                align-items: center;
                background: transparent;
                border: 0;
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.82);
                cursor: pointer;
                display: flex;
                flex: 1 1 0;
                font-size: 12px;
                font-weight: 600;
                justify-content: center;
                line-height: 16px;
                min-height: 34px;
                min-width: 0;
                padding: 8px 10px;
                text-align: center;
                transition: background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
            }
            .tm-volume-options-radio:hover,
            .tm-volume-options-radio:focus-visible {
                background: rgba(255, 255, 255, 0.1);
                outline: none;
            }
            .tm-volume-options-radio[aria-checked="true"] {
                background: ${VOLUME_ACCENT_DARK};
                border-color: ${VOLUME_ACCENT_DARK};
                box-shadow: none;
                color: #fff;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
            }
            .tm-volume-options-section[data-disabled="true"] .tm-volume-options-radio {
                cursor: not-allowed;
                opacity: 0.4;
            }
            .tm-volume-options-section[data-disabled="true"] .tm-volume-options-radio:hover {
                background: transparent;
            }
            .tm-volume-options-section[data-disabled="true"] .tm-volume-options-radio[aria-checked="true"] {
                background: ${VOLUME_ACCENT_DISABLED};
            }
            .tm-volume-options-opacity-row {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .tm-volume-options-section-label + .tm-volume-options-opacity-row {
                margin-top: 2px;
            }
            .tm-volume-options-opacity-row + .tm-volume-options-opacity-row {
                margin-top: 12px;
            }
            .tm-volume-options-opacity-label-group {
                align-items: baseline;
                display: flex;
                gap: 6px;
                min-width: 0;
            }
            .tm-volume-options-opacity-name {
                color: #fff;
                font-size: 13px;
                line-height: 18px;
            }
            .tm-volume-options-opacity-value {
                color: rgba(255, 255, 255, 0.65);
                font-size: 12px;
                line-height: 18px;
            }
            .tm-volume-options-opacity-controls {
                align-items: center;
                display: flex;
                gap: 12px;
            }
            .tm-volume-options-opacity-reset {
                align-items: center;
                background: rgba(255, 255, 255, 0.12);
                border: 0;
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.9);
                cursor: pointer;
                display: flex;
                flex-shrink: 0;
                font-size: 11px;
                font-weight: 500;
                height: 28px;
                justify-content: center;
                line-height: 16px;
                min-width: 52px;
                padding: 0 10px;
            }
            .tm-volume-options-opacity-reset:hover,
            .tm-volume-options-opacity-reset:focus-visible {
                background: rgba(255, 255, 255, 0.26);
            }
            .tm-volume-options-opacity-slider {
                -webkit-appearance: none;
                appearance: none;
                background: linear-gradient(to right,
                    rgba(255, 255, 255, 0.92) 0%,
                    rgba(255, 255, 255, 0.92) var(--tm-opacity-fill, 0%),
                    rgba(255, 255, 255, 0.22) var(--tm-opacity-fill, 0%),
                    rgba(255, 255, 255, 0.22) 100%);
                border-radius: 3px;
                cursor: pointer;
                display: block;
                flex: 1 1 auto;
                height: 4px;
                margin: 0;
                min-width: 0;
                outline: none;
                width: 100%;
            }
            .tm-volume-options-opacity-slider::-webkit-slider-runnable-track {
                background: transparent;
                border: none;
                height: 4px;
            }
            .tm-volume-options-opacity-slider::-moz-range-track {
                background: transparent;
                border: none;
                height: 4px;
            }
            .tm-volume-options-opacity-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                background: #fff;
                border: 0;
                border-radius: 50%;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
                cursor: pointer;
                height: 14px;
                margin-top: -5px;
                width: 14px;
            }
            .tm-volume-options-opacity-slider::-moz-range-thumb {
                background: #fff;
                border: 0;
                border-radius: 50%;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
                cursor: pointer;
                height: 14px;
                width: 14px;
            }
        `;
    }

    function closeYouTubeSettingsPopupIfOpen() {
        const isOpen = Array.from(document.querySelectorAll('.ytp-settings-menu'))
            .some((popup) => popup.style.display !== 'none' && popup.offsetParent !== null);
        if (isOpen) {
            document.querySelector('.ytp-settings-button')?.click();
        }
    }

    function getVolumeModeLabel(mode = getVolumeSliderMode()) {
        if (mode === 'off') return 'Off';
        return mode === 'replace-native' ? 'Replace native' : 'On';
    }

    function updateOptionsButtonState(btn = document.getElementById(OPTIONS_BUTTON_ID)) {
        if (!btn) return;
        const mode = getVolumeSliderMode();
        const label = `Volume Slider Options (${getVolumeModeLabel(mode)})`;
        btn.dataset.tmVolumeMode = mode;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
    }

    // -------------------------------------
    // Volume Options icon button (right of YouTube settings gear)
    // -------------------------------------

    function getRightControlsHost(player) {
        if (!player) return null;
        return player.querySelector('.ytp-right-controls-left') ||
            player.querySelector('.ytp-right-controls');
    }


    function injectVolumeOptionsButton() {
        ensureOptionsStyles();
        const player = getPlayerContainer();
        const host = getRightControlsHost(player);
        const settingsBtn = host?.querySelector?.('.ytp-settings-button');
        if (!host || !settingsBtn) return;

        let btn = document.getElementById(OPTIONS_BUTTON_ID);
        if (btn && btn.parentElement === host && btn.nextElementSibling === settingsBtn) {
            updateOptionsButtonState();
            return;
        }
        btn?.remove();

        btn = document.createElement('button');
        btn.id = OPTIONS_BUTTON_ID;
        btn.type = 'button';
        btn.className = 'ytp-button';
        btn.dataset.priority = '6';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.appendChild(createOptionsButtonIconSvg(document));
        updateOptionsButtonState(btn);

        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleVolumeOptionsPopup();
        });

        host.insertBefore(btn, settingsBtn);
        ensurePlayerControlsObserver();
    }

    function removeVolumeOptionsButton() {
        document.getElementById(OPTIONS_BUTTON_ID)?.remove();
        closeVolumeOptionsPopup();
    }

    // -------------------------------------
    // Volume Options popup (advanced settings)
    // -------------------------------------

    let optionsPopupOutsideHandler = null;
    let optionsPopupKeyHandler = null;
    let optionsPopupRepositionHandler = null;
    let optionsPopupOpener = null;

    function getOptionsPopup() {
        return document.getElementById(OPTIONS_POPUP_ID);
    }

    function isOptionsPopupOpen() {
        const popup = getOptionsPopup();
        return !!popup && !popup.hasAttribute('hidden');
    }


    const { buildOptionsPopup, syncOptionsRadioGroups } = createOptionsUi({
        document, optionsPopupId: OPTIONS_POPUP_ID, refreshOptionsPopupState,
        getVolumeSliderMode, setVolumeSliderMode, getReplaceNativePlacement, setReplaceNativePlacement,
        isSnapTo5Enabled, setSnapTo5Enabled, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled,
        isSliderOnVideo, setSliderLocation, getSavedOverlayOpacityPercent,
        setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent,
        getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent,
        getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent,
        beginThicknessSliderPreview, endThicknessSliderPreview,
        beginOpacitySliderPreview, endOpacitySliderPreview
    });











    function refreshOptionsPopupState() {
        const popup = getOptionsPopup();
        if (!popup) return;

        ['on', 'off', 'replace-native'].forEach((mode) => {
            popup.querySelector(`#tm-volume-options-mode-${mode}`)
                ?.setAttribute('aria-checked', getVolumeSliderMode() === mode ? 'true' : 'false');
        });

        const placementSection = popup.querySelector('#tm-volume-options-placement-section');
        const placementEnabled = isNativeVolumeReplacementEnabled();
        if (placementSection) {
            placementSection.dataset.disabled = placementEnabled ? 'false' : 'true';
        }
        ['native', 'custom'].forEach((p) => {
            const el = popup.querySelector(`#tm-volume-options-placement-${p}`);
            if (!el) return;
            el.setAttribute('aria-checked', getReplaceNativePlacement() === p ? 'true' : 'false');
            el.disabled = !placementEnabled;
        });

        popup.querySelector('#tm-volume-options-snap')
            ?.setAttribute('aria-checked', isSnapTo5Enabled() ? 'true' : 'false');
        popup.querySelector('#tm-volume-options-always-expanded')
            ?.setAttribute('aria-checked', isAlwaysExpandedEnabled() ? 'true' : 'false');
        popup.querySelector('#tm-volume-options-location-video')
            ?.setAttribute('aria-checked', isSliderOnVideo() ? 'true' : 'false');

        const opacitySection = popup.querySelector('#tm-volume-options-opacity-section');
        if (opacitySection) {
            opacitySection.style.display = isSliderOnVideo() ? '' : 'none';
        }
        const sizeSection = popup.querySelector('#tm-volume-options-size-section');
        if (sizeSection) {
            sizeSection.style.display = isSliderOnVideo() ? '' : 'none';
        }
        syncOptionsRadioGroups(popup);
    }

    function ensureOptionsPopup() {
        const player = getPlayerContainer();
        if (!player) return null;

        let popup = getOptionsPopup();
        if (!popup || !popup.isConnected) {
            popup?.remove();
            popup = buildOptionsPopup();
            ensurePlayerPositioning(player);
            player.appendChild(popup);
        }
        return popup;
    }

    function positionOptionsPopup(popup, resetScroll = false) {
        const btn = document.getElementById(OPTIONS_BUTTON_ID);
        const player = getPlayerContainer();
        if (!btn || !player || !popup) return;
        const playerRect = player.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const progressBar = document.querySelector('.ytp-progress-bar-padding');
        const barEl = progressBar ? (progressBar.closest('.ytp-progress-bar') || progressBar.parentElement) : null;
        const barRect = barEl?.getBoundingClientRect?.();
        const bottomPx = barRect
            ? playerRect.bottom - barRect.top + 8
            : playerRect.bottom - btnRect.top + 8;

        popup.style.right = `${Math.max(8, playerRect.right - btnRect.right)}px`;
        popup.style.bottom = `${Math.max(8, bottomPx)}px`;
        popup.style.left = 'auto';
        popup.style.top = 'auto';

        const margin = 8;
        const viewportTop = window.visualViewport?.offsetTop ?? 0;
        const popupBottomY = playerRect.bottom - Math.max(margin, bottomPx);
        const minTop = Math.max(playerRect.top + margin, viewportTop + margin);
        popup.style.maxHeight = `${Math.floor(Math.max(120, popupBottomY - minTop))}px`;

        const body = popup.querySelector('.tm-volume-options-body');
        if (!body) return;
        if (resetScroll) body.scrollTop = 0;
        else body.scrollTop = Math.min(body.scrollTop, Math.max(0, body.scrollHeight - body.clientHeight));
    }

    function keepYouTubeControlsVisible() {
        const player = getPlayerContainer();
        if (!player) return;
        player.classList.remove('ytp-autohide', 'ytp-hide-controls');
        if (typeof player.showControls === 'function') {
            try { player.showControls(); } catch (e) { /* ignore player API errors */ }
        }
    }

    function hideYouTubeControls() {
        const player = getPlayerContainer();
        if (!player) return;
        player.classList.add('ytp-autohide');
    }

    function isYouTubeVideoSurfaceClick(event) {
        const target = event.target;
        const player = getPlayerContainer();
        if (!target || !player?.contains?.(target)) return false;

        return !target.closest?.(
            '.ytp-chrome-bottom, .ytp-chrome-top, button, a, input, select, textarea, ' +
            '[role="button"], [role="slider"], [role="menuitem"]'
        );
    }

    function startOptionsControlsHold() {
        keepYouTubeControlsVisible();
        ensurePlayerControlsObserver();
    }

    function openVolumeOptionsPopup() {
        ensureOptionsStyles();
        const popup = ensureOptionsPopup();
        if (!popup) return;

        closeYouTubeSettingsPopupIfOpen();

        optionsPopupOpener = document.activeElement;
        refreshOptionsPopupState();
        popup.removeAttribute('hidden');
        positionOptionsPopup(popup, true);
        getPlayerContainer()?.classList?.add('tm-volume-options-open');
        startOptionsControlsHold();
        document.getElementById(OPTIONS_BUTTON_ID)?.setAttribute('aria-expanded', 'true');
        const initialFocus = popup.querySelector('[id^="tm-volume-options-mode-"][role="radio"][aria-checked="true"]:not(:disabled)') || getOptionsPopupFocusable(popup)[0];
        initialFocus?.focus();

        if (!optionsPopupOutsideHandler) {
            optionsPopupOutsideHandler = (event) => {
                const btn = document.getElementById(OPTIONS_BUTTON_ID);
                if (popup.contains(event.target) || btn?.contains(event.target)) return;
                if (event.target?.closest?.('.ytp-settings-button')) {
                    window.setTimeout(() => closeVolumeOptionsPopup(), 0);
                    return;
                }
                const clickedOutsidePlayer = !getPlayerContainer()?.contains?.(event.target);
                const clickedVideoSurface = isYouTubeVideoSurfaceClick(event);
                closeVolumeOptionsPopup();
                if (clickedOutsidePlayer) hideYouTubeControls();
                if (clickedVideoSurface) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            };
            document.addEventListener('click', optionsPopupOutsideHandler, true);
        }
        if (!optionsPopupKeyHandler) {
            optionsPopupKeyHandler = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeVolumeOptionsPopup(true);
                    return;
                }
                if (event.key !== 'Tab') return;
                const focusable = getOptionsPopupFocusable(popup);
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            };
            document.addEventListener('keydown', optionsPopupKeyHandler, true);
        }
        if (!optionsPopupRepositionHandler) {
            optionsPopupRepositionHandler = () => positionOptionsPopup(popup);
            window.addEventListener('resize', optionsPopupRepositionHandler, true);
            window.visualViewport?.addEventListener('resize', optionsPopupRepositionHandler, true);
            window.visualViewport?.addEventListener('scroll', optionsPopupRepositionHandler, true);
        }
    }

    function closeVolumeOptionsPopup(restoreFocus = false) {
        const popup = getOptionsPopup();
        if (popup) {
            if (popup.contains(document.activeElement)) document.activeElement.blur();
            popup.setAttribute('hidden', '');
        }
        getPlayerContainer()?.classList?.remove('tm-volume-options-open');
        document.getElementById(OPTIONS_BUTTON_ID)?.setAttribute('aria-expanded', 'false');

        if (optionsPopupOutsideHandler) {
            document.removeEventListener('click', optionsPopupOutsideHandler, true);
            optionsPopupOutsideHandler = null;
        }
        if (optionsPopupKeyHandler) {
            document.removeEventListener('keydown', optionsPopupKeyHandler, true);
            optionsPopupKeyHandler = null;
        }
        if (optionsPopupRepositionHandler) {
            window.removeEventListener('resize', optionsPopupRepositionHandler, true);
            window.visualViewport?.removeEventListener('resize', optionsPopupRepositionHandler, true);
            window.visualViewport?.removeEventListener('scroll', optionsPopupRepositionHandler, true);
            optionsPopupRepositionHandler = null;
        }
        if (restoreFocus) {
            const fallback = document.getElementById(OPTIONS_BUTTON_ID);
            (optionsPopupOpener?.isConnected ? optionsPopupOpener : fallback)?.focus();
        }
        optionsPopupOpener = null;
    }

    function setupNativeSettingsCloseHandler() {
        if (window.__tmYtVolumeNativeSettingsCloseBound) return;
        window.__tmYtVolumeNativeSettingsCloseBound = true;
        document.addEventListener('click', (event) => {
            if (event.target?.closest?.('.ytp-settings-button')) {
                window.setTimeout(() => closeVolumeOptionsPopup(), 0);
            }
        }, false);
    }

    function disconnectPlayerControlsObserver() {
        playerControlsObserver?.disconnect();
        playerControlsObserver = null;
        playerControlsObserverTarget = null;
    }

    function onPlayerControlsMutation() {
        if (isOptionsPopupOpen() && areYouTubeControlsHidden()) {
            keepYouTubeControlsVisible();
        }
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay?.dataset?.tmKeepExpanded === 'true' && areYouTubeControlsHidden()) {
            clearExpandedHold(overlay);
            setOverlayExpanded(overlay, false);
        }
    }

    function ensurePlayerControlsObserver() {
        const player = getPlayerContainer();
        if (!player) return;
        if (playerControlsObserverTarget === player) return;
        disconnectPlayerControlsObserver();
        playerControlsObserverTarget = player;
        playerControlsObserver = new MutationObserver(onPlayerControlsMutation);
        playerControlsObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    }

    function toggleVolumeOptionsPopup() {
        if (isOptionsPopupOpen()) {
            closeVolumeOptionsPopup();
        } else {
            openVolumeOptionsPopup();
        }
    }

    function createOverlay(video, player, controlsHost) {
        if (overlayLifecycle.active && !overlayLifecycle.active.root.isConnected) {
            disposeActiveOverlay();
        }
        // Prevent duplicates
        const existing = document.getElementById(OVERLAY_ID);
        if (existing) {
            return existing;
        }

        createStylesIfNeeded();

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'tm-collapsed';

        Object.assign(overlay.style, {
            position: 'relative',
            transform: 'translateY(0)',
            width: '40px',
            minWidth: '0',
            maxWidth: 'none',
            height: '40px',
            minHeight: '40px',
            padding: '0',
            background: 'transparent',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
            borderRadius: '20px',
            border: 'none',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: '0',
            zIndex: '2',
            pointerEvents: 'auto',
            boxSizing: 'border-box',
            overflow: 'hidden',
            opacity: '1',
            flex: '0 0 auto',
            margin: '0 4px',
            alignSelf: 'center',
            transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        });

        let hasPointerIntent = false;
        const markPointerIntent = () => {
            hasPointerIntent = true;
            window.removeEventListener('pointermove', markPointerIntent, true);
        };
        window.addEventListener('pointermove', markPointerIntent, true);
        overlay.addEventListener('mouseenter', () => {
            if (!hasPointerIntent) return;
            overlay.dataset.tmHovering = 'true';
            setOverlayExpanded(overlay, true);
            updateOverlayOpacity(overlay);
        });
        overlay.addEventListener('mouseleave', () => {
            overlay.dataset.tmHovering = 'false';
            overlay.dataset.tmDragging = 'false';
            updateOverlayOpacity(overlay);
            collapseOverlayIfIdle(overlay, true);
        });
        overlay.addEventListener('focusin', () => {
            setOverlayExpanded(overlay, true);
            updateOverlayOpacity(overlay);
        });
        overlay.addEventListener('focusout', () => {
            updateOverlayOpacity(overlay);
            collapseOverlayIfIdle(overlay);
        });
        const collapseHeldSliderOnVideoClick = (event) => {
            if (overlay.dataset.tmKeepExpanded !== 'true' || !isYouTubeVideoSurfaceClick(event)) return;
            clearExpandedHold(overlay);
            setOverlayExpanded(overlay, false);
        };
        document.addEventListener('click', collapseHeldSliderOnVideoClick, true);

        const iconCell = document.createElement('button');
        iconCell.type = 'button';
        iconCell.className = 'tm-volume-icon-cell';
        const indicator = document.createElement('div');
        indicator.className = 'tm-volume-indicator';
        indicator.appendChild(makeVolumeIndicatorSvg());
        iconCell.appendChild(indicator);
        iconCell.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleMute(video);
            setSliderFromPlayer(slider, label, video);
            markVolumeChangedWhileExpanded(overlay);
        });
        const panelBg = document.createElement('div');
        panelBg.className = 'tm-volume-panel-bg';

        const topRow = document.createElement('div');
        topRow.className = 'tm-volume-controls tm-volume-top-row';

        const label = document.createElement('div');
        label.id = VALUE_LABEL_ID;
        label.textContent = '100%';

        topRow.appendChild(label);

        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'tm-volume-controls tm-volume-slider-row';
        sliderWrap.style.position = 'relative';
        sliderWrap.style.width = 'auto';
        sliderWrap.style.flex = '1 1 auto';
        sliderWrap.style.height = '40px';
        sliderWrap.style.display = 'flex';
        sliderWrap.style.alignItems = 'center';

        const tickOverlay = document.createElement('div');
        tickOverlay.className = 'tm-slider-ticks';

        const sliderTrack = document.createElement('div');
        sliderTrack.className = 'tm-slider-track';

        const slider = document.createElement('input');
        slider.id = SLIDER_ID;
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.step = '1';
        slider.style.width = '100%';
        slider.style.display = 'block';
        slider.style.margin = '0';
        slider.style.cursor = 'pointer';
        slider.setAttribute('aria-label', 'Volume');
        slider.setAttribute('aria-describedby', VALUE_LABEL_ID);

        // Initialize from localStorage to avoid the 100% to actual jump on video load
        const initVol = getSavedVolume();
        if (initVol !== null) {
            slider.value = String(initVol);
            label.textContent = `${initVol}%`;
        } else {
            setSliderFromPlayer(slider, label, video);
        }
        updateSliderBar(slider);

        let pointerStartX = 0;
        let pointerStartY = 0;
        let pointerStartValue = 0;
        let pointerMoved = false;
        let clickSnapHandled = false;

        const applySliderValue = (value) => {
            setVolume(video, value);
            label.textContent = `${value}%`;
            updateSliderBar(slider);
            updateVolumeIndicator(overlay, value, isMuted(video));
            scheduleSaveVolume(value);
            markVolumeChangedWhileExpanded(overlay);
        };

        const snapDirectClickIfNeeded = () => {
            const currentValue = Number(slider.value) || 0;
            if (clickSnapHandled || pointerMoved || currentValue === pointerStartValue) return;
            const snappedValue = snapTo5(currentValue);
            slider.value = String(snappedValue);
            applySliderValue(snappedValue);
            clickSnapHandled = true;
        };

        const readPressAwareSliderValue = () => {
            if (isSnapTo5Enabled()) {
                return readSnappedSliderValue(slider);
            }

            let value = Number(slider.value) || 0;
            if (!pointerMoved && !clickSnapHandled && value !== pointerStartValue) {
                value = snapTo5(value);
                slider.value = String(value);
                clickSnapHandled = true;
            }
            return value;
        };

        const finishSliderInteraction = (event) => {
            const wasDragging = overlay.dataset.tmDragging === 'true';
            if (event?.type === 'pointerup' && wasDragging) {
                snapDirectClickIfNeeded();
            }
            overlay.dataset.tmDragging = 'false';
            updateOverlayOpacity(overlay);
            collapseOverlayIfIdle(overlay, !overlay.matches(':hover'));
        };
        slider.addEventListener('pointerdown', (event) => {
            pointerStartX = event.clientX;
            pointerStartY = event.clientY;
            pointerStartValue = Number(slider.value) || 0;
            pointerMoved = false;
            clickSnapHandled = false;
            overlay.dataset.tmDragging = 'true';
            setOverlayExpanded(overlay, true);
            updateOverlayOpacity(overlay);
        });
        slider.addEventListener('pointermove', (event) => {
            if (Math.abs(event.clientX - pointerStartX) > 3 || Math.abs(event.clientY - pointerStartY) > 3) {
                pointerMoved = true;
            }
        });
        slider.addEventListener('pointerup', finishSliderInteraction);
        slider.addEventListener('click', snapDirectClickIfNeeded);
        slider.addEventListener('pointercancel', finishSliderInteraction);
        window.addEventListener('pointerup', finishSliderInteraction, true);
        window.addEventListener('pointercancel', finishSliderInteraction, true);
        window.addEventListener('blur', finishSliderInteraction);

        slider.addEventListener('input', () => {
            applySliderValue(readPressAwareSliderValue());
        });

        slider.addEventListener('change', () => {
            applySliderValue(readSnappedSliderValue(slider));
        cancelScheduledSaveVolume();
            saveVolume(Number(slider.value) || 0);
        });

        const onVideoVolumeChange = () => {
            if (!document.getElementById(OVERLAY_ID)) return;
            setSliderFromPlayer(slider, label, video);
            if (!isMuted(video)) scheduleSaveVolume(getVolume(video));
        };
        video.addEventListener('volumechange', onVideoVolumeChange);

        sliderWrap.appendChild(sliderTrack);
        sliderWrap.appendChild(slider);
        sliderWrap.appendChild(tickOverlay);
        overlay.appendChild(panelBg);
        overlay.appendChild(iconCell);
        overlay.appendChild(topRow);
        overlay.appendChild(sliderWrap);

        placeOverlay(overlay, player, controlsHost);
        setSliderFromPlayer(slider, label, video);
        setOverlayExpanded(overlay, false, true);
        updateSliderThickness(overlay);
        updateVideoOverlayPosition(overlay, player);
        const onLayoutChange = () => {
            if (!overlay.isConnected || isOverlayInteractionFocused(overlay)) return;
            placeOverlay(overlay, player, controlsHost);
        };
        window.addEventListener('resize', onLayoutChange);
        const controlsObserver = new MutationObserver(onLayoutChange);
        controlsObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
        const detachmentObserver = new MutationObserver(() => {
            if (overlayLifecycle.owns(overlay) && !overlay.isConnected) {
                disposeActiveOverlay();
                window.setTimeout(() => attachSliderIfPossible(), 0);
            }
        });
        detachmentObserver.observe(document.body, { childList: true, subtree: true });
        const cleanup = () => {
            video.removeEventListener('volumechange', onVideoVolumeChange);
            window.removeEventListener('pointerup', finishSliderInteraction, true);
            window.removeEventListener('pointercancel', finishSliderInteraction, true);
            window.removeEventListener('blur', finishSliderInteraction);
            window.removeEventListener('resize', onLayoutChange);
            window.removeEventListener('pointermove', markPointerIntent, true);
            document.removeEventListener('click', collapseHeldSliderOnVideoClick, true);
            controlsObserver.disconnect();
            detachmentObserver.disconnect();
            clearExpandedHold(overlay);
        };
        overlayLifecycle.set(overlay, cleanup);

        return overlay;
    }

    function disposeActiveOverlay() {
        overlayLifecycle.dispose();
    }

    function removeOverlay() {
        cancelScheduledSaveVolume();
        disposeActiveOverlay();
        document.getElementById(OVERLAY_ID)?.remove();
        applyNativeVolumeVisibility();
    }

    function attachSliderIfPossible() {
        const video = getVideoElement();
        const player = getPlayerContainer(video);
        const controlsHost = getYouTubeControlsHost(player);

        if (!player) {
            return false;
        }

        // Keep the options button available even when the slider is off.
        if (!isOverlayEnabled()) {
            removeOverlay();
            applyNativeVolumeVisibility();
            injectVolumeOptionsButton();
            return !!document.getElementById(OPTIONS_BUTTON_ID);
        }

        if (!video || !player || (!controlsHost && !isSliderOnVideo())) {
            injectVolumeOptionsButton();
            return false;
        }
        const existingOverlay = document.getElementById(OVERLAY_ID);
        if (existingOverlay) {
            placeOverlay(existingOverlay, player, controlsHost);
        } else {
            restoreSavedVolume(video);
            createOverlay(video, player, controlsHost);
        }
        applyNativeVolumeVisibility();
        injectVolumeOptionsButton();
        ensurePlayerControlsObserver();
        ensureAttachObserver();
        return true;
    }

    function getAttachObserverRoot() {
        if (document.location.pathname !== '/watch') return null;
        return document.getElementById('movie_player') ||
            document.querySelector('.html5-video-player') ||
            document.getElementById('primary');
    }

    let lastAttach = 0;
    const ATTACH_COOLDOWN_MS = 1000;
    let attachQueued = false;

    function handleAttachObserverMutations(mutations) {
        if (document.location.pathname !== '/watch') return;
        const hasAddedNodes = mutations.some((m) => m.addedNodes && m.addedNodes.length > 0);
        if (!hasAddedNodes || attachQueued) return;

        const overlay = document.getElementById(OVERLAY_ID);
        const button = document.getElementById(OPTIONS_BUTTON_ID);
        const overlayMissing = isOverlayEnabled() && (!overlay || !overlay.isConnected);
        const buttonMissing = !button || !button.isConnected;
        if (!overlayMissing && !buttonMissing) return;

        attachQueued = true;
        requestAnimationFrame(() => {
            attachQueued = false;
            const now = Date.now();
            if (now - lastAttach < ATTACH_COOLDOWN_MS) return;
            if (document.location.pathname !== '/watch') return;
            if (attachSliderIfPossible()) {
                lastAttach = now;
            }
        });
    }

    function disconnectAttachObserver() {
        attachObserver?.disconnect();
        attachObserver = null;
        attachObserverTarget = null;
        attachBootstrapObserver?.disconnect();
        attachBootstrapObserver = null;
    }

    function ensureAttachObserver() {
        if (!window.MutationObserver) return;
        const root = getAttachObserverRoot();
        if (!root) return;

        attachBootstrapObserver?.disconnect();
        attachBootstrapObserver = null;

        if (attachObserverTarget === root) return;
        attachObserver?.disconnect();
        attachObserverTarget = root;
        attachObserver = new MutationObserver(handleAttachObserverMutations);
        attachObserver.observe(root, { childList: true, subtree: true });
    }

    function setupAttachObserver() {
        if (!window.MutationObserver) return;
        ensureAttachObserver();
        if (attachObserverTarget || attachBootstrapObserver) return;

        attachBootstrapObserver = new MutationObserver(() => {
            if (!getAttachObserverRoot()) return;
            ensureAttachObserver();
        });
        attachBootstrapObserver.observe(document.body, { childList: true, subtree: true });
    }

    function setupInitialAttempts() {
        const maxAttempts = 20;
        const delayMs = 500;
        const attemptAttach = (attempt) => {
            if (attachSliderIfPossible() || attempt >= maxAttempts) return;
            window.setTimeout(() => attemptAttach(attempt + 1), delayMs);
        };
        attemptAttach(0);
    }

    function setupYtNavigationHandler() {
        if (window.__tmYtVolumeNavBound) return;
        window.__tmYtVolumeNavBound = true;

        const runReattach = () => {
            if (navReattachTimer) {
                clearTimeout(navReattachTimer);
                navReattachTimer = 0;
            }

            resetVideoElement();
            cachedYtPlayer = null;
            closeVolumeOptionsPopup();
            disconnectPlayerControlsObserver();
            disconnectAttachObserver();

            navReattachTimer = window.setTimeout(() => {
                navReattachTimer = 0;
                removeOverlay();
                removeVolumeOptionsButton();
                attachSliderIfPossible();
            }, NAV_REATTACH_DELAY_MS);
        };

        const scheduleReattach = () => {
            if (navDebounceTimer) {
                clearTimeout(navDebounceTimer);
                navDebounceTimer = 0;
            }
            navDebounceTimer = window.setTimeout(() => {
                navDebounceTimer = 0;
                runReattach();
            }, NAV_DEBOUNCE_MS);
        };

        window.addEventListener('yt-navigate-finish', scheduleReattach, true);
        window.addEventListener('yt-page-data-updated', scheduleReattach, true);
    }

    function init() {
        setupInitialAttempts();
        setupAttachObserver();
        setupYtNavigationHandler();
        setupNativeSettingsCloseHandler();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init, { once: true });
    }
}
