import { createStyleElement } from './styles.js';

const selector = '[data-tm-tooltip]';
const tooltipId = 'tm-volume-player-tooltip';
const css = `
.tm-player-tooltip {
  box-sizing:border-box; position:absolute; z-index:10002; width:max-content;
  max-width:320px; padding:5px 9px; border:0; border-radius:8px;
  background:rgba(0,0,0,.3); color:#eee; backdrop-filter:blur(12px);
  font:500 13px/15px "YouTube Noto",Roboto,Arial,Helvetica,sans-serif;
  letter-spacing:normal; text-align:left; text-shadow:none; text-transform:none;
  white-space:normal; overflow-wrap:anywhere; pointer-events:none;
  animation:none; transition:none;
}
.tm-player-tooltip[data-platform="twitch"] {
  position:fixed;
  padding:4px 8px; border-radius:4px; backdrop-filter:none;
  background:var(--color-background-tooltip,#fff); color:var(--color-text-tooltip,#0e0e10);
  font:600 14px/1.4 var(--font-base,Inter,Roobert,"Helvetica Neue",Helvetica,Arial,sans-serif);
  animation:tm-tooltip-pop-in 100ms ease backwards;
  transform-origin:center;
}
@keyframes tm-tooltip-pop-in {
  from { opacity:0; transform:scale(.9); }
  to { opacity:1; transform:scale(1); }
}
@media (prefers-reduced-motion:reduce) {
  .tm-player-tooltip[data-platform="twitch"] { animation:none; }
}
.tm-player-tooltip[data-platform="twitch"]::after {
  content:""; position:absolute; top:100%; left:var(--tm-tooltip-arrow-x,50%);
  transform:translateX(-50%); border:5px solid transparent; border-bottom:0;
  border-top-color:var(--color-background-tooltip,#fff);
}
.tm-player-tooltip[data-platform="twitch"][data-placement="bottom"]::after {
  top:auto; bottom:100%; border-top:0; border-bottom:5px solid var(--color-background-tooltip,#fff);
}
/* YouTube keeps its previous tooltip fading after entering a custom control.
   Keep one label visible and make control-button handoffs immediate. Seek
   previews retain their own transitions. Display remains owned by YouTube. */
#movie_player:has(.tm-player-tooltip[data-platform="youtube"]) .ytp-tooltip {
  visibility:hidden !important;
}
#movie_player:has(.ytp-chrome-bottom button:hover:not([data-tm-tooltip])) .ytp-tooltip.ytp-bottom:not(.ytp-preview):not(.ytp-tooltip-progress-bar-style) {
  opacity:1 !important; transition:none !important;
}`;

