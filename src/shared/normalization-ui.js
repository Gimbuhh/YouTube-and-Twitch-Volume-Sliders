export function createNormalizationIcon(document) {
  const icon = document.createElement('span');
  icon.className = 'tm-normalization-icon';
  icon.hidden = true;
  icon.title = 'Auto-normalize volume is on';
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

export function updateNormalizationIcon(overlay, status) {
  if (!overlay) return;
  // Pausing, buffering, startup and mute are normal enabled states. Hide the
  // indicator for Off or a status requiring accessible audio/user activation.
  const visible = status.startsWith('Active') || status === 'Waiting for playback'
    || status === 'Starting audio analysis' || status === 'Muted';
  const icon = overlay.querySelector('.tm-normalization-icon');
  const description = overlay.querySelector('.tm-normalization-description');
  if (!icon || !description || icon.hidden === !visible) return;

  overlay.classList.toggle('tm-normalization-enabled', visible);
  icon.hidden = !visible;
  for (const control of overlay.querySelectorAll('.tm-volume-icon-cell, input[type="range"]')) {
    const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== description.id);
    if (visible) ids.push(description.id);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
    else control.removeAttribute('aria-describedby');
  }
}
