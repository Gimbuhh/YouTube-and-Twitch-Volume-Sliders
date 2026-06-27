export function createOverlayUi(dependencies) {
  const {
    document, window, isAlwaysExpandedEnabled, isSliderOnVideo,
    updateOverlayOpacity, updateOverlaySize, finishExpandedHoldIfDue,
    accentLight: VOLUME_ACCENT_LIGHT, accentDark: VOLUME_ACCENT_DARK, accentMid: VOLUME_ACCENT_MID,
    arcTrack: VOLUME_ARC_TRACK, expandedHoldMs: VOLUME_CHANGE_EXPANDED_HOLD_MS
  } = dependencies;

    const DEFAULT_VISUAL_THUMB_SIZE_PX = 22;
    const VOLUME_INDICATOR_CENTER = '20';
    const VOLUME_INDICATOR_COMPACT_X = '19.5';
    const VOLUME_INDICATOR_TEXT_Y = '20';
    const VOLUME_ARC_RADIUS = '14';
    const VOLUME_ARC_STROKE_WIDTH = '3';
    const VOLUME_INDICATOR_COMPACT_TEXT_LENGTH = '21';

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
        }
        const percent = overlay.querySelector('.tm-volume-percent');
        if (percent) {
            const text = muted ? 'M' : String(Math.round(pct));
            const isCompact = text.length > 2;
            percent.textContent = text;
            percent.setAttribute('x', isCompact ? VOLUME_INDICATOR_COMPACT_X : VOLUME_INDICATOR_CENTER);
            percent.setAttribute('y', VOLUME_INDICATOR_TEXT_Y);
            if (isCompact) {
                percent.setAttribute('textLength', VOLUME_INDICATOR_COMPACT_TEXT_LENGTH);
                percent.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            } else {
                percent.removeAttribute('textLength');
                percent.removeAttribute('lengthAdjust');
            }
        }
        const arc = overlay.querySelector('.tm-volume-arc');
        if (arc) {
            arc.style.visibility = pct <= 0 ? 'hidden' : 'visible';
            arc.style.strokeLinecap = pct <= 0 ? 'butt' : 'round';
            const dash = pct >= 100 ? 100.01 : pct;
            arc.style.strokeDasharray = `${dash} 100`;
        }
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
        percent.textContent = '0';
        svg.appendChild(percent);

        return svg;
    }

  return { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHoldTimer, clearExpandedHold, scheduleExpandedHoldRelease, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg };
}
