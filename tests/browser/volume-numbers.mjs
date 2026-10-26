import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchChrome, launchFirefox } from '../helpers/browser.js';
import { youtubeFixture, twitchFixture } from '../helpers/fixtures.js';

const firefox = process.argv.includes('--firefox');
const browser = await (firefox ? launchFirefox() : launchChrome());
try {
  for (const platform of ['youtube', 'twitch']) {
    const youtube = platform === 'youtube';
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
      body{margin:24px;background:#17181c;color:#fff;font-family:Arial}
      #movie_player,.video-player{position:relative;width:900px;height:240px;background:#333}
      video{width:900px;height:200px;display:block}
      .ytp-left-controls,.ytp-right-controls{position:absolute;bottom:0;height:40px;display:flex;align-items:center}
      .ytp-right-controls{right:0}[data-a-target="player-controls"]{display:flex;height:40px;align-items:center;justify-content:space-between}
      .player-controls__left-control-group,.player-controls__right-control-group{display:flex;align-items:center}
    </style><body></body>` }));
    await page.goto(youtube ? 'https://www.youtube.com/watch?v=numbers' : 'https://www.twitch.tv/numbers');
    await page.evaluate(({ fixture, prefix }) => {
      (0, eval)(`(${fixture})`)(document);
      localStorage.setItem(`tm-${prefix}-volume-slider-mode`, 'replace-native');
    }, { fixture: (youtube ? youtubeFixture : twitchFixture).toString(), prefix: youtube ? 'yt' : 'twitch' });
    await page.addScriptTag({ content: await readFile(new URL(`../../dist/${platform}-volume-slider.user.js`, import.meta.url), 'utf8') });
    await page.locator('.tm-volume-percent').waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Hold the real badge visible for geometry coverage; processing/status behavior
    // is exercised separately by normalization-icon.mjs with captured audio.
    await page.addStyleTag({ content: '#tm-volume-slider-overlay .tm-normalization-icon { display:block!important; }' });
    await page.evaluate(() => document.getElementById('tm-volume-slider-overlay').classList.add('tm-normalization-enabled'));

    for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
      await page.evaluate(zoom => { document.body.style.zoom = zoom; }, zoom);
      const results = await page.evaluate(async zoom => {
        const slider = document.getElementById('tm-volume-slider-range');
        const text = document.querySelector('.tm-volume-percent');
        const svg = text.ownerSVGElement;
        const svgRect = svg.getBoundingClientRect();
        const badge = document.querySelector('.tm-normalization-icon').getBoundingClientRect();
        const badgeX = (badge.x + badge.width / 2 - svgRect.x) * 40 / svgRect.width;
        const badgeY = (badge.y + badge.height / 2 - svgRect.y) * 40 / svgRect.height;
        const badgeRadius = badge.width * 20 / svgRect.width;
        const canvas = document.createElement('canvas');
        const pixels = Math.round(40 * zoom);
        canvas.width = canvas.height = pixels;
        const context = canvas.getContext('2d');
        const results = [];
        for (let value = 1; value <= 100; value++) {
          slider.value = value;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          const style = getComputedStyle(text);
          const clone = svg.cloneNode(false);
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          clone.setAttribute('width', pixels); clone.setAttribute('height', pixels);
          const glyph = text.cloneNode(true);
          // Rasterize the actual SVG placement and resolved styling, excluding shadows/arcs.
          glyph.style.font = style.font;
          glyph.style.letterSpacing = style.letterSpacing;
          glyph.style.fontSynthesis = 'none';
          glyph.style.fill = 'white';
          glyph.style.filter = 'none'; glyph.style.textShadow = 'none';
          clone.append(glyph);
          const image = new Image();
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
          await image.decode();
          context.clearRect(0, 0, pixels, pixels); context.drawImage(image, 0, 0);
          const rgba = context.getImageData(0, 0, pixels, pixels).data;
          let left = pixels, right = -1, top = pixels, bottom = -1, radius = 0, badgeClearance = Infinity;
          for (let y = 0; y < pixels; y++) {
            for (let x = 0; x < pixels; x++) {
              if (rgba[(y * pixels + x) * 4 + 3] < 100) continue;
              left = Math.min(left, x); right = Math.max(right, x);
              top = Math.min(top, y); bottom = Math.max(bottom, y);
              radius = Math.max(radius, Math.hypot(x + .5 - pixels / 2, y + .5 - pixels / 2) / zoom);
              badgeClearance = Math.min(badgeClearance, Math.hypot((x + .5) / zoom - badgeX, (y + .5) / zoom - badgeY) - badgeRadius);
            }
          }
          results.push({ value, text: text.textContent, dx: Math.abs((left + right + 1 - pixels) / (2 * zoom)),
            dy: Math.abs((top + bottom + 1 - pixels) / (2 * zoom)), radius, visible: right >= left && bottom >= top,
            badgeClearance, stretched: text.hasAttribute('textLength') || text.hasAttribute('lengthAdjust'), size: style.fontSize });
        }
        return results;
      }, zoom);
      assert.equal(results.length, 100);
      for (const result of results) {
        assert.equal(result.text, String(result.value));
        assert.ok(result.visible && result.dx <= 1 && result.dy <= 1, `${platform} at ${zoom}: numeral is centered: ${JSON.stringify(result)}`);
        assert.ok(result.radius < 13, `${platform} at ${zoom}: numeral clears the arc: ${JSON.stringify(result)}`);
        assert.ok(result.badgeClearance > 0, `${platform} at ${zoom}: badge leaves numeral unobscured: ${JSON.stringify(result)}`);
        assert.equal(result.stretched, false, 'numerals retain natural proportions');
        assert.equal(result.size, result.value === 100 ? '15px' : '16px');
      }
    }
    await page.evaluate(() => { document.body.style.zoom = 1; });
    await page.locator('.tm-volume-icon-cell').click();
    assert.equal(await page.locator('.tm-volume-percent').textContent(), 'M');
    await page.locator('.tm-volume-icon-cell').click();
    assert.equal(await page.locator('.tm-volume-percent').textContent(), '100');
    if (process.env.VOLUME_SLIDER_SCREENSHOTS) {
      await mkdir(process.env.VOLUME_SLIDER_SCREENSHOTS, { recursive: true });
      await page.mouse.move(1100, 700);
      await page.locator('#movie_player, .video-player').screenshot({ path: join(process.env.VOLUME_SLIDER_SCREENSHOTS, `${platform}-numbers-${firefox ? 'firefox' : 'chrome'}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(`${platform}: all 1–100 numerals remain centered and inside the arc at 75–200% scaling; mute restores 100`);
    await page.close();
  }
} finally { await browser.close(); }
