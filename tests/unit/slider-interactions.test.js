import test from 'node:test';
import assert from 'node:assert/strict';
import { bindRangePointerInteraction, getMajorTickPressValue } from '../../src/shared/slider-interactions.js';

function createTickFixture() {
  const left = 100;
  const width = 150;
  const ticks = Array.from({ length: 9 }, (_, index) => {
    const value = (index + 1) * 10;
    const center = left + (width * (value / 100));
    return {
      dataset: { tmTickPct: String(value) },
      getBoundingClientRect: () => ({ left: center - 0.5, width: 1 })
    };
  });
  const tickOverlay = {
    getBoundingClientRect: () => ({ left, width }),
    querySelectorAll: () => ticks
  };
  const slider = new EventTarget();
  slider.value = '9';
  slider.parentElement = { querySelector: () => tickOverlay };
  return { slider, tickOverlay };
}

function pointerEvent(type, clientX, clientY = 0) {
  const event = new Event(type);
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY }
  });
  return event;
}

test('major ticks expose a bounded click magnet only for fine steps', () => {
  const { slider } = createTickFixture();
  assert.equal(getMajorTickPressValue(slider, 115, 1), 10);
  assert.equal(getMajorTickPressValue(slider, 119.4, 2), 10);
  assert.equal(getMajorTickPressValue(slider, 120, 2), null);
  assert.equal(getMajorTickPressValue(slider, 115, 5), null);
});

test('major-tick presses snap but fine dragging remains unsnapped', () => {
  const { slider } = createTickFixture();
  const window = new EventTarget();
  const overlay = { dataset: {}, matches: () => false };
  const applied = [];
  const rangePointer = bindRangePointerInteraction({
    window,
    slider,
    overlay,
    getVolumeStep: () => 1,
    readSteppedValue: control => Number(control.value),
    snapValue: value => Math.round(value),
    applyValue: value => applied.push(value),
    setExpanded: () => {},
    updateOpacity: () => {},
    collapseIfIdle: () => {}
  });

  slider.dispatchEvent(pointerEvent('pointerdown', 115));
  window.dispatchEvent(pointerEvent('pointerup', 115));
  slider.dispatchEvent(pointerEvent('click', 115));
  assert.equal(slider.value, '10');
  assert.deepEqual(applied, [10]);

  slider.value = '50';
  slider.dispatchEvent(pointerEvent('pointerdown', 127));
  slider.value = '18';
  const firstInputValue = rangePointer.readPressAwareValue();
  applied.push(firstInputValue);
  window.dispatchEvent(pointerEvent('pointerup', 127));
  assert.equal(firstInputValue, 20);
  assert.equal(slider.value, '20');
  assert.deepEqual(applied, [10, 20]);

  slider.value = '48';
  slider.dispatchEvent(pointerEvent('pointerdown', 172));
  slider.dispatchEvent(pointerEvent('pointermove', 173.5));
  slider.value = '49';
  applied.push(rangePointer.readPressAwareValue());
  window.dispatchEvent(pointerEvent('pointerup', 173.5));
  assert.equal(slider.value, '49');
  assert.equal(applied.includes(50), false);

  rangePointer.dispose();
});
