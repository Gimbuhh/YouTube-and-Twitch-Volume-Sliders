import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchFirefox } from '../helpers/browser.js';
import { checkIdleResumeRace } from '../helpers/resume-race.mjs';

const directory = process.env.VOLUME_SLIDER_FIREFOX_RESULTS || join(tmpdir(), 'volume-slider-firefox-checks');
await mkdir(directory, { recursive: true });
const rate = 48000, samples = rate * 12, audio = Buffer.alloc(44 + samples * 2);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(rate, 24); audio.writeUInt32LE(rate * 2, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const time = i / rate, amplitude = time >= 2 && time < 2.3 ? .95 : .05;
  audio.writeInt16LE(Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * 997 * time)), 44 + i * 2);
}
const browser = await launchFirefox();
const results = [];
try {
  for (const platform of ['youtube', 'twitch']) {
    const youtube = platform === 'youtube', prefix = youtube ? 'yt' : 'twitch';
    const context = await browser.newContext({ viewport: { width: 1100, height: 760 } }), page = await context.newPage();
    const errors = new Set();
    page.on('pageerror', error => errors.add(error.message));
    const controls = youtube
      ? '<div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div>'
      : '<div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings">Settings</button></div></div>';
    const html = `<!doctype html><style>body{margin:0;background:#111;color:white}#movie_player,.video-player{position:relative;width:900px;height:500px}video{width:900px;height:450px}.ytp-left-controls,.ytp-right-controls,[data-a-target="player-controls"],.player-controls__left-control-group,.player-controls__right-control-group{display:flex;align-items:center;height:40px}
      /* Match the native right-anchored controls: collapsing the volume pill
         must not move Settings between pointerdown and pointerup. */
      [data-a-target="player-controls"]{justify-content:space-between}</style>
      <div ${youtube ? 'id="movie_player"' : 'class="video-player" data-a-target="player-overlay-click-handler"'}><video src="/audio.wav" loop></video>${controls}</div><script>
      const video=document.querySelector('video'),player=video.parentElement;video.volume=.2;
      const api={getVolume:()=>video.volume*${youtube ? 100 : 1},setVolume:v=>{video.volume=v/${youtube ? 100 : 1}},isMuted:()=>video.muted,mute:()=>{video.muted=true},unMute:()=>{video.muted=false},setMuted:v=>{video.muted=v}};
      ${youtube ? 'Object.assign(player,api)' : 'player.__reactFiber$fixture={return:{memoizedProps:{mediaPlayerInstance:api},return:null}}'};
      localStorage.setItem('tm-${prefix}-volume','20');localStorage.setItem('tm-${prefix}-muted','false');localStorage.setItem('tm-${prefix}-volume-slider-normalization','true');
      localStorage.setItem('tm-${prefix}-volume-slider-step','5');
      const connect=AudioNode.prototype.connect;window.__contexts=[];window.__taps=[];
      AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination===this.context.destination){if(!window.__contexts.includes(this.context)){window.__contexts.push(this.context);window.__tap=this.context.createAnalyser();window.__tap.fftSize=2048;window.__taps.push(window.__tap)}connect.call(this,window.__tap)}return result};
      window.__peak=()=>{let peak=0;const data=new Float32Array(2048);for(const tap of window.__taps){tap.getFloatTimeDomainData(data);for(const sample of data)peak=Math.max(peak,Math.abs(sample))}return peak};
      </script>`;
    await page.route('**/*', route => route.fulfill(route.request().url().endsWith('.wav')
      ? { contentType: 'audio/wav', body: audio } : { contentType: 'text/html', body: html }));
    await page.goto(youtube ? 'https://www.youtube.com/watch?v=firefox-fixture' : 'https://www.twitch.tv/firefox-fixture');
    await page.addScriptTag({ content: await readFile(new URL(`../../dist/${platform}-volume-slider.user.js`, import.meta.url), 'utf8') });
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status === 'Active' && window.__peak() > .001).catch(async error => {
      console.error(JSON.stringify({ platform, errors, ...await page.evaluate(() => {
        const video = document.querySelector('video');
        return { status: document.documentElement.dataset.tmAudioNormalization, peak: window.__peak(),
          media: { time: video.currentTime, paused: video.paused, muted: video.muted, volume: video.volume, ready: video.readyState, error: video.error?.message },
          contexts: window.__contexts.map(context => ({ state: context.state, time: context.currentTime, rate: context.sampleRate })) };
      }) }));
      throw error;
    });
    const levels = [], playbackDeadline = Date.now() + 10000;
    while (await page.evaluate(() => document.querySelector('video').currentTime < 3.5)) {
      assert.ok(Date.now() < playbackDeadline, `${platform}: playback stopped advancing`);
      levels.push(await page.evaluate(() => ({ peak: window.__peak(), status: JSON.parse(document.documentElement.dataset.tmAudioNormalization).status })));
      await page.waitForTimeout(30);
    }
    const before = await page.evaluate(() => ({ status: JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}'),
      peak: window.__peak(), volume: document.querySelector('video').volume,
      slider: document.querySelector('#tm-volume-slider-range').value, label: document.querySelector('#tm-volume-slider-value').textContent,
      gradient: document.querySelector('.tm-slider-track').style.background, hold: typeof AudioParam.prototype.cancelAndHoldAtTime }));
    await page.locator('.tm-volume-icon-cell').hover();
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ status: JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}'),
      peak: window.__peak(), slider: document.querySelector('#tm-volume-slider-range').value,
      label: document.querySelector('#tm-volume-slider-value').textContent, gradient: document.querySelector('.tm-slider-track').style.background }));
    const overlay = page.locator('#tm-volume-slider-overlay');
    await overlay.screenshot({ path: join(directory, `${platform}.png`) });
    const result = { platform, firefox: browser.version(), before, after, minPeak: Math.min(...levels.map(x => x.peak)),
      maxPeak: Math.max(...levels.map(x => x.peak)), statuses: [...new Set(levels.map(x => x.status))] };
    results.push(result);
    await page.evaluate(() => { document.querySelector('video').muted = true; });
    await page.waitForFunction(() => window.__peak() < 1e-7);
    await page.evaluate(() => { document.querySelector('video').muted = false; });
    await page.waitForFunction(() => window.__peak() > .001);
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForFunction(() => window.__contexts[0].state === 'suspended');
    const pausedTime = await page.evaluate(() => window.__contexts[0].currentTime);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__contexts[0].currentTime), pausedTime, 'paused DSP kept rendering');
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForFunction(() => window.__contexts[0].state === 'running');
    await page.waitForFunction(() => window.__peak() > .001);
    await page.evaluate(() => { const video = document.querySelector('video'); video.src = '/restart.wav'; video.load(); video.play(); });
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status === 'Active' && window.__peak() > .001);
    await page.locator('#tm-volume-options-button').click();
    await page.locator('#tm-volume-options-normalization').uncheck();
    await page.waitForFunction(() => !document.documentElement.dataset.tmAudioNormalization && document.querySelector('video').volume === .25 && window.__peak() > .001);
    await checkIdleResumeRace(page, '__contexts');
    await page.locator('#tm-volume-options-normalization').check();
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status === 'Active' && window.__peak() > .001);
    result.errors = [...errors];
    result.lifecycle = 'mute, pause, source restart, disable and re-enable passed';
    console.log(JSON.stringify(result));
    await context.close();
  }
  for (const result of results) {
    assert.deepEqual(result.errors, [], `${result.platform}: browser errors`);
    assert.equal(result.before.status.status, 'Active');
    assert.ok(result.before.peak > .001, `${result.platform}: processed output was silent`);
    assert.deepEqual(result.statuses, ['Active'], `${result.platform}: continuous audio lost processing`);
    assert.ok(result.minPeak > .001, `${result.platform}: output cut out`);
    assert.ok(result.maxPeak <= .2 * 10 ** (-10 / 20) + .001, `${result.platform}: sample ceiling exceeded`);
    assert.equal(result.after.slider, '25');
    assert.equal(result.after.label, '25%');
    assert.notEqual(result.after.gradient, result.before.gradient, `${result.platform}: wheel did not redraw the track`);
  }
} finally {
  await browser.close();
  await writeFile(join(directory, 'results.json'), JSON.stringify(results, null, 2));
}
