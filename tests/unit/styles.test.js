import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installOptionsStyles } from '../../src/shared/options-styles.js';
import { installVolumeSliderStyles } from '../../src/shared/slider-styles.js';

function installStyles(platform) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const { document } = dom.window;
  installVolumeSliderStyles({
    document,
    platform,
    overlayId: 'tm-volume-slider-overlay',
    valueLabelId: 'tm-volume-slider-value',
    panelDropShadow: 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.06))'
  });
  installOptionsStyles({
    document,
    platform,
    styleId: 'tm-volume-options-style',
    optionsButtonId: 'tm-volume-options-button',
    optionsPopupId: 'tm-volume-options-popup',
    accentDark: platform === 'twitch' ? '#9146ff' : '#bb3333',
    accentDisabled: platform === 'twitch'
      ? 'rgba(145, 70, 255, 0.55)'
      : 'rgba(187, 51, 51, 0.55)',
    closeHideControlsClass: 'tm-volume-options-close-hide-controls'
  });
  return { dom, document };
}

test('shared style templates resolve every token and install only once', () => {
  for (const platform of ['youtube', 'twitch']) {
    const { dom, document } = installStyles(platform);
    const slider = document.getElementById('tm-volume-slider-style');
    const options = document.getElementById('tm-volume-options-style');
    assert.ok(slider.textContent.includes('#tm-volume-slider-overlay input[type=range]'));
    assert.ok(options.textContent.includes('#tm-volume-options-popup'));
    assert.doesNotMatch(slider.textContent, /\{\{/);
    assert.doesNotMatch(options.textContent, /\{\{/);

    installVolumeSliderStyles({
      document,
      platform,
      overlayId: 'ignored',
      valueLabelId: 'ignored',
      panelDropShadow: 'none'
    });
    assert.equal(document.querySelectorAll('#tm-volume-slider-style').length, 1);
    assert.ok(slider.textContent.includes('#tm-volume-slider-overlay'));
    dom.window.close();
  }
});

test('platform style variants retain their distinct host contracts', () => {
  const youtube = installStyles('youtube');
  const twitch = installStyles('twitch');
  const youtubeSlider = youtube.document.getElementById('tm-volume-slider-style').textContent;
  const twitchSlider = twitch.document.getElementById('tm-volume-slider-style').textContent;
  const youtubeOptions = youtube.document.getElementById('tm-volume-options-style').textContent;
  const twitchOptions = twitch.document.getElementById('tm-volume-options-style').textContent;

  assert.match(youtubeSlider, /background: rgba\(8, 13, 15, 0\.34\)/);
  assert.match(youtubeSlider, /font: 500 14px\/40px "YouTube Noto"/);
  assert.doesNotMatch(youtubeSlider, /tm-volume-compact-layout/);
  assert.match(youtubeOptions, /movie_player\.tm-volume-options-close-hide-controls/);

  assert.match(twitchSlider, /background: rgba\(55, 48, 62, 0\.34\)/);
  assert.match(twitchSlider, /tm-in-controls/);
  assert.match(twitchSlider, /tm-volume-compact-layout/);
  assert.doesNotMatch(twitchSlider, /font: 500 14px\/40px "YouTube Noto"/);
  assert.match(twitchOptions, /player-controls.*tm-volume-options-controls-hold/);
  assert.doesNotMatch(twitchOptions, /ytp-chrome-bottom/);

  youtube.dom.window.close();
  twitch.dom.window.close();
});

test('volume arcs scale with browser zoom', () => {
  for (const platform of ['youtube', 'twitch']) {
    const { dom, document } = installStyles(platform);
    const slider = document.getElementById('tm-volume-slider-style');

    assert.match(slider.textContent, /\.tm-volume-arc-track,[\s\S]*shape-rendering:\s*geometricPrecision/);
    assert.doesNotMatch(slider.textContent, /vector-effect:\s*non-scaling-stroke/);
    dom.window.close();
  }
});

test('options button labels use zoom-stable centering rules', () => {
  for (const platform of ['youtube', 'twitch']) {
    const { dom, document } = installStyles(platform);
    const options = document.getElementById('tm-volume-options-style').textContent;

    assert.match(options, /#tm-volume-options-popup button\s*{[\s\S]*font-family:\s*inherit;[\s\S]*margin:\s*0;/);
    assert.doesNotMatch(options, /#tm-volume-options-popup button\s*{[\s\S]*font:\s*inherit;/);
    assert.match(options, /\.tm-volume-options-button-label\s*{[^}]*font-size:\s*14px;[^}]*font-weight:\s*400;/);
    assert.doesNotMatch(options, /\.tm-volume-options-button-label\s*{[^}]*transform:/);
    assert.match(options, /#tm-volume-options-popup \.tm-volume-options-checklist \.tm-volume-options-row\s*{[^}]*margin:\s*0 -8px;/);
    assert.match(options, /\.tm-volume-options-segment\s*{[\s\S]*gap:\s*8px;/);
    assert.match(options, /\.tm-volume-options-radio\s*{[\s\S]*display:\s*grid;[\s\S]*padding:\s*0 10px;[\s\S]*place-items:\s*center;/);
    assert.match(options, /\.tm-volume-options-radio > \.tm-volume-options-button-label\s*{[\s\S]*text-align:\s*center;[\s\S]*width:\s*100%;/);
    assert.match(options, /\.tm-volume-options-opacity-reset\s*{[\s\S]*display:\s*grid;[\s\S]*place-items:\s*center;[\s\S]*text-align:\s*center;/);
    assert.match(options, /\.tm-volume-options-radio\[aria-checked="true"\]\s*{[\s\S]*text-shadow:\s*0 1px 2px rgba\(0, 0, 0, 0\.45\);/);
    dom.window.close();
  }
});
