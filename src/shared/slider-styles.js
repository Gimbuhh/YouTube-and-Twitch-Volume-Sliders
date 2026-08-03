import { createStyleElement, fillStyleTemplate } from './styles.js';

const SLIDER_STYLE_TEMPLATE = String.raw`
#{{overlayId}} {
  --tm-pill-min-width: 228px;
  --tm-pill-zoom-adaptive-width: calc(34vw - 92px);
  --tm-pill-max-width: 368px;
  /* Browser zoom reduces the CSS viewport width, so this shrinks the expanded pill before it clips offscreen. */
  --tm-pill-expanded-width: clamp(var(--tm-pill-min-width), var(--tm-pill-zoom-adaptive-width), var(--tm-pill-max-width));
  --tm-label-row-width: 50px;
  --tm-slider-row-offset: 62px;
  filter: {{panelDropShadow}};
}
{{platformFootprintCss}}
#{{overlayId}}.tm-volume-appearance-classic {
  --tm-pill-min-width: 274px;
  --tm-pill-zoom-adaptive-width: calc(34vw - 46px);
  --tm-pill-max-width: 414px;
  --tm-label-row-width: 96px;
  --tm-slider-row-offset: 108px;
}{{compactCss}}
@media (max-width: 320px) {
  {{smallDefaultSelectors}} {
    --tm-pill-min-width: 176px;
    --tm-pill-zoom-adaptive-width: min(216px, calc(64vw - 14px));
  }

  {{smallClassicSelectors}} {
    --tm-pill-min-width: 196px;
    --tm-pill-zoom-adaptive-width: min(262px, calc(64vw + 6px));
  }

  #{{overlayId}} .tm-volume-slider-row {
    --tm-active-track-h: 9px;
    --tm-visual-track-h: 4px;
    --tm-thumb-size: 18px;
  }
}

#{{overlayId}} input[type=range] {
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

#{{overlayId}} input[type=range]::-webkit-slider-runnable-track {
  border: none;
  background: transparent;
  height: var(--tm-active-track-h, 9px);
  border-radius: var(--tm-track-radius);
}

#{{overlayId}} input[type=range]::-webkit-slider-thumb {
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

#{{overlayId}} input[type=range]::-webkit-slider-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

#{{overlayId}} input[type=range]::-webkit-slider-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

#{{overlayId}} input[type=range]::-moz-range-thumb {
  width: var(--tm-thumb-size);
  height: var(--tm-thumb-size);
  border-radius: 50%;
  background: linear-gradient(145deg, #ffffff, #f0f0f0);
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

#{{overlayId}} input[type=range]::-moz-range-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

#{{overlayId}} input[type=range]::-moz-range-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

#{{overlayId}} input[type=range]::-moz-range-track {
  background: transparent;
  height: var(--tm-active-track-h, 9px);
  border-radius: var(--tm-track-radius);
  border: none;
  outline: none;
}

#{{overlayId}} input[type=range]::-moz-range-progress {
  background: transparent;
  border: none;
}

#{{overlayId}} input[type=range]::-moz-focus-outer {
  border: none;
  outline: none;
}

#{{overlayId}} .tm-volume-panel-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  border: none;
  background: {{panelBackground}};
  box-sizing: border-box;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  opacity: 1;
  pointer-events: none;
  transform: none;
  transition: none;
}

#{{overlayId}} .tm-volume-icon-cell {
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

#{{overlayId}} .tm-volume-icon-cell:focus-visible {
  outline: 2px solid #fff;
  outline-offset: -4px;
  border-radius: 50%;
}

#{{overlayId}} .tm-volume-indicator {
  position: relative;
  width: 40px;
  height: 40px;
  opacity: 1;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

#{{overlayId}} .tm-volume-indicator svg {
  display: block;
  width: 40px;
  height: 40px;
  overflow: visible;
  shape-rendering: geometricPrecision;
}

#{{overlayId}} .tm-volume-arc-track,
#{{overlayId}} .tm-volume-arc {
  shape-rendering: geometricPrecision;
}

#{{overlayId}} .tm-volume-arc {
  stroke-linecap: round;
}

#{{overlayId}} .tm-volume-speaker-icon {
  color: rgba(255, 255, 255, 0.94);
  display: none;
}

#{{overlayId}}.tm-volume-appearance-classic .tm-volume-percent {
  display: none;
}

#{{overlayId}}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="muted"] .tm-volume-speaker-muted,
#{{overlayId}}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="low"] .tm-volume-speaker-low,
#{{overlayId}}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="high"] .tm-volume-speaker-high {
  display: block;
}

#{{overlayId}} .tm-volume-percent {
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

#{{overlayId}} .tm-volume-indicator.muted {
  filter: saturate(0.45);
  opacity: 0.78;
}

#{{overlayId}} .tm-volume-controls {
  position: relative;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity 0.08s ease 0.14s, visibility 0s linear 0.22s;
}

#{{overlayId}}.tm-collapsed .tm-volume-controls {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity 0.08s ease 0.14s, visibility 0s linear 0.22s;
}

#{{overlayId}}.tm-expanded .tm-volume-controls {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
  transition: opacity 0.1s ease, visibility 0s linear 0s;
}

#{{overlayId}} .tm-volume-top-row {
  flex: 0 0 auto;
  position: relative;
  width: var(--tm-label-row-width);
  height: 40px;
  box-sizing: border-box;
  pointer-events: {{topRowPointerEvents}};
}

#{{overlayId}} #{{valueLabelId}} {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
{{labelVisualCss}}}

#{{overlayId}}.tm-volume-appearance-classic #{{valueLabelId}} {
  left: 36px;
  top: 50%;
  width: 58px;
  height: auto;
  overflow: visible;
  clip-path: none;
  transform: translateY(-50%);
}

#{{overlayId}} .tm-volume-slider-row {
  --tm-active-track-h: 11px;
  --tm-visual-track-h: 5px;
  --tm-thumb-size: 22px;
  --tm-track-radius: calc(var(--tm-visual-track-h, 5px) / 2);
  flex: 0 0 calc(var(--tm-pill-expanded-width) - var(--tm-slider-row-offset));
  width: calc(var(--tm-pill-expanded-width) - var(--tm-slider-row-offset));
  min-width: 0;
  height: 40px;
}

#{{overlayId}} .tm-slider-track {
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

#{{overlayId}} .tm-slider-ticks {
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

#{{overlayId}} .tm-slider-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--tm-slider-tick-width, 1px);
  height: 100%;
  background: rgba(255,255,255,0.25);
  transform: none;
}

        `;

