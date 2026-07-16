import { createOverlayUi } from '../shared/overlay-ui.js';
import { createOptionsUi } from '../shared/options-ui.js';
import { createVolumeSettings } from '../shared/settings.js';
import { createVolumePersistence, snapTo5 } from '../shared/volume.js';
import { createOptionsButtonIconSvg, getOptionsPopupFocusable } from '../shared/options.js';
import { createCleanupRegistry, createOverlayLifecycle, createVideoLocator } from '../shared/lifecycle.js';
import { createStyleElement } from '../shared/styles.js';
import { bindRangePointerInteraction, bindWheelVolumeStep, createVolumeControlElements, syncVolumeControl } from '../shared/slider-interactions.js';
import { createDebugNodeIdentifier, createRollingDebugRecorder } from '../shared/debug-recorder.js';
import { createTwitchControlsVisibilityManager } from './twitch-controls-visibility.js';

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
    const OVERLAY_SIZE_KEY = 'tm-twitch-volume-slider-size';
    const SLIDER_THICKNESS_KEY = 'tm-twitch-volume-slider-thickness';
    const VOLUME_APPEARANCE_KEY = 'tm-twitch-volume-slider-appearance';
    const DEFAULT_OVERLAY_OPACITY_IDLE = 45;
    const DEFAULT_OVERLAY_OPACITY_ACTIVE = 95;
    const DEFAULT_OVERLAY_SIZE = 100;
    const DEFAULT_SLIDER_THICKNESS = 75;
    const STORAGE_WRITE_DEBOUNCE_MS = 150;
    const VOLUME_CHANGE_EXPANDED_HOLD_MS = 1200;
    const WHEEL_VOLUME_STEP = 5;
    const VOLUME_LABEL_ROW_WIDTH_PX = 50;
    const TWITCH_CONTROLS_OUTSIDE_CLOSE_HOLD_MS = 5000;
    const KEYBOARD_CONTROLS_HOLD_MS = 3000;
    const TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR =
        '[data-a-target="player-settings-button"], button[aria-label="Settings"]';
    const TWITCH_NATIVE_SETTINGS_UI_SELECTOR =
        `${TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR}, ` +
        '[data-a-target="player-settings-menu"], ' +
        '[data-a-target="player-settings-submenu"], ' +
        '[data-a-target="player-settings-submenu-back-button"]';
    const TWITCH_PREVIEW_PLAYER_MAX_WIDTH_PX = 720;
    const ON_VIDEO_IDLE_BOTTOM_PX = 12;
    const ON_VIDEO_MAX_CONTROLS_OFFSET_PX = 140;
    const COMPACT_CONTROLS_MAX_WIDTH_PX = 640;
    const VOLUME_ACCENT_LIGHT = '#a970ff';
    const VOLUME_ACCENT_DARK = '#9146ff';
    const VOLUME_ACCENT_MID = '#b38cff';
    const VOLUME_ACCENT_DISABLED = 'rgba(145, 70, 255, 0.55)';
    const VOLUME_ARC_TRACK = 'rgba(255, 255, 255, 0.38)';
    const VOLUME_PANEL_DROP_SHADOW = 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.06))';
    const STARTUP_MUTE_GUARD_MS = 4000;
    const STARTUP_MUTE_GUARD_INTERVAL_MS = 50;
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
        overlayOpacityFocused: 'saved',
        // On-video slider size: 'saved' or 100-200 as a percentage. Default: 100
        overlaySize: 'saved',
        // Bar thickness: 'saved' or 25-125 as a percentage of the 2.5 bar. Default: 75
        sliderThickness: 'saved',
        // Volume icon style: 'saved', 'new', or 'classic'. Default: 'saved'
        volumeAppearance: 'saved'
    };

    let cachedApi = null;
    let cachedApiFromElement = null;
    let startupLockUntil = 0;
    let startupCorrectionApplied = false;
    let stopActiveStartupMuteGuard = null;
    let userIntentUntil = 0;
    let navReattachTimer = 0;
    let navLateRestoreTimer = 0;
    let navDebounceTimer = 0;
    let lastKnownPath = window.location.pathname;
    let attachObserver = null;
    let attachObserverTarget = null;
    let attachBootstrapObserver = null;
    let nativeSettingsObserver = null;
    let nativeSettingsObserverTarget = null;
    let delayedFirstAttachRestoreTimer = 0;
    const overlayLifecycle = createOverlayLifecycle();
    const { getVideoElement, resetVideoElement, ensurePlayerPositioning } = createVideoLocator(document, window);
    const USER_INTENT_GRACE_MS = 5000;
    const NAV_REATTACH_DELAY_MS = 700;
    const NAV_LATE_RESTORE_DELAY_MS = 4200;
    const NAV_DEBOUNCE_MS = 180;

    // -------------------------------
    // Overlay State
    // -------------------------------





    const { getSavedVolumeSliderMode, getVolumeSliderMode, getReplaceNativePlacement, getSliderLocation, isSliderOnVideo, setSliderLocation, setReplaceNativePlacement, getVolumeAppearance, setVolumeAppearance, updateOverlayAppearance, isSnapTo5Enabled, setSnapTo5Enabled, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled, getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent, getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent, getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent, beginThicknessSliderPreview, endThicknessSliderPreview, beginOpacitySliderPreview, endOpacitySliderPreview, updateOverlaySize, updateSliderThickness, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode, isOverlayEnabled, isNativeVolumeReplacementEnabled, shouldUseNativeReplacementSlot } = createVolumeSettings({
        document, storage: localStorage, userSettings: USER_SETTINGS, overlayId: OVERLAY_ID,
        keys: { mode: VOLUME_MODE_KEY, location: SLIDER_LOCATION_KEY, replacePlacement: REPLACE_NATIVE_PLACEMENT_KEY, snap: SNAP_TO_5_KEY, expanded: ALWAYS_EXPANDED_KEY, idleOpacity: OVERLAY_OPACITY_IDLE_KEY, activeOpacity: OVERLAY_OPACITY_ACTIVE_KEY, overlaySize: OVERLAY_SIZE_KEY, sliderThickness: SLIDER_THICKNESS_KEY, appearance: VOLUME_APPEARANCE_KEY },
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
    const makeControlsVisibilityManager = () => createTwitchControlsVisibilityManager({
            window,
            MutationObserver: window.MutationObserver,
            getTargets: () => ({
                root: getTwitchPlayerControlsRoot(),
                shell: getTwitchPlayerControlsShell(),
                controls: getTwitchPlayerControlsSection()
            }),
            areControlsHidden: () => areTwitchControlsHidden()
        });
    let controlsVisibility = makeControlsVisibilityManager();
    const debugNodeId = createDebugNodeIdentifier('twitch');
    const debugRecorder = createRollingDebugRecorder({
        window,
        document,
        platform: 'twitch',
        getSnapshot: () => {
            const video = getVideoElement();
            const player = getPlayerContainer(video);
            const overlay = document.getElementById(OVERLAY_ID);
            let api = null;
            try { api = video ? getTwitchPlayerApi(video) : null; } catch { /* diagnostic snapshot only */ }
            return {
                path: `${window.location.pathname}${window.location.search}`,
                savedVolume: getSavedVolume(),
                savedMute: readDebugStorage(MUTE_STORAGE_KEY),
                mode: getVolumeSliderMode(),
                video: video ? { id: debugNodeId(video), connected: video.isConnected, src: video.currentSrc || video.src, readyState: video.readyState, nativeVolume: video.volume, nativeMuted: video.muted, apiVolume: getVolume(video), apiMuted: isMuted(video) } : null,
                api: api ? { getVolume: typeof api.getVolume, setVolume: typeof api.setVolume, isMuted: typeof api.isMuted, setMuted: typeof api.setMuted } : null,
                player: player ? { id: debugNodeId(player), className: player.className } : null,
                overlay: overlay ? { id: debugNodeId(overlay), connected: overlay.isConnected, ownsVideo: overlay._tmVolumeVideo === video, className: overlay.className } : null,
                startupLockRemainingMs: startupLockUntil - Date.now(),
                userIntentRemainingMs: userIntentUntil - Date.now(),
                controlsHidden: areTwitchControlsHidden(player),
                controlsHolds: controlsVisibility.size
            };
        }
    });

    function readDebugStorage(key) {
        try { return localStorage.getItem(key); } catch { return '[unavailable]'; }
    }























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
            video.closest('[data-a-target="video-player"], .video-player') ||
            video.closest('.video-player__container') ||
            video.parentElement
        );
    }

    function getVideoOverlayContainer(video = getVideoElement(), player = getPlayerContainer(video)) {
        return video?.closest?.('.video-player__container') || player;
    }

    function getElementWidth(element) {
        const rect = element?.getBoundingClientRect?.();
        const width = Number(rect?.width);
        return Number.isFinite(width) && width > 0 ? width : 0;
    }

    function isTwitchPreviewPlayerWidth(width) {
        return width > 0 && width <= TWITCH_PREVIEW_PLAYER_MAX_WIDTH_PX;
    }

    function updateTwitchPreviewPlayerSizing(overlay, player) {
        if (!overlay) return;
        const playerWidth = getElementWidth(player);
        const isPreviewPlayer = isTwitchPreviewPlayerWidth(playerWidth);
        overlay.classList.toggle('tm-twitch-preview-player', isPreviewPlayer);
        if (isPreviewPlayer) {
            overlay.style.setProperty('--tm-twitch-preview-player-width', `${playerWidth.toFixed(2)}px`);
        } else {
            overlay.style.removeProperty('--tm-twitch-preview-player-width');
        }
    }

    function getTwitchControlsHost(player = getPlayerContainer()) {
        return (
            player?.querySelector?.('.player-controls__left-control-group') ||
            document.querySelector('#channel-player .player-controls__left-control-group') ||
            document.querySelector('[aria-label="Player Controls"] .player-controls__left-control-group') ||
            document.querySelector('.player-controls__left-control-group')
        );
    }

    function getTwitchPlayerControlsRoot(player = getPlayerContainer()) {
        return (
            player?.querySelector?.('[data-a-target="player-controls"].player-controls') ||
            player?.querySelector?.('[data-a-target="player-controls"]') ||
            document.querySelector('[data-a-target="player-controls"].player-controls') ||
            document.querySelector('[data-a-target="player-controls"]')
        );
    }

    function getTwitchPlayerControlsShell(player = getPlayerContainer()) {
        return getTwitchPlayerControlsRoot(player)?.closest?.('.tw-transition') || null;
    }

    function getTwitchPlayerControlsSection(player = getPlayerContainer()) {
        return (
            player?.querySelector?.('#channel-player, [aria-label="Player Controls"]') ||
            document.querySelector('#channel-player, [aria-label="Player Controls"]')
        );
    }

    function getTwitchRightControlsHost(player = getPlayerContainer()) {
        return (
            player?.querySelector?.('.player-controls__right-control-group') ||
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

    function getLayoutWidth(element) {
        const rectWidth = element?.getBoundingClientRect?.().width || 0;
        return rectWidth > 0 ? rectWidth : (element?.clientWidth || 0);
    }

    function updateControlsCompactLayout(overlay, controlsHost) {
        if (!overlay) return;
        const controlsWidth =
            getLayoutWidth(getTwitchPlayerControlsRoot()) ||
            getLayoutWidth(getTwitchPlayerControlsSection()) ||
            getLayoutWidth(controlsHost);
        overlay.classList.toggle(
            'tm-volume-compact-layout',
            !isSliderOnVideo() && controlsWidth > 0 && controlsWidth <= COMPACT_CONTROLS_MAX_WIDTH_PX
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

    function positionOverlayAboveControls(overlay, overlayHost, player = getPlayerContainer()) {
        const controls = getTwitchPlayerControlsSection(player);
        if (!overlay || !overlayHost || !controls) {
            if (overlay) overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
            return;
        }

        const playerRect = overlayHost.getBoundingClientRect();
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

    function updateVideoOverlayPosition(overlay, overlayHost, player = getPlayerContainer()) {
        if (!overlay || !overlayHost || !isSliderOnVideo()) return;
        if (areTwitchControlsHidden(player)) {
            overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
            return;
        }
        positionOverlayAboveControls(overlay, overlayHost, player);
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
        updateTwitchPreviewPlayerSizing(overlay, player);

        if (isSliderOnVideo()) {
            const overlayHost = getVideoOverlayContainer(undefined, player);
            ensurePlayerPositioning(overlayHost);
            if (overlay.parentElement !== overlayHost) {
                overlayHost.appendChild(overlay);
            }
            updateVideoOverlayPosition(overlay, overlayHost, player);
        } else if (controlsHost) {
            placeOverlayInControls(overlay, controlsHost);
            overlay.style.bottom = '';
        }

        updateControlsCompactLayout(overlay, controlsHost);

        const expanded = overlay.classList.contains('tm-expanded') || isAlwaysExpandedEnabled();
        setOverlayExpanded(overlay, expanded, true);
        updateOverlayOpacity(overlay);
    }

    function applyNativeVolumeVisibility() {
        const video = getVideoElement();
        const player = getPlayerContainer(video);
        const controlsHost = getTwitchControlsHost(player);
        const nativeVolumeGroup = getNativeVolumeGroup(controlsHost);
        if (nativeVolumeGroup) {
            const shouldHideNative = isOverlayEnabled() && isNativeVolumeReplacementEnabled();
            const nextDisplay = shouldHideNative ? 'none' : '';
            if (nativeVolumeGroup.style.display !== nextDisplay) {
                nativeVolumeGroup.style.display = nextDisplay;
            }
        }

        const overlay = document.getElementById(OVERLAY_ID);
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
  --tm-pill-min-width: 228px;
  --tm-pill-zoom-adaptive-width: calc(34vw - 92px);
  --tm-pill-max-width: 368px;
  /* Browser zoom reduces the CSS viewport width, so this shrinks the expanded pill before it clips offscreen. */
  --tm-pill-expanded-width: clamp(var(--tm-pill-min-width), var(--tm-pill-zoom-adaptive-width), var(--tm-pill-max-width));
  --tm-label-row-width: 50px;
  --tm-slider-row-offset: 62px;
  filter: ${VOLUME_PANEL_DROP_SHADOW};
}

/* Match Twitch's native control footprint so the custom control does not raise the control row. */
#${OVERLAY_ID}.tm-in-controls {
  height: 32px !important;
  min-height: 32px !important;
  overflow: clip !important;
  overflow-clip-margin: 4px;
  transform: translateY(0) !important;
}

#${OVERLAY_ID}.tm-in-controls .tm-volume-panel-bg {
  top: -4px;
  bottom: auto;
  height: 40px;
}

#${OVERLAY_ID}.tm-in-controls .tm-volume-icon-cell {
  top: -4px;
  left: 0;
}

#${OVERLAY_ID}.tm-volume-appearance-classic {
  --tm-pill-min-width: 274px;
  --tm-pill-zoom-adaptive-width: calc(34vw - 46px);
  --tm-pill-max-width: 414px;
  --tm-label-row-width: 96px;
  --tm-slider-row-offset: 108px;
}

#${OVERLAY_ID}.tm-volume-compact-layout {
  --tm-pill-min-width: 208px;
  --tm-pill-zoom-adaptive-width: min(252px, calc(64vw - 14px));
}

