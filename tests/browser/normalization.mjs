import assert from 'node:assert/strict';
import { access, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const candidates = [process.env.VOLUME_SLIDER_CHROME,
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')];
let executablePath;
for (const path of candidates.filter(Boolean)) {
  try { await access(path); executablePath = path; break; } catch { /* next */ }
}
if (!executablePath) {
  console.log('normalization browser checks skipped: set VOLUME_SLIDER_CHROME');
  process.exit(0);
}

function wav(amplitude, channels = 1) {
  const rate = 48000, count = rate * 15;
  const bytes = Buffer.alloc(44 + count * channels * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(count * channels * 2, 40);
  for (let i = 0; i < count; i++) {
    const level = typeof amplitude === 'function' ? amplitude(i / rate) : amplitude;
    const sample = Math.round(32767 * level * Math.sin(2 * Math.PI * 440 * i / rate));
    for (let channel = 0; channel < channels; channel++) bytes.writeInt16LE(channel === 1 ? -sample : sample, 44 + (i * channels + channel) * 2);
  }
  return bytes;
}

const loud = wav(0.7), quiet = wav(0.06), stereo = wav(0.7, 2);
// Continuous audible tone with a changing envelope, never digital silence.
const soft = wav(time => 0.016 + 0.012 * Math.sin(2 * Math.PI * time));
const browser = await chromium.launch({ headless: true, executablePath, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-networking', '--no-first-run'] });
try {
  for (const [platform, preferred] of ['youtube', 'twitch'].flatMap(platform => [30, 40].map(preferred => [platform, preferred]))) {
    const youtube = platform === 'youtube';
    const prefix = youtube ? 'yt' : 'twitch';
    const origin = youtube ? 'https://www.youtube.com' : 'https://www.twitch.tv';
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const artifact = await readFile(new URL(`../../dist/${platform}-volume-slider.user.js`, import.meta.url), 'utf8');
    const player = youtube
      ? '<div id="movie_player"><video class="html5-main-video" src="/loud.wav" loop></video><div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div></div>'
      : '<div class="video-player" data-a-target="player-overlay-click-handler"><video src="/loud.wav" loop></video><div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings">Settings</button></div></div></div>';
    const html = `<!doctype html><html><head><style>
      body{margin:20px;background:#111;color:white;font-family:Arial}#movie_player,.video-player{position:relative;width:900px;height:506px;background:#222}
      video{width:900px;height:466px}.ytp-left-controls,.ytp-right-controls{position:absolute;bottom:0;height:40px;display:flex;align-items:center}.ytp-left-controls{left:0}.ytp-right-controls{right:0}
      [data-a-target="player-controls"]{display:flex;align-items:center;justify-content:space-between;height:40px}.player-controls__left-control-group,.player-controls__right-control-group{display:flex;align-items:center}
      .ytp-volume-area,[data-a-target="player-volume-slider"]{width:80px;height:40px}
    </style></head><body>${player}<script>
      const video = document.querySelector('video'); video.volume = ${preferred / 100};
      const player = video.parentElement;
      const api = {getVolume:()=>video.volume * ${youtube ? 100 : 1},setVolume:v=>{video.volume=v / ${youtube ? 100 : 1}},isMuted:()=>video.muted,mute:()=>{video.muted=true},unMute:()=>{video.muted=false},setMuted:v=>{video.muted=v}};
      ${youtube ? 'Object.assign(player,api);' : 'player.__reactFiber$fixture={return:{memoizedProps:{mediaPlayerInstance:api},return:null}};'}
      localStorage.setItem('tm-${prefix}-volume','${preferred}');
      AudioContext.prototype.createMediaElementSource = () => {throw new Error('Must never reroute original playback')};
      window.__normalizationCaptures = 0;
      const originalCapture = HTMLMediaElement.prototype.captureStream;
      HTMLMediaElement.prototype.captureStream = function(...args) { window.__normalizationCaptures++; return originalCapture.apply(this,args); };
    </script><script>${artifact.replaceAll('</script>', '<\\/script>')}</script></body></html>`;
    await page.route('**/*', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('.wav')) return route.fulfill({ status: 200, contentType: 'audio/wav', body: path.includes('quiet') ? quiet : path.includes('stereo') ? stereo : path.includes('soft') ? soft : loud });
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    try {
      await page.goto(`${origin}/${youtube ? 'watch?v=normalization' : 'normalization'}`);
      await page.waitForSelector('#tm-volume-options-button');
      await page.evaluate(() => document.querySelector('video').play());
      await page.locator('#tm-volume-options-button').click();
      const toggle = page.locator('#tm-volume-options-normalization');
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await toggle.click();
      await page.waitForFunction(preference => document.querySelector('video').volume < preference / 100 * .25, preferred, { timeout: 3000 });
      assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
      assert.equal(await page.locator('#tm-volume-options-normalization-status').textContent(), 'Active');
      const loudOutput = await page.evaluate(() => document.querySelector('video').volume);
      assert.match(await page.locator('#tm-volume-options-normalization-details').textContent(), /Reducing loud audio/);
      // A native mute must survive both analysis ticks and disabling the mode.
      await page.evaluate(() => { document.querySelector('video').muted = true; });
      await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent === 'Muted');
      await toggle.click();
      assert.deepEqual(await page.evaluate(() => ({ volume: document.querySelector('video').volume, muted: document.querySelector('video').muted })), { volume: preferred / 100, muted: true });
      await page.evaluate(() => { document.querySelector('video').muted = false; });
      await toggle.click();
      await page.waitForFunction(preference => document.querySelector('video').volume < preference / 100 * .25, preferred);
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/quiet.wav'; await v.play(); });
      await page.waitForFunction(preference => {
        const target = 0.1 * preference / 100;
        const output = .06 / Math.sqrt(2) * document.querySelector('video').volume;
        return Math.abs(output / target - 1) < .1;
      }, preferred, { timeout: 6000 });
      assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
      const quietOutput = await page.evaluate(() => document.querySelector('video').volume);
      assert.ok(quietOutput > preferred / 100 * 2, 'quiet source uses headroom beyond the old 2x cap');
      const differenceDb = 20 * Math.log10((.06 * quietOutput) / (.7 * loudOutput));
      assert.ok(Math.abs(differenceDb) < 1.5, 'actual captured quiet/loud sources converge within 1.5 dB');
      await page.waitForFunction(() => /Raising quiet audio/.test(document.querySelector('#tm-volume-options-normalization-details').textContent));
      if (process.env.VOLUME_SLIDER_SCREENSHOTS) {
        await page.locator('#tm-volume-options-normalization-details').scrollIntoViewIfNeeded();
        await mkdir(process.env.VOLUME_SLIDER_SCREENSHOTS, { recursive: true });
        await page.locator('#tm-volume-options-popup').screenshot({ path: join(process.env.VOLUME_SLIDER_SCREENSHOTS, `${platform}-normalization.png`) });
      }
      // The old mono analyser reads this audible stereo source as silence.
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/stereo.wav'; await v.play(); });
      await page.waitForFunction(preference => document.querySelector('video').volume < preference / 100 * .25, preferred, { timeout: 3000 });
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/soft.wav'; await v.play(); });
      await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent.startsWith('Active'));
      const statusTrace = await page.evaluate(() => new Promise(resolve => {
        const label = document.querySelector('#tm-volume-options-normalization-status');
        const captures = window.__normalizationCaptures;
        const states = [label.textContent];
        const observer = new MutationObserver(() => {
          if (states.at(-1) !== label.textContent) states.push(label.textContent);
        });
        observer.observe(label, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve({ states, captureRestarts: window.__normalizationCaptures - captures });
        }, 2400);
      }));
      assert.ok(statusTrace.states.every(state => state.startsWith('Active')), `continuous audio status trace: ${JSON.stringify(statusTrace)}`);
      assert.equal(statusTrace.captureRestarts, 0, 'continuous audio keeps the same capture connection');
      // Tainted media must continue playing at ordinary volume after capture
      // fails. The route intentionally sends no Access-Control-Allow-Origin.
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = 'https://media.example.invalid/loud.wav'; await v.play(); });
      await page.waitForFunction(() => /unavailable|accessible/i.test(document.querySelector('#tm-volume-options-normalization-status').textContent), null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => document.querySelector('video').volume), preferred / 100);
      const before = await page.evaluate(() => document.querySelector('video').currentTime);
      await page.waitForFunction(time => document.querySelector('video').currentTime > time + .2, before);
      assert.deepEqual(errors, []);
      console.log(`${platform} at ${preferred}%: loud output ${(loudOutput * 100).toFixed(0)}%, quiet output ${(quietOutput * 100).toFixed(0)}%, remaining difference ${differenceDb.toFixed(2)} dB; stereo, mute/preference and CORS fallback passed`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
