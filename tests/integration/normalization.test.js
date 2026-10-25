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

async function prepare(config, t, { saved = false, blockedStorage = false, delayedControls = false, beforeBody = false, controlledTime = false } = {}) {
  const runtime = createRuntime(config.url, { runScripts: 'outside-only' });
  t.after(() => runtime.close());
  const { video, player, state } = config.fixture(runtime.document);
  const controls = delayedControls ? [...player.querySelectorAll(config.file === 'youtube' ? '.ytp-left-controls, .ytp-right-controls' : '[data-a-target="player-controls"]')] : [];
  for (const element of controls) element.remove();
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
  if (controlledTime) {
    const epoch = runtime.window.Date.now();
    runtime.window.Date.now = () => epoch + now;
  }
  const ticks = new Map();
  const originalSetInterval = runtime.window.setInterval.bind(runtime.window);
  const originalClearInterval = runtime.window.clearInterval.bind(runtime.window);
  runtime.window.setInterval = (callback, delay, ...args) => {
    if (controlledTime || delay <= 100) {
      const id = originalSetInterval(() => {}, 100000);
      ticks.set(id, { callback: () => callback(...args), delay, next: now + delay });
      return id;
    }
    return originalSetInterval(callback, delay, ...args);
  };
  runtime.window.clearInterval = id => { ticks.delete(id); originalClearInterval(id); };
  if (controlledTime) {
    // Startup restoration and persistence must use the audio clock too.
    // Mixing real timeouts with virtual Date.now lets slow CI restore the
    // old preference during a supposedly post-startup native adjustment.
    runtime.window.setTimeout = (callback, delay = 0, ...args) => {
      const id = originalSetInterval(() => {}, 100000);
      ticks.set(id, { callback: () => callback(...args), next: now + delay, once: true });
      return id;
    };
    runtime.window.clearTimeout = runtime.window.clearInterval;
  }
  const advance = async (seconds = 7) => {
    await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < seconds * 20; i++) {
      now += 50;
      await new Promise(resolve => setImmediate(resolve));
      for (const [id, tick] of [...ticks]) {
        if (!ticks.has(id) || now < tick.next) continue;
        if (tick.once) { ticks.delete(id); originalClearInterval(id); }
        else tick.next += tick.delay;
        tick.callback();
      }
    }
  };
  const artifact = await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`, import.meta.url), 'utf8');
  if (delayedControls) {
    await new Promise(resolve => setImmediate(resolve)); // Let JSDOM's own load events finish first.
    Object.defineProperty(runtime.document, 'readyState', { configurable: true, value: 'loading' });
  }
  const body = runtime.document.body;
  if (beforeBody) body.remove();
  runtime.window.eval(artifact);
  if (!delayedControls) runtime.document.getElementById('tm-volume-options-button').click();
  const toggle = runtime.document.getElementById('tm-volume-options-normalization');
  const outputVolume = () => { const info = runtime.document.documentElement.dataset.tmAudioNormalization; return info ? JSON.parse(info).output : config.file === 'youtube' ? state.volume : Math.round(state.volume * 100); };
  return { ...runtime, video, player, state, api, audio, toggle, advance, outputVolume, volumeKey, optionKey, controls, body };
}

test('youtube: an incoming player is protected before first playback and navigation completion', async t => {
  const f = createRuntime('https://www.youtube.com/', {runScripts:'outside-only'});
  t.after(() => f.close());
  f.window.localStorage.setItem('tm-yt-volume', '30');
  f.window.localStorage.setItem('tm-yt-volume-slider-normalization', 'true');
  f.window.eval(await readFile(new URL('../../dist/youtube-volume-slider.user.js', import.meta.url), 'utf8'));
  f.window.dispatchEvent(new f.window.Event('yt-navigate-start'));
  f.window.history.replaceState(null, '', '/watch?v=incoming');
  const {video, state} = youtubeFixture(f.document);
  mockAudioCapture(f.window, video);
  video.dispatchEvent(new f.window.Event('loadstart'));
  video.dispatchEvent(new f.window.Event('play'));
  assert.equal(state.volume, 0, 'a late navigation-finish event cannot expose the selected volume');
  assert.equal(video.volume, 0, 'actual media output is zero before the first playing event');
  assert.equal(f.document.getElementById('tm-volume-slider-range').value, '30');
});

test('youtube: an asynchronous player API cannot defer zero-output protection', async t => {
  const f = createRuntime('https://www.youtube.com/watch?v=async', {runScripts:'outside-only'});
  t.after(() => f.close());
  const {video, player, state} = youtubeFixture(f.document);
  const audio = mockAudioCapture(f.window, video);
  audio.stalled = true;
  video.volume = .3;
  // The API accepts a command before its playback worker updates the element.
  const commands = [], setVolume = player.setVolume;
  player.setVolume = value => { commands.push(value); setVolume(value); };
  f.window.localStorage.setItem('tm-yt-volume', '30');
  f.window.localStorage.setItem('tm-yt-volume-slider-normalization', 'true');
  f.window.eval(await readFile(new URL('../../dist/youtube-volume-slider.user.js', import.meta.url), 'utf8'));
  assert.equal(state.volume, 0, 'the player API has accepted the hold');
  assert.equal(video.volume, 0, 'protection cannot wait for the playback worker');
  assert.ok(commands.every(value => value === 0), 'binding cannot queue ordinary-volume restoration before protection');
  video.volume = .3;
  video.dispatchEvent(new f.window.Event('volumechange'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(f.document.documentElement.dataset.tmAudioNormalization).output, 0, 'the graph stays silent before its first measurement');
  const port = audio.nodes[0].port;
  port.onmessage({data:{attackPower:.5}});
  port.onmessage({data:{power:.5,rawPower:.25,momentaryPower:.5,duration:.05}});
  video.volume = .3;
  video.dispatchEvent(new f.window.Event('volumechange'));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(JSON.parse(f.document.documentElement.dataset.tmAudioNormalization).output <= 10.5, 'late worker restoration cannot bypass the protected graph');
});

for (const config of platforms) {
  if (config.file === 'twitch') test('twitch: source initialization cannot replace saved mute intent during normalization', async t => {
    for (const muted of [false, true]) for (const notifyBeforeReset of [false, true]) {
      const f = await prepare(config, t, { saved: true, controlledTime: true });
      await f.advance(7);
      f.window.localStorage.setItem('tm-twitch-muted', String(muted));
      // Twitch sets its initial mute flag before emptied. Native notifications
      // can arrive on either side of that source-reset event.
      const deferVolumeChange = event => event.stopImmediatePropagation();
      f.video.addEventListener('volumechange', deferVolumeChange, true);
      f.api.setMuted(!muted);
      f.video.removeEventListener('volumechange', deferVolumeChange, true);
      if (notifyBeforeReset) f.video.dispatchEvent(new f.window.Event('volumechange'));
      f.video.dispatchEvent(new f.window.Event('emptied'));
      f.video.dispatchEvent(new f.window.Event('volumechange'));
      assert.equal(f.outputVolume(), 0, 'mute restoration retains startup output protection');
      assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), String(muted));
      f.video.dispatchEvent(new f.window.Event('loadedmetadata'));
      assert.equal(f.state.muted, muted, 'restore the saved choice, not Twitch initialization mute');
      assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), String(muted));
      f.api.setMuted(!muted);
      f.video.dispatchEvent(new f.window.Event('playing'));
      assert.equal(f.state.muted, muted, 'late initialization mute cannot outlive the source restart');
      await f.advance(.2);
      assert.equal(f.state.muted, muted);
      if (!muted) {
        assert.ok(f.outputVolume() > 0 && f.outputVolume() < 20);
        assert.equal(f.document.getElementById('tm-volume-options-normalization-status').textContent, 'Active');
      }
      assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
      assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
    }
  });

  if (config.file === 'twitch') test('twitch: restart mute restoration works without metadata and respects a new user choice', async t => {
    const f = await prepare(config, t, { saved: true, controlledTime: true });
    await f.advance(7);
    f.window.localStorage.setItem('tm-twitch-muted', 'false');
    // Controls can attach after loadstart but before metadata is available.
    f.video.dispatchEvent(new f.window.Event('loadedmetadata'));
    f.api.setMuted(true);
    f.video.dispatchEvent(new f.window.Event('playing'));
    assert.equal(f.state.muted, false, 'metadata also arms restoration when the reset event preceded attachment');
    f.video.dispatchEvent(new f.window.Event('emptied'));
    f.api.setMuted(true);
    f.video.dispatchEvent(new f.window.Event('playing'));
    await f.advance(.2);
    assert.equal(f.state.muted, false, 'playing completes a restart even without new metadata');
    assert.equal(f.video.muted, false);

    // An ordinary pause/resume must not restore an old startup preference.
    f.api.setMuted(true);
    f.video.dispatchEvent(new f.window.Event('playing'));
    assert.equal(f.state.muted, true);

    f.video.dispatchEvent(new f.window.Event('loadstart'));
    f.window.localStorage.setItem('tm-twitch-muted', 'true');
    f.api.setMuted(false);
    f.video.dispatchEvent(new f.window.Event('playing'));
    assert.equal(f.state.muted, true, 'use the latest user choice, not a restart-time snapshot');
    assert.equal(f.video.muted, true);
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
  });

  if (config.file === 'twitch') test('twitch: restart locks protect saved settings without freezing the mute indicator', async t => {
    const f = await prepare(config, t, { saved: true, controlledTime: true });
    await f.advance(7);
    const label = f.document.getElementById('tm-volume-slider-value');
    const indicator = f.document.querySelector('.tm-volume-icon-cell');
    f.window.localStorage.setItem('tm-twitch-muted', 'true');
    f.api.setMuted(true);
    f.video.muted = true;
    assert.equal(label.textContent, 'Muted');
    const mutedArtwork = indicator.innerHTML;

    // The player restarts muted, then restores the saved unmuted choice while
    // persistence is still locked. Native output stays at 100% for the graph.
    f.window.localStorage.setItem('tm-twitch-muted', 'false');
    f.video.dispatchEvent(new f.window.Event('emptied'));
    f.video.dispatchEvent(new f.window.Event('loadedmetadata'));
    f.video.dispatchEvent(new f.window.Event('playing'));
    await f.advance(.2);
    assert.equal(f.state.muted, false);
    assert.equal(f.video.muted, false);
    assert.equal(label.textContent, '50%', 'the restored mute state must reach the display during the startup lock');
    assert.notEqual(indicator.innerHTML, mutedArtwork);
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
    assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), 'false');
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');

    // No native-volume change is guaranteed once playback stabilizes.
    await f.advance(3);
    assert.equal(label.textContent, '50%');
  });

  if (config.file === 'twitch') test('twitch: temporary startup mute does not flash or replace the selected volume', async t => {
    for (const muted of [false, true]) {
      const f = await prepare(config, t, { saved: true, controlledTime: true });
      await f.advance(7);
      f.window.localStorage.setItem('tm-twitch-muted', String(muted));
      f.api.setMuted(muted);
      const label = f.document.getElementById('tm-volume-slider-value');
      const expected = muted ? 'Muted' : '50%';
      assert.equal(label.textContent, expected);
      f.video.dispatchEvent(new f.window.Event('emptied'));
      f.api.setMuted(!muted);
      assert.equal(label.textContent, expected, 'initialization mute must not flash in the control');
      assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
      assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), String(muted));
      f.video.dispatchEvent(new f.window.Event('loadedmetadata'));
      f.video.dispatchEvent(new f.window.Event('playing'));
      await f.advance(.2);
      assert.equal(label.textContent, expected);
    }
  });

  if (config.file === 'twitch') test('twitch: explicit mute input updates the display during startup', async t => {
    const f = await prepare(config, t, { saved: true, controlledTime: true });
    await f.advance(7);
    f.window.localStorage.setItem('tm-twitch-muted', 'false');
    f.video.dispatchEvent(new f.window.Event('emptied'));
    f.api.setMuted(true); // Passive initialization mute.
    // Close the settings menu before interacting with playback controls.
    f.document.getElementById('tm-volume-options-button').click();
    const slider = f.document.getElementById('tm-volume-slider-range');
    slider.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), 'false', 'a volume step cannot adopt initialization mute');
    assert.equal(f.document.getElementById('tm-volume-slider-value').textContent, '55%');
    f.document.querySelector('.tm-volume-icon-cell').click();
    assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), 'true', 'clicking the unmuted control requests mute');
    const label = f.document.getElementById('tm-volume-slider-value');
    assert.equal(label.textContent, 'Muted');
    const button = f.document.createElement('button');
    button.dataset.aTarget = 'player-mute-unmute-button';
    button.addEventListener('click', () => f.api.setMuted(false));
    f.player.append(button);
    button.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), 'false');
    assert.equal(label.textContent, '55%', 'native unmute refreshes after the saved choice changes');
  });

  if (config.file === 'twitch') test('twitch: native mute button and M key still save explicit mute choices', async t => {
    const f = await prepare(config, t, { saved: true, controlledTime: true });
    await f.advance(7);
    f.document.getElementById('tm-volume-options-button').click();
    const button = f.document.createElement('button');
    button.dataset.aTarget = 'player-mute-unmute-button';
    button.addEventListener('click', () => f.api.setMuted(true));
    f.player.append(button);
    button.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), 'true');
    f.player.tabIndex = 0; f.player.focus();
    f.player.addEventListener('keydown', event => { if (event.key === 'm') f.api.setMuted(false); });
    f.player.dispatchEvent(new f.window.KeyboardEvent('keydown', {key:'m',bubbles:true}));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.window.localStorage.getItem('tm-twitch-muted'), 'false');
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
  });

  if (config.file === 'youtube') test('youtube: a replacement video is protected before deferred control reattachment', async t => {
    const f = await prepare(config, t, { saved: true, controlledTime: true });
    f.audio.amplitude = .06; await f.advance(7);
    const slider = f.document.getElementById('tm-volume-slider-range');
    slider.value = '60'; slider.dispatchEvent(new f.window.Event('input', {bubbles:true}));
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50', 'the latest input is still waiting for its debounced save');
    const frames = [];
    f.window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
    const incoming = f.document.createElement('video'); incoming.className = 'html5-main-video';
    const audio = mockAudioCapture(f.window, incoming);
    f.video.replaceWith(incoming);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.outputVolume(), 0, 'the new video is guarded before any queued layout frame runs');
    assert.equal(f.audio.contexts[0].closed, false);
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '60');
    await f.advance(.1);
    assert.ok(f.outputVolume() > 0 && f.outputVolume() < 20);
    assert.equal(audio.captures, 1);
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '60');
  });

  if (config.file === 'youtube') test('youtube: same-element navigation holds startup until the incoming source is ready', async t => {
    const f = await prepare(config, t, { saved: true, controlledTime: true });
    f.audio.amplitude = .06; await f.advance(7);
    assert.ok(f.outputVolume() > 50, 'the outgoing video has quiet-source boost');
    f.window.dispatchEvent(new f.window.Event('yt-navigate-start'));
    assert.equal(f.outputVolume(), 0, 'navigation protects output before any native load event');
    await f.advance(.3);
    assert.equal(f.outputVolume(), 0, 'outgoing samples must not end the startup hold');
    f.api.setVolume(50); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.outputVolume(), 0, 'site restoration cannot release the protected output');
    f.audio.amplitude = .5;
    f.window.history.replaceState(null, '', '/watch?v=incoming');
    f.window.dispatchEvent(new f.window.Event('yt-navigate-finish'));
    assert.equal(f.outputVolume(), 0, 'reusing the video element still requires fresh measurements');
    await f.advance(.1);
    assert.ok(f.outputVolume() > 0 && f.outputVolume() < 20);
    assert.equal(f.audio.captures, 2);
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
    f.window.dispatchEvent(new f.window.Event('yt-page-data-updated')); await f.advance(.1);
    assert.equal(f.audio.captures, 2, 'repeated completion events do not restart healthy analysis');
  });

  test(`${config.file}: native input during startup changes the selection without releasing unmeasured output`, async t => {
    const f = await prepare(config, t, { saved: true });
    f.audio.stalled = true;
    const mode = f.document.getElementById('tm-volume-options-mode');
    mode.value = 'on'; mode.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    assert.equal(f.outputVolume(), 0);
    const control = f.player.querySelector(config.file === 'youtube' ? '.ytp-volume-area' : '[data-a-target="player-volume-slider"]');
    control.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    f.api.setVolume(config.file === 'youtube' ? 60 : .6);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.outputVolume(), 0);
    await f.advance(.2); assert.equal(f.outputVolume(), 0);
    f.toggle.click(); assert.equal(f.outputVolume(), 60, 'disable restores the new native selection');
  });

  if (config.file === 'twitch') test('twitch: sustained startup volume keys supersede the delayed preference restore', async t => {
    const f = await prepare(config, t, { saved: true, controlledTime: true });
    f.document.getElementById('tm-volume-options-button').click();
    f.video.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true }));
    const slider = f.document.getElementById('tm-volume-slider-range');
    for (let i = 0; i < 22; i++) {
      const key = i % 2 ? 'ArrowDown' : 'ArrowUp';
      f.player.dispatchEvent(new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await f.advance(.1);
      assert.equal(slider.value, i % 2 ? '50' : '55', 'startup restoration cannot reset held-key selection');
    }
  });

  test(`${config.file}: source-restoration writes keep selected volume and player keys use five-point steps`, async t => {
    for (const mode of ['on', 'replace-native']) {
      const f = await prepare(config, t, { controlledTime: true });
      const select = f.document.getElementById('tm-volume-options-mode');
      select.value = mode; select.dispatchEvent(new f.window.Event('change', { bubbles: true }));
      const slider = f.document.getElementById('tm-volume-slider-range');
      slider.value = '25'; slider.dispatchEvent(new f.window.Event('input', { bubbles: true }));
      slider.dispatchEvent(new f.window.Event('change', { bubbles: true }));
      f.audio.amplitude = .17; f.toggle.click(); await f.advance();
      const corrected = f.outputVolume();
      for (const type of [null, 'emptied', 'loadstart']) {
        f.api.setVolume((corrected - 1) / (config.file === 'youtube' ? 1 : 100));
        if (type) f.video.dispatchEvent(new f.window.Event(type));
        await f.advance(.2);
        assert.equal(slider.value, '25'); assert.equal(f.outputVolume(), corrected);
        assert.equal(f.window.localStorage.getItem(f.volumeKey), '25');
      }
      f.document.getElementById('tm-volume-options-button').click();
      f.video.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true }));
      const overlay = f.document.getElementById('tm-volume-slider-overlay');
      if (config.file === 'youtube') {
        overlay.classList.remove('tm-expanded'); overlay.classList.add('tm-collapsed');
        overlay.dataset.tmKeepExpanded = 'false';
      }
      for (const [key, expected] of [['ArrowUp', '30'], ['ArrowDown', '25']]) {
        f.player.dispatchEvent(new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await f.advance(.2); assert.equal(slider.value, expected);
        if (config.file === 'youtube') {
          assert.equal(overlay.classList.contains('tm-expanded'), false, 'player keys never expand the volume pill');
          assert.equal(overlay.dataset.tmKeepExpanded, 'false');
        }
        assert.equal(f.player.querySelector('[data-tm-volume-feedback]').textContent, `${expected}%`);
        assert.equal(f.player.querySelector('[data-tm-volume-feedback]').dataset.volumeIcon, 'low');
      }
      f.toggle.click(); assert.equal(f.outputVolume(), 25);
      f.video.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true }));
      for (const [key, expected] of [['ArrowUp', '30'], ['ArrowDown', '25']]) {
        f.player.dispatchEvent(new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await f.advance(.2);
        assert.equal(slider.value, expected, 'normalization-off player keys use the same selected-volume handler');
        assert.equal(f.outputVolume(), Number(expected));
        assert.equal(f.player.querySelector('[data-tm-volume-feedback]').textContent, `${expected}%`);
        assert.equal(overlay.classList.contains('tm-expanded'), false);
      }
    }
  });

  test(`${config.file}: audio feedback distinguishes unchanged volume from loudness matching`, async t => {
    const f = await prepare(config, t);
    f.audio.amplitude = .03; f.toggle.click(); await f.advance(30);
    const status = f.document.getElementById('tm-volume-options-normalization-status');
    const details = f.document.getElementById('tm-volume-options-normalization-details');
    assert.equal(status.textContent, 'Active');
    const slider = f.document.getElementById('tm-volume-slider-range');
    slider.value = '100'; slider.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    await f.advance(.05);
    assert.equal(status.textContent, 'Active');
    assert.equal(details.textContent, 'No volume adjustment\nOutput 100% · Selected 100%');
    assert.equal(f.document.querySelector('.tm-normalization-icon').hidden, false);
    f.toggle.click(); assert.equal(f.outputVolume(), 100);
  });

  test(`${config.file}: native controls set absolute selected volume without relearning the source`, async t => {
    for (const mode of ['on', 'replace-native']) for (const delta of [-5, 5]) {
      const f = await prepare(config, t, { controlledTime: true });
      const select = f.document.getElementById('tm-volume-options-mode');
      select.value = mode; select.dispatchEvent(new f.window.Event('change', { bubbles: true }));
      const slider = f.document.getElementById('tm-volume-slider-range');
      slider.value = '30'; slider.dispatchEvent(new f.window.Event('input', { bubbles: true }));
      slider.dispatchEvent(new f.window.Event('change', { bubbles: true }));
      f.audio.amplitude = .17; f.toggle.click(); await f.advance();
      const before = f.outputVolume(), requested = before + delta;
      const guarded = config.file === 'twitch' && mode === 'replace-native';
      if (!guarded) {
        const control = f.player.querySelector(config.file === 'youtube' ? '.ytp-volume-area' : '[data-a-target="player-volume-slider"]');
        control.dispatchEvent(new f.window.Event('input', { bubbles: true }));
      }
      f.api.setVolume(requested / (config.file === 'youtube' ? 1 : 100));
      await f.advance(.2);
      const preferred = guarded ? 30 : requested;
      assert.equal(Number(slider.value), preferred);
      assert.equal(Math.round(f.video.volume * 100), 100, 'selected-volume input cannot bypass the processed graph');
      assert.equal(Number(f.window.localStorage.getItem(f.volumeKey)), preferred);
      f.toggle.click(); assert.equal(f.outputVolume(), preferred);
    }
  });

  test(`${config.file}: established quiet audio resumes after silence without losing boost`, async t => {
    const f = await prepare(config, t);
    f.audio.amplitude = .06; f.toggle.click(); await f.advance(30);
    const before = f.outputVolume(); assert.ok(before > 50);
    f.audio.amplitude = 0; await f.advance(4);
    assert.equal(f.outputVolume(), before);
    f.audio.amplitude = .06; await f.advance(.05);
    assert.ok(Math.abs(f.outputVolume() - before) <= 1);
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
    f.toggle.click(); assert.equal(f.outputVolume(), 50);
  });

  test(`${config.file}: saved normalization starts before controls or document completion and keeps one capture on mount`, async t => {
    for (const beforeBody of [false, true]) {
      const f = await prepare(config, t, { saved: true, delayedControls: true, beforeBody });
      if (beforeBody) {
        f.document.documentElement.append(f.body);
        await new Promise(resolve => f.window.setTimeout(resolve, 50));
      }
      assert.equal(f.outputVolume(), 0, 'startup is silent before the first audio measurement');
      await f.advance(.2);
      assert.equal(f.document.readyState, 'loading');
      assert.equal(f.document.getElementById('tm-volume-slider-overlay'), null);
      assert.equal(f.audio.captures, 1, 'the playing video does not wait for controls');
      assert.ok(f.outputVolume() > 0 && f.outputVolume() < 20, 'first measurements release corrected output');
      assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
      f.player.append(...f.controls);
      Object.defineProperty(f.document, 'readyState', { configurable: true, value: 'interactive' });
      f.window.dispatchEvent(new f.window.Event('DOMContentLoaded'));
      await new Promise(resolve => f.window.setTimeout(resolve, 100));
      await f.advance(.2);
      assert.ok(f.document.getElementById('tm-volume-slider-overlay'));
      assert.equal(f.audio.captures, 1, 'mounting controls retains the early analysis session');
      assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
      f.document.getElementById('tm-volume-options-button').click();
      f.document.getElementById('tm-volume-options-normalization').click();
      assert.equal(f.outputVolume(), 50);
      assert.ok(f.audio.contexts.every(context => !context.closed));
    }
  });

  test(`${config.file}: quiet startup boost stays bounded in the standalone artifact`, async t => {
    const f = await prepare(config, t);
    const slider = f.document.getElementById('tm-volume-slider-range');
    slider.value = '20';
    slider.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    slider.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    f.audio.amplitude = .03;
    f.toggle.click();
    for (let i = 0; i < 3; i++) {
      await f.advance();
      assert.ok(f.outputVolume() <= 40, 'the native output stays within the rounded 6 dB boost limit');
      assert.ok(f.outputVolume() > 30, 'quiet audio still receives useful boost');
      assert.equal(slider.value, '20');
      assert.equal(f.window.localStorage.getItem(f.volumeKey), '20');
    }
    f.audio.amplitude = .8;
    await f.advance();
    assert.ok(f.outputVolume() < 10, 'loud audio still receives full attenuation');
    f.toggle.click();
    assert.equal(f.outputVolume(), 20);
  });

  test(`${config.file}: the standalone artifact contains only the LUFS normalization path`, async () => {
    const artifact = await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`, import.meta.url), 'utf8');
    assert.match(artifact, /createNativeGainGraph/); assert.match(artifact, /tm-native-graph-meter/);
    for (const removed of ['createLoudnessTracker', 'TARGET_RMS', 'createLufsGainController', 'createStreamingProcessor', 'createBufferSource', 'LOCAL TEST', 'Local lookahead', 'local lookahead test']) {
      assert.ok(!artifact.includes(removed), `${removed} is absent from the production bundle`);
    }
  });

  test(`${config.file}: normalization icon survives ordinary idle states and hides for analysis problems`, async t => {
    const f = await prepare(config, t, { saved: true });
    const indicator = f.document.querySelector('.tm-normalization-icon');
    const icon = f.document.querySelector('.tm-volume-icon-cell');
    const slider = f.document.getElementById('tm-volume-slider-range');
    assert.equal(indicator.hidden, false, 'normal startup is not an analysis problem');
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
    for (let i = 0; i < 10 && f.outputVolume() < 100; i++) await f.advance();
    assert.equal(indicator.innerHTML, artwork);
    assert.match(f.document.getElementById('tm-volume-options-normalization-details').textContent, /Output 100%/);
    assert.equal(slider.value, '50');
    if (config.file === 'youtube') f.api.mute(); else f.api.setMuted(true);
    await f.advance(); assert.equal(indicator.innerHTML, artwork);
    assert.equal(f.document.getElementById('tm-volume-options-normalization-status').textContent, 'Waiting for audio');
    assert.equal(indicator.hidden, false);
    assert.match(icon.getAttribute('aria-describedby'), /normalization-description/);
    if (config.file === 'youtube') f.api.unMute(); else f.api.setMuted(false);
    await f.advance(.2); assert.equal(indicator.hidden, false);
    f.audio.paused = true; await f.advance(.2); assert.equal(indicator.hidden, false);
    f.audio.paused = false; await f.advance(.2); assert.equal(indicator.hidden, false);
    // Volume zero is also an ordinary listening choice.
    slider.value = '0'; slider.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    await f.advance(.2); assert.equal(indicator.hidden, false);
    assert.equal(f.document.getElementById('tm-volume-options-normalization-status').textContent, 'Waiting for audio');
    slider.value = '50'; slider.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    await f.advance(.2);
    f.audio.contexts[0].state = 'suspended'; await f.advance(.2);
    assert.equal(indicator.hidden, true, 'activation is required before analysis can resume');
    f.document.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true }));
    await f.advance(.2); assert.equal(indicator.hidden, false);
    f.audio.captureMuted = true;
    f.audio.streams[0].getAudioTracks()[0].muted = true;
    await f.advance(); assert.equal(indicator.innerHTML, artwork);
    assert.equal(indicator.hidden, true);
    assert.equal(indicator.title, 'Auto-normalize volume is on');
    assert.match(f.document.getElementById('tm-volume-options-normalization-status').textContent, /unavailable|accessible audio/);
    f.audio.captureMuted = false;
    f.audio.streams[0].getAudioTracks()[0].muted = false;
    f.document.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true }));
    await f.advance(.2); assert.equal(indicator.hidden, false);
    await f.advance(3.2); // Healthy processing resets the earlier retry backoff.
    f.audio.stalled = true; await f.advance(1.7);
    assert.match(f.document.getElementById('tm-volume-options-normalization-status').textContent, /unavailable/i);
    assert.equal(indicator.hidden, true);
    f.audio.paused = true; await f.advance(.2);
    assert.equal(indicator.hidden, true, 'pausing does not mask a failed capture');
    f.audio.paused = false;
    f.audio.stalled = false; await f.advance(1.2);
    assert.equal(indicator.hidden, false, 'automatic recovery updates the icon without toggling');
    assert.equal(indicator.innerHTML, artwork);
    assert.match(icon.getAttribute('aria-describedby'), /normalization-description/);
    f.toggle.click();
    assert.equal(indicator.hidden, true);
    assert.equal(icon.getAttribute('aria-describedby'), null);
    assert.equal(slider.getAttribute('aria-describedby'), 'tm-volume-slider-value');
    assert.equal(f.outputVolume(), 50);
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
    assert.ok(f.outputVolume() < 20);
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
    assert.ok(f.outputVolume() < 40);
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '40');
    f.toggle.click();
    assert.equal(f.outputVolume(), 40);
    assert.equal(f.document.getElementById('tm-volume-options-normalization-details').hidden, true);
    assert.equal(f.audio.contexts[0].closed, false);
    assert.equal(f.window.localStorage.getItem(f.optionKey), 'false');
  });

  test(`${config.file}: saved opt-in starts automatically; mode Off releases capture and retains opt-in`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance(); assert.equal(f.audio.captures, 1); assert.ok(f.outputVolume() < 20);
    const offSelect = f.document.getElementById('tm-volume-options-mode');
    offSelect.value = 'off';
    offSelect.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    assert.equal(f.outputVolume(), 50);
    assert.equal(f.audio.contexts[0].closed, false);
    assert.equal(f.document.getElementById('tm-volume-slider-overlay'), null);
    assert.equal(f.window.localStorage.getItem(f.optionKey), 'true');
    const onSelect = f.document.getElementById('tm-volume-options-mode');
    onSelect.value = 'on';
    onSelect.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    await f.advance(); assert.equal(f.audio.captures, 2); assert.ok(f.outputVolume() < 20);
    assert.equal(f.document.querySelector('.tm-normalization-icon').hidden, false);
  });

  test(`${config.file}: opt-in works for the session when settings storage is blocked`, async t => {
    const f = await prepare(config, t, { blockedStorage: true });
    f.toggle.click(); await f.advance();
    assert.equal(f.toggle.getAttribute('aria-checked'), 'true'); assert.ok(f.outputVolume() < 20);
    f.toggle.click(); assert.equal(f.outputVolume(), 50);
  });

  test(`${config.file}: inaccessible capture restores volume and mute remains user-controlled`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance();
    f.audio.captureMuted = true;
    f.audio.streams[0].getAudioTracks()[0].muted = true;
    await f.advance(); assert.equal(f.outputVolume(), 50);
    // Restore must never unmute a user-muted player.
    if (config.file === 'youtube') f.api.mute(); else f.api.setMuted(true);
    f.toggle.click(); assert.equal(f.state.muted, true); assert.equal(f.outputVolume(), 50);
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
  });

  test(`${config.file}: reusing the video for a new source resets correction and capture`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance(); assert.ok(f.outputVolume() < 20);
    f.video.dispatchEvent(new f.window.Event('emptied'));
    assert.equal(f.outputVolume(), 0); assert.equal(f.audio.contexts[0].closed, false);
    f.audio.amplitude = 0.08;
    f.video.dispatchEvent(new f.window.Event('playing'));
    await f.advance(); assert.ok(f.outputVolume() > 50);
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
    assert.equal(f.audio.captures, 2);
  });

  test(`${config.file}: replacing the player releases outgoing capture and normalizes the incoming video`, async t => {
    const f = await prepare(config, t, { saved: true });
    await f.advance(); assert.ok(f.outputVolume() < 20);
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
    assert.equal(f.audio.contexts[0].closed, false);
    assert.equal(audio.captures, 1);
    const raw = config.file === 'youtube' ? incoming.state.volume : incoming.state.volume * 100;
    assert.ok(raw > 50);
    assert.equal(f.document.getElementById('tm-volume-slider-range').value, '50');
    assert.equal(f.window.localStorage.getItem(f.volumeKey), '50');
  });
}