#${OVERLAY_ID}.tm-volume-compact-layout.tm-volume-appearance-classic {
  --tm-pill-min-width: 228px;
  --tm-pill-zoom-adaptive-width: min(292px, calc(64vw + 6px));
}

#${OVERLAY_ID}.tm-volume-compact-layout .tm-volume-slider-row {
  --tm-active-track-h: 9px;
  --tm-visual-track-h: 4px;
  --tm-thumb-size: 18px;
}

#${OVERLAY_ID}.tm-twitch-preview-player {
  --tm-pill-min-width: 184px;
  --tm-pill-zoom-adaptive-width: calc(var(--tm-twitch-preview-player-width, 520px) * 0.48);
  --tm-pill-max-width: 260px;
  --tm-label-row-width: 42px;
  --tm-slider-row-offset: 54px;
}

#${OVERLAY_ID}.tm-twitch-preview-player.tm-volume-appearance-classic {
  --tm-pill-min-width: 220px;
  --tm-pill-zoom-adaptive-width: calc(var(--tm-twitch-preview-player-width, 520px) * 0.58);
  --tm-pill-max-width: 304px;
  --tm-label-row-width: 84px;
  --tm-slider-row-offset: 96px;
}

@media (max-width: 320px) {
  #${OVERLAY_ID},
  #${OVERLAY_ID}.tm-volume-compact-layout {
    --tm-pill-min-width: 176px;
    --tm-pill-zoom-adaptive-width: min(216px, calc(64vw - 14px));
  }

  #${OVERLAY_ID}.tm-volume-appearance-classic,
  #${OVERLAY_ID}.tm-volume-compact-layout.tm-volume-appearance-classic {
    --tm-pill-min-width: 196px;
    --tm-pill-zoom-adaptive-width: min(262px, calc(64vw + 6px));
  }

  #${OVERLAY_ID} .tm-volume-slider-row {
    --tm-active-track-h: 9px;
    --tm-visual-track-h: 4px;
    --tm-thumb-size: 18px;
  }
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
  overflow: visible;
  shape-rendering: geometricPrecision;
}

