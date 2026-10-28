import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../helpers/runtime.js';
import { createVolumeNumberRenderer } from '../../src/shared/volume-number.js';

test('wide-font 100 fits naturally, caches its size and restores normal sizing for other values', t => {
  const runtime = createRuntime();
  t.after(() => runtime.close());
  const sizes = [];
  const context = {
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      sizes.push(size);
      return { actualBoundingBoxLeft: 0, actualBoundingBoxRight: text === '100' ? size * 2 : size,
        actualBoundingBoxAscent: size * .75, actualBoundingBoxDescent: 0 };
    }
  };
  runtime.window.CanvasRenderingContext2D = function() {};
  runtime.window.HTMLCanvasElement.prototype.getContext = () => context;
  const element = runtime.document.createElementNS('http://www.w3.org/2000/svg', 'text');
  const render = createVolumeNumberRenderer(runtime.document, 20);
  render(element, '100');
  const size = parseFloat(element.style.fontSize);
  assert.ok(size > 0 && size < 15);
  assert.ok(size * 2 - .5 <= 22.5);
  assert.equal(element.textContent, '100');
  assert.equal(element.hasAttribute('textLength'), false);
  assert.equal(element.hasAttribute('lengthAdjust'), false);
  render(element, '100');
  assert.equal(sizes.length, 2, 'fitted measurements are reused');
  render(element, '50');
  assert.equal(element.style.fontSize, '');
  assert.equal(element.hasAttribute('data-compact'), false);
  render(element, '100');
  assert.equal(parseFloat(element.style.fontSize), size);
  assert.equal(sizes.length, 3, 'returning to 100 reuses its fitted position and size');
});
