export function createVolumeControlElements({
  document,
  overlay,
  sliderId,
  valueLabelId,
  makeVolumeIndicatorSvg,
  populateSliderTicks
}) {
  const iconCell = document.createElement('button');
  iconCell.type = 'button';
  iconCell.className = 'tm-volume-icon-cell';

  const indicator = document.createElement('div');
  indicator.className = 'tm-volume-indicator';
  indicator.appendChild(makeVolumeIndicatorSvg());
  iconCell.appendChild(indicator);

  const panelBg = document.createElement('div');
  panelBg.className = 'tm-volume-panel-bg';

  const topRow = document.createElement('div');
  topRow.className = 'tm-volume-controls tm-volume-top-row';

  const label = document.createElement('div');
  label.id = valueLabelId;
  label.textContent = '100%';
  topRow.appendChild(label);

  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'tm-volume-controls tm-volume-slider-row';
  Object.assign(sliderWrap.style, {
    position: 'relative',
    height: '40px',
    display: 'flex',
    alignItems: 'center'
  });

  const tickOverlay = document.createElement('div');
  tickOverlay.className = 'tm-slider-ticks';
  populateSliderTicks(tickOverlay);

  const sliderTrack = document.createElement('div');
  sliderTrack.className = 'tm-slider-track';

  const slider = document.createElement('input');
  slider.id = sliderId;
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  Object.assign(slider.style, {
    width: '100%',
    display: 'block',
    margin: '0',
    cursor: 'pointer'
  });
  slider.setAttribute('aria-label', 'Volume');
  slider.setAttribute('aria-describedby', valueLabelId);

  sliderWrap.append(sliderTrack, slider, tickOverlay);
  overlay.append(panelBg, iconCell, topRow, sliderWrap);
  return { iconCell, indicator, panelBg, topRow, label, sliderWrap, tickOverlay, sliderTrack, slider };
}

export function syncVolumeControl({ slider, label, overlay, value, muted, updateSliderBar, updateVolumeIndicator }) {
  slider.value = String(value);
  label.textContent = muted ? 'Muted' : `${value}%`;
  updateSliderBar(slider);
  updateVolumeIndicator(overlay, value, muted);
}

export function bindWheelVolumeStep({ target, slider, step = 5, beforeApply, applyValue }) {
  const handler = (event) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const currentValue = Number(slider.value) || 0;
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextValue = Math.min(100, Math.max(0, currentValue + (direction * step)));
    if (nextValue === currentValue) return;
    beforeApply?.(event, nextValue);
    slider.value = String(nextValue);
    applyValue(nextValue);
  };
  target.addEventListener('wheel', handler, { passive: false });
  return () => target.removeEventListener('wheel', handler, { passive: false });
}

export function bindRangePointerInteraction({
  window,
  slider,
  overlay,
  isSnapEnabled,
  readSnappedValue,
  snapValue,
  applyValue,
  setExpanded,
  updateOpacity,
  collapseIfIdle,
  onFinish,
  finishLayout
}) {
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerStartValue = 0;
  let pointerMoved = false;
  let clickSnapHandled = false;
  let pointerActive = false;

  const snapDirectClickIfNeeded = () => {
    const currentValue = Number(slider.value) || 0;
    if (clickSnapHandled || pointerMoved || currentValue === pointerStartValue) return;
    const snappedValue = snapValue(currentValue);
    slider.value = String(snappedValue);
    applyValue(snappedValue);
    clickSnapHandled = true;
  };

  const readPressAwareValue = () => {
    if (isSnapEnabled()) return readSnappedValue(slider);
    let value = Number(slider.value) || 0;
    if (pointerActive && !pointerMoved && !clickSnapHandled && value !== pointerStartValue) {
      value = snapValue(value);
      slider.value = String(value);
      clickSnapHandled = true;
    }
    return value;
  };

  const finish = (event) => {
    const wasDragging = overlay.dataset.tmDragging === 'true';
    if (event?.type === 'pointerup' && wasDragging) snapDirectClickIfNeeded();
    overlay.dataset.tmDragging = 'false';
    pointerActive = false;
    onFinish?.(event, wasDragging);
    if (finishLayout) {
      finishLayout(!overlay.matches(':hover'));
      return;
    }
    updateOpacity();
    collapseIfIdle(!overlay.matches(':hover'));
  };

  const start = (event) => {
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    pointerStartValue = Number(slider.value) || 0;
    pointerMoved = false;
    clickSnapHandled = false;
    pointerActive = true;
    overlay.dataset.tmDragging = 'true';
    setExpanded();
    updateOpacity();
  };
  const move = (event) => {
    if (Math.abs(event.clientX - pointerStartX) > 3 || Math.abs(event.clientY - pointerStartY) > 3) {
      pointerMoved = true;
    }
  };

  slider.addEventListener('pointerdown', start);
  slider.addEventListener('pointermove', move);
  slider.addEventListener('pointerup', finish);
  slider.addEventListener('click', snapDirectClickIfNeeded);
  slider.addEventListener('pointercancel', finish);
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('pointercancel', finish, true);
  window.addEventListener('blur', finish);

  return {
    readPressAwareValue,
    dispose() {
      slider.removeEventListener('pointerdown', start);
      slider.removeEventListener('pointermove', move);
      slider.removeEventListener('pointerup', finish);
      slider.removeEventListener('click', snapDirectClickIfNeeded);
      slider.removeEventListener('pointercancel', finish);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
    }
  };
}
