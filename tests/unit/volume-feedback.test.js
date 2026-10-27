import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../helpers/runtime.js';
import { createVolumeFeedback } from '../../src/shared/volume-feedback.js';

test('keyboard feedback leaves native playback feedback intact and owns one transient popup', t => {
  const f = createRuntime(); t.after(f.close);
  f.document.body.innerHTML = '<div id="player"><div data-layer="4" style="display:none" class="ytp-bezel-text-hide"><div class="ytp-bezel-text-wrapper"><div class="ytp-bezel-text"></div></div><div class="ytp-bezel" role="status" aria-label="Play"><div class="ytp-bezel-icon"><svg/></div></div></div></div>';
  const player = f.document.getElementById('player'), native = player.querySelector('[data-layer]');
  const original = native.outerHTML, timers = new Map(); let id = 0;
  f.window.setTimeout = callback => { timers.set(++id, callback); return id; };
  f.window.clearTimeout = key => timers.delete(key);
  const feedback = createVolumeFeedback({ window: f.window, player });
  feedback.show(30); feedback.show(25);
  assert.equal(player.querySelectorAll('[data-tm-volume-feedback]').length, 1);
  assert.equal(timers.size, 1);
  const popup = player.querySelector('[data-tm-volume-feedback]');
  assert.equal(popup.textContent, '25%');
  assert.equal(popup.getAttribute('aria-label'), 'Volume 25%');
  assert.equal(popup.querySelectorAll('[id], use').length, 0);
  assert.equal(native.outerHTML, original);
  player.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: ' ' }));
  assert.equal(player.querySelector('[data-tm-volume-feedback]'), null);
  feedback.show(100); [...timers.values()][0]();
  assert.equal(player.querySelector('[data-tm-volume-feedback]'), null);
  feedback.show(0); feedback.dispose();
  assert.equal(timers.size, 0);
  assert.equal(native.outerHTML, original);
  assert.equal(player.querySelector('[data-tm-volume-feedback]'), null);
});

test('feedback owns its artwork and reflects the selected percentage and mute state without native markup', t => {
  const f = createRuntime(); t.after(f.close);
  const player = f.document.createElement('div');
  f.document.body.appendChild(player);
  const feedback = createVolumeFeedback({ window: f.window, player });
  t.after(() => feedback.dispose());
  const artwork = new Map();
  for (const [value, muted, mode] of [[25, false, 'low'], [75, false, 'high'], [0, false, 'muted'], [75, true, 'muted'], [100, false, 'high'], [49, false, 'low'], [50, false, 'high']]) {
    feedback.show(value, muted);
    const popup = player.querySelector('[data-tm-volume-feedback]');
    assert.equal(popup.textContent, `${value}%`);
    assert.equal(popup.dataset.volumeIcon, mode);
    const paths = popup.querySelector('svg').innerHTML;
    if (artwork.has(mode)) assert.equal(paths, artwork.get(mode));
    else artwork.set(mode, paths);
  }
  assert.equal(new Set(artwork.values()).size, 3, 'muted, low and high have distinct artwork');
  player.dispatchEvent(new f.window.Event('pointerdown'));
  assert.equal(player.querySelector('[data-tm-volume-feedback]'), null);
});

test('mute feedback reuses the popup, announces the action and retains the selected level', t => {
  const f=createRuntime();t.after(f.close);
  const player=f.document.createElement('div');f.document.body.append(player);
  const feedback=createVolumeFeedback({window:f.window,player});t.after(()=>feedback.dispose());
  feedback.show(30);
  const popup=player.querySelector('[data-tm-volume-feedback]');
  feedback.showMute(30,true);
  assert.equal(popup.textContent,'Muted');
  assert.equal(popup.dataset.volumeIcon,'muted');
  assert.equal(popup.getAttribute('aria-label'),'Muted, volume 30%');
  feedback.showMute(30,false);
  assert.equal(player.querySelector('[data-tm-volume-feedback]'),popup);
  assert.equal(popup.textContent,'Unmuted');
  assert.equal(popup.dataset.volumeIcon,'low');
  assert.equal(popup.getAttribute('aria-label'),'Unmuted, volume 30%');
  feedback.show(35);
  assert.equal(popup.textContent,'35%');
});
