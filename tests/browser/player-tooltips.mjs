import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launchChrome, launchFirefox } from '../helpers/browser.js';

const browser = await (process.argv.includes('--firefox') ? launchFirefox() : launchChrome());
try {
  for (const platform of ['youtube', 'twitch']) {
    const youtube = platform === 'youtube';
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__tooltipTrace = [];
      for (const type of ['focusin', 'focusout', 'pointerover', 'pointerout', 'scroll', 'keydown']) {
        document.addEventListener(type, event => {
          const element = event.target;
          window.__tooltipTrace.push({ type, key: event.key, target: element.id || element.tagName,
            active: document.activeElement?.id || document.activeElement?.tagName,
            focusVisible: element.matches?.(':focus-visible'), tooltip: !!document.getElementById('tm-volume-player-tooltip') });
          window.__tooltipTrace = window.__tooltipTrace.slice(-40);
        }, true);
      }
    });
    const host = youtube
      ? '<div id="movie_player"><video></video><div class="ytp-popup ytp-settings-menu" hidden>Quality</div><div class="ytp-chrome-bottom"><div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div></div></div>'
      : '<div class="player-stack"><div class="video-player" data-a-target="player-overlay-click-handler"><video></video><div class="controls-fade"><div data-a-target="player-controls" data-a-visible="true"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button">Settings</button></div></div></div></div></div>';
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
      body{margin:24px;background:#111;color:white;font-family:Arial}
      #movie_player,.video-player{position:relative;width:900px;height:500px;background:#333;overflow:hidden}
      video{display:block;width:900px;height:460px}button{color:white;background:#333;border:0;height:36px}
      .ytp-left-controls,.ytp-right-controls{position:absolute;bottom:0;display:flex;align-items:center}
      .ytp-right-controls{right:0}[data-a-target="player-controls"]{display:flex;justify-content:space-between;height:40px}
      .ytp-chrome-bottom{position:absolute;bottom:0;width:100%;height:56px}
      .ytp-left-controls,.ytp-right-controls{bottom:8px}
      .player-controls__left-control-group,.player-controls__right-control-group{display:flex;align-items:center}
      .player-stack{position:relative;z-index:0}
    </style>${host}` }));
    try {
      await page.goto(youtube ? 'https://www.youtube.com/watch?v=tooltips' : 'https://www.twitch.tv/tooltips');
      await page.addScriptTag({ content: await readFile(new URL(`../../dist/${platform}-volume-slider.user.js`, import.meta.url), 'utf8') });
      const button = page.getByRole('button', { name: 'Volume Slider Options', exact: true });
      const tooltip = page.locator('#tm-volume-player-tooltip');
      const player = page.locator('#movie_player,.video-player');
      await button.waitFor();
      assert.equal(await button.getAttribute('title'), null);
      for (const scale of [1, 1.25]) {
        await player.evaluate((element, value) => { element.style.transformOrigin = 'top left'; element.style.transform = `scale(${value})`; }, scale);
        await button.hover();
        await page.mouse.move(0, 0);
        await button.hover();
        await tooltip.waitFor();
        assert.equal(await tooltip.textContent(), 'Volume Slider Options');
        const bounds = await tooltip.boundingBox(), anchor = await button.boundingBox();
        assert.ok(bounds.y + bounds.height <= anchor.y, 'tooltip appears above its control');
        if (youtube) {
          const controls = await page.locator('.ytp-chrome-bottom').boundingBox();
          assert.ok(Math.abs(controls.y - (bounds.y + bounds.height) - 10 * scale) <= scale, 'YouTube tooltip uses the native controls-bar baseline');
        }
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1280, 'tooltip stays in view at different scales');
        const appearance = await tooltip.evaluate(element => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, color: style.color, radius: style.borderRadius };
        });
        assert.equal(appearance.radius, youtube ? '8px' : '4px');
        assert.equal(appearance.color, youtube ? 'rgb(238, 238, 238)' : 'rgb(14, 14, 16)');
        assert.equal(await tooltip.evaluate(element => getComputedStyle(element).pointerEvents), 'none', 'tooltips do not intercept movement between controls');
        await page.keyboard.press('Escape');
        await tooltip.waitFor({ state: 'detached' });
      }
      await player.evaluate(element => { element.style.transform = ''; });
      await page.mouse.move(0, 0);
      if (youtube) {
        const immediate = await button.evaluate(element => {
          element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
          const tip = document.getElementById('tm-volume-player-tooltip');
          const appeared = !!tip;
          const animated = tip?.getAnimations().length;
          element.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.querySelector('.ytp-settings-button') }));
          return { appeared, animated, remaining: !!document.getElementById('tm-volume-player-tooltip') };
        });
        assert.deepEqual(immediate, { appeared: true, animated: 0, remaining: false }, 'YouTube appears and disappears immediately without overlapping the next tooltip');
        await player.evaluate(element => {
          const native = document.createElement('div');
          native.className = 'ytp-tooltip ytp-bottom';
          native.textContent = 'Settings';
          native.style.cssText = 'display:none;position:absolute;top:390px;left:750px;opacity:0;transition:opacity 200ms';
          element.append(native);
          const button = element.querySelector('.ytp-settings-button');
          let timer;
          const show = () => {
            clearTimeout(timer);
            native.style.display = 'block';
            native.getBoundingClientRect();
            native.style.opacity = '1';
          };
          const hide = () => {
            native.style.opacity = '0';
            timer = setTimeout(() => { native.style.display = 'none'; }, 200);
          };
          button.addEventListener('mouseenter', show);
          button.addEventListener('mouseleave', hide);
          native.disposeFixture = () => {
            clearTimeout(timer);
            button.removeEventListener('mouseenter', show);
            button.removeEventListener('mouseleave', hide);
            native.remove();
          };
        });
        const native = page.locator('.ytp-tooltip.ytp-bottom');
        const settings = page.locator('.ytp-settings-button');
        for (let attempt = 0; attempt < 3; attempt++) {
          await settings.hover();
          assert.equal(await tooltip.count(), 0);
          assert.equal(await native.evaluate(element => getComputedStyle(element).opacity), '1', 'native tooltip handoff does not fade back in');
          await button.hover();
          await tooltip.waitFor();
          assert.equal(await native.evaluate(element => getComputedStyle(element).visibility), 'hidden', 'fading native tooltip cannot overlap the custom label');
        }
        await settings.hover();
        await native.evaluate(element => {
          element.classList.add('ytp-preview', 'ytp-tooltip-progress-bar-style');
          element.style.transition = 'none';
          element.style.opacity = '.4';
        });
        assert.equal(await native.evaluate(element => getComputedStyle(element).opacity), '0.4', 'seek-preview opacity remains controlled by YouTube');
        await page.mouse.move(0, 0);
        await native.evaluate(element => element.disposeFixture());
      } else {
        await button.evaluate(element => {
          const timing = window.__tooltipTiming = {};
          element.addEventListener('pointerover', () => { timing.entered = performance.now(); }, { once: true });
          const observer = new MutationObserver(() => {
            const tip = document.getElementById('tm-volume-player-tooltip');
            if (!tip) return;
            timing.delay = performance.now() - timing.entered;
            const animation = tip.getAnimations()[0];
            timing.animation = animation && { duration: animation.effect.getTiming().duration, easing: getComputedStyle(tip).animationTimingFunction, frames: animation.effect.getKeyframes() };
            observer.disconnect();
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
        await button.hover();
        await tooltip.waitFor();
        const timing = await page.evaluate(() => window.__tooltipTiming);
        assert.ok(timing.delay >= 180 && timing.delay < 1000, 'Twitch uses its native 200 ms hover delay');
        assert.equal(timing.animation.duration, 100);
        assert.equal(timing.animation.easing, 'ease');
        assert.equal(timing.animation.frames[0].opacity, '0');
        assert.match(timing.animation.frames[0].transform, /scale\(0\.9\)/);
        assert.equal(timing.animation.frames.at(-1).opacity, '1');
        await page.mouse.move(0, 0);
        assert.equal(await tooltip.count(), 0, 'leaving a control removes its tooltip without lingering over its neighbor');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await button.hover();
        await tooltip.waitFor();
        assert.equal(await tooltip.evaluate(element => getComputedStyle(element).animationName), 'none', 'reduced motion skips the pop animation');
        await page.mouse.move(0, 0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await button.hover();
        await tooltip.waitFor();
        await tooltip.evaluate(element => {
          const r = element.getBoundingClientRect();
          const menu = document.createElement('div');
          menu.id = 'native-settings-portal';
          menu.setAttribute('role', 'menu');
          menu.textContent = 'Native settings';
          menu.style.cssText = `position:fixed;z-index:5000;background:#333;left:${r.x - 10}px;top:${r.y - 10}px;width:${r.width + 20}px;height:${r.height + 20}px`;
          document.body.append(menu);
        });
        await tooltip.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
        assert.equal(await tooltip.evaluate(element => {
          const r = element.getBoundingClientRect();
          element.style.pointerEvents = 'auto';
          const aboveMenu = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === element;
          element.style.removeProperty('pointer-events');
          return aboveMenu;
        }), true, 'Twitch tooltip is painted above the native settings portal, not just present in the DOM');
        await page.locator('#native-settings-portal').evaluate(element => element.remove());
        await player.evaluate(element => element.requestFullscreen());
        await page.mouse.move(0, 0);
        await button.hover();
        await tooltip.waitFor();
        assert.equal(await tooltip.evaluate(element => document.fullscreenElement.contains(element)), true, 'fullscreen retains the tooltip in the visible layer');
        await page.evaluate(() => document.exitFullscreen());
        await page.mouse.move(0, 0);
      }
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      await page.keyboard.press('Tab');
      // Focus the real control using keyboard navigation, regardless of platform tab order.
      for (let attempt = 0; attempt < 10 && !await button.evaluate(element => element === document.activeElement); attempt++) await page.keyboard.press('Tab');
      assert.equal(await button.evaluate(element => element === document.activeElement), true);
      try { await tooltip.waitFor({ timeout: 5000 }); }
      catch (error) {
        console.log('Tooltip keyboard failure', platform, await page.evaluate(() => ({ trace: window.__tooltipTrace,
          focused: document.activeElement?.outerHTML, focusVisible: document.activeElement?.matches(':focus-visible'), hasFocus: document.hasFocus(),
          tooltip: document.getElementById('tm-volume-player-tooltip')?.outerHTML,
          popup: document.getElementById('tm-volume-options-popup')?.hidden })));
        throw error;
      }
      if (youtube) {
        await page.locator('.ytp-settings-button').hover();
        assert.equal(await tooltip.count(), 0, 'a native hover dismisses keyboard-opened custom feedback');
        await button.hover();
        await tooltip.waitFor();
        for (const settingsClass of [true, false]) {
          await player.evaluate((element, useClass) => {
            element.classList.toggle('ytp-settings-shown', useClass);
            element.querySelector('.ytp-settings-menu').hidden = useClass;
          }, settingsClass);
          await tooltip.waitFor({ state: 'detached' });
          await page.mouse.move(0, 0);
          await button.hover();
          await page.waitForTimeout(400);
          assert.equal(await tooltip.count(), 0, 'native player menus suppress custom tooltips');
          await player.evaluate(element => {
            element.classList.remove('ytp-settings-shown');
            element.querySelector('.ytp-settings-menu').hidden = true;
          });
          await page.mouse.move(0, 0);
          await button.hover();
          await tooltip.waitFor();
        }
      } else {
        const controls = page.locator('[data-a-target="player-controls"]');
        await controls.evaluate(element => element.setAttribute('data-a-visible', 'false'));
        await tooltip.waitFor({ state: 'detached' });
        await page.mouse.move(0, 0);
        await button.hover();
        await page.waitForTimeout(400);
        assert.equal(await tooltip.count(), 0, 'hidden Twitch controls cannot show a tooltip');
        await controls.evaluate(element => element.setAttribute('data-a-visible', 'true'));
        await page.mouse.move(0, 0);
        await button.hover();
        await tooltip.waitFor();
        await page.locator('.controls-fade').evaluate(element => { element.style.visibility = 'hidden'; });
        await tooltip.waitFor({ state: 'detached' });
        await page.locator('.controls-fade').evaluate(element => { element.style.visibility = ''; });
        await page.mouse.move(0, 0);
        await button.hover();
        await tooltip.waitFor();
      }
      await button.press('Enter');
      await tooltip.waitFor({ state: 'detached' });
      await page.locator('#tm-volume-options-popup').waitFor({ state: 'visible' });
      await page.mouse.move(0, 0);
      await button.hover();
      if (youtube) {
        await page.waitForTimeout(400);
        assert.equal(await tooltip.count(), 0, 'open YouTube menu suppresses its tooltip');
      } else {
        await tooltip.waitFor();
        assert.equal(await tooltip.textContent(), 'Volume Slider Options', 'Twitch keeps tooltips available while its menu is open');
      }
      await page.keyboard.press('Escape');
      await page.mouse.move(0, 0);
      await button.hover();
      await tooltip.waitFor();
      if (process.env.VOLUME_SLIDER_SCREENSHOTS) {
        await mkdir(process.env.VOLUME_SLIDER_SCREENSHOTS, { recursive: true });
        await player.screenshot({ path: join(process.env.VOLUME_SLIDER_SCREENSHOTS, `${platform}-options-tooltip${process.argv.includes('--firefox') ? '-firefox' : ''}.png`) });
      }
      if (!youtube) {
        await player.evaluate(element => element.parentElement.remove());
        await tooltip.waitFor({ state: 'detached' });
      } else {
        const removedTooltip = await tooltip.elementHandle();
        await button.evaluate(element => element.remove());
        await page.waitForFunction(element => !element.isConnected, removedTooltip);
        await removedTooltip.dispose();
      }
      assert.deepEqual(errors, []);
      console.log(`${platform}: platform tooltip, exact label, hover, keyboard, scaling, platform menu rules, native-tooltip handoff, controls hiding, dismissal and control replacement passed`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