const YOUTUBE_LABEL_VISUAL_CSS = "  font: 500 14px/40px \"YouTube Noto\", Roboto, Arial, Helvetica, sans-serif;\n  color: #fff;\n  text-align: center;\n  text-shadow: 0 0 2px rgb(0, 0, 0);\n  user-select: none;\n  letter-spacing: 0;\n";

function getSliderPlatformStyles(platform, overlayId) {
  if (platform !== 'twitch') {
    return {
      platformFootprintCss: '',
      compactCss: '\n',
      smallDefaultSelectors: `#${overlayId}`,
      smallClassicSelectors: `#${overlayId}.tm-volume-appearance-classic`,
      panelBackground: 'rgba(8, 13, 15, 0.34)',
      topRowPointerEvents: 'none !important',
      labelVisualCss: YOUTUBE_LABEL_VISUAL_CSS
    };
  }
  return {
    platformFootprintCss: `
/* Match Twitch's native control footprint so the custom control does not raise the control row. */
#${overlayId}.tm-in-controls {
  height: 32px !important;
  min-height: 32px !important;
  overflow: clip !important;
  overflow-clip-margin: 4px;
  transform: translateY(0) !important;
}

#${overlayId}.tm-in-controls .tm-volume-panel-bg {
  top: -4px;
  bottom: auto;
  height: 40px;
}

#${overlayId}.tm-in-controls .tm-volume-icon-cell {
  top: -4px;
  left: 0;
}
`,
    compactCss: `

#${overlayId}.tm-volume-compact-layout {
  --tm-pill-min-width: 208px;
  --tm-pill-zoom-adaptive-width: min(252px, calc(64vw - 14px));
}

#${overlayId}.tm-volume-compact-layout.tm-volume-appearance-classic {
  --tm-pill-min-width: 228px;
  --tm-pill-zoom-adaptive-width: min(292px, calc(64vw + 6px));
}

#${overlayId}.tm-volume-compact-layout .tm-volume-slider-row {
  --tm-active-track-h: 9px;
  --tm-visual-track-h: 4px;
  --tm-thumb-size: 18px;
}
`,
    smallDefaultSelectors: `#${overlayId},
  #${overlayId}.tm-volume-compact-layout`,
    smallClassicSelectors: `#${overlayId}.tm-volume-appearance-classic,
  #${overlayId}.tm-volume-compact-layout.tm-volume-appearance-classic`,
    panelBackground: 'rgba(55, 48, 62, 0.34)',
    topRowPointerEvents: 'none',
    labelVisualCss: ''
  };
}

export function installVolumeSliderStyles({ document, platform, overlayId, valueLabelId, panelDropShadow }) {
  const style = createStyleElement(document, 'tm-volume-slider-style');
  if (!style) return;
  style.textContent = fillStyleTemplate(SLIDER_STYLE_TEMPLATE, {
    overlayId,
    valueLabelId,
    panelDropShadow,
    ...getSliderPlatformStyles(platform, overlayId)
  });
}
