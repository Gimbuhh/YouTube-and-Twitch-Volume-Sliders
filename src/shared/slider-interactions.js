import { stepVolume } from './volume.js';

export function createVolumeControlElements({
  document,
  overlay,
  sliderId,
  valueLabelId,
  makeVolumeIndicatorSvg,
  populateSliderTicks,
  getVolumeStep
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
  // Keep the native range on 1% increments so fixed 5% keyboard changes can
  // represent off-grid values. Pointer and wheel input are stepped in JS.
  slider.step = '1';
  slider.dataset.tmVolumeStep = String(getVolumeStep());
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
  return { iconCell, topRow, label, tickOverlay, slider };
}

export function syncVolumeControl({ slider, label, overlay, value, muted, updateSliderBar, updateVolumeIndicator }) {
  slider.value = String(value);
  label.textContent = muted ? 'Muted' : `${value}%`;
  updateSliderBar(slider);
  updateVolumeIndicator(overlay, value, muted);
}

export function bindWheelVolumeStep({ target, slider, getVolumeStep, beforeApply, applyValue }) {
  const pixelThreshold = 40;
  const gestureGapMs = 250;
  let accumulatedPixels = 0;
  let lastDirection = 0;
  let lastTime = 0;
  const handler = (event) => {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented || !Number.isFinite(event.deltaY) || event.deltaY === 0) {
      accumulatedPixels = 0;
      lastDirection = 0;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY < 0 ? 1 : -1;
    if (direction !== lastDirection || event.timeStamp - lastTime > gestureGapMs) {
      accumulatedPixels = 0;
    }
    lastDirection = direction;
    lastTime = event.timeStamp;
    // Accumulate smooth pixel scrolling, but retain one step per discrete
    // mouse-wheel event, including line/page units and large pixel deltas.
    accumulatedPixels += (event.deltaMode || 0) === 0
      ? Math.min(Math.abs(event.deltaY), pixelThreshold)
      : pixelThreshold;
    if (accumulatedPixels < pixelThreshold) {
      return;
    }
    accumulatedPixels -= pixelThreshold;
    const currentValue = Number(slider.value) || 0;
    const step = getVolumeStep();
    const nextValue = stepVolume(currentValue, direction, step);
    if (nextValue === currentValue) {
      return;
    }
    beforeApply?.(event, nextValue);
    slider.value = String(nextValue);
    applyValue(nextValue);
  };
  target.addEventListener('wheel', handler, { passive: false });
  return () => target.removeEventListener('wheel', handler, { passive: false });
}

export function getMajorTickPressValue(slider, clientX, volumeStep) {
  if (volumeStep !== 1 && volumeStep !== 2) return null;
  if (!Number.isFinite(clientX)) return null;

  const tickOverlay = slider?.parentElement?.querySelector?.('.tm-slider-ticks');
  const overlayRect = tickOverlay?.getBoundingClientRect?.();
  if (!overlayRect || !Number.isFinite(overlayRect.width) || overlayRect.width <= 0) return null;

  const majorTicks = Array.from(tickOverlay.querySelectorAll?.('.tm-slider-tick-major') || []);
  let nearestValue = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const tick of majorTicks) {
    const value = Number(tick.dataset?.tmTickPct);
    const rect = tick.getBoundingClientRect?.();
    if (!Number.isFinite(value) || !rect) continue;
    const center = Number(rect.left) + (Number(rect.width) / 2);
    const distance = Math.abs(clientX - center);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestValue = value;
    }
  }

  const majorTickSpacing = overlayRect.width / 10;
  const hitRadius = Math.max(4, Math.min(8, majorTickSpacing * 0.3));
  return nearestDistance <= hitRadius ? nearestValue : null;
}

export function bindRangePointerInteraction({
  window,
  slider,
  overlay,
  getVolumeStep,
  readSteppedValue,
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
  let pointerDisplaced = false;
  let clickSnapHandled = false;
  let majorTickPressHandled = false;
  let pointerActive = false;

  const snapMajorTickPressIfNeeded = (event) => {
    if (!pointerActive || pointerDisplaced || majorTickPressHandled) return false;
    const pressedValue = getMajorTickPressValue(slider, event?.clientX ?? pointerStartX, getVolumeStep?.());
    if (pressedValue === null) return false;
    majorTickPressHandled = true;
    clickSnapHandled = true;
    const currentValue = Number(slider.value) || 0;
    if (pressedValue !== currentValue) {
      slider.value = String(pressedValue);
      applyValue(pressedValue);
    }
    return true;
  };

  const snapDirectClickIfNeeded = (event) => {
    if (snapMajorTickPressIfNeeded(event)) return;
    const currentValue = Number(slider.value) || 0;
    if (clickSnapHandled || pointerMoved || currentValue === pointerStartValue) return;
    const snappedValue = snapValue(currentValue);
    slider.value = String(snappedValue);
    applyValue(snappedValue);
    clickSnapHandled = true;
  };

  const readPressAwareValue = () => {
    const value = readSteppedValue(slider);
    if (pointerActive && !pointerDisplaced && !majorTickPressHandled) {
      const pressedValue = getMajorTickPressValue(slider, pointerStartX, getVolumeStep?.());
      if (pressedValue !== null) {
        slider.value = String(pressedValue);
        majorTickPressHandled = true;
        clickSnapHandled = true;
        return pressedValue;
      }
    }
    if (pointerActive && !pointerMoved && !clickSnapHandled && value !== pointerStartValue) {
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
    pointerDisplaced = false;
    clickSnapHandled = false;
    majorTickPressHandled = false;
    pointerActive = true;
    overlay.dataset.tmDragging = 'true';
    setExpanded();
    updateOpacity();
  };
  const move = (event) => {
    if (Math.abs(event.clientX - pointerStartX) > 1 || Math.abs(event.clientY - pointerStartY) > 1) {
      pointerDisplaced = true;
    }
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
