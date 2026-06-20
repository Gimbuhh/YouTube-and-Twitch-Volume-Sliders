const focusableSelector = 'input:not(:disabled),button:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

export function getOptionsPopupFocusable(popup) {
  return Array.from(popup.querySelectorAll(focusableSelector));
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
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('fill', '#fff');
  path.setAttribute('d', 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6h2z');
  svg.appendChild(path);
  return svg;
}
