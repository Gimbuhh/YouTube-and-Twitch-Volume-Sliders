import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, launchFirefox } from '../helpers/browser.js';

const directory = process.env.VOLUME_SLIDER_ARTIFACT_ROOT || fileURLToPath(new URL('../../dist/', import.meta.url));
const browser = await (process.argv.includes('--firefox') ? launchFirefox() : launchChrome());
try {
  for (const platform of ['youtube', 'twitch']) {
    const youtube = platform === 'youtube', prefix = youtube ? 'yt' : 'twitch';
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const controls = youtube
      ? '<div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div>'
      : '<div data-a-target="player-controls" data-a-visible="true"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button">Settings</button></div></div>';
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
      body{margin:20px;background:#111;color:white;font-family:Arial}
      #movie_player,.video-player{position:relative;width:900px;height:340px;background:#333}
      video{display:block;width:900px;height:300px}.ytp-left-controls,.ytp-right-controls{position:absolute;bottom:0;display:flex;height:40px}
      .ytp-right-controls{right:0}[data-a-target="player-controls"]{display:flex;justify-content:space-between;height:40px}
      .player-controls__left-control-group,.player-controls__right-control-group{display:flex;height:40px}
      #outside{display:block;margin-top:40px}button{height:36px}
      </style><div ${youtube ? 'id="movie_player"' : 'class="video-player" data-a-target="player-overlay-click-handler"'} tabindex="0"><video ${youtube ? 'class="html5-main-video"' : ''}></video>${controls}</div><button id="outside">Outside player</button>` }));
    try {
      await page.goto(youtube ? 'https://www.youtube.com/watch?v=pill' : 'https://www.twitch.tv/pill');
      await page.evaluate(({ youtube, prefix }) => {
        const player = document.querySelector('#movie_player,.video-player'), video = player.querySelector('video');
        let volume = .5, muted = false;
        const api = { getVolume: () => volume * (youtube ? 100 : 1), setVolume: value => { volume = value / (youtube ? 100 : 1); },
          isMuted: () => muted, mute: () => { muted = true; }, unMute: () => { muted = false; }, setMuted: value => { muted = value; } };
        if (youtube) Object.assign(player, api);
        else player.__reactFiber$pill = { return: { memoizedProps: { mediaPlayerInstance: api }, return: null } };
        video.volume = .5;
        localStorage.setItem(`tm-${prefix}-volume`, '50');
        localStorage.setItem(`tm-${prefix}-muted`, 'false');
      }, { youtube, prefix });
      await page.addScriptTag({ content: await readFile(join(directory, `${platform}-volume-slider.user.js`), 'utf8') });
      const overlay = page.locator('#tm-volume-slider-overlay'), icon = page.locator('.tm-volume-icon-cell');
      const slider = page.locator('#tm-volume-slider-range'), outside = page.locator('#outside');
      const expanded = () => overlay.evaluate(element => element.classList.contains('tm-expanded'));
      const collapsed = timeout => page.waitForFunction(() => document.querySelector('#tm-volume-slider-overlay').classList.contains('tm-collapsed'), null, { timeout });

      // Expiry under hover must not latch the pill open after pointer exit.
      await icon.hover(); await page.mouse.wheel(0, -100); await page.waitForTimeout(1350);
      assert.equal(await expanded(), true, 'hover survives the grace deadline');
      await outside.hover(); await collapsed(600);

      // Leaving uses the existing deadline; a later wheel adjustment renews it.
      await icon.hover(); await page.mouse.wheel(0, 100); await page.waitForTimeout(700);
      await page.mouse.wheel(0, -100); await outside.hover(); await page.waitForTimeout(650);
      assert.equal(await expanded(), true, 'each wheel adjustment restarts the grace period');
      await collapsed(1000);

      // Native pointer focus must not pin the pill; crossing its edge must not
      // end the drag before the actual outside release.
      await icon.hover();
      await slider.waitFor({ state: 'visible' }); await page.waitForTimeout(250);
      const rect = await slider.boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
      await page.mouse.move(1050, 430); await page.waitForTimeout(1350);
      assert.equal(await overlay.getAttribute('data-tm-dragging'), 'true', 'pointer exit retains the active drag');
      assert.equal(await expanded(), true, 'dragging survives the grace deadline');
      await page.mouse.up();
      assert.equal(await overlay.getAttribute('data-tm-dragging'), 'false');
      await collapsed(1800);

      // Keyboard focus is intentionally different from focus left by a mouse.
      await icon.hover(); await slider.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.equal(await slider.evaluate(element => element === document.activeElement && element.matches(':focus-visible')), true);
      await page.keyboard.press('ArrowDown'); await outside.hover(); await page.waitForTimeout(1350);
      assert.equal(await expanded(), true, 'keyboard focus survives pointer exit and expiry');
      assert.equal(await slider.evaluate(element => element === document.activeElement), true, 'volume input preserves keyboard focus');
      await page.keyboard.press('Tab'); await collapsed(600);

      await page.getByRole('button', { name: 'Volume Slider Options', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Always expanded', exact: true }).check();
      await page.keyboard.press('Escape'); await outside.hover(); await page.waitForTimeout(1350);
      assert.equal(await expanded(), true, 'Always expanded overrides idle collapse');
      assert.equal(await overlay.evaluate(element => getComputedStyle(element).transitionDuration.split(',')[0].trim()), '0.22s');
      assert.deepEqual(errors, []);
      console.log(`${platform}: expired hover/focus holds, remaining grace, repeated wheel input, outside drag/release, keyboard focus and Always expanded passed`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
