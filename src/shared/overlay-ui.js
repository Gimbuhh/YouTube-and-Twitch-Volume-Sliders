export function createOverlayUi(dependencies) {
  const {
    document, window, isAlwaysExpandedEnabled, isSliderOnVideo,
    updateOverlayOpacity, updateOverlaySize, finishExpandedHoldIfDue,
    accentLight: VOLUME_ACCENT_LIGHT, accentDark: VOLUME_ACCENT_DARK, accentMid: VOLUME_ACCENT_MID,
    arcTrack: VOLUME_ARC_TRACK, expandedHoldMs: VOLUME_CHANGE_EXPANDED_HOLD_MS
  } = dependencies;

    const DEFAULT_VISUAL_THUMB_SIZE_PX = 22;
    const VOLUME_INDICATOR_CENTER = '20';
    const VOLUME_INDICATOR_TEXT_Y = '20';
    const VOLUME_ARC_RADIUS = '14.5';
    const VOLUME_ARC_STROKE_WIDTH = '3';
    const VOLUME_INDICATOR_COMPACT_TEXT_LENGTH = '22.5';
    const VOLUME_TEXT_MAX_OPTICAL_SHIFT_PX = 1.5;

    function updateSliderBar(slider) {
        const value = Number(slider.value) || 0;
        const pct = Math.min(Math.max(value, 0), 100);
        const fadeStart = Math.max(0, pct - 1);
        const fadeEnd = Math.min(100, pct + 1);
        const thumbSize = getSliderThumbSize(slider);
        const background = `linear-gradient(to right,
            ${VOLUME_ACCENT_LIGHT} 0%,
            ${VOLUME_ACCENT_DARK} ${getThumbAlignedTrackStop(fadeStart, thumbSize)},
            ${VOLUME_ACCENT_MID} ${getThumbAlignedTrackStop(pct, thumbSize)},
            rgba(255, 255, 255, 0.15) ${getThumbAlignedTrackStop(fadeEnd, thumbSize)},
            rgba(255, 255, 255, 0.15) 100%)`;
        const track = slider.parentElement?.querySelector?.('.tm-slider-track');
        if (track) {
            track.style.background = background;
            slider.style.background = 'transparent';
        } else {
            slider.style.background = background;
            slider.style.backgroundSize = '100% 100%';
            slider.style.backgroundPosition = 'center';
            slider.style.backgroundRepeat = 'no-repeat';
        }
    }

    function getSliderThumbSize(slider) {
        const style = window.getComputedStyle?.(slider.parentElement || slider);
        const parsed = Number.parseFloat(style?.getPropertyValue('--tm-thumb-size'));
        return Number.isFinite(parsed) ? parsed : DEFAULT_VISUAL_THUMB_SIZE_PX;
    }

    function getThumbAlignedTrackStop(pct, thumbSize = DEFAULT_VISUAL_THUMB_SIZE_PX) {
        if (pct <= 0) return '0%';
        if (pct >= 100) return '100%';
        const thumbOffset = thumbSize * (0.5 - (pct / 100));
        return `calc(${pct}% + ${thumbOffset.toFixed(2)}px)`;
    }

    function updateVolumeIndicator(overlay, value, muted) {
        if (!overlay) return;
        const pct = muted ? 0 : Math.min(Math.max(Number(value) || 0, 0), 100);
        overlay.removeAttribute('title');
        overlay.setAttribute('aria-label', muted ? 'Muted' : `Volume ${Math.round(pct)}%`);
        const muteButton = overlay.querySelector('.tm-volume-icon-cell');
        if (muteButton) {
            const action = muted ? 'Unmute' : 'Mute';
            muteButton.setAttribute('aria-label', action);
            muteButton.removeAttribute('title');
        }

        const indicator = overlay.querySelector('.tm-volume-indicator');
        if (indicator) {
            indicator.classList.toggle('muted', muted);
            indicator.dataset.volumeIcon = getSpeakerIconMode(pct, muted);
        }
        const percent = overlay.querySelector('.tm-volume-percent');
        if (percent) {
            const text = muted ? 'M' : String(Math.round(pct));
            const isCompact = text.length > 2;
            percent.textContent = text;
            percent.setAttribute('x', VOLUME_INDICATOR_CENTER);
            percent.setAttribute('y', VOLUME_INDICATOR_TEXT_Y);
            if (isCompact) {
                percent.setAttribute('textLength', VOLUME_INDICATOR_COMPACT_TEXT_LENGTH);
                percent.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            } else {
                percent.removeAttribute('textLength');
                percent.removeAttribute('lengthAdjust');
            }
            opticallyCenterVolumeText(percent);
        }
        const arc = overlay.querySelector('.tm-volume-arc');
        if (arc) {
            arc.style.visibility = pct <= 0 ? 'hidden' : 'visible';
            arc.style.strokeLinecap = pct <= 0 ? 'butt' : 'round';
            const dash = pct >= 100 ? 100.01 : pct;
            const dashValue = `${dash} 100`;
            arc.setAttribute('stroke-dasharray', dashValue);
            arc.style.strokeDasharray = dashValue;
        }
    }

    function opticallyCenterVolumeText(textElement) {
        textElement.removeAttribute('transform');
        if (typeof textElement.getBBox !== 'function') return;

        // text-anchor centers the advance box; getBBox centers the visible glyphs.
        let box;
        try {
            box = textElement.getBBox();
        } catch {
            return;
        }

        if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.width) || box.width <= 0) {
            return;
        }

        const visualCenter = box.x + (box.width / 2);
        const correction = Number(VOLUME_INDICATOR_CENTER) - visualCenter;
        const safeCorrection = Math.max(
            -VOLUME_TEXT_MAX_OPTICAL_SHIFT_PX,
            Math.min(VOLUME_TEXT_MAX_OPTICAL_SHIFT_PX, correction)
        );
        if (Math.abs(safeCorrection) < 0.01) return;
        textElement.setAttribute('transform', `translate(${safeCorrection.toFixed(2)} 0)`);
    }

    function setOverlayExpanded(overlay, expanded, force = false, options = {}) {
        if (!overlay) return;
        if (!expanded && isAlwaysExpandedEnabled() && !options.ignoreAlwaysExpanded) {
            expanded = true;
        }
        if (!force && (
            (expanded && overlay.classList.contains('tm-expanded')) ||
            (!expanded && overlay.classList.contains('tm-collapsed'))
        )) {
            return;
        }
        const onVideo = isSliderOnVideo();
        overlay.classList.toggle('tm-on-video', onVideo);
        overlay.classList.toggle('tm-in-controls', !onVideo);
        const baseStyle = onVideo ? {
            position: 'absolute',
            left: '50%',
            zIndex: '10000',
            margin: '0',
            alignSelf: 'auto',
            flex: '0 0 auto',
            transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1), bottom 0.25s ease'
        } : {
            position: 'relative',
            left: 'auto',
            bottom: '',
            zIndex: '2',
            margin: '0 4px',
            alignSelf: 'center',
            flex: '0 0 auto',
            transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        };
        const pillStyle = {
            ...baseStyle,
            minWidth: '0',
            maxWidth: 'none',
            height: '40px',
            minHeight: '40px',
            borderRadius: '20px',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: '0',
            background: 'transparent',
            transform: onVideo ? 'translateX(-50%) scale(var(--tm-overlay-scale, 1))' : 'translateY(0)',
            transformOrigin: onVideo ? 'center bottom' : 'center center'
        };

        if (expanded) {
            overlay.classList.remove('tm-collapsed');
            overlay.classList.add('tm-expanded');
            Object.assign(overlay.style, pillStyle, {
                width: 'var(--tm-pill-expanded-width)',
                padding: '0 12px 0 0'
            });
            updateOverlaySize(overlay);
            updateOverlayOpacity(overlay);
            return;
        }

        overlay.classList.remove('tm-expanded');
        overlay.classList.add('tm-collapsed');
        Object.assign(overlay.style, pillStyle, {
            width: '40px',
            padding: '0'
        });
        updateOverlaySize(overlay);
        updateOverlayOpacity(overlay);
    }

    function shouldKeepOverlayExpanded(overlay) {
        return isAlwaysExpandedEnabled() ||
            overlay.matches(':hover') ||
            overlay.contains(document.activeElement) ||
            overlay.dataset.tmDragging === 'true';
    }

    function clearExpandedHoldTimer(overlay) {
        if (overlay._expandedHoldTimer) {
            clearTimeout(overlay._expandedHoldTimer);
            overlay._expandedHoldTimer = 0;
        }
    }

    function clearExpandedHold(overlay) {
        overlay.dataset.tmKeepExpanded = 'false';
        overlay._expandedHoldUntil = 0;
        clearExpandedHoldTimer(overlay);
    }

    function scheduleExpandedHoldRelease(overlay) {
        clearExpandedHoldTimer(overlay);
        const delay = Math.max(0, (overlay._expandedHoldUntil || 0) - Date.now());
        if (delay === 0) {
            finishExpandedHoldIfDue(overlay);
            return;
        }
        overlay._expandedHoldTimer = window.setTimeout(() => {
            overlay._expandedHoldTimer = 0;
            finishExpandedHoldIfDue(overlay);
        }, delay);
    }

    function markVolumeChangedWhileExpanded(overlay) {
        if (!overlay) return;
        if (isAlwaysExpandedEnabled()) {
            setOverlayExpanded(overlay, true);
            return;
        }
        overlay.dataset.tmKeepExpanded = 'true';
        overlay._expandedHoldUntil = Date.now() + VOLUME_CHANGE_EXPANDED_HOLD_MS;
        setOverlayExpanded(overlay, true);
        scheduleExpandedHoldRelease(overlay);
    }

    function getSpeakerIconMode(pct, muted) {
        if (muted || pct <= 0) return 'muted';
        if (pct >= 50) return 'high';
        return 'low';
    }

    function makeSpeakerIconGroup(ns, mode) {
        const group = document.createElementNS(ns, 'g');
        const addPath = (d) => {
            const path = document.createElementNS(ns, 'path');
            path.setAttribute('fill', 'currentColor');
            path.setAttribute('d', d);
            group.appendChild(path);
        };

        if (mode === 'muted') {
            addPath('M11.48 2.14L3.91 6.68C3.02 7.21 2.28 7.97 1.77 8.87C1.26 9.77 1 10.79 1 11.83V12.16C1 13.20 1.26 14.22 1.77 15.12C2.28 16.02 3.02 16.78 3.91 17.31L11.48 21.85C11.63 21.94 11.80 21.99 11.98 21.99C12.25 22 12.51 21.90 12.70 21.71C12.89 21.52 13 21.26 13 21V3C13 2.73 12.89 2.48 12.70 2.29C12.51 2.10 12.25 2 11.98 2C11.80 2 11.63 2.05 11.48 2.14ZM4.94 8.40L11 4.76V19.22L4.94 15.59C4.35 15.23 3.85 14.73 3.51 14.13C3.17 13.53 3 12.85 3 12.16V11.83C3 11.14 3.18 10.46 3.52 9.86C3.86 9.26 4.35 8.76 4.94 8.40Z');
            addPath('M16.05 7.65L18.75 10.35L21.45 7.65L22.85 9.05L20.15 11.75L22.85 14.45L21.45 15.85L18.75 13.15L16.05 15.85L14.65 14.45L17.35 11.75L14.65 9.05L16.05 7.65Z');
            return group;
        }

        addPath('M11.60 2.08L11.48 2.14L3.91 6.68C3.02 7.21 2.28 7.97 1.77 8.87C1.26 9.77 1 10.79 1 11.83V12.16L1.01 12.56C1.07 13.52 1.37 14.46 1.87 15.29C2.38 16.12 3.08 16.81 3.91 17.31L11.48 21.85C11.63 21.94 11.80 21.99 11.98 21.99C12.16 22 12.33 21.95 12.49 21.87C12.64 21.78 12.77 21.65 12.86 21.50C12.95 21.35 13 21.17 13 21V3C12.99 2.83 12.95 2.67 12.87 2.52C12.80 2.37 12.68 2.25 12.54 2.16C12.41 2.07 12.25 2.01 12.08 2C11.92 1.98 11.75 2.01 11.60 2.08Z');
        addPath('M15.53 7.05C15.35 7.22 15.25 7.45 15.24 7.70C15.23 7.95 15.31 8.19 15.46 8.38L15.53 8.46L15.70 8.64C16.09 9.06 16.39 9.55 16.61 10.08L16.70 10.31C16.90 10.85 17 11.42 17 12L16.99 12.24C16.96 12.73 16.87 13.22 16.70 13.68L16.61 13.91C16.36 14.51 15.99 15.07 15.53 15.53C15.35 15.72 15.25 15.97 15.26 16.23C15.26 16.49 15.37 16.74 15.55 16.92C15.73 17.11 15.98 17.21 16.24 17.22C16.50 17.22 16.76 17.12 16.95 16.95C17.60 16.29 18.11 15.52 18.46 14.67L18.59 14.35C18.82 13.71 18.95 13.03 18.99 12.34L19 12C18.99 11.19 18.86 10.39 18.59 9.64L18.46 9.32C18.15 8.57 17.72 7.89 17.18 7.30L16.95 7.05L16.87 6.98C16.68 6.82 16.43 6.74 16.19 6.75C15.94 6.77 15.71 6.87 15.53 7.05Z');

        if (mode === 'high') {
            addPath('M18.36 4.22C18.18 4.39 18.08 4.62 18.07 4.87C18.05 5.12 18.13 5.36 18.29 5.56L18.36 5.63L18.66 5.95C19.36 6.72 19.91 7.60 20.31 8.55L20.47 8.96C20.82 9.94 21 10.96 21 11.99L20.98 12.44C20.94 13.32 20.77 14.19 20.47 15.03L20.31 15.44C19.86 16.53 19.19 17.52 18.36 18.36C18.17 18.55 18.07 18.80 18.07 19.07C18.07 19.33 18.17 19.59 18.36 19.77C18.55 19.96 18.80 20.07 19.07 20.07C19.33 20.07 19.59 19.96 19.77 19.77C20.79 18.75 21.61 17.54 22.16 16.20L22.35 15.70C22.72 14.68 22.93 13.62 22.98 12.54L23 12C22.99 10.73 22.78 9.48 22.35 8.29L22.16 7.79C21.67 6.62 20.99 5.54 20.15 4.61L19.77 4.22L19.70 4.15C19.51 3.99 19.26 3.91 19.02 3.93C18.77 3.94 18.53 4.04 18.36 4.22Z');
        }

        return group;
    }

    function formatCssPx(value) {
        if (!Number.isFinite(value)) return '0px';
        const rounded = Number(value.toFixed(3));
        return `${rounded}px`;
    }

    function getDevicePixelRatio() {
        const ratio = Number(window.devicePixelRatio);
        return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    }

    function syncSliderTicksToDevicePixels(tickOverlay, ticks) {
        if (!tickOverlay || !ticks?.length) return;
        const rect = tickOverlay.getBoundingClientRect?.();
        const width = Number(rect?.width) || 0;
        const ratio = getDevicePixelRatio();
        const tickWidth = 1 / ratio;
        tickOverlay.style.setProperty('--tm-slider-tick-width', formatCssPx(tickWidth));
        if (width <= 0) return;

        ticks.forEach((tick) => {
            const pct = Number(tick.dataset.tmTickPct);
            if (!Number.isFinite(pct)) return;
            const rawCenter = width * (pct / 100);
            const rawLeft = rawCenter - (tickWidth / 2);
            const snappedLeft = Math.round(rawLeft * ratio) / ratio;
            tick.style.left = formatCssPx(snappedLeft);
        });
    }

    function populateSliderTicks(tickOverlay) {
        if (!tickOverlay) return;
        tickOverlay._tmSliderTicksCleanup?.();
        tickOverlay.textContent = '';
        const ticks = [];
        const fragment = document.createDocumentFragment();
        for (let pct = 5; pct < 100; pct += 5) {
            const tick = document.createElement('span');
            tick.className = 'tm-slider-tick';
            tick.dataset.tmTickPct = String(pct);
            tick.setAttribute('aria-hidden', 'true');
            tick.style.left = `${pct}%`;
            fragment.appendChild(tick);
            ticks.push(tick);
        }
        tickOverlay.appendChild(fragment);

        let frame = 0;
        const sync = () => {
            frame = 0;
            syncSliderTicksToDevicePixels(tickOverlay, ticks);
        };
        const scheduleSync = () => {
            if (frame) return;
            if (typeof window.requestAnimationFrame === 'function') {
                frame = window.requestAnimationFrame(sync);
                return;
            }
            sync();
        };
        const resizeObserver = typeof window.ResizeObserver === 'function'
            ? new window.ResizeObserver(scheduleSync)
            : null;
        resizeObserver?.observe(tickOverlay);
        window.addEventListener('resize', scheduleSync, { passive: true });
        tickOverlay._tmSliderTicksCleanup = () => {
            if (frame && typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(frame);
            }
            frame = 0;
            resizeObserver?.disconnect();
            window.removeEventListener('resize', scheduleSync);
        };
        scheduleSync();
    }

    function makeVolumeIndicatorSvg() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', '40');
        svg.setAttribute('height', '40');
        svg.setAttribute('viewBox', '0 0 40 40');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');

        const makeCircle = (className, attrs) => {
            const circle = document.createElementNS(ns, 'circle');
            if (className) circle.setAttribute('class', className);
            Object.entries(attrs).forEach(([key, value]) => {
                circle.setAttribute(key, value);
            });
            svg.appendChild(circle);
            return circle;
        };

        const appendSpeakerIcon = (className, mode, transform) => {
            const group = makeSpeakerIconGroup(ns, mode);
            group.setAttribute('class', `${className} tm-volume-speaker-icon`);
            group.setAttribute('transform', transform);
            svg.appendChild(group);
        };

        makeCircle('tm-volume-arc-track', {
            cx: VOLUME_INDICATOR_CENTER,
            cy: VOLUME_INDICATOR_CENTER,
            r: VOLUME_ARC_RADIUS,
            fill: 'none',
            stroke: VOLUME_ARC_TRACK,
            'stroke-width': VOLUME_ARC_STROKE_WIDTH,
            transform: 'rotate(-90 20 20)'
        });
        makeCircle('tm-volume-arc', {
            cx: VOLUME_INDICATOR_CENTER,
            cy: VOLUME_INDICATOR_CENTER,
            r: VOLUME_ARC_RADIUS,
            fill: 'none',
            stroke: VOLUME_ACCENT_LIGHT,
            'stroke-width': VOLUME_ARC_STROKE_WIDTH,
            'stroke-dasharray': '0 100',
            'visibility': 'hidden',
            'pathLength': '100',
            transform: 'rotate(-90 20 20)'
        });
        const percent = document.createElementNS(ns, 'text');
        percent.setAttribute('class', 'tm-volume-percent');
        percent.setAttribute('x', VOLUME_INDICATOR_CENTER);
        percent.setAttribute('y', VOLUME_INDICATOR_TEXT_Y);
        percent.setAttribute('text-anchor', 'middle');
        percent.setAttribute('dominant-baseline', 'central');
        percent.setAttribute('alignment-baseline', 'central');
        percent.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
        percent.setAttribute('font-size', '15');
        percent.setAttribute('font-weight', '700');
        percent.textContent = '0';
        svg.appendChild(percent);

        appendSpeakerIcon('tm-volume-speaker-muted', 'muted', 'translate(8 8)');
        appendSpeakerIcon('tm-volume-speaker-low', 'low', 'translate(8 8)');
        appendSpeakerIcon('tm-volume-speaker-high', 'high', 'translate(8 8)');

        return svg;
    }

  return { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHoldTimer, clearExpandedHold, scheduleExpandedHoldRelease, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg, populateSliderTicks };
}
