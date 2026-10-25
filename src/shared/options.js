const focusableSelector = [
  'input:not(:disabled):not([tabindex="-1"])',
  'button:not(:disabled):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function isHiddenFromFocus(element, boundary) {
  const view = element.ownerDocument?.defaultView;
  for (let current = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return true;
    const style = view?.getComputedStyle?.(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return true;
    if (current === boundary) break;
  }
  return false;
}

export function getOptionsPopupFocusable(popup) {
  return Array.from(popup.querySelectorAll(focusableSelector))
    .filter((element) => !isHiddenFromFocus(element, popup));
}

export function bindOptionsPopupKeyboard({ document, popup, closePopup }) {
  const handler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePopup(true);
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = getOptionsPopupFocusable(popup);
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === popup)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === popup)) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}

export function createOptionsButtonIconSvg(document) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('height', '24');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [row, x, y] of [['top', 15, 5], ['middle', 7, 11], ['bottom', 11, 17]]) {
    const track = document.createElementNS(namespace, 'rect');
    track.setAttribute('x', '3'); track.setAttribute('y', String(y));
    track.setAttribute('width', '18'); track.setAttribute('height', '2');
    track.setAttribute('fill', '#fff');
    const handle = document.createElementNS(namespace, 'rect');
    handle.setAttribute('class', `tm-options-handle tm-options-handle-${row}`);
    handle.setAttribute('x', String(x)); handle.setAttribute('y', String(y - 2));
    handle.setAttribute('width', '2'); handle.setAttribute('height', '6');
    handle.setAttribute('fill', '#fff');
    svg.append(track, handle);
  }
  return svg;
}
