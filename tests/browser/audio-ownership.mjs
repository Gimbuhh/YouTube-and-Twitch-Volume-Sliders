import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, launchFirefox } from '../helpers/browser.js';

// API contract observed in the official 7TV 1.10.5 package: create a second
// MediaElementAudioSourceNode, then route it through a DynamicsCompressorNode.
// Synthetic fixtures only; no extension installation, profile or live audio.
const directory = process.env.VOLUME_SLIDER_AUDIO_OWNERSHIP_DIST || fileURLToPath(new URL('../../dist/', import.meta.url));
const rate = 48000, wav = Buffer.alloc(44 + rate * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < rate * 2; i++) wav.writeInt16LE(Math.round(.05 * 32767 * Math.sin(2 * Math.PI * 997 * i / rate)), 44 + i * 2);
const browser = process.argv.includes('--firefox') ? await launchFirefox() : await launchChrome(['--autoplay-policy=no-user-gesture-required', '--mute-audio']);
try {
  for (const api of ['constructor', 'factory']) for (const first of ['normalizer', 'normalizer-starting', '7tv', '7tv-before-script']) {
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill(route.request().url().endsWith('.wav') ? { contentType: 'audio/wav', body: wav }
      : { contentType: 'text/html', body: `<!doctype html><style>.video-player{position:relative;width:900px;height:500px}video{width:900px;height:450px}[data-a-target="player-controls"],.player-controls__left-control-group,.player-controls__right-control-group{display:flex;height:40px}</style>
      <div class="video-player" data-a-target="player-overlay-click-handler"><video${first === 'normalizer-starting' ? '' : ' src="/tone.wav"'} loop></video><div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"><button data-a-target="player-mute-unmute-button">Mute</button></div></div><div class="player-controls__right-control-group"><button data-a-target="seventv-player-audio-compressor-button" aria-label="Enable 7TV Audio Compressor">Compressor</button><button data-a-target="player-settings-button" aria-label="Settings">Settings</button></div></div></div>
      <script>
      const current=()=>document.querySelector('video'),player=document.querySelector('.video-player');current().volume=.2;
      const api={getVolume:()=>current().volume,setVolume:v=>{current().volume=v},isMuted:()=>current().muted,setMuted:v=>{current().muted=v}};
      player.__reactFiber$fixture={return:{memoizedProps:{mediaPlayerInstance:api},return:null}};
      localStorage.setItem('tm-twitch-volume','20');localStorage.setItem('tm-twitch-muted','false');localStorage.setItem('tm-twitch-volume-slider-normalization','${first !== '7tv'}');
      const connect=AudioNode.prototype.connect;window.__taps=[];window.__contexts=[];
      AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination===this.context.destination){if(!window.__contexts.includes(this.context)){window.__contexts.push(this.context);const tap=this.context.createAnalyser();tap.fftSize=2048;window.__taps.push(tap)}connect.call(this,window.__taps[window.__contexts.indexOf(this.context)])}return result};
      window.__peak=()=>{let peak=0;const data=new Float32Array(2048);for(const tap of window.__taps){tap.getFloatTimeDomainData(data);for(const value of data)peak=Math.max(peak,Math.abs(value))}return peak};
      window.__sevenSource=null;window.__sevenTooltipCount=0;
      document.querySelector('[data-a-target="seventv-player-audio-compressor-button"]').addEventListener('mouseenter',()=>window.__sevenTooltipCount++);
      window.__enableSeven=async method=>{const context=new AudioContext();await context.resume();try{const source=method==='constructor'?new MediaElementAudioSourceNode(context,{mediaElement:current()}):context.createMediaElementSource(current());const compressor=context.createDynamicsCompressor();compressor.threshold.value=-50;source.connect(compressor);compressor.connect(context.destination);window.__sevenSource={context,source,compressor};document.querySelector('[data-a-target="seventv-player-audio-compressor-button"]').classList.add('is-active');return true}catch(error){window.__sevenError=error.name;await context.close();return false}};
      </script>` }));
    await page.goto('https://www.twitch.tv/audio-ownership-fixture');
    if (first === '7tv-before-script') assert.equal(await page.evaluate(method => window.__enableSeven(method), api), true);
    await page.addScriptTag({ content: await readFile(join(directory, 'twitch-volume-slider.user.js'), 'utf8') });
    if (first === 'normalizer-starting') {
      assert.equal(await page.evaluate(method => window.__enableSeven(method), api), false, 'normalization must reserve audio before capture becomes ready');
      assert.equal(await page.evaluate(() => window.__contexts.length), 0, 'priority does not wait for an audio graph');
      await page.waitForFunction(() => document.querySelector('[data-a-target="seventv-player-audio-compressor-button"]').disabled);
      await page.evaluate(() => { document.querySelector('video').src = '/tone.wav'; });
    }
    await page.evaluate(() => document.querySelector('video').play());
    const compressor = page.locator('[data-a-target="seventv-player-audio-compressor-button"]');
    const select = async value => {
      await page.locator('#tm-volume-slider-range').evaluate((slider, value) => {
        slider.value = String(value);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await page.waitForFunction(value => document.querySelector('#tm-volume-slider-value').textContent === value + '%', value);
    };
    if (first.startsWith('normalizer')) {
      await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status === 'Active' && window.__peak() > .001);
      assert.equal(await page.evaluate(method => window.__enableSeven(method), api), false, 'a second processor must not bypass selected volume');
      assert.equal(await page.evaluate(() => window.__sevenError), 'InvalidStateError');
      await page.waitForFunction(() => document.querySelector('[data-a-target="seventv-player-audio-compressor-button"]').disabled);
      assert.match(await compressor.getAttribute('aria-label'), /Reload with Auto-normalize volume off/);
      assert.equal(await compressor.getAttribute('title'), null);
      assert.equal(await compressor.getAttribute('data-tm-tooltip'), await compressor.getAttribute('aria-label'));
      await compressor.hover();
      await page.locator('#tm-volume-player-tooltip').waitFor();
      assert.equal(await page.locator('#tm-volume-player-tooltip').textContent(), await compressor.getAttribute('aria-label'));
      await page.mouse.move(0, 0);
      await compressor.dispatchEvent('mouseenter');
      assert.equal(await page.evaluate(() => window.__sevenTooltipCount), 0, '7TV cannot show its stale requested-state tooltip');
      // 7TV can rewrite its button after a failed auto-enable attempt.
      await compressor.evaluate(button => { button.disabled = false; button.setAttribute('aria-label', 'Disable 7TV Audio Compressor'); button.replaceChildren(document.createElement('span')); });
      await page.waitForFunction(() => document.querySelector('[data-a-target="seventv-player-audio-compressor-button"]').disabled);
      assert.match(await compressor.getAttribute('aria-label'), /Volume Slider controls audio/);
    } else {
      if (first === '7tv') assert.equal(await page.evaluate(method => window.__enableSeven(method), api), true);
      await page.waitForFunction(() => window.__peak() > .001);
      await page.locator('#tm-volume-options-button').click();
      await page.locator('#tm-volume-options-normalization').check();
      await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status === 'Another audio processor is active — normal volume');
      assert.match(await page.locator('#tm-volume-options-normalization-details').textContent(), /Turn off.*then reload/);
      assert.equal(await compressor.isEnabled(), true, 'the first owner keeps its own controls');
      assert.equal(await page.evaluate(() => window.__contexts.length), 1, 'no parallel normalization graph is created');
    }
    await select(0);
    await page.waitForFunction(() => window.__peak() < 1e-7);
    await select(40);
    await page.waitForFunction(() => window.__peak() > .001);
    assert.equal(await page.evaluate(() => localStorage.getItem('tm-twitch-volume')), '40');
    await page.evaluate(() => { document.querySelector('video').muted = true; });
    await page.waitForFunction(() => window.__peak() < 1e-7);
    await page.evaluate(() => { document.querySelector('video').muted = false; });
    await page.waitForFunction(() => window.__peak() > .001);
    if (first.startsWith('normalizer')) {
      await page.locator('#tm-volume-options-button').click();
      await page.locator('#tm-volume-options-normalization').uncheck();
      await page.waitForFunction(() => document.querySelector('video').volume === .4 && window.__peak() > .001);
      assert.equal(await compressor.isEnabled(), false, 'retained media attachment still requires reload before another processor');
      assert.equal(await page.evaluate(method => window.__enableSeven(method), api), false);
      await page.locator('#tm-volume-options-normalization').check();
      await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status === 'Active');
      await page.evaluate(() => { const video = document.querySelector('video'); video.src = '/restart.wav'; video.load(); video.play(); });
    } else {
      await page.evaluate(async () => {
        const old = document.querySelector('video'); old.pause(); await window.__sevenSource.context.close();
        const next = old.cloneNode(); old.replaceWith(next); await next.play();
      });
    }
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status === 'Active' && window.__peak() > .001);
    await page.waitForFunction(() => document.querySelector('[data-a-target="seventv-player-audio-compressor-button"]').disabled);
    assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), '40');
    // Ownership protection must not block unrelated media elements.
    assert.equal(await page.evaluate(async () => {
      const audio = document.createElement('audio'); audio.src = '/other.wav'; document.body.append(audio);
      const context = new AudioContext(); context.createMediaElementSource(audio); await context.close(); audio.remove(); return true;
    }), true);
    assert.deepEqual(errors, []);
    console.log(`${browser.browserType().name()}/${api}/${first}-first: exclusive audio, 0–40% volume, mute, restart and button explanation passed`);
    await context.close();
  }
} finally { await browser.close(); }
