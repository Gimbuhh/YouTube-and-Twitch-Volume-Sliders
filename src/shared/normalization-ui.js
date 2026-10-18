export function createNormalizationIcon(document) {
  const icon = document.createElement('span');
  icon.className = 'tm-normalization-icon';
  icon.hidden = true;
  icon.title = 'Auto-normalize volume is active';
  icon.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('focusable', 'false');
  const frame = document.createElementNS(ns, 'circle');
  frame.setAttribute('cx', '7');
  frame.setAttribute('cy', '7');
  frame.setAttribute('r', '6.5');
  const waveform = document.createElementNS(ns, 'path');
  waveform.setAttribute('d', 'M3.5 5.5v3 M7 3.5v7 M10.5 5.5v3');
  svg.append(frame, waveform);
  icon.append(svg);
  return icon;
}

export function updateNormalizationIcon(overlay, active) {
  if (!overlay) return;
  const icon = overlay.querySelector('.tm-normalization-icon');
  const description = overlay.querySelector('.tm-normalization-description');
  if (!icon || !description || icon.hidden === !active) return;

  overlay.classList.toggle('tm-normalization-active', active);
  icon.hidden = !active;
  for (const control of overlay.querySelectorAll('.tm-volume-icon-cell, input[type="range"]')) {
    const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== description.id);
    if (active) ids.push(description.id);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
    else control.removeAttribute('aria-describedby');
  }
}
