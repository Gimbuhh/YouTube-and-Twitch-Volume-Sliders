import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { youtubeFixture, twitchFixture } from '../helpers/fixtures.js';
import { mockAudioCapture } from '../helpers/audio.js';

const platforms = [
  { file: 'youtube', prefix: 'yt', url: 'https://www.youtube.com/watch?v=test', fixture: youtubeFixture },
  { file: 'twitch', prefix: 'twitch', url: 'https://www.twitch.tv/test', fixture: twitchFixture }
];

async function prepare(config, t, { saved = false, blockedStorage = false } = {}) {
  const runtime = createRuntime(config.url, { runScripts: 'outside-only' });
  t.after(() => runtime.close());
  const { video, player, state } = config.fixture(runtime.document);
  const audio = mockAudioCapture(runtime.window, video);
  const volumeKey = `tm-${config.prefix}-volume`;
  const optionKey = `tm-${config.prefix}-volume-slider-normalization`;
  runtime.window.localStorage.setItem(volumeKey, '50');
  if (saved) runtime.window.localStorage.setItem(optionKey, 'true');
  if (blockedStorage) Object.defineProperty(runtime.window.localStorage.constructor.prototype, 'setItem', { value() { throw new Error('Storage denied'); } });
  // Exercise the site's synchronous volume and mute notifications, including
  // events dispatched between unmute and the final volume setter.
  const api = config.file === 'youtube' ? player : player._tmPlayerApi;
  for (const name of ['setVolume', 'unMute', 'mute', 'setMuted']) {
    if (!api[name]) continue;
    const original = api[name];
    api[name] = (...args) => { original(...args); video.dispatchEvent(new runtime.window.Event('volumechange')); };
  }
  let now = 0;
  Object.defineProperty(runtime.window.performance, 'now', { value: () => now });
  const ticks = new Map();
  const originalSetInterval = runtime.window.setInterval.bind(runtime.window);
  const originalClearInterval = runtime.window.clearInterval.bind(runtime.window);
  runtime.window.setInterval = (callback, delay, ...args) => {
    if (delay <= 100) {
      const id = originalSetInterval(() => {}, 100000);
      ticks.set(id, { callback: () => callback(...args), delay, next: now + delay });
      return id;
    }
    return originalSetInterval(callback, delay, ...args);
  };
  runtime.window.clearInterval = id => { ticks.delete(id); originalClearInterval(id); };
  const advance = async () => {
    await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < 140; i++) {
      now += 50;
      await new Promise(resolve => setImmediate(resolve));
      for (const tick of ticks.values()) {
        if (now < tick.next) continue;
        tick.next += tick.delay;
        tick.callback();
      }
    }
  };
  runtime.window.eval(await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`, import.meta.url), 'utf8'));
  runtime.document.getElementById('tm-volume-options-button').click();
  const toggle = runtime.document.getElementById('tm-volume-options-normalization');
  const rawVolume = () => config.file === 'youtube' ? state.volume : Math.round(state.volume * 100);
  return { ...runtime, video, player, state, api, audio, toggle, advance, rawVolume, volumeKey, optionKey };
}

for (const config of platforms) {
  test(`${config.file}: the standalone artifact contains only the LUFS normalization path`, async () => {
    const artifact = await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`, import.meta.url), 'utf8');
    assert.match(artifact, /tm-lufs-analysis/);
    for (const removed of ['createLoudnessTracker', 'TARGET_RMS', 'createAnalyser', 'createChannelSplitter', 'getFloatTimeDomainData']) {
      assert.ok(!artifact.includes(removed), `${removed} is absent from the production bundle`);
    }
  });

  test(`${config.file}: normalization icon stays static through output, mute and fallback and hides when disabled`, async t => {
    const f = await prepare(config, t, { saved: true });
    const indicator = f.document.querySelector('.tm-normalization-icon');
    const icon = f.document.querySelector('.tm-volume-icon-cell');
    const slider = f.document.getElementById('tm-volume-slider-range');
    await f.advance();
    assert.equal(indicator.hidden, false);
    assert.equal(indicator.textContent, '');
    assert.equal(indicator.title, 'Auto-normalize volume is on');
    const artwork = indicator.innerHTML;
    assert.equal(slider.value, '50');
    assert.match(icon.getAttribute('aria-describedby'), /normalization-description/);
    f.audio.amplitude = 0.02;
    // This follows an established loud source. Allow the cautious background
    // hold to release before checking the icon at the exact headroom limit.
    for (let i = 0; i < 10 && f.rawVolume() < 100; i++) await f.advance();
    assert.equal(indicator.innerHTML, artwork);
    assert.match(f.document.getElementById('tm-volume-options-normalization-details').textContent, /Output 100%/);
    assert.equal(slider.value, '50');
    if (config.file === 'youtube') f.api.mute(); else f.api.setMuted(true);
    await f.advance(); assert.equal(indicator.innerHTML, artwork);
    assert.equal(indicator.hidden, false);
    if (config.file === 'youtube') f.api.unMute(); else f.api.setMuted(false);
    f.audio.streams[0].getAudioTracks()[0].muted = true;
    await f.advance(); assert.equal(indicator.innerHTML, artwork);
    assert.equal(indicator.hidden, false);
    assert.equal(indicator.title, 'Auto-normalize volume is on');
    assert.match(f.document.getElementById('tm-volume-options-normalization-status').textContent, /Waiting for accessible audio/);
    f.toggle.click();
    assert.equal(indicator.hidden, true);
    assert.equal(icon.getAttribute('aria-describedby'), null);
    assert.equal(slider.getAttribute('aria-describedby'), 'tm-volume-slider-value');
    assert.equal(f.rawVolume(), 50);
  });

  test(`${config.file}: quiet continuous audio does not cycle the source status or rebuild capture`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance();
    const status = f.document.getElementById('tm-volume-options-normalization-status');
    const details = f.document.getElementById('tm-volume-options-normalization-details');
    for (const amplitude of [0.005, 0.025, 0.005, 0.025, 0]) {
      f.audio.amplitude = amplitude; await f.advance();
      assert.ok(status.textContent.startsWith('Active'));
      assert.equal(details.hidden, false);
      assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
    }
    assert.equal(f.audio.captures, 1);
    assert.equal(f.audio.contexts.length, 1);
    assert.equal(f.audio.contexts[0].closed, false);
  });

  test(`${config.file}: opt-in changes audible output while slider and storage keep user intent`, async t => {
    const f = await prepare(config, t);
    assert.equal(f.toggle.getAttribute('aria-checked'), 'false');
    assert.equal(f.audio.captures, 0);
    f.toggle.click(); await f.advance();
    assert.equal(f.toggle.getAttribute('aria-checked'), 'true');
    assert.equal(f.window.localStorage.getItem(f.optionKey), 'true');
    assert.ok(f.rawVolume() < 20);
    const slider = f.document.getElementById('tm-volume-slider-range');
    assert.equal(slider.value, '50');
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
    assert.equal(f.document.getElementById('tm-volume-options-normalization-status').textContent, 'Active');
    assert.match(f.document.getElementById('tm-volume-options-normalization-details').textContent, /^Reducing loud audio\nOutput \d+% · Selected 50%$/);
    // Custom slider intent survives synchronous unmute notifications.
    if (config.file === 'youtube') f.api.mute(); else f.api.setMuted(true);
    slider.value = '40'; slider.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    slider.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    assert.equal(slider.value, '40');
    assert.ok(f.rawVolume() < 40);
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '40');
    f.toggle.click();
    assert.equal(f.rawVolume(), 40);
    assert.equal(f.document.getElementById('tm-volume-options-normalization-details').hidden, true);
    assert.equal(f.audio.contexts[0].closed, true);
    assert.equal(f.window.localStorage.getItem(f.optionKey), 'false');
  });

  test(`${config.file}: saved opt-in starts automatically; mode Off releases capture and retains opt-in`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance(); assert.equal(f.audio.captures, 1); assert.ok(f.rawVolume() < 20);
    const offSelect = f.document.getElementById('tm-volume-options-mode');
    offSelect.value = 'off';
    offSelect.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    assert.equal(f.rawVolume(), 50);
    assert.equal(f.audio.contexts[0].closed, true);
    assert.equal(f.document.getElementById('tm-volume-slider-overlay'), null);
    assert.equal(f.window.localStorage.getItem(f.optionKey), 'true');
    const onSelect = f.document.getElementById('tm-volume-options-mode');
    onSelect.value = 'on';
    onSelect.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    await f.advance(); assert.equal(f.audio.captures, 2); assert.ok(f.rawVolume() < 20);
    assert.equal(f.document.querySelector('.tm-normalization-icon').hidden, false);
  });

  test(`${config.file}: opt-in works for the session when settings storage is blocked`, async t => {
    const f = await prepare(config, t, { blockedStorage: true });
    f.toggle.click(); await f.advance();
    assert.equal(f.toggle.getAttribute('aria-checked'), 'true'); assert.ok(f.rawVolume() < 20);
    f.toggle.click(); assert.equal(f.rawVolume(), 50);
  });

  test(`${config.file}: inaccessible capture restores volume and mute remains user-controlled`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance();
    f.audio.streams[0].getAudioTracks()[0].muted = true;
    await f.advance(); assert.equal(f.rawVolume(), 50);
    // Restore must never unmute a user-muted player.
    if (config.file === 'youtube') f.api.mute(); else f.api.setMuted(true);
    f.toggle.click(); assert.equal(f.state.muted, true); assert.equal(f.rawVolume(), 50);
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
  });

  test(`${config.file}: reusing the video for a new source resets correction and capture`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance(); assert.ok(f.rawVolume() < 20);
    f.video.dispatchEvent(new f.window.Event('emptied'));
    assert.equal(f.rawVolume(), 50); assert.equal(f.audio.contexts[0].closed, true);
    f.audio.amplitude = 0.08;
    f.video.dispatchEvent(new f.window.Event('playing'));
    await f.advance(); assert.ok(f.rawVolume() > 50);
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
    assert.equal(f.audio.captures, 2);
  });

  test(`${config.file}: replacing the player releases outgoing capture and normalizes the incoming video`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance(); assert.ok(f.rawVolume() < 20);
    const incoming = config.fixture(f.document);
    const audio = mockAudioCapture(f.window, incoming.video);
    audio.amplitude = 0.08;
    if (config.file === 'youtube') {
      f.window.dispatchEvent(new f.window.Event('yt-navigate-finish'));
    } else {
      // Twitch's attachment observer discovers a new video under the body.
      await new Promise(resolve => f.window.setTimeout(resolve, 1100));
    }
    await f.advance();
    assert.equal(f.audio.contexts[0].closed, true);
    assert.equal(audio.captures, 1);
    const raw = config.file === 'youtube' ? incoming.state.volume : incoming.state.volume * 100;
    assert.ok(raw > 50);
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
  });
}
