import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOverlayUi } from '../../src/shared/overlay-ui.js';
import { createVolumeSettings } from '../../src/shared/settings.js';

test('expansion preserves size and opacity with one immediate and one deferred tick alignment', () => {
  const dom = new JSDOM('<div id="overlay"><div class="tm-slider-ticks"></div></div>');
  try {
    const { window } = dom;
    const { document } = window;
    const overlay = document.getElementById('overlay');
    const frames = [];
    let syncs = 0;
    window.requestAnimationFrame = callback => frames.push(callback);
    overlay.firstChild._tmSliderTicksSync = () => syncs++;
    const settings = createVolumeSettings({
      document, storage: { getItem: () => null }, keys: {}, defaults: {},
      userSettings: { sliderLocation: 'video', overlaySize: 150, overlayOpacityUnfocused: 45 },
      overlayId: 'overlay'
    });
    const ui = createOverlayUi({
      document, window, isAlwaysExpandedEnabled: () => false,
      isSliderOnVideo: settings.isSliderOnVideo,
      updateOverlayOpacity: settings.updateOverlayOpacity
    });
    for (let index = 0; index < 100; index++) {
      const expanded = index % 2 === 0;
      ui.setOverlayExpanded(overlay, expanded);
      assert.equal(overlay.classList.contains('tm-expanded'), expanded);
      assert.equal(overlay.classList.contains('tm-collapsed'), !expanded);
    }
    assert.equal(overlay.style.opacity, '0.45');
    assert.equal(overlay.style.getPropertyValue('--tm-overlay-scale'), '1.5');
    assert.equal(syncs, 100);
    assert.equal(frames.length, 100);
    frames.forEach(callback => callback());
    assert.equal(syncs, 200);
    ui.setOverlayExpanded(overlay, false);
    assert.equal(syncs, 200, 'unchanged expansion does no layout work');
  } finally {
    dom.window.close();
  }
});
