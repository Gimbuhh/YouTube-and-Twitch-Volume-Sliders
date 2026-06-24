import { createOverlayUi } from '../shared/overlay-ui.js';
import { createOptionsUi } from '../shared/options-ui.js';
import { createVolumeSettings } from '../shared/settings.js';
import { createVolumePersistence, getSpeakerIconMode, snapTo5 } from '../shared/volume.js';
import { createOptionsButtonIconSvg, getOptionsPopupFocusable } from '../shared/options.js';
import { createOverlayLifecycle, createVideoLocator } from '../shared/lifecycle.js';
import { createStyleElement } from '../shared/styles.js';

export function startTwitchVolumeSlider() {
    'use strict';

    const OVERLAY_ID = 'tm-volume-slider-overlay';
    const SLIDER_ID = 'tm-volume-slider-range';
    const VALUE_LABEL_ID = 'tm-volume-slider-value';
    const OPTIONS_STYLE_ID = 'tm-volume-options-style';
    const OPTIONS_BUTTON_ID = 'tm-volume-options-button';
    const OPTIONS_POPUP_ID = 'tm-volume-options-popup';
    const STORAGE_KEY = 'tm-twitch-volume';
    const MUTE_STORAGE_KEY = 'tm-twitch-muted';
    const VOLUME_MODE_KEY = 'tm-twitch-volume-slider-mode';
    const SLIDER_LOCATION_KEY = 'tm-twitch-volume-slider-location';
    const REPLACE_NATIVE_PLACEMENT_KEY = 'tm-twitch-volume-slider-replace-placement';
    const SNAP_TO_5_KEY = 'tm-twitch-volume-slider-snap-to-5';
    const ALWAYS_EXPANDED_KEY = 'tm-twitch-volume-slider-always-expanded';
    const OVERLAY_OPACITY_IDLE_KEY = 'tm-twitch-volume-slider-opacity-idle';
    const OVERLAY_OPACITY_ACTIVE_KEY = 'tm-twitch-volume-slider-opacity-active';
    const DEFAULT_OVERLAY_OPACITY_IDLE = 45;
    const DEFAULT_OVERLAY_OPACITY_ACTIVE = 95;
    const STORAGE_WRITE_DEBOUNCE_MS = 150;
    const VOLUME_CHANGE_EXPANDED_HOLD_MS = 1200;
    const TWITCH_CONTROLS_OUTSIDE_CLOSE_HOLD_MS = 5000;
    const TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR =
        '[data-a-target="player-settings-button"], button[aria-label="Settings"]';
    const TWITCH_NATIVE_SETTINGS_UI_SELECTOR =
        `${TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR}, ` +
        '[data-a-target="player-settings-menu"], ' +
        '[data-a-target="player-settings-submenu"], ' +
        '[data-a-target="player-settings-submenu-back-button"]';
    const ON_VIDEO_IDLE_BOTTOM_PX = 12;
    const ON_VIDEO_MAX_CONTROLS_OFFSET_PX = 140;
    const VOLUME_ACCENT_LIGHT = '#a970ff';
    const VOLUME_ACCENT_DARK = '#9146ff';
    const VOLUME_ACCENT_MID = '#b38cff';
    const VOLUME_ACCENT_DISABLED = 'rgba(145, 70, 255, 0.55)';
    const VOLUME_ARC_TRACK = 'rgba(255, 255, 255, 0.38)';
    const VOLUME_PANEL_DROP_SHADOW = 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.06))';
    const USER_SETTINGS = {
        // Volume slider mode: 'saved', 'off', 'on', or 'replace-native'. Default: 'saved'
        volumeSliderMode: 'saved',
        // Where to place the slider when replacing native volume: 'saved', 'native', or 'custom'. Default: 'saved'
        replaceNativePlacement: 'saved',
        // Slider location: 'saved', 'controls', or 'video'. Default: 'saved'
        sliderLocation: 'saved',
        // Snap slider movement to 5% steps: 'saved', true, or false. Default: 'saved'
        snapToFive: 'saved',
        // Keep the volume pill expanded: 'saved', true, or false. Default: 'saved'
        alwaysExpanded: 'saved',
        // Opacity for the on-video slider when idle/focused: 'saved' or 0-100. Default: 'saved'
        overlayOpacityUnfocused: 'saved',
        overlayOpacityFocused: 'saved'
    };

    let cachedApi = null;
    let cachedApiFromElement = null;
    let startupLockUntil = 0;
    let startupCorrectionApplied = false;
    let userIntentUntil = 0;
    let navReattachTimer = 0;
    let navLateRestoreTimer = 0;
    let navDebounceTimer = 0;
    let lastKnownPath = window.location.pathname;
    let attachObserver = null;
    let attachObserverTarget = null;
    let attachBootstrapObserver = null;
    let optionsControlsHoldObserver = null;
    let optionsControlsHoldTargetKey = null;
    let nativeSettingsObserver = null;
    let nativeSettingsObserverTarget = null;
    const overlayLifecycle = createOverlayLifecycle();
    const { getVideoElement, resetVideoElement, ensurePlayerPositioning } = createVideoLocator(document, window);
    const USER_INTENT_GRACE_MS = 5000;
    const NAV_REATTACH_DELAY_MS = 700;
    const NAV_LATE_RESTORE_DELAY_MS = 4200;
    const NAV_DEBOUNCE_MS = 180;

    // -------------------------------
    // Overlay State
    // -------------------------------





    const { getSavedVolumeSliderMode, getVolumeSliderMode, getReplaceNativePlacement, getSliderLocation, isSliderOnVideo, setSliderLocation, setReplaceNativePlacement, isSnapTo5Enabled, setSnapTo5Enabled, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled, getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode, isOverlayEnabled, isNativeVolumeReplacementEnabled, shouldUseNativeReplacementSlot } = createVolumeSettings({
        document, storage: localStorage, userSettings: USER_SETTINGS, overlayId: OVERLAY_ID,
        keys: { mode: VOLUME_MODE_KEY, location: SLIDER_LOCATION_KEY, replacePlacement: REPLACE_NATIVE_PLACEMENT_KEY, snap: SNAP_TO_5_KEY, expanded: ALWAYS_EXPANDED_KEY, idleOpacity: OVERLAY_OPACITY_IDLE_KEY, activeOpacity: OVERLAY_OPACITY_ACTIVE_KEY },
        defaults: { idleOpacity: DEFAULT_OVERLAY_OPACITY_IDLE, activeOpacity: DEFAULT_OVERLAY_OPACITY_ACTIVE },
        onPlacementChanged: () => { attachSliderIfPossible(); applyNativeVolumeVisibility(); },
        onModeChanged: (mode) => { if (mode === 'off') removeOverlay(); else attachSliderIfPossible(); applyNativeVolumeVisibility(); injectVolumeOptionsButton(); refreshOptionsPopupState(); updateOptionsButtonState(); },
        clearExpandedHold: (overlay) => clearExpandedHold(overlay),
        setOverlayExpanded: (overlay, expanded) => setOverlayExpanded(overlay, expanded),
        collapseOverlayIfIdle: (overlay, force) => collapseOverlayIfIdle(overlay, force)
    });
    const { getSavedVolume, readSnappedSliderValue, saveVolume, scheduleSaveVolume, cancelScheduledSaveVolume } = createVolumePersistence({
        window, storage: localStorage, storageKey: STORAGE_KEY, debounceMs: STORAGE_WRITE_DEBOUNCE_MS,
        isSnapEnabled: () => isSnapTo5Enabled()
    });























    /**
     * Ensure we always get the active HTMLVideoElement.
     */
    /**
     * Find a suitable container to host the overlay.
     */
    function getPlayerContainer(video = getVideoElement()) {
        if (!video) {
            return null;
        }

        return (
            video.closest('.video-player, .video-player__container, [data-a-target="video-player"]') ||
            video.parentElement
        );
    }

    function getTwitchControlsHost() {
        return (
            document.querySelector('#channel-player .player-controls__left-control-group') ||
            document.querySelector('[aria-label="Player Controls"] .player-controls__left-control-group') ||
            document.querySelector('.player-controls__left-control-group')
        );
    }

    function getTwitchPlayerControlsRoot() {
        return (
            document.querySelector('[data-a-target="player-controls"].player-controls') ||
            document.querySelector('[data-a-target="player-controls"]')
        );
    }

    function getTwitchPlayerControlsShell() {
        return getTwitchPlayerControlsRoot()?.closest?.('.tw-transition') || null;
    }

    function getTwitchPlayerControlsSection() {
        return document.querySelector('#channel-player, [aria-label="Player Controls"]');
    }

    function getTwitchRightControlsHost() {
        return (
            document.querySelector('#channel-player .player-controls__right-control-group') ||
            document.querySelector('[aria-label="Player Controls"] .player-controls__right-control-group') ||
            document.querySelector('.player-controls__right-control-group')
        );
    }

    function getTwitchSettingsButton(host = getTwitchRightControlsHost()) {
        return (
            host?.querySelector?.('[data-a-target="player-settings-button"]') ||
            host?.querySelector?.('button[aria-label="Settings"]') ||
            null
        );
    }

    function isNativeSettingsMenuOpen() {
        return getTwitchSettingsButton()?.getAttribute('aria-expanded') === 'true';
    }

    function isClickOnNativeSettingsUi(event) {
        return !!event.target?.closest?.(TWITCH_NATIVE_SETTINGS_UI_SELECTOR);
    }

    function getDirectChildOf(parent, child) {
        let node = child;
        while (node && node.parentElement && node.parentElement !== parent) {
            node = node.parentElement;
        }
        return node && node.parentElement === parent ? node : null;
    }

    function getNativeVolumeGroup(controlsHost = getTwitchControlsHost()) {
        if (!controlsHost) return null;
        const muteButton = controlsHost.querySelector('[data-a-target="player-mute-unmute-button"]');
        return muteButton ? getDirectChildOf(controlsHost, muteButton) : null;
    }

    function getTwitchSettingsWrapper(host = getTwitchRightControlsHost()) {
        const settingsBtn = getTwitchSettingsButton(host);
        return host && settingsBtn ? getDirectChildOf(host, settingsBtn) : null;
    }

    function positionOverlayAboveControls(overlay, player) {
        const controls = getTwitchPlayerControlsSection();
        if (!overlay || !player || !controls) {
            if (overlay) overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
            return;
        }

        const playerRect = player.getBoundingClientRect();
        const controlsRect = controls.getBoundingClientRect();
        const hasUsableControlsRect =
            controlsRect.width > 0 &&
            controlsRect.height > 0 &&
            controlsRect.top >= playerRect.top &&
            controlsRect.top < playerRect.bottom;
        if (!hasUsableControlsRect) {
            overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
            return;
        }
        const bottomPx = playerRect.bottom - controlsRect.top + 8;
        const safeBottomPx = Math.min(Math.max(20, bottomPx), ON_VIDEO_MAX_CONTROLS_OFFSET_PX);
        overlay.style.bottom = `${safeBottomPx}px`;
    }

    function updateVideoOverlayPosition(overlay, player) {
        if (!overlay || !player || !isSliderOnVideo()) return;
        if (areTwitchControlsHidden()) {
            overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
            return;
        }
        positionOverlayAboveControls(overlay, player);
    }

    function placeOverlayInControls(overlay, controlsHost) {
        if (!overlay || !controlsHost) return;
        const nativeVolumeGroup = getNativeVolumeGroup(controlsHost);
        if (shouldUseNativeReplacementSlot() && nativeVolumeGroup && nativeVolumeGroup.parentElement === controlsHost) {
            if (overlay.parentElement !== controlsHost || overlay.nextElementSibling !== nativeVolumeGroup) {
                controlsHost.insertBefore(overlay, nativeVolumeGroup);
            }
            return;
        }

        if (nativeVolumeGroup && nativeVolumeGroup.parentElement === controlsHost) {
            if (overlay.parentElement === controlsHost && overlay.previousElementSibling === nativeVolumeGroup) {
                return;
            }
            nativeVolumeGroup.insertAdjacentElement('afterend', overlay);
            return;
        }

        if (overlay.parentElement !== controlsHost || overlay.nextElementSibling) {
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

    function applyNativeVolumeVisibility() {
        const nativeVolumeGroup = getNativeVolumeGroup();
        if (nativeVolumeGroup) {
            const shouldHideNative = isOverlayEnabled() && isNativeVolumeReplacementEnabled();
            const nextDisplay = shouldHideNative ? 'none' : '';
            if (nativeVolumeGroup.style.display !== nextDisplay) {
                nativeVolumeGroup.style.display = nextDisplay;
            }
        }

        const overlay = document.getElementById(OVERLAY_ID);
        const video = getVideoElement();
        const player = getPlayerContainer(video);
        const controlsHost = getTwitchControlsHost();
        if (overlay && player && !isOverlayInteractionFocused(overlay)) {
            placeOverlay(overlay, player, controlsHost);
        }
    }

    function createStylesIfNeeded() {
        const style = createStyleElement(document, 'tm-volume-slider-style');
        if (!style) return;
        style.type = 'text/css';
        const css = `
#${OVERLAY_ID} {
  filter: ${VOLUME_PANEL_DROP_SHADOW};
}

#${OVERLAY_ID} input[type=range] {
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(to right, ${VOLUME_ACCENT_LIGHT} 0%, ${VOLUME_ACCENT_DARK} 50%, rgba(255, 255, 255, 0.15) 50%, rgba(255, 255, 255, 0.15) 100%);
  --tm-active-track-h: 11px;
  --tm-thumb-size: 22px;
  height: 42px;
  border-radius: 12px;
  outline: none;
  position: relative;
  background-size: calc(100% - var(--tm-thumb-size, 22px)) var(--tm-active-track-h, 9px);
  background-position: center;
  background-repeat: no-repeat;
  transition: all 0.2s ease;
  overflow: visible;
}

#${OVERLAY_ID} input[type=range]::-webkit-slider-runnable-track {
  border: none;
  background: transparent;
  height: var(--tm-active-track-h, 9px);
  border-radius: 12px;
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
  transition: all 0.2s ease;
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
  transition: all 0.2s ease;
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
  border-radius: 12px;
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
  background: rgba(55, 48, 62, 0.34);
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
  transition: opacity 0.12s ease 0.04s;
}

#${OVERLAY_ID}.tm-collapsed .tm-volume-controls {
  opacity: 0;
  pointer-events: none;
  transition-delay: 0s;
}

#${OVERLAY_ID}.tm-expanded .tm-volume-controls {
  opacity: 1;
  pointer-events: auto;
}

#${OVERLAY_ID} .tm-volume-top-row {
  flex: 0 0 auto;
  position: relative;
  width: 106px;
  height: 40px;
  box-sizing: border-box;
  pointer-events: none;
}

#${OVERLAY_ID} #${VALUE_LABEL_ID} {
  position: absolute;
  left: 46px;
  top: 50%;
  width: 54px;
  transform: translateY(-50%);
  white-space: nowrap;
}

#${OVERLAY_ID} .tm-volume-slider-row {
  flex: 1 1 auto;
  min-width: 180px;
  height: 40px;
}

#${OVERLAY_ID} .tm-slider-ticks {
  position: absolute;
  left: calc(var(--tm-thumb-size, 22px) / 2);
  right: calc(var(--tm-thumb-size, 22px) / 2);
  top: 50%;
  transform: translateY(-50%);
  height: 9px;
  pointer-events: none;
  background: repeating-linear-gradient(to right, rgba(255,255,255,0.25) 0px, transparent 1px, transparent calc(5% - 1px), rgba(255,255,255,0.25) 5%);
  background-size: 100% 100%;
  opacity: 0;
  transition: opacity 0.2s ease;
}
#${OVERLAY_ID}.tm-expanded .tm-slider-ticks,
#${OVERLAY_ID}:hover .tm-slider-ticks {
  opacity: 1;
}

        `;
        style.textContent = css;
    }

    const { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHoldTimer, clearExpandedHold, scheduleExpandedHoldRelease, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg } = createOverlayUi({
        document, window, getSpeakerIconMode, isAlwaysExpandedEnabled, isSliderOnVideo,
        updateOverlayOpacity, finishExpandedHoldIfDue,
        accentLight: VOLUME_ACCENT_LIGHT, accentDark: VOLUME_ACCENT_DARK, accentMid: VOLUME_ACCENT_MID,
        arcTrack: VOLUME_ARC_TRACK, expandedHoldMs: VOLUME_CHANGE_EXPANDED_HOLD_MS
    });





    function areTwitchControlsHidden() {
        const controlsRoot = getTwitchPlayerControlsRoot();
        const controlsShell = getTwitchPlayerControlsShell();
        const controls = getTwitchPlayerControlsSection();
        if (controlsShell?.getAttribute('aria-hidden') === 'true') return true;
        if (controlsRoot?.getAttribute('data-a-visible') === 'false') return true;
        if (controlsRoot?.getAttribute('aria-hidden') === 'true') return true;
        if (!controls) return false;
        if (controls.getAttribute('aria-hidden') === 'true') return true;
        const shellStyle = controlsShell ? window.getComputedStyle(controlsShell) : null;
        const rootStyle = controlsRoot ? window.getComputedStyle(controlsRoot) : null;
        const controlsStyle = window.getComputedStyle(controls);
        return shellStyle?.display === 'none' ||
            shellStyle?.visibility === 'hidden' ||
            Number(shellStyle?.opacity) === 0 ||
            rootStyle?.display === 'none' ||
            rootStyle?.visibility === 'hidden' ||
            Number(rootStyle?.opacity) === 0 ||
            controlsStyle.display === 'none' ||
            controlsStyle.visibility === 'hidden' ||
            Number(controlsStyle.opacity) === 0;
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
        collapseOverlayIfIdle(overlay, true);
    }



    function collapseOverlayIfIdle(overlay, force = false) {
        window.setTimeout(() => {
            if (isAlwaysExpandedEnabled()) {
                setOverlayExpanded(overlay, true);
                return;
            }
            if (overlay.dataset.tmKeepExpanded === 'true') {
                return;
            }
            if (force || !shouldKeepOverlayExpanded(overlay)) {
                setOverlayExpanded(overlay, false);
            }
        }, 0);
    }

    /**
     * Get Twitch's internal player API (mediaPlayerInstance) via React fiber.
     * Returns object with getVolume(), setVolume(), isMuted(), setMuted() or null.
     */
    function getTwitchPlayerApi() {
        try {
            const playerSel = 'div[data-a-target="player-overlay-click-handler"], .video-player';
            const el = document.querySelector(playerSel);
            if (!el) return null;
            if (cachedApi && cachedApiFromElement === el) {
                return cachedApi;
            }

            let instance;
            for (const key in el) {
                if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                    instance = el[key];
                    break;
                }
            }
            if (!instance) return null;

            let parent = instance.return;
            for (let i = 0; i < 50; i++) {
                if (!parent || !parent.memoizedProps) break;
                const player = parent.memoizedProps.mediaPlayerInstance;
                if (player) {
                    const api = player.core ?? player.playerInstance?.core ?? player;
                    if (typeof api?.getVolume === 'function' && typeof api?.setVolume === 'function') {
                        cachedApi = api;
                        cachedApiFromElement = el;
                        return api;
                    }
                }
                parent = parent.return;
            }
        } catch (e) { /* React structure may change */ }
        cachedApi = null;
        cachedApiFromElement = null;
        return null;
    }

    /**
     * Get effective volume (0 when muted, else 0-100). Use for display when unmuted.
     */
    function getVolume(video) {
        try {
            const api = getTwitchPlayerApi();
            if (api) {
                if (api.isMuted && api.isMuted()) return 0;
                const vol = api.getVolume();
                return Math.round((typeof vol === 'number' ? vol : 0) * 100);
            }
        } catch (e) { /* fall through */ }
        const vol = (video.muted ? 0 : video.volume) || 0;
        return Math.round(vol * 100);
    }

    /**
     * Set volume via Twitch API (preferred) or video element from percentage (0-100).
     */
    function setVolume(video, value) {
        try {
            const api = getTwitchPlayerApi();
            if (api) {
                if (api.isMuted && api.isMuted()) api.setMuted(false);
                api.setVolume(Math.min(1, Math.max(0, value / 100)));
                return;
            }
        } catch (e) { /* fall through */ }
        video.volume = value / 100;
        video.muted = false;
    }

    /**
     * Check if muted via Twitch API or video element.
     */
    function isMuted(video) {
        try {
            const api = getTwitchPlayerApi();
            if (api && api.isMuted) return api.isMuted();
        } catch (e) { /* fall through */ }
        return !!video.muted;
    }

    /**
     * Set mute state via Twitch API or video element.
     */
    function setMuted(video, muted) {
        try {
            const api = getTwitchPlayerApi();
            if (api && api.setMuted) {
                api.setMuted(!!muted);
                return;
            }
        } catch (e) { /* fall through */ }
        video.muted = !!muted;
    }

    function toggleMute(video) {
        setMuted(video, !isMuted(video));
    }

    /**
     * Restore volume and mute from localStorage. Call before syncing slider.
     */
    function restoreSavedVolume(video) {
        const wasMuted = isMuted(video);
        const value = getSavedVolume();
        if (value !== null) {
            setVolume(video, value);
        }
        try {
            const savedMute = localStorage.getItem(MUTE_STORAGE_KEY);
            if (savedMute === 'true') {
                setMuted(video, true);
            } else if (savedMute === 'false') {
                setMuted(video, false);
            } else {
                setMuted(video, wasMuted);
            }
        } catch (e) { /* ignore storage errors */ }
    }

    /**
     * Snap value to nearest 5% (5, 10, 15, ... 100).
     */


    /**
     * Save volume to localStorage for persistence across page reloads.
     */


    /**
     * Save mute state to localStorage.
     */
    function saveMute(muted) {
        try {
            localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
        } catch (e) { /* ignore storage errors */ }
    }

    function markUserVolumeIntent() {
        userIntentUntil = Date.now() + USER_INTENT_GRACE_MS;
    }


    function setSliderFromPlayer(slider, label, video) {
        try {
            const muted = isMuted(video);
            const displayValue = getVolume(video);
            slider.value = String(displayValue);
            if (label) {
                label.textContent = muted ? 'Muted' : `${displayValue}%`;
            }
            updateSliderBar(slider);
            updateVolumeIndicator(document.getElementById(OVERLAY_ID), displayValue, muted);
        } catch (e) { /* prevent crash */ }
    }



    function ensureOptionsStyles() {
        const style = createStyleElement(document, OPTIONS_STYLE_ID);
        if (!style) return;
        style.type = 'text/css';
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
            .tm-volume-options-controls-shell-hold,
            [data-a-target="player-controls"].tm-volume-options-controls-hold,
            [data-a-target="player-controls"].tm-volume-options-controls-hold #channel-player {
                opacity: 1 !important;
                pointer-events: auto !important;
                visibility: visible !important;
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


    function injectVolumeOptionsButton() {
        ensureOptionsStyles();
        const host = getTwitchRightControlsHost();
        const settingsWrapper = getTwitchSettingsWrapper(host);
        const settingsBtn = getTwitchSettingsButton(host);
        if (!host || !settingsWrapper || !settingsBtn) return;
        ensureNativeSettingsHoldIsolation();

        let wrapper = document.getElementById(`${OPTIONS_BUTTON_ID}-wrapper`);
        if (wrapper && wrapper.parentElement === host && wrapper.nextElementSibling === settingsWrapper) {
            updateOptionsButtonState();
            return;
        }
        if (wrapper && wrapper.querySelector(`#${OPTIONS_BUTTON_ID}`)) {
            host.insertBefore(wrapper, settingsWrapper);
            updateOptionsButtonState();
            ensureOptionsControlsHoldObserver();
            return;
        }
        wrapper?.remove();

        wrapper = document.createElement('div');
        wrapper.id = `${OPTIONS_BUTTON_ID}-wrapper`;
        wrapper.className = 'InjectLayout-sc-1i43xsx-0 iDMNUO';

        const inner = document.createElement('div');
        inner.className = 'Layout-sc-1xcs6mc-0 ScLayoutCssVars-sc-1pn65j5-0 jfyitl kDsKkP';

        const btn = document.createElement('button');
        btn.id = OPTIONS_BUTTON_ID;
        btn.type = 'button';
        btn.className = settingsBtn.className || 'ScCoreButton-sc-ocjdkq-0 ScButtonIcon-sc-9yap0r-0';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');

        const figure = document.createElement('div');
        figure.className = 'ButtonIconFigure-sc-1emm8lf-0 lnTwMD';
        const svgWrap = document.createElement('div');
        svgWrap.className = 'ScSvgWrapper-sc-wkgzod-0 kccyMt tw-svg';
        svgWrap.appendChild(createOptionsButtonIconSvg(document));
        figure.appendChild(svgWrap);
        btn.appendChild(figure);
        updateOptionsButtonState(btn);

        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleVolumeOptionsPopup();
        });

        inner.appendChild(btn);
        wrapper.appendChild(inner);
        host.insertBefore(wrapper, settingsWrapper);
        ensureOptionsControlsHoldObserver();
    }

    function isOptionsButtonInPreferredSlot() {
        const host = getTwitchRightControlsHost();
        const settingsWrapper = getTwitchSettingsWrapper(host);
        const wrapper = document.getElementById(`${OPTIONS_BUTTON_ID}-wrapper`);
        return !!(host && settingsWrapper && wrapper && wrapper.parentElement === host && wrapper.nextElementSibling === settingsWrapper);
    }

    function removeVolumeOptionsButton() {
        document.getElementById(`${OPTIONS_BUTTON_ID}-wrapper`)?.remove();
        closeVolumeOptionsPopup();
    }

    let optionsPopupOutsideHandler = null;
    let optionsPopupKeyHandler = null;
    let optionsPopupRepositionHandler = null;
    let optionsPopupOpener = null;
    let optionsPostCloseOutsideHandler = null;
    let optionsPostCloseControlsTimer = 0;

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
        setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent
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
        const bottomPx = playerRect.bottom - btnRect.top + 8;

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

    function keepTwitchControlsVisible() {
        const controlsRoot = getTwitchPlayerControlsRoot();
        const controlsShell = getTwitchPlayerControlsShell();
        const controls = getTwitchPlayerControlsSection();
        if (controlsShell) {
            controlsShell.classList.add('tm-volume-options-controls-shell-hold');
            controlsShell.setAttribute('aria-hidden', 'false');
            controlsShell.style.opacity = '1';
            controlsShell.style.visibility = 'visible';
        }
        if (controlsRoot) {
            controlsRoot.classList.add('tm-volume-options-controls-hold');
            controlsRoot.setAttribute('data-a-visible', 'true');
            controlsRoot.setAttribute('aria-hidden', 'false');
            controlsRoot.style.opacity = '1';
            controlsRoot.style.visibility = 'visible';
        }
        if (controls) {
            controls.setAttribute('aria-hidden', 'false');
            controls.style.opacity = '1';
            controls.style.visibility = 'visible';
        }
    }

    function hideTwitchControls() {
        const controlsRoot = getTwitchPlayerControlsRoot();
        const controlsShell = getTwitchPlayerControlsShell();
        const controls = getTwitchPlayerControlsSection();
        if (controlsShell) {
            controlsShell.setAttribute('aria-hidden', 'true');
        }
        if (controlsRoot) {
            controlsRoot.setAttribute('data-a-visible', 'false');
            controlsRoot.setAttribute('aria-hidden', 'true');
        }
        if (controls) {
            controls.setAttribute('aria-hidden', 'true');
        }
    }

    function isPointerOverTwitchPlayerArea() {
        const player = getPlayerContainer();
        const controlsRoot = getTwitchPlayerControlsRoot();
        return !!(player?.matches?.(':hover') || controlsRoot?.matches?.(':hover'));
    }

    function isClickOutsideTwitchPlayerArea(event) {
        const target = event.target;
        if (getPlayerContainer()?.contains?.(target)) return false;
        if (getTwitchPlayerControlsRoot()?.contains?.(target)) return false;
        return true;
    }

    function releaseTwitchControlsVisibility() {
        const controlsRoot = getTwitchPlayerControlsRoot();
        const controlsShell = getTwitchPlayerControlsShell();
        const controls = getTwitchPlayerControlsSection();
        controlsShell?.classList?.remove('tm-volume-options-controls-shell-hold');
        [controlsShell, controlsRoot, controls].forEach((el) => {
            el?.classList?.remove('tm-volume-options-controls-hold');
            el?.style?.removeProperty('opacity');
            el?.style?.removeProperty('visibility');
            el?.style?.removeProperty('pointer-events');
        });
    }

    function startOptionsControlsHold() {
        keepTwitchControlsVisible();
        ensureOptionsControlsHoldObserver();
    }

    function stopOptionsControlsHold() {
        releaseTwitchControlsVisibility();
    }

    function clearPostCloseControlsHold() {
        if (optionsPostCloseControlsTimer) {
            clearTimeout(optionsPostCloseControlsTimer);
            optionsPostCloseControlsTimer = 0;
        }
        if (optionsPostCloseOutsideHandler) {
            document.removeEventListener('click', optionsPostCloseOutsideHandler, true);
            optionsPostCloseOutsideHandler = null;
        }
    }

    function endPostCloseControlsHold(hideControls) {
        clearPostCloseControlsHold();
        if (hideControls && !isNativeSettingsMenuOpen()) {
            hideTwitchControls();
        }
        releaseTwitchControlsVisibility();
    }

    function startPostCloseControlsHold() {
        if (isNativeSettingsMenuOpen()) return;
        clearPostCloseControlsHold();
        keepTwitchControlsVisible();
        optionsPostCloseControlsTimer = window.setTimeout(() => {
            endPostCloseControlsHold(!isPointerOverTwitchPlayerArea());
        }, TWITCH_CONTROLS_OUTSIDE_CLOSE_HOLD_MS);

        optionsPostCloseOutsideHandler = (event) => {
            if (isClickOnNativeSettingsUi(event)) return;
            if (!isClickOutsideTwitchPlayerArea(event)) return;
            endPostCloseControlsHold(true);
        };
        document.addEventListener('click', optionsPostCloseOutsideHandler, true);
    }

    function openVolumeOptionsPopup() {
        clearPostCloseControlsHold();
        ensureOptionsStyles();
        const popup = ensureOptionsPopup();
        if (!popup) return;
        optionsPopupOpener = document.activeElement;
        refreshOptionsPopupState();
        popup.removeAttribute('hidden');
        positionOptionsPopup(popup, true);
        startOptionsControlsHold();
        document.getElementById(OPTIONS_BUTTON_ID)?.setAttribute('aria-expanded', 'true');
        const initialFocus = popup.querySelector('[id^="tm-volume-options-mode-"][role="radio"][aria-checked="true"]:not(:disabled)') || getOptionsPopupFocusable(popup)[0];
        initialFocus?.focus();

        if (!optionsPopupOutsideHandler) {
            optionsPopupOutsideHandler = (event) => {
                const btn = document.getElementById(OPTIONS_BUTTON_ID);
                if (popup.contains(event.target) || btn?.contains(event.target)) return;
                const clickedOutsideControls = !getTwitchPlayerControlsRoot()?.contains?.(event.target);
                closeVolumeOptionsPopup();
                if (clickedOutsideControls) startPostCloseControlsHold();
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
        stopOptionsControlsHold();
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
        if (window.__tmTwitchVolumeNativeSettingsCloseBound) return;
        window.__tmTwitchVolumeNativeSettingsCloseBound = true;
        document.addEventListener('click', (event) => {
            if (event.target?.closest?.(TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR)) {
                closeVolumeOptionsPopup();
            }
        }, false);
        ensureNativeSettingsHoldIsolation();
    }

    function disconnectOptionsControlsHoldObserver() {
        optionsControlsHoldObserver?.disconnect();
        optionsControlsHoldObserver = null;
        optionsControlsHoldTargetKey = null;
    }

    function disconnectNativeSettingsObserver() {
        nativeSettingsObserver?.disconnect();
        nativeSettingsObserver = null;
        nativeSettingsObserverTarget = null;
    }

    function ensureNativeSettingsHoldIsolation() {
        const settingsBtn = getTwitchSettingsButton();
        if (!settingsBtn) return;
        if (nativeSettingsObserverTarget === settingsBtn) return;
        disconnectNativeSettingsObserver();
        nativeSettingsObserverTarget = settingsBtn;
        nativeSettingsObserver = new MutationObserver(() => {
            if (isNativeSettingsMenuOpen()) {
                endPostCloseControlsHold(false);
            }
        });
        nativeSettingsObserver.observe(settingsBtn, { attributes: true, attributeFilter: ['aria-expanded'] });
    }

    function toggleVolumeOptionsPopup() {
        if (isOptionsPopupOpen()) {
            closeVolumeOptionsPopup();
        } else {
            openVolumeOptionsPopup();
        }
    }

    function ensureOptionsControlsHoldObserver() {
        const controlsRoot = getTwitchPlayerControlsRoot();
        const controlsShell = getTwitchPlayerControlsShell();
        const controls = getTwitchPlayerControlsSection();
        if (!controlsRoot && !controlsShell && !controls) return;

        const targetKey = [controlsRoot, controlsShell, controls].map((el) => el?.id || el?.className || '').join('|');
        if (optionsControlsHoldTargetKey === targetKey) return;

        disconnectOptionsControlsHoldObserver();
        optionsControlsHoldTargetKey = targetKey;
        optionsControlsHoldObserver = new MutationObserver(() => {
            if (areTwitchControlsHidden() && isOptionsPopupOpen()) {
                keepTwitchControlsVisible();
            }
        });
        if (controlsShell) {
            optionsControlsHoldObserver.observe(controlsShell, { attributes: true, attributeFilter: ['aria-hidden', 'style', 'class'] });
        }
        if (controlsRoot) {
            optionsControlsHoldObserver.observe(controlsRoot, { attributes: true, attributeFilter: ['data-a-visible', 'aria-hidden', 'style', 'class'] });
        }
        if (controls) {
            optionsControlsHoldObserver.observe(controls, { attributes: true, attributeFilter: ['aria-hidden', 'style', 'class'] });
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
            padding: '0 12px 0 0',
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
            collapseOverlayIfIdle(overlay, true);
            updateOverlayOpacity(overlay);
        });
        overlay.addEventListener('focusin', () => {
            setOverlayExpanded(overlay, true);
            updateOverlayOpacity(overlay);
        });
        overlay.addEventListener('focusout', () => {
            collapseOverlayIfIdle(overlay);
            updateOverlayOpacity(overlay);
        });

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
            markUserVolumeIntent();
            toggleMute(video);
            saveMute(isMuted(video));
            setSliderFromPlayer(slider, label, video);
            markVolumeChangedWhileExpanded(overlay);
        });
        const panelBg = document.createElement('div');
        panelBg.className = 'tm-volume-panel-bg';

        const topRow = document.createElement('div');
        topRow.className = 'tm-volume-controls tm-volume-top-row';
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '0';
        topRow.style.flex = '0 0 auto';
        topRow.style.position = 'relative';
        topRow.style.width = '106px';
        topRow.style.height = '40px';
        topRow.style.boxSizing = 'border-box';

        const label = document.createElement('div');
        label.id = VALUE_LABEL_ID;
        Object.assign(label.style, {
            fontSize: '18px',
            fontWeight: '500',
            color: 'rgba(255, 255, 255, 0.95)',
            textAlign: 'center',
            userSelect: 'none',
            letterSpacing: '0',
            position: 'absolute',
            left: '46px',
            top: '50%',
            width: '54px',
            transform: 'translateY(-50%)',
            whiteSpace: 'nowrap'
        });
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
        slider.style.backgroundSize = 'calc(100% - var(--tm-thumb-size, 22px)) 100%';
        slider.setAttribute('aria-label', 'Volume');
        slider.setAttribute('aria-describedby', VALUE_LABEL_ID);

        // Initialize from localStorage to avoid the 100% to actual jump on stream load
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
            saveMute(false);
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
            collapseOverlayIfIdle(overlay, !overlay.matches(':hover'));
            updateOverlayOpacity(overlay);
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
            markUserVolumeIntent();
            applySliderValue(readPressAwareSliderValue());
        });

        slider.addEventListener('change', () => {
            markUserVolumeIntent();
            applySliderValue(readSnappedSliderValue(slider));
        cancelScheduledSaveVolume();
            saveVolume(Number(slider.value) || 0);
            markVolumeChangedWhileExpanded(overlay);
        });

        // Sync slider UI and persist volume on any external/native change
        // During startup lock, re-apply our saved volume if Twitch's player init overrides it
        const onVideoVolumeChange = () => {
            if (Date.now() <= startupLockUntil) {
                if (Date.now() <= userIntentUntil || startupCorrectionApplied) {
                    return;
                }
                // Actively re-apply saved volume when Twitch overrides it during player initialization
                const savedValue = getSavedVolume();
                if (savedValue !== null && Math.abs(getVolume(video) - savedValue) > 1) {
                    setVolume(video, savedValue);
                }
                startupCorrectionApplied = true;
                return;
            }
            try {
                setSliderFromPlayer(slider, label, video);
                if (!isMuted(video)) {
                    scheduleSaveVolume(getVolume(video));
                }
            } catch (e) { /* prevent crash */ }
        };
        video.addEventListener('volumechange', onVideoVolumeChange);

        const onLayoutChange = () => {
            if (!overlay.isConnected) return;
            if (areTwitchControlsHidden()) {
                if (isSliderOnVideo()) {
                    updateVideoOverlayPosition(overlay, getPlayerContainer(video));
                }
                if (isOverlayInteractionFocused(overlay)) {
                    updateOverlayOpacity(overlay);
                    return;
                }
                if (!isAlwaysExpandedEnabled()) {
                    overlay.dataset.tmDragging = 'false';
                    clearExpandedHold(overlay);
                    setOverlayExpanded(overlay, false, true);
                }
                updateOverlayOpacity(overlay);
                return;
            }
            if (isOverlayInteractionFocused(overlay)) return;
            placeOverlay(overlay, getPlayerContainer(video), getTwitchControlsHost());
        };
        window.addEventListener('resize', onLayoutChange);
        const controlsObserver = new MutationObserver(onLayoutChange);
        const controlsRootForLayout = getTwitchPlayerControlsRoot();
        const controlsForLayout = getTwitchPlayerControlsSection();
        if (controlsRootForLayout) {
            controlsObserver.observe(controlsRootForLayout, { attributes: true, attributeFilter: ['data-a-visible', 'class', 'aria-hidden', 'style'] });
        }
        if (controlsForLayout) {
            controlsObserver.observe(controlsForLayout, { attributes: true, attributeFilter: ['class', 'aria-hidden', 'style'] });
        }

        sliderWrap.appendChild(slider);
        sliderWrap.appendChild(tickOverlay);
        overlay.appendChild(panelBg);
        overlay.appendChild(iconCell);
        overlay.appendChild(topRow);
        overlay.appendChild(sliderWrap);
        placeOverlay(overlay, player, controlsHost);
        setSliderFromPlayer(slider, label, video);
        setOverlayExpanded(overlay, false, true);

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
        const controlsHost = getTwitchControlsHost();

        // Keep the options button available even when the slider is off.
        if (!isOverlayEnabled()) {
            removeOverlay();
            injectVolumeOptionsButton();
            return !!document.getElementById(OPTIONS_BUTTON_ID);
        }

        if (!video || !player || !controlsHost) {
            injectVolumeOptionsButton();
            return false;
        }
        // Only restore volume and schedule fade-in on first attach
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) {
            // Extend to at least 2s from now; cooperates with the longer lock
            // already set by scheduleReattach on channel navigation without shortening it
            startupLockUntil = Math.max(startupLockUntil, Date.now() + 2000);
            restoreSavedVolume(video);
            createOverlay(video, player, controlsHost);
            setTimeout(() => {
                restoreSavedVolume(video);
                const el = document.getElementById(OVERLAY_ID);
                if (el) updateOverlayOpacity(el);
            }, 1500);
        } else if (!isOverlayInteractionFocused(overlay)) {
            placeOverlay(overlay, player, controlsHost);
        } else {
            updateOverlayOpacity(overlay);
        }
        applyNativeVolumeVisibility();
        injectVolumeOptionsButton();
        ensureOptionsControlsHoldObserver();
        ensureNativeSettingsHoldIsolation();
        ensureAttachObserver();
        return true;
    }

    function getAttachObserverRoot() {
        return getPlayerContainer() || getTwitchPlayerControlsRoot();
    }

    let lastAttach = 0;
    const ATTACH_COOLDOWN_MS = 1000;
    let attachQueued = false;

    function handleAttachObserverMutations(mutations) {
        const hasAddedNodes = mutations.some((m) => m.addedNodes && m.addedNodes.length > 0);
        if (!hasAddedNodes || attachQueued) return;

        applyNativeVolumeVisibility();
        const overlay = document.getElementById(OVERLAY_ID);
        const button = document.getElementById(OPTIONS_BUTTON_ID);
        const overlayMissing = isOverlayEnabled() && (!overlay || !overlay.isConnected);
        const buttonMissing = !button || !button.isConnected;
        const buttonMisplaced = !buttonMissing && !isOptionsButtonInPreferredSlot();
        if (!overlayMissing && !buttonMissing && !buttonMisplaced) return;

        attachQueued = true;
        requestAnimationFrame(() => {
            attachQueued = false;
            if (!isOverlayEnabled()) {
                injectVolumeOptionsButton();
                return;
            }
            const currentOverlay = document.getElementById(OVERLAY_ID);
            if (currentOverlay && currentOverlay.isConnected) {
                injectVolumeOptionsButton();
                return;
            }
            const now = Date.now();
            if (now - lastAttach < ATTACH_COOLDOWN_MS) return;
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

    function setupNavigationHandler() {
        if (window.__tmTwitchVolumeNavPatched) return;
        window.__tmTwitchVolumeNavPatched = true;
        const getPathFromUrlArg = (urlArg) => {
            try {
                if (urlArg === undefined || urlArg === null || urlArg === '') {
                    return window.location.pathname;
                }
                return new URL(String(urlArg), window.location.href).pathname;
            } catch (e) {
                return window.location.pathname;
            }
        };

        const runReattach = () => {
            if (navReattachTimer) {
                clearTimeout(navReattachTimer);
                navReattachTimer = 0;
            }
            if (navLateRestoreTimer) {
                clearTimeout(navLateRestoreTimer);
                navLateRestoreTimer = 0;
            }

            // Invalidate stale player API and video caches so we re-discover fresh instances
            // after Twitch rebuilds its React fiber tree on channel navigation
            cachedApi = null;
            cachedApiFromElement = null;
            resetVideoElement();
            closeVolumeOptionsPopup();
            disconnectOptionsControlsHoldObserver();
            disconnectNativeSettingsObserver();
            disconnectAttachObserver();

            // Set the startup lock IMMEDIATELY (not just when the new overlay is created at 700ms).
            // On fast machines Twitch re-initializes the player in <100ms and fires volumechange
            // before our reattach timeout fires. Without this, the OLD overlay's volumechange
            // listener would run while startupLockUntil is still 0, saving Twitch's reset
            // volume (typically 100%) over our persisted value - corrupting localStorage before
            // we even get a chance to restore.
            // Use 3500ms (vs 2000ms on initial load) - channel nav takes longer for Twitch
            // to fully re-initialize its player than a full page load does.
            startupLockUntil = Date.now() + 3500;
            startupCorrectionApplied = false;

            navReattachTimer = window.setTimeout(() => {
                removeOverlay();
                removeVolumeOptionsButton();
                attachSliderIfPossible();
                navReattachTimer = 0;
            }, NAV_REATTACH_DELAY_MS);

            // Late recovery restore: catches cases where Twitch's player finishes its own
            // volume initialization after our startup lock has already expired
            navLateRestoreTimer = window.setTimeout(() => {
                navLateRestoreTimer = 0;
                if (Date.now() <= userIntentUntil) return;
                const vid = getVideoElement();
                if (!vid) return;
                    const saved = getSavedVolume();
                    if (saved !== null && Math.abs(getVolume(vid) - saved) > 1) {
                        restoreSavedVolume(vid);
                        const sliderEl = document.getElementById(SLIDER_ID);
                        const labelEl = document.getElementById(VALUE_LABEL_ID);
                        if (sliderEl) setSliderFromPlayer(sliderEl, labelEl, vid);
                    }
            }, NAV_LATE_RESTORE_DELAY_MS);
        };

        const scheduleReattachIfPathChanged = (nextPath) => {
            const targetPath = nextPath || window.location.pathname;
            if (targetPath === lastKnownPath) return;
            lastKnownPath = targetPath;
            if (navDebounceTimer) {
                clearTimeout(navDebounceTimer);
                navDebounceTimer = 0;
            }
            navDebounceTimer = window.setTimeout(() => {
                navDebounceTimer = 0;
                runReattach();
            }, NAV_DEBOUNCE_MS);
        };

        const originalPushState = history.pushState;
        history.pushState = function () {
            const result = originalPushState.apply(this, arguments);
            scheduleReattachIfPathChanged(getPathFromUrlArg(arguments[2]));
            return result;
        };

        const originalReplaceState = history.replaceState;
        history.replaceState = function () {
            const result = originalReplaceState.apply(this, arguments);
            scheduleReattachIfPathChanged(getPathFromUrlArg(arguments[2]));
            return result;
        };

        window.addEventListener('popstate', () => {
            scheduleReattachIfPathChanged(window.location.pathname);
        }, true);
    }

    function init() {
        setupInitialAttempts();
        setupAttachObserver();
        setupNavigationHandler();
        setupNativeSettingsCloseHandler();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init, { once: true });
    }
}
