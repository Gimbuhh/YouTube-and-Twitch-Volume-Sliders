import { createStyleElement, fillStyleTemplate } from './styles.js';

const OPTIONS_STYLE_TEMPLATE = String.raw`
            #{{optionsButtonId}} {
                opacity: 0.94;
            }
            #{{optionsButtonId}}:hover,
            #{{optionsButtonId}}:focus-visible,
            #{{optionsButtonId}}[aria-expanded="true"] {
                opacity: 1;
            }
            #{{optionsButtonId}}[data-tm-volume-mode="off"] svg {
                opacity: 0.58;
            }
            #{{optionsButtonId}} svg {
                display: block;
                height: 24px;
                width: 24px;
            }
            #{{optionsPopupId}} {
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
                max-width: calc(100vw - 16px);
                min-width: 288px;
                outline: none;
                overflow: hidden;
                position: absolute;
                user-select: none;
                width: 320px;
                z-index: 10001;
            }
            #{{optionsPopupId}},
            #{{optionsPopupId}} * {
                box-sizing: border-box;
            }
            #{{optionsPopupId}} button {
                -webkit-appearance: none;
                appearance: none;
                font-family: inherit;
                letter-spacing: normal;
                margin: 0;
                text-transform: none;
            }
            #{{optionsPopupId}} .tm-volume-options-button-label {
                display: block;
                font-size: 14px;
                font-weight: 400;
                min-width: 0;
            }
            #{{optionsPopupId}}[hidden] {
                display: none;
            }
            #{{optionsPopupId}} [hidden] {
                display: none !important;
            }
            #{{optionsPopupId}} .tm-volume-options-mode {
                align-items: center;
                display: flex;
                flex-shrink: 0;
                justify-content: space-between;
                gap: 12px;
                padding: 8px 16px 10px;
                line-height: 20px;
            }
            #{{optionsPopupId}} select {
                -webkit-appearance: none;
                appearance: none;
                background-color: rgba(255, 255, 255, 0.08);
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m3 4.5 3 3 3-3' fill='none' stroke='%23fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
                background-position: right 12px center;
                background-repeat: no-repeat;
                background-size: 12px 12px;
                border: 0;
                border-radius: 6px;
                color: #fff;
                color-scheme: dark;
                cursor: pointer;
                font: inherit;
                line-height: 20px;
                outline: none;
                padding: 7px 32px 7px 10px;
                width: 176px;
            }
            #{{optionsPopupId}} select:open {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m3 7.5 3-3 3 3' fill='none' stroke='%23fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
            }
            #{{optionsPopupId}} select:focus-visible {
                background-color: rgba(255, 255, 255, 0.16);
            }
            #{{optionsPopupId}} select option {
                background-color: #242424;
                color: #fff;
            }
            #{{optionsPopupId}} .tm-volume-options-tabs {
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: grid;
                flex-shrink: 0;
                grid-template-columns: 1fr 1fr;
                padding: 0 16px;
            }
            #{{optionsPopupId}} .tm-volume-options-tab {
                background: transparent;
                border: 0;
                color: rgba(255, 255, 255, 0.65);
                cursor: pointer;
                display: grid;
                padding: 11px 0;
                place-items: center;
            }
            #{{optionsPopupId}} .tm-volume-options-tab[aria-selected="true"] {
                box-shadow: inset 0 -2px {{accentDark}};
                color: #fff;
            }
            #{{optionsPopupId}} .tm-volume-options-tab:hover {
                color: #fff;
            }
            #{{optionsPopupId}} :is(button, input):focus-visible {
                outline: 2px solid {{accentDark}};
                outline-offset: -2px;
            }
            #{{optionsPopupId}} .tm-volume-options-normalization-feedback {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.09);
                border-radius: 6px;
                margin-top: 6px;
                padding: 8px 10px;
            }
            #{{optionsPopupId}} #tm-volume-options-normalization-status {
                color: rgba(255, 255, 255, 0.9);
                margin: 0;
            }
            #{{optionsPopupId}} #tm-volume-options-normalization-status::before {
                background: rgba(255, 255, 255, 0.45);
                border-radius: 50%;
                content: '';
                display: inline-block;
                height: 6px;
                margin-right: 7px;
                vertical-align: 1px;
                width: 6px;
            }
            #{{optionsPopupId}} #tm-volume-options-normalization-status[data-state="active"]::before {
                background: #60cf83;
            }
            #{{optionsPopupId}} #tm-volume-options-normalization-details {
                white-space: pre-line;
            }
            #{{optionsPopupId}} .tm-volume-options-step-setting {
                margin-top: 14px;
            }
            #{{optionsPopupId}} .tm-volume-options-step-setting .tm-volume-options-section-label {
                color: rgba(255, 255, 255, 0.75);
                font-size: 12px;
                font-weight: 400;
                margin-bottom: 8px;
            }
            #{{optionsPopupId}} .tm-volume-options-appearance-hint {
                padding: 8px 16px 0;
            }
            #{{optionsPopupId}} #tm-volume-options-placement-section > .tm-volume-options-checklist {
                margin-top: 8px;
            }
{{platformOptionsCss}}
            .tm-volume-options-header {
                align-items: center;
                display: flex;
                flex-shrink: 0;
                padding: 10px 16px 4px;
            }
            .tm-volume-options-title {
                color: #fff;
                font-size: 15px;
                font-weight: 600;
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
                color: #fff;
                font-size: 14px;
                font-weight: 600;
                line-height: 20px;
                margin: 0 0 10px;
            }
            .tm-volume-options-checklist {
                display: flex;
                flex-direction: column;
            }
            #{{optionsPopupId}} .tm-volume-options-help {
                color: rgba(255, 255, 255, 0.7);
                font-size: 12px;
                line-height: 1.4;
                margin: 6px 0 0;
                white-space: normal;
            }
            #{{optionsPopupId}} .tm-volume-options-checklist .tm-volume-options-row {
                align-items: center;
                column-gap: 12px;
                display: grid;
                grid-template-columns: 1fr 32px;
                justify-content: stretch;
                margin: 0 -8px;
                min-height: 36px;
                padding: 5px 8px;
                width: calc(100% + 16px);
            }
            .tm-volume-options-checklist .tm-volume-options-row > .tm-volume-options-button-label {
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
            .tm-volume-options-row > .tm-volume-options-button-label {
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
                background: rgba(255, 255, 255, 0.22);
                border: 0;
                border-radius: 10px;
                display: block;
                flex-shrink: 0;
                height: 18px;
                position: relative;
                width: 32px;
            }
            .tm-volume-options-checkbox::after {
                background: #fff;
                border-radius: 50%;
                content: '';
                height: 14px;
                left: 2px;
                position: absolute;
                top: 2px;
                width: 14px;
            }
            .tm-volume-options-row[aria-checked="true"] .tm-volume-options-checkbox {
                background: {{accentDark}};
            }
            .tm-volume-options-row[aria-checked="true"] .tm-volume-options-checkbox::after {
                left: 16px;
            }
            .tm-volume-options-section-label + * {
                padding-top: 2px;
            }
            .tm-volume-options-segment {
                display: flex;
                gap: 8px;
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
                display: grid;
                flex: 1 1 0;
                font-size: 12px;
                font-weight: 600;
                line-height: 16px;
                min-height: 34px;
                min-width: 0;
                padding: 0 10px;
                place-items: center;
                text-align: center;
                transition: background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
            }
            .tm-volume-options-radio > .tm-volume-options-button-label {
                line-height: 16px;
                max-width: 100%;
                text-align: center;
                width: 100%;
            }
            .tm-volume-options-radio:hover,
            .tm-volume-options-radio:focus-visible {
                background: rgba(255, 255, 255, 0.1);
                outline: none;
            }
            .tm-volume-options-radio[aria-checked="true"] {
                background: {{accentDark}};
                border-color: {{accentDark}};
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
                background: {{accentDisabled}};
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
                display: grid;
                flex-shrink: 0;
                font-size: 11px;
                font-weight: 500;
                height: 28px;
                line-height: 16px;
                min-width: 52px;
                padding: 0 10px;
                place-items: center;
                text-align: center;
            }
            .tm-volume-options-opacity-reset > .tm-volume-options-button-label {
                line-height: 16px;
                text-align: center;
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

function getPlatformOptionsCss(platform, closeHideControlsClass) {
  if (platform === 'twitch') {
    return `            .tm-volume-options-controls-shell-hold,
            [data-a-target="player-controls"].tm-volume-options-controls-hold,
            [data-a-target="player-controls"].tm-volume-options-controls-hold #channel-player {
                opacity: 1 !important;
                pointer-events: auto !important;
                visibility: visible !important;
            }`;
  }
  return `            .tm-volume-options-open .ytp-tooltip {
                display: none !important;
            }
            #movie_player.ytp-autohide:not(.tm-volume-options-controls-hold) .ytp-chrome-bottom,
            #movie_player.ytp-hide-controls:not(.tm-volume-options-controls-hold) .ytp-chrome-bottom {
                pointer-events: none !important;
            }
            #movie_player.${closeHideControlsClass}:not(.tm-volume-options-controls-hold) .ytp-chrome-bottom {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            .tm-volume-options-controls-hold .ytp-chrome-bottom {
                opacity: 1 !important;
                pointer-events: auto !important;
                visibility: visible !important;
            }`;
}

export function installOptionsStyles({
  document,
  platform,
  styleId,
  optionsButtonId,
  optionsPopupId,
  accentDark,
  accentDisabled,
  closeHideControlsClass = ''
}) {
  const style = createStyleElement(document, styleId);
  if (!style) return;
  style.textContent = fillStyleTemplate(OPTIONS_STYLE_TEMPLATE, {
    optionsButtonId,
    optionsPopupId,
    accentDark,
    accentDisabled,
    platformOptionsCss: getPlatformOptionsCss(platform, closeHideControlsClass)
  });
}
