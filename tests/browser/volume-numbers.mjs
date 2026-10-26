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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
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
      const sheet = await page.evaluate(() => {
        const slider = document.getElementById('tm-volume-slider-range');
        const text = document.querySelector('.tm-volume-percent');
        const svg = text.ownerSVGElement;
        const svgRect = svg.getBoundingClientRect();
        const badge = document.querySelector('.tm-normalization-icon').getBoundingClientRect();
        const badgeX = (badge.x + badge.width / 2 - svgRect.x) * 40 / svgRect.width;
        const badgeY = (badge.y + badge.height / 2 - svgRect.y) * 40 / svgRect.height;
        const badgeRadius = badge.width * 20 / svgRect.width;
        const grid = document.createElement('div');
        grid.id = 'numeral-sheet';
        Object.assign(grid.style, { position: 'fixed', left: '0', top: '0', zIndex: '100000',
          display: 'grid', gridTemplateColumns: 'repeat(10,40px)', gap: '8px', padding: '8px', background: '#000' });
        document.body.append(grid);
        const samples = [];
        for (let value = 1; value <= 100; value++) {
          slider.value = value;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          const style = getComputedStyle(text);
          const clone = svg.cloneNode(false);
          clone.setAttribute('width', '40'); clone.setAttribute('height', '40');
          clone.style.display = 'block';
          const glyph = text.cloneNode(true);
          // Keep samples in the page's font context. An SVG loaded as a separate
          // image can resolve system-ui differently from the actual player on Linux.
          for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontKerning', 'fontVariantNumeric', 'fontFeatureSettings', 'textRendering']) {
            glyph.style[property] = style[property];
          }
          glyph.style.letterSpacing = style.letterSpacing;
          glyph.style.fontSynthesis = 'none';
          glyph.style.fill = 'white';
          glyph.style.filter = 'none'; glyph.style.textShadow = 'none';
          clone.append(glyph);
          grid.append(clone);
          samples.push({ value, text: text.textContent, stretched: text.hasAttribute('textLength') || text.hasAttribute('lengthAdjust'),
            size: style.fontSize, font: { family: style.fontFamily, weight: style.fontWeight }, element: clone });
        }
        const gridRect = grid.getBoundingClientRect();
        return { badgeX, badgeY, badgeRadius, width: gridRect.width, samples: samples.map(({ element, ...sample }) => {
          const rect = element.getBoundingClientRect();
          return { ...sample, x: rect.x - gridRect.x, y: rect.y - gridRect.y, width: rect.width, height: rect.height };
        }) };
      });
      const screenshot = await page.locator('#numeral-sheet').screenshot();
      const results = await page.evaluate(async ({ sheet, png }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const density = canvas.width / sheet.width;
        const results = sheet.samples.map(sample => {
          const scale = sample.width * density / 40;
          const cx = (sample.x + sample.width / 2) * density;
          const cy = (sample.y + sample.height / 2) * density;
          let left = canvas.width, right = -1, top = canvas.height, bottom = -1, radius = 0, badgeClearance = Infinity;
          for (let y = Math.round(sample.y * density); y < Math.round((sample.y + sample.height) * density); y++) {
            for (let x = Math.round(sample.x * density); x < Math.round((sample.x + sample.width) * density); x++) {
              if (rgba[(y * canvas.width + x) * 4] < 100) continue;
              left = Math.min(left, x); right = Math.max(right, x);
              top = Math.min(top, y); bottom = Math.max(bottom, y);
              radius = Math.max(radius, Math.hypot(x + .5 - cx, y + .5 - cy) / scale);
              badgeClearance = Math.min(badgeClearance, Math.hypot((x + .5 - cx) / scale + 20 - sheet.badgeX,
                (y + .5 - cy) / scale + 20 - sheet.badgeY) - sheet.badgeRadius);
            }
          }
          return { ...sample, dx: Math.abs((left + right + 1) / 2 - cx) / scale,
            dy: Math.abs((top + bottom + 1) / 2 - cy) / scale,
            pixelOffsetX: Math.abs((left + right + 1) / 2 - cx), pixelOffsetY: Math.abs((top + bottom + 1) / 2 - cy),
            radius, visible: right >= left && bottom >= top, badgeClearance };
        });
        document.getElementById('numeral-sheet').remove();
        return results;
      }, { sheet, png: screenshot.toString('base64') });
      assert.equal(results.length, 100);
      for (const result of results) {
        assert.equal(result.text, String(result.value));
        // Font hinting rounds painted edges to device pixels. Keep the same
        // one-pixel tolerance at every scale, rather than loosening it when enlarged.
        assert.ok(result.visible && result.pixelOffsetX <= 1.01 && result.pixelOffsetY <= 1.01,
          `${platform} at ${zoom}: numeral is centered: ${JSON.stringify(result)}`);
        assert.ok(result.radius < 13, `${platform} at ${zoom}: numeral clears the arc: ${JSON.stringify(result)}`);
        assert.ok(result.badgeClearance > 0, `${platform} at ${zoom}: badge leaves numeral unobscured: ${JSON.stringify(result)}`);
        assert.equal(result.stretched, false, 'numerals retain natural proportions');
        if (result.value === 100) {
          assert.ok(parseFloat(result.size) > 0 && parseFloat(result.size) <= 15, '100 fits the resolved local font');
        } else {
          assert.equal(result.size, '16px');
        }
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
