import { ownsMediaOutput, registerExternalMediaOutput } from '../shared/normalization-output.js';

const buttons = new WeakMap();
const selector = '[data-a-target="seventv-player-audio-compressor-button"]';
const explanation = '7TV compressor unavailable while Volume Slider controls audio. Reload with Auto-normalize volume off to use it.';

export function registerExistingTwitchAudio(window, video) {
  // A late userscript injection may miss the constructor call. An already-active
  // 7TV controller keeps its source attachment even after compression is off.
  if (window.document.querySelector('[data-a-target="seventv-player-audio-compressor-button"].is-active:not(.is-unavailable)')) {
    registerExternalMediaOutput(window, video);
  }
}

export function syncTwitchAudioCompatibility(window, video, mutations) {
  // Reuse the existing page observer without rescanning controls for chat traffic.
  if (mutations && !mutations.some(({ target, addedNodes }) => target.nodeType === 1 && target.closest(selector)
    || [...addedNodes].some(node => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))))) {
    return;
  }
  const owned = ownsMediaOutput(window, video);
  for (const button of window.document.querySelectorAll(selector)) {
    let saved = buttons.get(button);
    if (owned) {
      if (!saved) {
        // 7TV's custom tooltip uses its private requested state, which can be
        // wrong after source creation fails. Use the native explanation instead.
        saved = { disabled: button.disabled, label: button.getAttribute('aria-label'), title: button.getAttribute('title'),
          hover: event => event.stopImmediatePropagation() };
        buttons.set(button, saved);
        button.addEventListener('mouseenter', saved.hover, true);
      }
      if (!button.disabled) { button.disabled = true; }
      if (button.getAttribute('aria-label') !== explanation) { button.setAttribute('aria-label', explanation); }
      if (button.title !== explanation) { button.title = explanation; }
    } else if (saved) {
      button.disabled = saved.disabled;
      for (const [attribute, value] of [['aria-label', saved.label], ['title', saved.title]]) {
        if (value === null) { button.removeAttribute(attribute); }
        else { button.setAttribute(attribute, value); }
      }
      button.removeEventListener('mouseenter', saved.hover, true);
      buttons.delete(button);
    }
  }
}
