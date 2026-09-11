import test from 'node:test';
import assert from 'node:assert/strict';
import { bindRangePointerInteraction, bindWheelVolumeStep, getMajorTickPressValue } from '../../src/shared/slider-interactions.js';

function createWheelFixture() {
  const target = new EventTarget();
  const slider = { value: '50' };
  const applied = [];
  let time = 0;
  const dispose = bindWheelVolumeStep({ target, slider, getVolumeStep: () => 5, applyValue: value => applied.push(value) });
  const wheel = (deltaY, options = {}) => {
    const event = new Event('wheel', { cancelable: true });
    const { elapsed = 10, ...properties } = options;
    time += elapsed;
    for (const [key, value] of Object.entries({ deltaY, deltaMode: 0, timeStamp: time, ...properties })) {
      Object.defineProperty(event, key, { value });
    }
    target.dispatchEvent(event);
    return event;
  };
  return { slider, applied, wheel, dispose };
}

test('wheel input accumulates tiny pixel deltas and keeps discrete mouse steps', () => {
  const { slider, applied, wheel, dispose } = createWheelFixture();
  for (let index = 0; index < 10; index++) {
    assert.equal(wheel(-0.1).defaultPrevented, true);
  }
  assert.equal(slider.value, '50');
  assert.deepEqual(applied, []);
  wheel(-20);
  wheel(-20);
  assert.equal(slider.value, '55');
  wheel(-100);
  assert.equal(slider.value, '60');
  wheel(3, { deltaMode: 1 });
  assert.equal(slider.value, '55');
  wheel(1, { deltaMode: 2 });
  assert.equal(slider.value, '50');
  dispose();
  wheel(-100);
  assert.equal(slider.value, '50');
});

test('zoom gestures pass through without changing volume or consuming partial scroll', () => {
  const { slider, applied, wheel } = createWheelFixture();
  for (const modifier of ['ctrlKey', 'metaKey']) {
    wheel(-30);
    assert.equal(wheel(-100, { [modifier]: true }).defaultPrevented, false);
    wheel(-10);
    assert.equal(slider.value, '50');
    wheel(0);
  }
  assert.deepEqual(applied, []);
});

test('wheel accumulation resets after a pause or direction change and clamps at bounds', () => {
  const { slider, applied, wheel } = createWheelFixture();
  wheel(-30);
  wheel(-10, { elapsed: 300 });
  assert.equal(slider.value, '50');
  wheel(30);
  assert.equal(slider.value, '50');
  wheel(10);
  assert.equal(slider.value, '45');
  slider.value = '100';
  wheel(-100);
  assert.deepEqual(applied, [45]);
  wheel(100);
  assert.equal(slider.value, '95');
  assert.equal(wheel(0).defaultPrevented, false);
});

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
