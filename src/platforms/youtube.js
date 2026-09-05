import { createOverlayUi } from '../shared/overlay-ui.js';
import { createOptionsUi } from '../shared/options-ui.js';
import { createVolumeSettings } from '../shared/settings.js';
import { clampVolume, createVolumePersistence, snapToStep } from '../shared/volume.js';
import { createOptionsButtonIconSvg, getOptionsPopupFocusable } from '../shared/options.js';
import { createCleanupRegistry, createOverlayLifecycle, createVideoLocator } from '../shared/lifecycle.js';
import { createStyleElement } from '../shared/styles.js';
import { installOptionsStyles } from '../shared/options-styles.js';
import { installVolumeSliderStyles } from '../shared/slider-styles.js';
import { bindRangePointerInteraction, bindWheelVolumeStep, createVolumeControlElements, syncVolumeControl } from '../shared/slider-interactions.js';

export function startYouTubeVolumeSlider() {
    'use strict';

    const OVERLAY_ID = 'tm-volume-slider-overlay';
    const SLIDER_ID = 'tm-volume-slider-range';
    const VALUE_LABEL_ID = 'tm-volume-slider-value';
    const OPTIONS_STYLE_ID = 'tm-volume-options-style';
    const OPTIONS_BUTTON_ID = 'tm-volume-options-button';
    const OPTIONS_POPUP_ID = 'tm-volume-options-popup';
    const OPTIONS_CLOSE_HIDE_CONTROLS_CLASS = 'tm-volume-options-close-hide-controls';
    const STORAGE_KEY = 'tm-yt-volume';
    const MUTE_STORAGE_KEY = 'tm-yt-muted';
    const VOLUME_MODE_KEY = 'tm-yt-volume-slider-mode';
    const SLIDER_LOCATION_KEY = 'tm-yt-volume-slider-location';
    const REPLACE_NATIVE_PLACEMENT_KEY = 'tm-yt-volume-slider-replace-placement';
    const VOLUME_STEP_KEY = 'tm-yt-volume-slider-step';
    const LEGACY_SNAP_TO_5_KEY = 'tm-yt-volume-slider-snap-to-5';
    const ALWAYS_EXPANDED_KEY = 'tm-yt-volume-slider-always-expanded';
    const OVERLAY_OPACITY_IDLE_KEY = 'tm-yt-volume-slider-opacity-idle';
    const OVERLAY_OPACITY_ACTIVE_KEY = 'tm-yt-volume-slider-opacity-active';
    const OVERLAY_SIZE_KEY = 'tm-yt-volume-slider-size';
    const SLIDER_THICKNESS_KEY = 'tm-yt-volume-slider-thickness';
    const VOLUME_APPEARANCE_KEY = 'tm-yt-volume-slider-appearance';
    const DEFAULT_OVERLAY_OPACITY_IDLE = 45;
    const DEFAULT_OVERLAY_OPACITY_ACTIVE = 95;
    const DEFAULT_OVERLAY_SIZE = 100;
    const DEFAULT_SLIDER_THICKNESS = 75;
    const STORAGE_WRITE_DEBOUNCE_MS = 150;
    const VOLUME_CHANGE_EXPANDED_HOLD_MS = 1200;
    const KEYBOARD_VOLUME_STEP = 5;
    const NAV_REATTACH_DELAY_MS = 700;
    const NAV_DEBOUNCE_MS = 180;
    const INITIAL_ATTACH_RETRY_MS = 50;
    const INITIAL_ATTACH_MAX_ATTEMPTS = 80;
    const USER_VOLUME_INTENT_GRACE_MS = 5000;
    const USER_VOLUME_TOLERANCE = 1;
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
        // Volume adjustment step: 'saved', 1, 2, 5, or 10. Default: 'saved'
        volumeStep: 'saved',
        // Keep the volume pill expanded: 'saved', true, or false. Default: 'saved'
        alwaysExpanded: 'saved',
        // On-video slider opacity when unfocused: 'saved' or 0-100 as a percentage. Default: 45
        overlayOpacityUnfocused: 'saved',
        // On-video slider opacity when focused/hovered: 'saved' or 0-100 as a percentage. Default: 95
        overlayOpacityFocused: 'saved',
        // On-video slider size: 'saved' or 100-200 as a percentage. Default: 100
        overlaySize: 'saved',
        // Bar thickness: 'saved' or 25-125 as a percentage of the 2.5 bar. Default: 75
        sliderThickness: 'saved',
        // Volume icon style: 'saved', 'new', or 'classic'. Default: 'saved'
        volumeAppearance: 'saved'
    };

    let cachedYtPlayer = null;
    let navReattachTimer = 0;
    let navDebounceTimer = 0;
    let attachObserver = null;
    let attachObserverTarget = null;
    let attachBootstrapObserver = null;
    let playerControlsObserver = null;
    let playerControlsObserverTarget = null;
    let requestedVolumeIntent = null;
    const overlayLifecycle = createOverlayLifecycle();
    const { getVideoElement, resetVideoElement, ensurePlayerPositioning } = createVideoLocator(document, window);

    // -------------------------------
    // Overlay + Options State
    // -------------------------------





    const { getVolumeSliderMode, getReplaceNativePlacement, isSliderOnVideo, setSliderLocation, setReplaceNativePlacement, getVolumeAppearance, setVolumeAppearance, updateOverlayAppearance, getVolumeStep, setVolumeStep, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled, getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent, getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent, getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent, beginThicknessSliderPreview, endThicknessSliderPreview, beginOpacitySliderPreview, endOpacitySliderPreview, updateSliderThickness, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode, isOverlayEnabled, isNativeVolumeReplacementEnabled, shouldUseNativeReplacementSlot } = createVolumeSettings({
        document, storage: localStorage, userSettings: USER_SETTINGS, overlayId: OVERLAY_ID,
        keys: { mode: VOLUME_MODE_KEY, location: SLIDER_LOCATION_KEY, replacePlacement: REPLACE_NATIVE_PLACEMENT_KEY, step: VOLUME_STEP_KEY, legacySnap: LEGACY_SNAP_TO_5_KEY, expanded: ALWAYS_EXPANDED_KEY, idleOpacity: OVERLAY_OPACITY_IDLE_KEY, activeOpacity: OVERLAY_OPACITY_ACTIVE_KEY, overlaySize: OVERLAY_SIZE_KEY, sliderThickness: SLIDER_THICKNESS_KEY, appearance: VOLUME_APPEARANCE_KEY },
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
    const { getSavedVolume, readSteppedSliderValue, saveVolume, scheduleSaveVolume, cancelScheduledSaveVolume } = createVolumePersistence({
        window, storage: localStorage, storageKey: STORAGE_KEY, debounceMs: STORAGE_WRITE_DEBOUNCE_MS,
        getVolumeStep
    });






















    function shouldHideNativeVolume() {
        return isYouTubeSupportedPage() && isOverlayEnabled() && isNativeVolumeReplacementEnabled();
    }

    function ensureNativeVolumeVisibilityGuard() {
        const style = createStyleElement(document, 'tm-volume-native-visibility-style');
        if (style) {
            style.textContent = `
html.tm-yt-volume-native-replacement-active .ytp-volume-area {
  display: none !important;
}
            `;
        }
        document.documentElement.classList.toggle(
            'tm-yt-volume-native-replacement-active',
            shouldHideNativeVolume()
        );
    }

    function applyNativeVolumeVisibility() {
        ensureNativeVolumeVisibilityGuard();
        const shouldHideNative = shouldHideNativeVolume();
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
        installVolumeSliderStyles({
            document, platform: 'youtube', overlayId: OVERLAY_ID, valueLabelId: VALUE_LABEL_ID,
            panelDropShadow: VOLUME_PANEL_DROP_SHADOW
        });
    }

    const { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHold, scheduleExpandedHoldRelease, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg, populateSliderTicks } = createOverlayUi({
        document, window, isAlwaysExpandedEnabled, isSliderOnVideo,
        updateOverlayOpacity, finishExpandedHoldIfDue, getVolumeStep,
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

    function getUnderlyingVolume(video) {
        const ytPlayer = getYouTubePlayer();
        if (ytPlayer) return Math.round(ytPlayer.getVolume());
        return Math.round((Number(video?.volume) || 0) * 100);
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

    function setMuted(video, muted) {
        const ytPlayer = getYouTubePlayer();
        if (ytPlayer) {
            if (muted) {
                ytPlayer.mute();
            } else {
                ytPlayer.unMute();
            }
        } else {
            video.muted = !!muted;
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
     * Restore volume from localStorage and apply to player. Call before syncing slider.
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
            } else if (wasMuted && !isMuted(video)) {
                setMuted(video, true);
            }
        } catch (e) { /* ignore storage errors */ }
    }





    function saveMute(muted) {
        try {
            localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
        } catch (e) { /* ignore storage errors */ }
    }


    function setSliderFromPlayer(slider, label, video) {
        const muted = isMuted(video);
        const displayValue = muted ? getUnderlyingVolume(video) : getVolume(video);
        slider.value = String(displayValue);
        if (label) {
            label.textContent = muted ? 'Muted' : `${displayValue}%`;
        }
        updateSliderBar(slider);
        updateVolumeIndicator(document.getElementById(OVERLAY_ID), displayValue, muted);
    }



    function ensureOptionsStyles() {
        installOptionsStyles({
            document, platform: 'youtube', styleId: OPTIONS_STYLE_ID,
            optionsButtonId: OPTIONS_BUTTON_ID, optionsPopupId: OPTIONS_POPUP_ID,
            accentDark: VOLUME_ACCENT_DARK, accentDisabled: VOLUME_ACCENT_DISABLED,
            closeHideControlsClass: OPTIONS_CLOSE_HIDE_CONTROLS_CLASS
        });
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

    function isOptionsButtonInPreferredSlot() {
        const player = getPlayerContainer();
        const host = getRightControlsHost(player);
        const settingsBtn = host?.querySelector?.('.ytp-settings-button');
        const btn = document.getElementById(OPTIONS_BUTTON_ID);
        return !!(host && settingsBtn && btn && btn.parentElement === host && btn.nextElementSibling === settingsBtn);
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
    let optionsCloseHideControlsHandler = null;
    let optionsPopupOpener = null;

    function getOptionsPopup() {
        return document.getElementById(OPTIONS_POPUP_ID);
    }

    function isOptionsPopupOpen() {
        const popup = getOptionsPopup();
        return !!popup && !popup.hasAttribute('hidden');
    }


    const { buildOptionsPopup, syncOptionsPopupState } = createOptionsUi({
        document, optionsPopupId: OPTIONS_POPUP_ID, refreshOptionsPopupState,
        getVolumeSliderMode, setVolumeSliderMode, getReplaceNativePlacement, setReplaceNativePlacement,
        getVolumeAppearance, setVolumeAppearance,
        getVolumeStep, setVolumeStep, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled,
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
        clearOptionsCloseControlsHide();
        player.classList.add('tm-volume-options-controls-hold');
        player.classList.remove('ytp-autohide', 'ytp-hide-controls');
        if (typeof player.showControls === 'function') {
            try { player.showControls(); } catch (e) { /* ignore player API errors */ }
        }
    }

    function releaseYouTubeControlsVisibility() {
        getPlayerContainer()?.classList?.remove('tm-volume-options-controls-hold');
    }

    function clearOptionsCloseControlsHide() {
        getPlayerContainer()?.classList?.remove(OPTIONS_CLOSE_HIDE_CONTROLS_CLASS);
        if (!optionsCloseHideControlsHandler) return;
        document.removeEventListener('pointermove', optionsCloseHideControlsHandler, true);
        document.removeEventListener('pointerdown', optionsCloseHideControlsHandler, true);
        optionsCloseHideControlsHandler = null;
    }

    function hideControlsUntilPlayerPointerReturn() {
        const player = getPlayerContainer();
        if (!player) return;
        clearOptionsCloseControlsHide();
        player.classList.add(OPTIONS_CLOSE_HIDE_CONTROLS_CLASS);
        optionsCloseHideControlsHandler = (event) => {
            if (getPlayerContainer()?.contains?.(event.target)) {
                clearOptionsCloseControlsHide();
            }
        };
        document.addEventListener('pointermove', optionsCloseHideControlsHandler, true);
        document.addEventListener('pointerdown', optionsCloseHideControlsHandler, true);
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

    function stopOptionsControlsHold() {
        releaseYouTubeControlsVisibility();
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
                if (clickedOutsidePlayer) hideControlsUntilPlayerPointerReturn();
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
        cleanupRegistry.listen(document, 'click', collapseHeldSliderOnVideoClick, true);

        const { iconCell, label, tickOverlay, slider } = createVolumeControlElements({
            document,
            overlay,
            sliderId: SLIDER_ID,
            valueLabelId: VALUE_LABEL_ID,
            makeVolumeIndicatorSvg,
            populateSliderTicks,
            getVolumeStep
        });
        cleanupRegistry.add(() => tickOverlay._tmSliderTicksCleanup?.());
        iconCell.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });
        iconCell.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleMute(video);
            saveMute(isMuted(video));
            setSliderFromPlayer(slider, label, video);
            markVolumeChangedWhileExpanded(overlay);
        });

        const syncInitialSliderState = (value, muted = false) => {
            syncVolumeControl({ slider, label, overlay, value, muted, updateSliderBar, updateVolumeIndicator });
        };

        // Initialize from localStorage to avoid the 100% to actual jump on video load
        const initVol = getSavedVolume();
        if (initVol !== null) {
            syncInitialSliderState(initVol, isMuted(video));
        } else {
            syncInitialSliderState(getVolume(video), isMuted(video));
        }

        const applySliderValue = (value) => {
            requestedVolumeIntent = { value, until: Date.now() + USER_VOLUME_INTENT_GRACE_MS, overlay };
            setVolume(video, value);
            saveMute(false);
            label.textContent = `${value}%`;
            updateSliderBar(slider);
            updateVolumeIndicator(overlay, value, isMuted(video));
            scheduleSaveVolume(value);
            markVolumeChangedWhileExpanded(overlay);
        };

        cleanupRegistry.add(bindWheelVolumeStep({
            target: iconCell,
            slider,
            getVolumeStep,
            applyValue: applySliderValue
        }));
        const rangePointer = bindRangePointerInteraction({
            window,
            slider,
            overlay,
            getVolumeStep,
            readSteppedValue: readSteppedSliderValue,
            snapValue: (value) => snapToStep(value, getVolumeStep()),
            applyValue: applySliderValue,
            setExpanded: () => setOverlayExpanded(overlay, true),
            updateOpacity: () => updateOverlayOpacity(overlay),
            collapseIfIdle: (force) => collapseOverlayIfIdle(overlay, force)
        });
        cleanupRegistry.add(() => rangePointer.dispose());

        slider.addEventListener('input', () => {
            applySliderValue(rangePointer.readPressAwareValue());
        });

        slider.addEventListener('change', () => {
            applySliderValue(readSteppedSliderValue(slider));
            cancelScheduledSaveVolume();
            saveVolume(Number(slider.value) || 0);
        });

        const applyKeyboardVolumeStep = (event) => {
            const direction = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
            if (!direction) return;
            event.preventDefault();
            event.stopPropagation();
            if (requestedVolumeIntent?.overlay === overlay) requestedVolumeIntent = null;
            const currentValue = Number(slider.value) || 0;
            const nextValue = clampVolume(currentValue + (direction * KEYBOARD_VOLUME_STEP));
            if (nextValue === currentValue) return;
            slider.value = String(nextValue);
            applySliderValue(nextValue);
        };
        slider.addEventListener('keydown', applyKeyboardVolumeStep);

        const onVideoVolumeChange = () => {
            if (!document.getElementById(OVERLAY_ID)) return;
            const muted = isMuted(video);
            saveMute(muted);
            const playerVolume = getVolume(video);
            const intent = requestedVolumeIntent;
            if (intent?.overlay === overlay) {
                if (Math.abs(playerVolume - intent.value) <= USER_VOLUME_TOLERANCE) {
                    requestedVolumeIntent = null;
                } else if (Date.now() <= intent.until && !muted) {
                    return;
                } else {
                    requestedVolumeIntent = null;
                }
            }
            setSliderFromPlayer(slider, label, video);
            if (!muted) scheduleSaveVolume(playerVolume);
        };
        video.addEventListener('volumechange', onVideoVolumeChange);

        updateOverlayAppearance(overlay);
        if (isAlwaysExpandedEnabled()) {
            setOverlayExpanded(overlay, true, true);
        }

        placeOverlay(overlay, player, controlsHost);
        if (initVol === null) setSliderFromPlayer(slider, label, video);
        else syncInitialSliderState(initVol, isMuted(video));
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
        const cleanup = () => {
            if (requestedVolumeIntent?.overlay === overlay) requestedVolumeIntent = null;
            video.removeEventListener('volumechange', onVideoVolumeChange);
            window.removeEventListener('resize', onLayoutChange);
            controlsObserver.disconnect();
            cleanupRegistry.dispose();
            clearExpandedHold(overlay);
        };
        overlayLifecycle.set(overlay, cleanup);

        return overlay;
    }

    function disposeActiveOverlay() {
        requestedVolumeIntent = null;
        overlayLifecycle.dispose();
    }

    function removeOverlay() {
        cancelScheduledSaveVolume();
        disposeActiveOverlay();
        document.getElementById(OVERLAY_ID)?.remove();
        applyNativeVolumeVisibility();
    }

    function attachSliderIfPossible() {
        if (!isYouTubeSupportedPage()) {
            removeOverlay();
            removeVolumeOptionsButton();
            disconnectPlayerControlsObserver();
            disconnectAttachObserver();
            return false;
        }
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
        let existingOverlay = document.getElementById(OVERLAY_ID);
        if (existingOverlay && existingOverlay._tmVolumeVideo !== video) {
            disposeActiveOverlay();
            existingOverlay.remove();
            existingOverlay = null;
        }
        if (existingOverlay) {
            placeOverlay(existingOverlay, player, controlsHost);
        } else {
            restoreSavedVolume(video);
            const overlay = createOverlay(video, player, controlsHost);
            overlay._tmVolumeVideo = video;
        }
        applyNativeVolumeVisibility();
        injectVolumeOptionsButton();
        ensurePlayerControlsObserver();
        ensureAttachObserver();
        return true;
    }

    function getAttachObserverRoot() {
        if (!isYouTubeSupportedPage()) return null;
        return document.getElementById('movie_player') ||
            document.querySelector('.html5-video-player') ||
            document.getElementById('primary');
    }

    function mutationAddsVideo(mutations) {
        return mutations.some((mutation) => [...mutation.addedNodes].some((node) =>
            node.nodeName === 'VIDEO' || !!node.querySelector?.('video')
        ));
    }

    let lastAttach = 0;
    const ATTACH_COOLDOWN_MS = 1000;
    let attachQueued = false;
    let trailingAttachTimer = 0;

    function isYouTubeSupportedPage() {
        return document.location.pathname === '/watch';
    }

    function handleAttachObserverMutations(mutations) {
        if (!isYouTubeSupportedPage()) return;
        const hasAddedNodes = mutations.some((m) => m.addedNodes && m.addedNodes.length > 0);
        const hasRemovedNodes = mutations.some((m) => m.removedNodes && m.removedNodes.length > 0);
        if ((!hasAddedNodes && !hasRemovedNodes) || attachQueued) return;

        applyNativeVolumeVisibility();
        const overlay = document.getElementById(OVERLAY_ID);
        const button = document.getElementById(OPTIONS_BUTTON_ID);
        const overlayMissing = isOverlayEnabled() && (!overlay || !overlay.isConnected);
        const buttonMissing = !button || !button.isConnected;
        const buttonMisplaced = !buttonMissing && !isOptionsButtonInPreferredSlot();
        if (buttonMissing || buttonMisplaced) {
            injectVolumeOptionsButton();
        }
        const videoMayHaveChanged = isOverlayEnabled() && !!overlay && mutationAddsVideo(mutations);
        if (!overlayMissing && !videoMayHaveChanged) return;

        attachQueued = true;
        requestAnimationFrame(() => {
            attachQueued = false;
            if (videoMayHaveChanged) resetVideoElement();
            const now = Date.now();
            if (now - lastAttach < ATTACH_COOLDOWN_MS) {
                clearTimeout(trailingAttachTimer);
                trailingAttachTimer = window.setTimeout(() => {
                    trailingAttachTimer = 0;
                    resetVideoElement();
                    if (isYouTubeSupportedPage() && attachSliderIfPossible()) lastAttach = Date.now();
                }, ATTACH_COOLDOWN_MS - (now - lastAttach));
                return;
            }
            if (!isYouTubeSupportedPage()) return;
            if (attachSliderIfPossible()) {
                lastAttach = now;
            }
        });
    }

    function disconnectAttachObserver() {
        if (trailingAttachTimer) {
            window.clearTimeout(trailingAttachTimer);
            trailingAttachTimer = 0;
        }
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

        const bootstrapRoot = document.body || document.documentElement;
        if (!bootstrapRoot) return;
        attachBootstrapObserver = new MutationObserver(() => {
            if (!getAttachObserverRoot()) return;
            ensureAttachObserver();
            attachSliderIfPossible();
        });
        attachBootstrapObserver.observe(bootstrapRoot, { childList: true, subtree: true });
    }

    function setupInitialAttempts() {
        const attemptAttach = (attempt) => {
            if (attachSliderIfPossible() || attempt >= INITIAL_ATTACH_MAX_ATTEMPTS) return;
            window.setTimeout(() => attemptAttach(attempt + 1), INITIAL_ATTACH_RETRY_MS);
        };
        attemptAttach(0);
    }

    function setupYtNavigationHandler() {
        if (window.__tmYtVolumeNavBound) return;
        window.__tmYtVolumeNavBound = true;

        const cancelPendingReattach = () => {
            if (navDebounceTimer) {
                clearTimeout(navDebounceTimer);
                navDebounceTimer = 0;
            }
            if (navReattachTimer) {
                clearTimeout(navReattachTimer);
                navReattachTimer = 0;
            }
        };

        const runReattach = () => {
            cancelPendingReattach();

            resetVideoElement();
            cachedYtPlayer = null;
            closeVolumeOptionsPopup();
            clearOptionsCloseControlsHide();
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
            cancelPendingReattach();
            navDebounceTimer = window.setTimeout(() => {
                navDebounceTimer = 0;
                runReattach();
            }, NAV_DEBOUNCE_MS);
        };

        const handleNavigationStart = () => {
            // Tampermonkey can isolate the userscript's History object from the one
            // YouTube calls. The navigation-start event crosses that boundary and
            // fires before the incoming player can expose its native volume area.
            if (isOverlayEnabled() && isNativeVolumeReplacementEnabled()) {
                document.documentElement.classList.add('tm-yt-volume-native-replacement-active');
            }
        };

        const handleNavigationComplete = () => {
            // YouTube usually has its incoming video and controls ready by this
            // event. Mount synchronously so the custom icon replaces the hidden
            // native control in the same frame, retaining the delayed path only as
            // a fallback for unusually late player creation.
            resetVideoElement();
            cachedYtPlayer = null;
            applyNativeVolumeVisibility();
            const attached = attachSliderIfPossible();
            if (attached || !isYouTubeSupportedPage()) {
                cancelPendingReattach();
                return;
            }
            scheduleReattach();
        };

        window.addEventListener('yt-navigate-start', handleNavigationStart, true);
        window.addEventListener('yt-navigate-finish', handleNavigationComplete, true);
        window.addEventListener('yt-page-data-updated', handleNavigationComplete, true);
        window.addEventListener('popstate', handleNavigationComplete, true);
    }

    function init() {
        applyNativeVolumeVisibility();
        setupInitialAttempts();
        setupAttachObserver();
        setupYtNavigationHandler();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        applyNativeVolumeVisibility();
        init();
    }
}
