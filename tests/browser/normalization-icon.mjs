import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../helpers/browser.js';
import { mockAudioCapture } from '../helpers/audio.js';

const updateDocs = process.argv.includes('--update-docs');
const screenshotDirectory = updateDocs ? fileURLToPath(new URL('../../docs/images/', import.meta.url)) : process.env.VOLUME_SLIDER_SCREENSHOTS;
const docScreenshots = { expanded: 'volume-slider-expanded', classic: 'volume-slider-classic', settings: 'settings-menu', audio: 'normalization-settings', appearance: 'appearance-settings' };

const browser = await launchChrome();
try {
  for (const platform of ['youtube', 'twitch']) {
    const youtube = platform === 'youtube', prefix = youtube ? 'yt' : 'twitch';
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const host = youtube
      ? '<div id="movie_player" tabindex="0"><video></video><div class="ytp-left-controls"><div class="ytp-volume-area"><button class="ytp-mute-button"><svg><path d="M8 15h4l5-5v16l-5-5H8z"/></svg></button></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div><div data-layer="4" style="display:none" class="ytp-bezel-text-hide"><div class="ytp-bezel-text-wrapper"><div class="ytp-bezel-text"></div></div><div class="ytp-bezel" role="status" aria-label="Play"><div class="ytp-bezel-icon"></div></div></div></div>'
      : '<div class="video-player" tabindex="0" data-a-target="player-overlay-click-handler"><video></video><div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button">Settings</button></div></div></div>';
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
      body{margin:24px;background:#111;color:white;font-family:Arial}#movie_player,.video-player{position:relative;width:900px;height:330px;overflow:hidden;background:#222}
      video{display:block;width:900px;height:290px}.ytp-left-controls,.ytp-right-controls{position:absolute;bottom:0;height:40px;display:flex;align-items:center}.ytp-left-controls{left:0}.ytp-right-controls{right:0}
      [data-a-target="player-controls"]{height:40px;display:flex;align-items:center;justify-content:space-between}.player-controls__left-control-group,.player-controls__right-control-group{display:flex;align-items:center}
      .ytp-volume-area,[data-a-target="player-volume-slider"]{width:60px;height:32px}
      .ytp-bezel-text-wrapper,.ytp-bezel{animation:1s forwards native-bezel-fade}
      @keyframes native-bezel-fade{0%{opacity:0}25%,75%{opacity:1}100%{opacity:0}}
    </style></head><body>${host}</body></html>` }));
    try {
      await page.goto(youtube ? 'https://www.youtube.com/watch?v=icon' : 'https://www.twitch.tv/icon');
      await page.evaluate(({ mock, prefix, youtube }) => {
        const video = document.querySelector('video');
        window.__iconAudio = (0, eval)(`(${mock})`)(window, video);
        window.__iconAudio.amplitude = 0.17;
        video.volume = 0.3;
        const api = { getVolume: () => video.volume * (youtube ? 100 : 1), setVolume: value => { video.volume = value / (youtube ? 100 : 1); }, isMuted: () => video.muted, mute: () => { video.muted = true; }, unMute: () => { video.muted = false; }, setMuted: value => { video.muted = value; } };
        if (youtube) {
          Object.assign(video.parentElement, api);
          window.__nativeVolumeKeys = 0;
          video.parentElement.addEventListener('keydown', event => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') window.__nativeVolumeKeys++;
          });
        }
        else video.parentElement.__reactFiber$icon = { return: { memoizedProps: { mediaPlayerInstance: api }, return: null } };
        localStorage.setItem(`tm-${prefix}-volume`, '30');
        localStorage.setItem(`tm-${prefix}-volume-slider-normalization`, 'true');
      }, { mock: mockAudioCapture.toString(), prefix, youtube });
      await page.addScriptTag({ content: await readFile(new URL(`../../dist/${platform}-volume-slider.user.js`, import.meta.url), 'utf8') });
      const indicator = page.locator('.tm-normalization-icon');
      const overlay = page.locator('#tm-volume-slider-overlay');
      const mute = page.locator('.tm-volume-icon-cell');
      const slider = page.locator('#tm-volume-slider-range');
      await indicator.waitFor({ state: 'visible' });
      await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').output < 20);
      {
        const player = page.locator('#movie_player, .video-player');
        const native = youtube ? await page.locator('[data-layer="4"]').evaluate(element => element.outerHTML) : null;
        for (const [key, value] of [['ArrowUp', '35'], ['ArrowDown', '30']]) {
          await player.press(key);
          assert.equal(await slider.inputValue(), value);
          assert.equal(await overlay.evaluate(element => element.classList.contains('tm-expanded')), false, 'player arrows keep the pill collapsed');
          assert.equal(await page.locator('[data-tm-volume-feedback]').textContent(), `${value}%`);
          assert.equal(await page.locator('video').evaluate(video => video.volume), 1, 'feedback keeps audio routed through the normalized graph');
          if (youtube) assert.equal(await page.locator('[data-layer="4"]').evaluate(element => element.outerHTML), native);
        }
        const repeatedKeysStarted = Date.now();
        let repeats = 0;
        while (Date.now() - repeatedKeysStarted < 2200 || repeats % 2) {
          await player.press(repeats % 2 ? 'ArrowDown' : 'ArrowUp');
          const visible = await page.locator('[data-tm-volume-feedback]').evaluate(popup =>
            getComputedStyle(popup).opacity === '1' && getComputedStyle(popup).animationName === 'none');
          assert.equal(visible, true, 'percentage and speaker stay visible beyond the native fade duration during repeated keys');
          repeats++;
          await page.waitForTimeout(100);
        }
        assert.equal(await slider.inputValue(), '30');
        assert.equal(await overlay.evaluate(element => element.classList.contains('tm-expanded')), false);
        const selectWithKeys = async value => {
          let current = Number(await slider.inputValue());
          for (let attempt = 0; current !== value && attempt < 20; attempt++) {
            await player.press(current < value ? 'ArrowUp' : 'ArrowDown');
            current = Number(await slider.inputValue());
          }
          assert.equal(current, value, 'volume keys reach the requested percentage');
        };
        for (const [start, key, expected, icon] of [[45, 'ArrowUp', 50, 'high'], [50, 'ArrowDown', 45, 'low'], [0, 'ArrowDown', 0, 'muted'], [100, 'ArrowUp', 100, 'high']]) {
          await selectWithKeys(start);
          await player.press(key);
          const feedback = page.locator('[data-tm-volume-feedback]');
          assert.equal(await feedback.textContent(), `${expected}%`);
          assert.equal(await feedback.getAttribute('data-volume-icon'), icon);
          assert.equal(await feedback.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
          const bounds = await feedback.boundingBox(), host = await player.boundingBox();
          assert.ok(bounds.x >= host.x && bounds.x + bounds.width <= host.x + host.width, 'feedback stays within the player');
          if (screenshotDirectory && !updateDocs && expected === 50) {
            await mkdir(screenshotDirectory, { recursive: true });
            await player.screenshot({ path: join(screenshotDirectory, `${platform}-volume-feedback.png`) });
          }
        }
        await selectWithKeys(30);
        await player.evaluate(element => element.requestFullscreen());
        await player.press('ArrowUp');
        const fullscreenPopup = await page.locator('[data-tm-volume-feedback]').boundingBox();
        const fullscreenPlayer = await player.boundingBox();
        assert.ok(fullscreenPopup.x >= fullscreenPlayer.x && fullscreenPopup.y >= fullscreenPlayer.y && fullscreenPopup.x + fullscreenPopup.width <= fullscreenPlayer.x + fullscreenPlayer.width, 'fullscreen keeps volume feedback within the player');
        assert.equal(await player.evaluate(element => element === document.fullscreenElement), true);
        await page.evaluate(() => document.exitFullscreen());
        await player.press('ArrowDown');
        await page.locator('[data-tm-volume-feedback]').waitFor({ state: 'detached' });
        console.log(`${platform}: repeated player arrows show selected percentage and distinct speaker states, retain corrected output and leave the pill collapsed`);
      }
      const artwork = await indicator.innerHTML();
      assert.equal(await indicator.textContent(), '');
      assert.equal(await indicator.getAttribute('title'), null);
      assert.equal(await indicator.getAttribute('data-tm-tooltip'), 'Auto-normalize volume is on');
      assert.equal(await indicator.locator('text, animate, animateTransform').count(), 0);
      assert.match(await mute.getAttribute('aria-describedby'), /normalization-description/);

      const geometry = async () => page.evaluate(() => {
        const root = document.querySelector('#tm-volume-slider-overlay');
        const rect = selector => { const r = root.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { icon: rect('.tm-normalization-icon'), number: rect('.tm-volume-percent'), panel: rect('.tm-volume-panel-bg'), mute: rect('.tm-volume-icon-cell'), slider: rect('input[type="range"]'), animation: getComputedStyle(root.querySelector('.tm-normalization-icon')).animationName, dpr: devicePixelRatio };
      });
      const assertGeometry = async () => {
        const boxes = await geometry();
        const { icon, number } = boxes;
        if (number.width) {
          const cx = icon.x + icon.width / 2, cy = icon.y + icon.height / 2;
          const dx = cx - Math.max(number.x, Math.min(cx, number.right));
          const dy = cy - Math.max(number.y, Math.min(cy, number.bottom));
          assert.ok(Math.hypot(dx, dy) >= icon.width / 2 - 0.1, `${platform}: circular icon leaves the selected number unobscured`);
        }
        const scale = boxes.mute.width / 40;
        const distanceFromCenter = Math.hypot(icon.x + icon.width / 2 - (boxes.mute.x + boxes.mute.width / 2), icon.y + icon.height / 2 - (boxes.mute.y + boxes.mute.height / 2));
        assert.ok(distanceFromCenter < 16 * scale + icon.width / 2, `${platform}: icon touches the arc instead of floating outside the pill`);
        assert.ok(distanceFromCenter - icon.width / 2 >= 13 * scale, `${platform}: overlap stays within the ring's outer band`);
        assert.ok(icon.x > boxes.mute.x + boxes.mute.width / 2 && Math.abs(icon.y - boxes.mute.y) < 0.1 && icon.right <= boxes.mute.right + 0.1, `${platform}: icon is tucked into the upper-right corner`);
        assert.equal(boxes.animation, 'none');
        assert.equal(await indicator.evaluate(element => {
          const r = element.getBoundingClientRect();
          return [[0, 0], [0, -0.45], [0.45, 0], [0, 0.45], [-0.45, 0], [-0.31, -0.31], [0.31, -0.31], [0.31, 0.31], [-0.31, 0.31]].every(([x, y]) =>
            document.elementFromPoint(r.x + r.width * (0.5 + x), r.y + r.height * (0.5 + y)) === element);
        }), true, `${platform}: icon center and perimeter are unclipped and retain mute interaction`);
        return boxes;
      };
      const screenshot = async (name, session, target) => {
        if (!screenshotDirectory || (updateDocs && !docScreenshots[name])) return;
        await mkdir(screenshotDirectory, { recursive: true });
        const path = join(screenshotDirectory, updateDocs ? `demo-${platform}-${docScreenshots[name]}.png` : `${platform}-normalization-icon-${name}.png`);
        if (target) { await target.screenshot({ path }); return; }
        const bounds = await overlay.boundingBox(), boxes = await geometry();
        const left = Math.floor(Math.min(bounds.x, boxes.icon.x) - 4), top = Math.floor(Math.min(bounds.y, boxes.mute.y, boxes.icon.y) - 4);
        const clip = { x: left, y: top, width: Math.ceil(Math.max(bounds.x + bounds.width, boxes.icon.right) + 4 - left), height: Math.ceil(Math.max(bounds.y + bounds.height, boxes.icon.bottom) + 4 - top) };
        if (session) {
          const { data } = await session.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
          await writeFile(path, Buffer.from(data, 'base64'));
        } else await page.screenshot({ path, clip });
      };
      await page.waitForTimeout(260);
      const compact = await assertGeometry();
      assert.equal((await overlay.boundingBox()).width, 40);
      assert.equal(compact.panel.width, compact.panel.height);
      assert.deepEqual(compact.panel, compact.mute);
      await screenshot('compact');
      const session = await context.newCDPSession(page);
      try {
        for (const zoom of [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]) {
          await session.send('Emulation.setDeviceMetricsOverride', { width: Math.round(1280 / zoom), height: Math.round(800 / zoom), deviceScaleFactor: zoom, mobile: false, screenWidth: 1280, screenHeight: 800 });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const boxes = await assertGeometry();
          const player = page.locator('#movie_player, .video-player');
          await player.press('ArrowUp');
          const badge = await page.locator('[data-tm-volume-feedback]').boundingBox(), host = await player.boundingBox();
          assert.ok(Math.abs(badge.x + badge.width / 2 - (host.x + host.width / 2)) < .6, `${platform}: feedback remains centered at ${zoom * 100}% zoom`);
          await player.press('ArrowDown');
          assert.ok(Math.abs(boxes.dpr - zoom) < 0.000001);
          if ([0.8, 1, 1.25, 1.5, 2].includes(zoom)) await screenshot(`zoom-${zoom * 100}`, session);
        }
      } finally { await session.send('Emulation.clearDeviceMetricsOverride'); await session.detach(); }
      await page.mouse.move(1100, 700); await mute.hover();
      await page.waitForFunction(() => document.querySelector('#tm-volume-slider-overlay').classList.contains('tm-expanded'));
      await page.waitForTimeout(260); await screenshot('expanded');
      for (const value of ['0', '100', '30']) {
        await slider.evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }, value);
        await indicator.waitFor({ state: 'visible' });
        const boxes = await assertGeometry();
        assert.ok(boxes.icon.right < boxes.slider.x, `${platform}: icon clears the slider thumb at ${value}%`);
        assert.equal(await indicator.innerHTML(), artwork);
      }
      if (updateDocs) {
        // Give the documentation preview room for the complete real menu.
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.locator('#movie_player, .video-player').evaluate(player => {
          player.style.height = '760px';
          player.querySelector('video').style.height = '720px';
        });
      }
      await page.locator('#tm-volume-options-button').click();
      await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-details')?.textContent.includes('Output 17% · Selected 30%'));
      const statusSession = await context.newCDPSession(page);
      try {
        for (const zoom of [0.5, 0.67, 1, 1.25, 1.5, 2]) {
          await statusSession.send('Emulation.setDeviceMetricsOverride', { width: Math.round(1280 / zoom), height: Math.round(800 / zoom), deviceScaleFactor: zoom, mobile: false });
          const layout = await page.locator('#tm-volume-options-normalization-details').evaluate(details => {
            const range = document.createRange();
            range.selectNodeContents(details);
            const lines = [...range.getClientRects()].filter(rect => rect.width > 0);
            const card = details.parentElement.getBoundingClientRect();
            const status = details.previousElementSibling.getBoundingClientRect();
            return { lines: lines.length, contained: lines.every(rect => rect.left >= card.left && rect.right <= card.right && rect.bottom <= card.bottom), separated: lines.length === 2 && lines[0].top >= status.bottom && lines[1].top >= lines[0].bottom };
          });
          assert.deepEqual(layout, { lines: 2, contained: true, separated: true }, `${platform}: audio details use two clear lines without overlap at ${zoom * 100}% zoom`);
        }
      } finally { await statusSession.send('Emulation.clearDeviceMetricsOverride'); await statusSession.detach(); }
      await screenshot('settings', null, page.locator('#tm-volume-options-popup'));
      await screenshot('audio', null, page.locator('.tm-volume-options-section').filter({ has: page.locator('#tm-volume-options-normalization') }));
      await page.locator('#tm-volume-options-tab-appearance').click();
      await screenshot('appearance', null, page.locator('#tm-volume-options-popup'));
      await page.locator('#tm-volume-options-appearance-classic').click();
      await page.waitForTimeout(260); await assertGeometry(); await screenshot('classic');
      await page.locator('#tm-volume-options-tab-general').click();
      await page.locator('#tm-volume-options-location-video').click();
      await page.locator('#tm-volume-options-tab-appearance').click();
      await page.locator('#tm-volume-options-size-section input').evaluate(element => { element.value = '200'; element.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForTimeout(260); await assertGeometry(); await screenshot('on-video');
      await page.locator('#tm-volume-options-appearance-new').click();
      await page.locator('#tm-volume-options-tab-general').click();
      await page.locator('#tm-volume-options-location-video').click();
      await page.keyboard.press('Escape'); await mute.focus(); await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('video').muted);
      await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent === 'Waiting for audio');
      assert.equal(await indicator.isVisible(), true);
      assert.equal(await indicator.innerHTML(), artwork);
      await mute.click();
      assert.equal(await page.locator('video').evaluate(video => video.muted), false);
      await indicator.waitFor({ state: 'visible' });
      await indicator.click();
      assert.equal(await indicator.isVisible(), true);
      assert.equal(await page.locator('video').evaluate(video => video.muted), true, 'the waveform retains mute interaction');
      await mute.click();
      await indicator.waitFor({ state: 'visible' });
      await page.evaluate(() => { window.__iconAudio.paused = true; });
      await page.locator('#tm-volume-options-button').click();
      await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent === 'Waiting for playback');
      assert.equal(await indicator.isVisible(), true, 'pause keeps the enabled indication');
      assert.match(await mute.getAttribute('aria-describedby'), /normalization-description/);
      await page.evaluate(() => { window.__iconAudio.paused = false; });
      await page.evaluate(() => { window.__iconAudio.amplitude = 0.02; window.__iconAudio.streams.at(-1).getAudioTracks()[0].muted = true; });
      await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent.includes('Waiting for accessible audio'));
      assert.equal(await indicator.isVisible(), false);
      assert.equal(await indicator.innerHTML(), artwork);
      await page.locator('#tm-volume-options-normalization').click();
      assert.equal(await indicator.isVisible(), false);
      assert.equal(await mute.getAttribute('aria-describedby'), null);
      assert.equal(await slider.getAttribute('aria-describedby'), 'tm-volume-slider-value');
      await page.keyboard.press('Escape'); await page.mouse.move(1100, 700);
      await page.locator('#movie_player, .video-player').press('ArrowUp');
      assert.equal(await page.locator('[data-tm-volume-feedback]').textContent(), '35%', `${platform}: shared feedback also works with normalization off`);
      assert.equal(await slider.inputValue(), '35');
      assert.equal(await page.locator('video').evaluate(video => Math.round(video.volume * 100)), 35);
      await page.locator('#movie_player, .video-player').press('ArrowDown');
      assert.equal(await page.locator('[data-tm-volume-feedback]').textContent(), '30%');
      if (youtube) assert.equal(await page.evaluate(() => window.__nativeVolumeKeys), 0, 'both normalization states prevent a second native player-key action');
      await page.waitForFunction(() => document.querySelector('#tm-volume-slider-overlay').classList.contains('tm-collapsed'));
      await page.waitForTimeout(260);
      assert.equal((await overlay.boundingBox()).width, 40);
      assert.deepEqual(errors, []);
      console.log(`${platform}: waveform survives pause/mute/zero, hides for inaccessible audio and Off; unchanged layout, 50–200% zoom, Classic/on-video and accessibility passed`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