#${OVERLAY_ID} .tm-volume-arc-track,
#${OVERLAY_ID} .tm-volume-arc {
  shape-rendering: geometricPrecision;
  vector-effect: non-scaling-stroke;
}

#${OVERLAY_ID} .tm-volume-arc {
  stroke-linecap: round;
}

#${OVERLAY_ID} .tm-volume-speaker-icon {
  color: rgba(255, 255, 255, 0.94);
  display: none;
}

#${OVERLAY_ID}.tm-volume-appearance-classic .tm-volume-percent {
  display: none;
}

#${OVERLAY_ID}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="muted"] .tm-volume-speaker-muted,
#${OVERLAY_ID}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="low"] .tm-volume-speaker-low,
#${OVERLAY_ID}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="high"] .tm-volume-speaker-high {
  display: block;
}

#${OVERLAY_ID} .tm-volume-percent {
  fill: rgba(255, 255, 255, 0.96);
  font: 700 15px/1 Arial, Helvetica, sans-serif;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-synthesis: none;
  letter-spacing: 0;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.75);
  text-rendering: geometricPrecision;
  user-select: none;
}

#${OVERLAY_ID} .tm-volume-indicator.muted {
  filter: saturate(0.45);
  opacity: 0.78;
}

#${OVERLAY_ID} .tm-volume-controls {
  position: relative;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity 0.08s ease 0.14s, visibility 0s linear 0.22s;
}