export function installPlayerTooltips(window, platform) {
  const { document } = window;
  let target = null, tooltip = null, observer = null, showTimer = null;
  const rootSelector = platform === 'youtube' ? '#movie_player' : '.video-player,[data-a-target="player-overlay-click-handler"]';
  function getVisiblePlayer(element) {
    if (!element?.isConnected || element.hidden || !element.dataset.tmTooltip) { return null; }
    const root = element.closest(rootSelector);
    if (!root) { return null; }
    if (platform === 'youtube') {
      if (element.getAttribute('aria-expanded') === 'true'
        || document.getElementById('tm-volume-options-popup')?.hasAttribute('hidden') === false) { return null; }
      if (root.classList.contains('ytp-settings-shown')) { return null; }
      for (const menu of root.querySelectorAll('.ytp-popup:not(button)')) {
        if (menu.getClientRects().length && window.getComputedStyle(menu).visibility !== 'hidden') { return null; }
      }
    } else if (element.closest('[data-a-target="player-controls"]')?.getAttribute('data-a-visible') === 'false') {
      return null;
    }
    // Tooltips follow the control's visibility even when rendered in an overlay.
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      if (ancestor.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') { return null; }
      if (ancestor === root && platform === 'youtube') { break; }
    }
    return root;
  }

  function hide() {
    window.clearTimeout(showTimer);
    observer?.disconnect(); observer = null;
    tooltip?.remove(); tooltip = null; target = null;
  }

  function show() {
    const root = getVisiblePlayer(target);
    if (!root) { hide(); return; }
    const style = createStyleElement(document, 'tm-volume-player-tooltip-style');
    if (style) { style.textContent = css; }
    tooltip = document.createElement('div');
    tooltip.id = tooltipId;
    tooltip.className = 'tm-player-tooltip';
    tooltip.dataset.platform = platform;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = target.dataset.tmTooltip;
    // Reuse YouTube's current button-tooltip presentation, including variants.
    const nativeText = platform === 'youtube' && root.querySelector('.ytp-tooltip .ytp-tooltip-bottom-text');
    if (nativeText) {
      const native = window.getComputedStyle(nativeText);
      for (const property of ['font', 'color', 'backgroundColor', 'borderRadius', 'padding', 'backdropFilter', 'boxShadow']) {
        tooltip.style[property] = native[property];
      }
    }
    // Twitch's native menus are body portals above the player's stacking context.
    // Use that same overlay level, staying inside the fullscreen element when set.
    const fixed = platform === 'twitch';
    const host = fixed ? document.fullscreenElement || document.body : root;
    host.appendChild(tooltip);
    const box = root.getBoundingClientRect(), anchor = target.getBoundingClientRect();
    const sx = fixed ? 1 : box.width / root.offsetWidth || 1, sy = fixed ? 1 : box.height / root.offsetHeight || 1;
    const originX = fixed ? 0 : box.left + root.clientLeft * sx, originY = fixed ? 0 : box.top + root.clientTop * sy;
    const leftEdge = Math.max(fixed ? box.left + 8 : 8, (8 - originX) / sx);
    const rightEdge = Math.min(fixed ? box.right - 8 : root.clientWidth - 8, (window.innerWidth - 8 - originX) / sx);
    tooltip.style.maxWidth = `${Math.max(0, Math.min(320, rightEdge - leftEdge))}px`;
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    const center = ((anchor.left + anchor.right) / 2 - originX) / sx;
    const desiredLeft = platform === 'twitch' ? (anchor.right - originX) / sx - width : center - width / 2;
    const left = Math.max(leftEdge, Math.min(desiredLeft, rightEdge - width));
    const controls = platform === 'youtube' && target.closest('.ytp-chrome-bottom');
    const anchorTop = controls ? controls.getBoundingClientRect().top : anchor.top;
    const above = Math.floor((anchorTop - originY) / sy - height - 10);
    const below = above < (fixed ? Math.max(0, box.top) : Math.max(0, -originY / sy));
    tooltip.dataset.placement = below ? 'bottom' : 'top';
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${below ? (anchor.bottom - originY) / sy + 10 : above}px`;
    tooltip.style.setProperty('--tm-tooltip-arrow-x', `${Math.max(8, Math.min(width - 8, center - left))}px`);
    // Observe only while a tooltip is visible, to remove it with its control.
    observer = new window.MutationObserver(() => {
      if (!getVisiblePlayer(target) || tooltip.textContent !== target.dataset.tmTooltip) { hide(); }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'aria-expanded', 'data-tm-tooltip', 'data-a-visible', 'class', 'style'] });
    if (fixed) {
      // Remove an overlay tooltip if its player or any enclosing layout is removed
      // or hidden. Observe only the ancestor chain, avoiding unrelated chat churn.
      for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
        observer.observe(ancestor, { childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
      }
    }
  }

  function enter(element, delay) {
    if (element === target) { return; }
    hide();
    if (!getVisiblePlayer(element)) { return; }
    target = element;
    if (delay) { showTimer = window.setTimeout(show, delay); }
    else { show(); }
  }
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') { return; }
    const element = event.target.closest?.(selector);
    if (element) { enter(element, platform === 'youtube' ? 0 : 200); }
    else if (target && !target.contains(event.target)) { hide(); }
  }, true);
  document.addEventListener('pointerout', event => {
    if (!target?.contains(event.target) || target.contains(event.relatedTarget)) { return; }
    hide();
  }, true);
  document.addEventListener('focusin', event => {
    const element = event.target.closest?.(selector);
    if (element?.matches(':focus-visible')) { enter(element, 0); }
  }, true);
  document.addEventListener('focusout', event => { if (target?.contains(event.target)) { hide(); } }, true);
  for (const type of ['pointerdown', 'click']) { document.addEventListener(type, hide, true); }
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { hide(); } }, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('fullscreenchange', hide);
}
