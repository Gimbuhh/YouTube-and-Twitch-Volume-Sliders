import { createOverlayUi } from '../shared/overlay-ui.js';
import { createOptionsUi } from '../shared/options-ui.js';
import { createVolumeSettings } from '../shared/settings.js';
import { createVolumePersistence, snapTo5 } from '../shared/volume.js';
import { createOptionsButtonIconSvg, getOptionsPopupFocusable } from '../shared/options.js';
import { createCleanupRegistry, createOverlayLifecycle, createVideoLocator } from '../shared/lifecycle.js';
import { installOptionsStyles } from '../shared/options-styles.js';
import { installVolumeSliderStyles } from '../shared/slider-styles.js';
import { bindRangePointerInteraction, bindWheelVolumeStep, createVolumeControlElements, syncVolumeControl } from '../shared/slider-interactions.js';
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
    let playerBoundaryResizeFrame = 0;
    const overlayLifecycle = createOverlayLifecycle();
    const { getVideoElement, resetVideoElement, ensurePlayerPositioning } = createVideoLocator(document, window);
    const USER_INTENT_GRACE_MS = 5000;
    const NAV_REATTACH_DELAY_MS = 700;
    const NAV_LATE_RESTORE_DELAY_MS = 4200;
    const NAV_DEBOUNCE_MS = 180;

    // -------------------------------
    // Overlay State
    // -------------------------------





    const { getVolumeSliderMode, getReplaceNativePlacement, isSliderOnVideo, setSliderLocation, setReplaceNativePlacement, getVolumeAppearance, setVolumeAppearance, updateOverlayAppearance, isSnapTo5Enabled, setSnapTo5Enabled, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled, getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent, getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent, getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent, beginThicknessSliderPreview, endThicknessSliderPreview, beginOpacitySliderPreview, endOpacitySliderPreview, updateOverlaySize, updateSliderThickness, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode, isOverlayEnabled, isNativeVolumeReplacementEnabled, shouldUseNativeReplacementSlot } = createVolumeSettings({
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

    function isTwitchPreviewPlayer(player = getPlayerContainer()) {
        const rect = player?.getBoundingClientRect?.();
        const width = Number(rect?.width);
        return Number.isFinite(width) && width > 0 && width <= TWITCH_PREVIEW_PLAYER_MAX_WIDTH_PX;
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
        const isPreviewPlayer = isTwitchPreviewPlayer(player);
        if (nativeVolumeGroup) {
            const shouldHideNative = !isPreviewPlayer && isOverlayEnabled() && isNativeVolumeReplacementEnabled();
            const nextDisplay = shouldHideNative ? 'none' : '';
            if (nativeVolumeGroup.style.display !== nextDisplay) {
                nativeVolumeGroup.style.display = nextDisplay;
            }
        }

        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay && player && !isPreviewPlayer && !isOverlayInteractionFocused(overlay)) {
            placeOverlay(overlay, player, controlsHost);
        }
    }

    function createStylesIfNeeded() {
        installVolumeSliderStyles({
            document, platform: 'twitch', overlayId: OVERLAY_ID, valueLabelId: VALUE_LABEL_ID,
            panelDropShadow: VOLUME_PANEL_DROP_SHADOW
        });
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
        if (value !== null) {
            setVolume(video, value, { preserveMute: wasMuted });
        }
        setMuted(video, wasMuted);
        if (wasMuted) {
            startStartupMuteGuard(video);
        }
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
        installOptionsStyles({
            document, platform: 'twitch', styleId: OPTIONS_STYLE_ID,
            optionsButtonId: OPTIONS_BUTTON_ID, optionsPopupId: OPTIONS_POPUP_ID,
            accentDark: VOLUME_ACCENT_DARK, accentDisabled: VOLUME_ACCENT_DISABLED
        });
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
        const player = getPlayerContainer();
        if (isTwitchPreviewPlayer(player)) {
            removeVolumeOptionsButton();
            return;
        }
        const host = getTwitchRightControlsHost(player || undefined);
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


    const { buildOptionsPopup, syncOptionsPopupState, syncOptionsRadioGroups } = createOptionsUi({
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
        syncOptionsPopupState(getOptionsPopup());
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

        // Sync slider UI and persist volume on native changes. In replace-native
        // mode, the custom controls own volume and unmarked player writes are resets.
        const onVideoVolumeChange = () => {
            const now = Date.now();
            if (now <= startupLockUntil) {
                if (now <= userIntentUntil || startupCorrectionApplied) {
                    return;
                }
                // Actively re-apply saved volume when Twitch overrides it during player initialization
                const savedValue = getSavedVolume();
                const muted = isMuted(video);
                if (savedValue !== null && Math.abs(getUnderlyingVolume(video) - savedValue) > 1) {
                    setVolume(video, savedValue, { preserveMute: muted });
                }
                startupCorrectionApplied = true;
                return;
            }
            try {
                const muted = isMuted(video);
                const playerVolume = getVolume(video);
                const savedValue = getSavedVolume();
                if (isNativeVolumeReplacementEnabled() && now > userIntentUntil &&
                    savedValue !== null && Math.abs(playerVolume - savedValue) > 1) {
                    cancelScheduledSaveVolume();
                    setVolume(video, savedValue, { preserveMute: muted });
                    saveMute(muted);
                    setSliderFromPlayer(slider, label, video);
                    return;
                }
                setSliderFromPlayer(slider, label, video);
                saveMute(muted);
                if (!muted) {
                    scheduleSaveVolume(playerVolume);
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
        if (isTwitchPreviewPlayer(player)) {
            removeOverlay();
            removeVolumeOptionsButton();
            return true;
        }
        // Keep the options button available even when the slider is off.
        if (!isOverlayEnabled()) {
            removeOverlay();
            injectVolumeOptionsButton();
            return !!document.getElementById(OPTIONS_BUTTON_ID);
        }

        let overlay = document.getElementById(OVERLAY_ID);
        if (overlay && overlay._tmVolumeVideo !== video) {
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

    function setupPlayerBoundaryResizeHandler() {
        window.addEventListener('resize', () => {
            if (playerBoundaryResizeFrame) return;
            playerBoundaryResizeFrame = window.requestAnimationFrame(() => {
                playerBoundaryResizeFrame = 0;
                resetVideoElement();
                attachSliderIfPossible();
                applyNativeVolumeVisibility();
            });
        }, true);
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
            }, NAV_REATTACH_DELAY_MS);

            // Late recovery restore: catches cases where Twitch's player finishes its own
            // volume initialization after our startup lock has already expired
            navLateRestoreTimer = window.setTimeout(() => {
                navLateRestoreTimer = 0;
                if (Date.now() <= userIntentUntil) return;
                const vid = getVideoElement();
                if (!vid) return;
                if (isTwitchPreviewPlayer(getPlayerContainer(vid))) return;
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
        setupPlayerBoundaryResizeHandler();
        setupNavigationHandler();
        setupNativeSettingsCloseHandler();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init, { once: true });
    }
}