#${OVERLAY_ID}.tm-collapsed .tm-volume-controls {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity 0.08s ease 0.14s, visibility 0s linear 0.22s;
}

#${OVERLAY_ID}.tm-expanded .tm-volume-controls {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
  transition: opacity 0.1s ease, visibility 0s linear 0s;
}

#${OVERLAY_ID} .tm-volume-top-row {
  flex: 0 0 auto;
  position: relative;
  width: var(--tm-label-row-width);
  height: 40px;
  box-sizing: border-box;
  pointer-events: none;
}

#${OVERLAY_ID} #${VALUE_LABEL_ID} {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

#${OVERLAY_ID}.tm-volume-appearance-classic #${VALUE_LABEL_ID} {
  left: 36px;
  top: 50%;
  width: 58px;
  height: auto;
  overflow: visible;
  clip-path: none;
  transform: translateY(-50%);
}

#${OVERLAY_ID} .tm-volume-slider-row {
  --tm-active-track-h: 11px;
  --tm-visual-track-h: 5px;
  --tm-thumb-size: 22px;
  --tm-track-radius: calc(var(--tm-visual-track-h, 5px) / 2);
  flex: 0 0 calc(var(--tm-pill-expanded-width) - var(--tm-slider-row-offset));
  width: calc(var(--tm-pill-expanded-width) - var(--tm-slider-row-offset));
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
  overflow: visible;
  pointer-events: none;
  opacity: 1;
  transition: none;
  z-index: 1;
}

#${OVERLAY_ID} .tm-slider-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--tm-slider-tick-width, 1px);
  height: 100%;
  background: rgba(255,255,255,0.25);
  transform: none;
}

        `;
        style.textContent = css;
    }

    const { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHoldTimer, clearExpandedHold, scheduleExpandedHoldRelease, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg, populateSliderTicks } = createOverlayUi({
        document, window, isAlwaysExpandedEnabled, isSliderOnVideo,
        updateOverlayOpacity, updateOverlaySize, finishExpandedHoldIfDue,
        accentLight: VOLUME_ACCENT_LIGHT, accentDark: VOLUME_ACCENT_DARK, accentMid: VOLUME_ACCENT_MID,
        arcTrack: VOLUME_ARC_TRACK, expandedHoldMs: VOLUME_CHANGE_EXPANDED_HOLD_MS
    });





    function areTwitchControlsHidden(player = getPlayerContainer()) {
        const controlsRoot = getTwitchPlayerControlsRoot(player);
        const controlsShell = getTwitchPlayerControlsShell(player);
        const controls = getTwitchPlayerControlsSection(player);
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
    function getTwitchPlayerApi(video) {
        try {
            const playerSel = 'div[data-a-target="player-overlay-click-handler"], [data-a-target="video-player"], .video-player';
            const player = getPlayerContainer(video);
            const candidates = [
                video?.closest?.(playerSel),
                player,
                player?.closest?.(playerSel),
                player?.querySelector?.(playerSel),
                document.querySelector(playerSel)
            ].filter(Boolean);
            const uniqueCandidates = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
            if (cachedApi && uniqueCandidates.includes(cachedApiFromElement)) {
                return cachedApi;
            }

            for (const el of uniqueCandidates) {
                let instance;
                for (const key in el) {
                    if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                        instance = el[key];
                        break;
                    }
                }
                if (!instance) continue;

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
            const api = getTwitchPlayerApi(video);
            if (api) {
                if (api.isMuted && api.isMuted()) return 0;
                const vol = api.getVolume();
                return Math.round((typeof vol === 'number' ? vol : 0) * 100);
            }
        } catch (e) { /* fall through */ }
        const vol = (video.muted ? 0 : video.volume) || 0;
        return Math.round(vol * 100);
    }

    function getUnderlyingVolume(video) {
        try {
            const api = getTwitchPlayerApi(video);
            if (api) {
                const vol = api.getVolume();
                return Math.round((typeof vol === 'number' ? vol : 0) * 100);
            }
        } catch (e) { /* fall through */ }
        return Math.round((Number(video?.volume) || 0) * 100);
    }

    /**
     * Set volume via Twitch API (preferred) or video element from percentage (0-100).
     */
    function setNativeVideoMuted(video, muted) {
        if (!video) return;
        video.muted = video.defaultMuted = !!muted;
    }

    function setVolume(video, value, options = {}) {
        const preserveMute = options.preserveMute === true;
        const api = getTwitchPlayerApi(video);
        debugRecorder.record('set-volume', { value, preserveMute, viaPlayerApi: !!api, before: getVolume(video), muted: isMuted(video) });
        if (api) {
            if (!preserveMute) {
                try {
                    if (api.isMuted?.()) {
                        if (typeof api.setMuted === 'function') api.setMuted(false);
                        else setNativeVideoMuted(video, false);
                    }
                } catch (e) { setNativeVideoMuted(video, false); }
            }
            try {
                api.setVolume(Math.min(1, Math.max(0, value / 100)));
                return;
            } catch (e) { /* fall through */ }
        }
        video.volume = value / 100;
        if (!preserveMute) {
            setNativeVideoMuted(video, false);
        }
    }

    /**
     * Check if muted via Twitch API or video element.
     */
    function isMuted(video) {
        try {
            const api = getTwitchPlayerApi(video);
            if (api && api.isMuted) return api.isMuted();
        } catch (e) { /* fall through */ }
        return !!video.muted;
    }

    /**
     * Set mute state via Twitch API or video element.
     */
    function setMuted(video, muted) {
        const nextMuted = !!muted;
        if (!nextMuted) {
            stopStartupMuteGuard();
        }
        try {
            const api = getTwitchPlayerApi(video);
            if (api && api.setMuted) {
                api.setMuted(nextMuted);
                setNativeVideoMuted(video, nextMuted);
                return;
            }
        } catch (e) { /* fall through */ }
        setNativeVideoMuted(video, nextMuted);
    }

    function toggleMute(video) {
        setMuted(video, !isMuted(video));
    }

    /**
     * Restore volume and mute from localStorage. Call before syncing slider.
     */
    function restoreSavedVolume(video) {
        const savedMute = readSavedMute();
        const wasMuted = savedMute === null ? isMuted(video) : savedMute;
        if (savedMute === true) {
            setMuted(video, true);
        }
        const value = getSavedVolume();
        debugRecorder.record('restore-start', { value, savedMute, wasMuted, startupLockRemainingMs: startupLockUntil - Date.now() });
        if (value !== null) {
            setVolume(video, value, { preserveMute: wasMuted });
        }
        setMuted(video, wasMuted);
        if (wasMuted) {
            startStartupMuteGuard(video);
        }
        debugRecorder.record('restore-finish', { volume: getVolume(video), muted: isMuted(video) });
    }

    function readSavedMute() {
        try {
            const savedMute = localStorage.getItem(MUTE_STORAGE_KEY);
            if (savedMute === 'true') return true;
            if (savedMute === 'false') return false;
        } catch (e) { /* ignore storage errors */ }
        return null;
    }

    function restoreSavedVolumeBeforeControls(video = getVideoElement()) {
        if (!video) return false;
        startupLockUntil = Math.max(startupLockUntil, Date.now() + 2000);
        restoreSavedVolume(video);
        return true;
    }

    function stopStartupMuteGuard() {
        stopActiveStartupMuteGuard?.();
        stopActiveStartupMuteGuard = null;
    }

    function startStartupMuteGuard(video) {
        if (!shouldHoldSavedMute(video)) return;
        stopStartupMuteGuard();

        const guardUntil = Math.max(startupLockUntil, Date.now() + STARTUP_MUTE_GUARD_MS);
        const enforceSavedMute = () => {
            if (Date.now() > guardUntil || !shouldHoldSavedMute(video)) {
                stopStartupMuteGuard();
                return;
            }
            try {
                const api = getTwitchPlayerApi(video);
                if (api?.setMuted && (!api.isMuted || !api.isMuted())) {
                    api.setMuted(true);
                }
            } catch (e) { /* Twitch API may still be initializing */ }
            if (!video.muted || !video.defaultMuted) {
                setNativeVideoMuted(video, true);
            }
        };

        const timer = window.setInterval(enforceSavedMute, STARTUP_MUTE_GUARD_INTERVAL_MS);
        stopActiveStartupMuteGuard = () => {
            window.clearInterval(timer);
        };
        enforceSavedMute();
    }

    function shouldHoldSavedMute(video) {
        return !!video?.isConnected && readSavedMute() === true && Date.now() > userIntentUntil;
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
        stopStartupMuteGuard();
        userIntentUntil = Date.now() + USER_INTENT_GRACE_MS;
    }


    function setSliderFromPlayer(slider, label, video) {
        try {
            const muted = isMuted(video);
            const displayValue = muted ? getUnderlyingVolume(video) : getVolume(video);
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
        getVolumeAppearance, setVolumeAppearance,
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

        ['new', 'classic'].forEach((appearance) => {
            popup.querySelector(`#tm-volume-options-appearance-${appearance}`)
                ?.setAttribute('aria-checked', getVolumeAppearance() === appearance ? 'true' : 'false');
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
        const overlayHost = getVideoOverlayContainer(undefined, player);
        if (!overlayHost) return null;
        let popup = getOptionsPopup();
        if (!popup || !popup.isConnected) {
            popup?.remove();
            popup = buildOptionsPopup();
            ensurePlayerPositioning(overlayHost);
            overlayHost.appendChild(popup);
        }
        return popup;
    }

    function positionOptionsPopup(popup, resetScroll = false) {
        const btn = document.getElementById(OPTIONS_BUTTON_ID);
        const player = getPlayerContainer();
        const overlayHost = getVideoOverlayContainer(undefined, player);
        if (!btn || !overlayHost || !popup) return;
        const playerRect = overlayHost.getBoundingClientRect();
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

    function isTwitchVideoSurfaceClick(event) {
        const target = event.target;
        const player = getPlayerContainer();
        if (!target || !player?.contains?.(target)) return false;

        return !target.closest?.(
            '[data-a-target="player-controls"], button, a, input, select, textarea, ' +
            '[role="button"], [role="slider"], [role="menuitem"]'
        );
    }

    function startKeyboardControlsHold() {
        controlsVisibility.refresh('keyboard-volume', KEYBOARD_CONTROLS_HOLD_MS);
    }

    function startOptionsControlsHold() {
        controlsVisibility.hold('options');
    }

    function stopOptionsControlsHold() {
        controlsVisibility.release('options');
    }

    function clearPostCloseControlsHold() {
        controlsVisibility.release('post-close');
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
    }

    function startPostCloseControlsHold() {
        if (isNativeSettingsMenuOpen()) return;
        clearPostCloseControlsHold();
        controlsVisibility.hold('post-close', TWITCH_CONTROLS_OUTSIDE_CLOSE_HOLD_MS, () => {
            endPostCloseControlsHold(!isPointerOverTwitchPlayerArea());
        });

        optionsPostCloseOutsideHandler = (event) => {
            if (isClickOnNativeSettingsUi(event)) return;
            if (!isClickOutsideTwitchPlayerArea(event)) return;
            endPostCloseControlsHold(true);
        };
        document.addEventListener('click', optionsPostCloseOutsideHandler, true);
    }

    function markTwitchVolumeInteraction(overlay) {
        markVolumeChangedWhileExpanded(overlay);
        startPostCloseControlsHold();
    }

    function releaseTwitchVolumeFocusSoon(overlay) {
        window.setTimeout(() => {
            const active = document.activeElement;
            if (active && overlay?.contains?.(active)) {
                active.blur();
            }
        }, 0);
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
                if (event.target?.closest?.(TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR)) {
                    window.setTimeout(() => closeVolumeOptionsPopup(), 0);
                    return;
                }
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
                window.setTimeout(() => closeVolumeOptionsPopup(), 0);
            }
        }, false);
        ensureNativeSettingsHoldIsolation();
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
        overlay._tmVolumeVideo = video;

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
        const cleanupRegistry = createCleanupRegistry();

        let hasPointerIntent = false;
        const markPointerIntent = () => {
            hasPointerIntent = true;
            window.removeEventListener('pointermove', markPointerIntent, true);
        };
        cleanupRegistry.listen(window, 'pointermove', markPointerIntent, true);
        overlay.addEventListener('mouseenter', () => {
            if (!hasPointerIntent) return;
            overlay.dataset.tmHovering = 'true';
            setOverlayExpanded(overlay, true);
            updateOverlayOpacity(overlay);
            releaseTwitchVolumeFocusSoon(overlay);
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
        const collapseHeldSliderOnVideoClick = (event) => {
            if (overlay.dataset.tmKeepExpanded !== 'true' || !isTwitchVideoSurfaceClick(event)) return;
            clearExpandedHold(overlay);
            setOverlayExpanded(overlay, false);
        };
        cleanupRegistry.listen(document, 'click', collapseHeldSliderOnVideoClick, true);

        const { iconCell, panelBg, topRow, label, sliderWrap, tickOverlay, slider } = createVolumeControlElements({
            document,
            overlay,
            sliderId: SLIDER_ID,
            valueLabelId: VALUE_LABEL_ID,
            makeVolumeIndicatorSvg,
            populateSliderTicks
        });
        cleanupRegistry.add(() => tickOverlay._tmSliderTicksCleanup?.());
        iconCell.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });
        iconCell.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            markUserVolumeIntent();
            toggleMute(video);
            saveMute(isMuted(video));
            setSliderFromPlayer(slider, label, video);
            markTwitchVolumeInteraction(overlay);
            releaseTwitchVolumeFocusSoon(overlay);
        });
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '0';
        topRow.style.flex = '0 0 auto';
        topRow.style.position = 'relative';
        topRow.style.width = `${VOLUME_LABEL_ROW_WIDTH_PX}px`;
        topRow.style.height = '40px';
        topRow.style.boxSizing = 'border-box';

        Object.assign(label.style, {
            font: '500 14px/40px "YouTube Noto", Roboto, Arial, Helvetica, sans-serif',
            color: '#fff',
            textAlign: 'center',
            textShadow: '0 0 2px rgb(0, 0, 0)',
            userSelect: 'none',
            letterSpacing: '0',
            position: 'absolute',
            left: '0',
            top: '0',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            clipPath: 'inset(50%)',
            whiteSpace: 'nowrap'
        });

        const syncInitialSliderState = (value, muted = false) => {
            syncVolumeControl({ slider, label, overlay, value, muted, updateSliderBar, updateVolumeIndicator });
        };

        // Initialize from localStorage to avoid the 100% to actual jump on stream load
        const initVol = getSavedVolume();
        if (initVol !== null) {
            syncInitialSliderState(initVol, isMuted(video));
        } else {
            syncInitialSliderState(getVolume(video), isMuted(video));
        }

        const applySliderValue = (value, { preserveMute = false, markInteraction = true } = {}) => {
            setVolume(video, value, { preserveMute });
            const muted = isMuted(video);
            saveMute(muted);
            label.textContent = muted ? 'Muted' : `${value}%`;
            updateSliderBar(slider);
            updateVolumeIndicator(overlay, value, muted);
            scheduleSaveVolume(value);
            if (markInteraction) markTwitchVolumeInteraction(overlay);
        };

        const applyKeyboardVolumeStep = (event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const direction = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
            if (!direction) return;
            event.preventDefault();
            event.stopPropagation();
            const currentValue = Number(slider.value) || 0;
            const nextValue = Math.min(100, Math.max(0, currentValue + (direction * WHEEL_VOLUME_STEP)));
            if (nextValue === currentValue) return;
            markUserVolumeIntent();
            slider.value = String(nextValue);
            applySliderValue(nextValue, { preserveMute: true, markInteraction: false });
            startKeyboardControlsHold();
        };
        slider.addEventListener('keydown', applyKeyboardVolumeStep);

        let playerWasLastPressed = false;
        const trackLastPressedArea = (event) => {
            const activePlayer = getPlayerContainer(video) || player;
            playerWasLastPressed = !!activePlayer?.contains?.(event.target);
        };
        document.addEventListener('pointerdown', trackLastPressedArea, true);

        const applyPlayerKeyboardVolumeStep = (event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (isOptionsPopupOpen()) return;
            const target = event.target;
            if (target instanceof window.Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
            const activePlayer = getPlayerContainer(video) || player;
            if (!playerWasLastPressed && !activePlayer?.contains?.(document.activeElement)) return;
            applyKeyboardVolumeStep(event);
        };
        document.addEventListener('keydown', applyPlayerKeyboardVolumeStep, true);

        cleanupRegistry.add(bindWheelVolumeStep({
            target: iconCell,
            slider,
            step: WHEEL_VOLUME_STEP,
            beforeApply: () => markUserVolumeIntent(),
            applyValue: applySliderValue
        }));
        const rangePointer = bindRangePointerInteraction({
            window,
            slider,
            overlay,
            isSnapEnabled: isSnapTo5Enabled,
            readSnappedValue: readSnappedSliderValue,
            snapValue: snapTo5,
            applyValue: applySliderValue,
            setExpanded: () => setOverlayExpanded(overlay, true),
            updateOpacity: () => updateOverlayOpacity(overlay),
            collapseIfIdle: (force) => collapseOverlayIfIdle(overlay, force),
            onFinish: (event, wasDragging) => {
                if (wasDragging && event?.type !== 'blur') releaseTwitchVolumeFocusSoon(overlay);
            },
            finishLayout: (force) => {
                collapseOverlayIfIdle(overlay, force);
                updateOverlayOpacity(overlay);
            }
        });
        cleanupRegistry.add(() => rangePointer.dispose());

        slider.addEventListener('input', () => {
            markUserVolumeIntent();
            applySliderValue(rangePointer.readPressAwareValue());
        });

        slider.addEventListener('change', () => {
            markUserVolumeIntent();
            applySliderValue(readSnappedSliderValue(slider));
            cancelScheduledSaveVolume();
            saveVolume(Number(slider.value) || 0);
            releaseTwitchVolumeFocusSoon(overlay);
        });

        // Sync slider UI and persist volume on any external/native change
        // During startup lock, re-apply our saved volume if Twitch's player init overrides it
        const onVideoVolumeChange = () => {
            debugRecorder.record('volumechange', {
                volume: getVolume(video),
                muted: isMuted(video),
                savedVolume: getSavedVolume(),
                startupLockRemainingMs: startupLockUntil - Date.now(),
                userIntentRemainingMs: userIntentUntil - Date.now(),
                startupCorrectionApplied
            });
            if (Date.now() <= startupLockUntil) {
                if (Date.now() <= userIntentUntil || startupCorrectionApplied) {
                    debugRecorder.record('volumechange-ignored-during-lock', { userIntent: Date.now() <= userIntentUntil, startupCorrectionApplied });
                    return;
                }
                // Actively re-apply saved volume when Twitch overrides it during player initialization
                const savedValue = getSavedVolume();
                if (savedValue !== null && Math.abs(getVolume(video) - savedValue) > 1) {
                    debugRecorder.record('volumechange-corrected-during-lock', { from: getVolume(video), to: savedValue });
                    setVolume(video, savedValue);
                }
                startupCorrectionApplied = true;
                return;
            }
            try {
                setSliderFromPlayer(slider, label, video);
                saveMute(isMuted(video));
                if (!isMuted(video)) {
                    scheduleSaveVolume(getVolume(video));
                }
            } catch (e) { /* prevent crash */ }
        };
        video.addEventListener('volumechange', onVideoVolumeChange);

        const onLayoutChange = () => {
            if (!overlay.isConnected) return;
            const activePlayer = getPlayerContainer(video);
            if (areTwitchControlsHidden(activePlayer)) {
                if (isSliderOnVideo()) {
                    updateVideoOverlayPosition(overlay, getVideoOverlayContainer(video, activePlayer), activePlayer);
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
            placeOverlay(overlay, activePlayer, getTwitchControlsHost(activePlayer));
        };
        window.addEventListener('resize', onLayoutChange);
        const controlsObserver = new MutationObserver(onLayoutChange);
        const controlsRootForLayout = getTwitchPlayerControlsRoot(player);
        const controlsForLayout = getTwitchPlayerControlsSection(player);
        if (controlsRootForLayout) {
            controlsObserver.observe(controlsRootForLayout, { attributes: true, attributeFilter: ['data-a-visible', 'class', 'aria-hidden', 'style'] });
        }
        if (controlsForLayout) {
            controlsObserver.observe(controlsForLayout, { attributes: true, attributeFilter: ['class', 'aria-hidden', 'style'] });
        }

        updateOverlayAppearance(overlay);
        placeOverlay(overlay, player, controlsHost);
        setSliderFromPlayer(slider, label, video);
        setOverlayExpanded(overlay, false, true);
        updateSliderThickness(overlay);

        const cleanup = () => {
            video.removeEventListener('volumechange', onVideoVolumeChange);
            window.removeEventListener('resize', onLayoutChange);
            document.removeEventListener('keydown', applyPlayerKeyboardVolumeStep, true);
            document.removeEventListener('pointerdown', trackLastPressedArea, true);
            controlsObserver.disconnect();
            cleanupRegistry.dispose();
            controlsVisibility.dispose();
            controlsVisibility = makeControlsVisibilityManager();
            if (optionsPostCloseOutsideHandler) {
                document.removeEventListener('click', optionsPostCloseOutsideHandler, true);
                optionsPostCloseOutsideHandler = null;
            }
            clearExpandedHold(overlay);
        };
        overlayLifecycle.set(overlay, cleanup);

        return overlay;
    }

    function disposeActiveOverlay() {
        cancelDelayedFirstAttachRestore();
        overlayLifecycle.dispose();
        cachedApi = null;
        cachedApiFromElement = null;
    }

    function removeOverlay() {
        cancelScheduledSaveVolume();
        disposeActiveOverlay();
        document.getElementById(OVERLAY_ID)?.remove();
        applyNativeVolumeVisibility();
    }

    function cancelDelayedFirstAttachRestore() {
        if (!delayedFirstAttachRestoreTimer) return;
        window.clearTimeout(delayedFirstAttachRestoreTimer);
        delayedFirstAttachRestoreTimer = 0;
    }

    function attachSliderIfPossible() {
        resetVideoElement();
        const video = getVideoElement();
        const player = getPlayerContainer(video);
        const controlsHost = getTwitchControlsHost(player);
        debugRecorder.record('attach-attempt', { videoPresent: !!video, playerPresent: !!player, controlsPresent: !!controlsHost });

        // Keep the options button available even when the slider is off.
        if (!isOverlayEnabled()) {
            removeOverlay();
            injectVolumeOptionsButton();
            return !!document.getElementById(OPTIONS_BUTTON_ID);
        }

        let overlay = document.getElementById(OVERLAY_ID);
        if (overlay && overlay._tmVolumeVideo !== video) {
            debugRecorder.record('attach-video-replaced', { oldVideoId: debugNodeId(overlay._tmVolumeVideo), newVideoId: debugNodeId(video), oldConnected: overlay._tmVolumeVideo?.isConnected, newConnected: video?.isConnected });
            disposeActiveOverlay();
            overlay = null;
        }
        if (!overlay && video) {
            restoreSavedVolumeBeforeControls(video);
        }
        if (!video || !player || !controlsHost) {
            injectVolumeOptionsButton();
            return false;
        }
        // Only restore volume and schedule fade-in on first attach
        if (!overlay) {
            // Extend to at least 2s from now; cooperates with the longer lock
            // already set by scheduleReattach on channel navigation without shortening it
            startupLockUntil = Math.max(startupLockUntil, Date.now() + 2000);
            restoreSavedVolume(video);
            const createdOverlay = createOverlay(video, player, controlsHost);
            createdOverlay._tmVolumeVideo = video;
            cancelDelayedFirstAttachRestore();
            delayedFirstAttachRestoreTimer = window.setTimeout(() => {
                delayedFirstAttachRestoreTimer = 0;
                if (!overlayLifecycle.owns(createdOverlay) || !createdOverlay.isConnected ||
                    createdOverlay._tmVolumeVideo !== video || !video.isConnected) return;
                restoreSavedVolume(video);
                updateOverlayOpacity(createdOverlay);
            }, 1500);
        } else if (!isOverlayInteractionFocused(overlay)) {
            placeOverlay(overlay, player, controlsHost);
        } else {
            updateOverlayOpacity(overlay);
        }
        applyNativeVolumeVisibility();
        injectVolumeOptionsButton();
        ensureNativeSettingsHoldIsolation();
        ensureAttachObserver();
        return true;
    }

    function getAttachObserverRoot() {
        return document.body;
    }

    function mutationAddsVideo(mutations) {
        return mutations.some((mutation) => [...mutation.addedNodes].some((node) =>
            node.nodeName === 'VIDEO' || !!node.querySelector?.('video')
        ));
    }

    let lastAttach = 0;
    const ATTACH_COOLDOWN_MS = 1000;
    let attachQueued = false;

    function handleAttachObserverMutations(mutations) {
        const hasAddedNodes = mutations.some((m) => m.addedNodes && m.addedNodes.length > 0);
        const hasRemovedNodes = mutations.some((m) => m.removedNodes && m.removedNodes.length > 0);
        if ((!hasAddedNodes && !hasRemovedNodes) || attachQueued) return;

        applyNativeVolumeVisibility();
        const overlay = document.getElementById(OVERLAY_ID);
        const button = document.getElementById(OPTIONS_BUTTON_ID);
        const overlayMissing = isOverlayEnabled() && (!overlay || !overlay.isConnected);
        const videoMayHaveChanged = isOverlayEnabled() && !!overlay && mutationAddsVideo(mutations);
        const buttonMissing = !button || !button.isConnected;
        const buttonMisplaced = !buttonMissing && !isOptionsButtonInPreferredSlot();
        if (buttonMissing || buttonMisplaced) {
            injectVolumeOptionsButton();
        }
        if (!overlayMissing && !videoMayHaveChanged) return;

        attachQueued = true;
        requestAnimationFrame(() => {
            attachQueued = false;
            if (!isOverlayEnabled()) {
                injectVolumeOptionsButton();
                return;
            }
            const currentOverlay = document.getElementById(OVERLAY_ID);
            if (!videoMayHaveChanged && currentOverlay && currentOverlay.isConnected) {
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
        injectVolumeOptionsButton();
    }

    function setupAttachObserver() {
        if (!window.MutationObserver) return;
        ensureAttachObserver();
        if (attachObserverTarget || attachBootstrapObserver) return;

        attachBootstrapObserver = new MutationObserver(() => {
            if (!getAttachObserverRoot()) return;
            ensureAttachObserver();
            attachSliderIfPossible();
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
            debugRecorder.record('navigation-reattach-start', { path: window.location.pathname });
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
            controlsVisibility.dispose();
            controlsVisibility = makeControlsVisibilityManager();
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
                debugRecorder.record('navigation-reattach-finish', { path: window.location.pathname });
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
                        debugRecorder.record('late-restore-correction', { from: getVolume(vid), to: saved });
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
            debugRecorder.record('navigation-scheduled', { from: lastKnownPath, to: targetPath });
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
