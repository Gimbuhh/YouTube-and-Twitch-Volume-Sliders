import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { launchChrome } from '../helpers/browser.js';
import { checkIdleResumeRace } from '../helpers/resume-race.mjs';

const directory = process.argv[2] || fileURLToPath(new URL('../../dist/', import.meta.url));
const resultsDirectory = process.env.VOLUME_SLIDER_NORMALIZATION_RESULTS || join(tmpdir(), 'volume-slider-native-checks');
await mkdir(resultsDirectory, { recursive: true });
const rate = 48000, count = rate * 12;
const wav = Buffer.alloc(44 + count * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 4, 40);
for (let i = 0; i < count; i++) {
  const time = i / rate, level = time >= 2 && time < 2.3 ? .95 : .05;
  const value = Math.round(level * 32767 * Math.sin(2 * Math.PI * 997 * time));
  wav.writeInt16LE(value, 44 + i * 4); wav.writeInt16LE(-value, 46 + i * 4);
}
const monoWav = Buffer.alloc(44 + count * 2); wav.copy(monoWav, 0, 0, 44);
monoWav.writeUInt32LE(monoWav.length - 8, 4); monoWav.writeUInt16LE(1, 22); monoWav.writeUInt32LE(rate * 2, 28);
monoWav.writeUInt16LE(2, 32); monoWav.writeUInt32LE(count * 2, 40);
for (let i = 0; i < count; i++) monoWav.writeInt16LE(wav.readInt16LE(44 + i * 4), 44 + i * 2);
const browser = await launchChrome(['--autoplay-policy=no-user-gesture-required', '--disable-background-networking', '--mute-audio']);
const results = [];
try {
  for (const platform of ['youtube', 'twitch']) for (const mode of ['worklet', 'native', 'compensated', 'csp', 'unavailable', 'activation']) {
    const native = mode !== 'worklet';
    const compensation = mode === 'compensated' ? .54 : 1;
    const youtube = platform === 'youtube', origin = youtube ? 'https://www.youtube.com' : 'https://www.twitch.tv', prefix = youtube ? 'yt' : 'twitch';
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    const controls = youtube ? '<div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div>'
      : '<div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings">Settings</button></div></div>';
    const html = `<!doctype html><html><head><style>body{background:#111;color:#fff}#movie_player,.video-player{position:relative;width:900px;height:506px}video{width:900px;height:450px}.ytp-left-controls,.ytp-right-controls{display:inline-flex}</style></head><body>
    <div ${youtube ? 'id="movie_player"' : 'class="video-player" data-a-target="player-overlay-click-handler"'}><video class="html5-main-video" src="/audio.wav" loop></video>${controls}</div>
    <script>
    const video=document.querySelector('video'),player=video.parentElement;video.volume=.3;
    const current=()=>document.querySelector('video');
    const capture=HTMLMediaElement.prototype.captureStream;window.__captures=[];
    HTMLMediaElement.prototype.captureStream=function(){const stream=capture.call(this);window.__captures.push(stream);return stream};
    let selectedVolume=.3;window.__volumeWrites=0;
    const api={getVolume:()=>${mode === 'compensated' ? 'selectedVolume' : 'current().volume'}*${youtube ? 100 : 1},setVolume:v=>{
      if(++window.__volumeWrites>80&&${mode === 'compensated'})throw new Error('Volume write feedback loop');
      selectedVolume=v/${youtube ? 100 : 1};current().volume=selectedVolume*${compensation};
    },isMuted:()=>current().muted,mute:()=>{current().muted=true},unMute:()=>{current().muted=false},setMuted:v=>{current().muted=v}};
    ${youtube ? 'Object.assign(player,api)' : 'player.__reactFiber$fixture={return:{memoizedProps:{mediaPlayerInstance:api},return:null}}'};
    localStorage.setItem('tm-${prefix}-volume','30');localStorage.setItem('tm-${prefix}-volume-slider-normalization','true');
    ${mode === 'activation' ? "const BaseContext=AudioContext;window.AudioContext=class extends BaseContext{constructor(options){super(options);this.suspend();this.resume=()=>new Promise(()=>{})}};" : ''}
    const elementSource=AudioContext.prototype.createMediaElementSource;window.__elementSources=0;
    AudioContext.prototype.createMediaElementSource=function(video){window.__elementSources++;return elementSource.call(this,video)};
    const connect=AudioNode.prototype.connect;
    window.__graphContexts=[];
    AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination===this.context.destination){if(!window.__graphContexts.includes(this.context)){window.__graphContexts.push(this.context);const split=this.context.createChannelSplitter(2);window.__split=split;window.__taps=[this.context.createAnalyser(),this.context.createAnalyser()];for(let i=0;i<2;i++){window.__taps[i].fftSize=2048;connect.call(split,window.__taps[i],i)}}connect.call(this,window.__split)}return result};
    window.__peak=()=>{if(!window.__taps)return 0;const data=new Float32Array(2048);let peak=0;for(const tap of window.__taps){tap.getFloatTimeDomainData(data);for(const x of data)peak=Math.max(peak,Math.abs(x))}return peak};
    window.__lateAttackMessages=0;
    ${mode === 'worklet' ? "const MeterNode=AudioWorkletNode;window.AudioWorkletNode=class extends MeterNode{constructor(...args){super(...args);let measured=false;this.port.addEventListener('message',({data})=>{if(data.attackPower!=null){if(measured)window.__lateAttackMessages++}else if(data.rawPower>=1e-9&&data.power>=1e-9)measured=true})}};" : ''}
    ${mode === 'native' || mode === 'compensated' || mode === 'unavailable' ? 'window.AudioWorkletNode=undefined;' : ''}
    ${mode === 'worklet' ? 'window.MediaStreamTrackProcessor=undefined;' : ''}
    ${mode === 'unavailable' ? 'window.MediaStreamTrackProcessor=undefined;' : ''}
    </script></body></html>`;
    await page.route('**/*', async route => route.fulfill(route.request().url().includes('.wav')
      ? { contentType: 'audio/wav', body: mode === 'native' ? monoWav : wav } : { contentType: 'text/html', body: html,
        headers: mode === 'csp' ? { 'content-security-policy': `script-src 'unsafe-inline' 'unsafe-eval' ${origin}; worker-src 'none'` } : {} }));
    await page.goto(origin + (youtube ? '/watch?v=local-lookahead' : '/local-lookahead'));
    await page.addScriptTag({ content: await readFile(join(directory, `${platform}-volume-slider.user.js`), 'utf8') });
    await page.evaluate(() => document.querySelector('video').play());
    if (mode === 'unavailable' || mode === 'activation') {
      await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status?.startsWith('Audio unavailable'));
      await page.waitForFunction(() => document.querySelector('video').volume === .3, null, { timeout: 1000 });
      assert.equal(await page.evaluate(() => document.querySelector('video').volume), .3);
      if (mode === 'activation') assert.equal(await page.evaluate(() => window.__elementSources), 0, 'blocked activation diverted native audio');
      else await page.waitForFunction(() => window.__peak() > .001);
      assert.deepEqual(errors, []);
      results.push({ platform, mode, result: 'ordinary playback restored with unavailable status' });
      console.log(`${platform}/${mode}: ordinary playback restored with unavailable status`);
      await context.close(); continue;
    }
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status?.startsWith('Active'), { timeout: 10000 });
    await page.waitForFunction(() => window.__peak() > .001);
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').metrics?.gain > .001);
    const active = await page.evaluate(() => ({ ...JSON.parse(document.documentElement.dataset.tmAudioNormalization), nativeVolume: document.querySelector('video').volume,
      preferred: document.querySelector('#tm-volume-slider-value')?.textContent, peak: window.__peak() }));
    assert.equal(active.selected, 30); assert.equal(active.nativeVolume, compensation); assert.ok(active.peak > 0);
    if (mode === 'compensated') {
      assert.ok(await page.evaluate(() => window.__volumeWrites) <= 6, 'site compensation flooded volume writes');
      const writes = await page.evaluate(() => window.__volumeWrites);
      await page.evaluate(() => { document.querySelector('video').volume = .43; });
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => window.__volumeWrites), writes, 'compensation changes must not restart volume writes');
      assert.equal(await page.evaluate(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization).status), 'Active');
      assert.equal(await page.locator('#tm-volume-slider-value').textContent(), '30%');
    }
    assert.equal(active.backend, 'native graph');
    assert.equal(active.metrics.meterBackend, native ? 'native frames' : 'audio worklet');
    let peak = 0;
    while (await page.evaluate(() => document.querySelector('video').currentTime < 2.6)) {
      peak = Math.max(peak, await page.evaluate(() => window.__peak()));
      await page.waitForTimeout(15);
    }
    assert.ok(peak <= .3 * 10 ** (-10 / 20) + .001, `audible peak exceeded ceiling: ${peak}`);
    await page.evaluate(() => { document.querySelector('video').muted = true; });
    await page.waitForFunction(() => window.__peak() < 1e-7);
    await page.evaluate(() => { document.querySelector('video').muted = false; });
    await page.waitForFunction(() => window.__peak() > .001);
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForFunction(() => window.__graphContexts[0].state === 'suspended');
    const pausedTime = await page.evaluate(() => window.__graphContexts[0].currentTime);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__graphContexts[0].currentTime), pausedTime, 'paused DSP kept rendering');
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForFunction(() => window.__graphContexts[0].state === 'running');
    await page.waitForFunction(() => window.__peak() > .001);
    await page.evaluate(() => { const slider=document.querySelector('#tm-volume-slider-range');slider.value='40';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true})); });
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').selected === 40);
    await page.evaluate(twitch => {
      const video = document.querySelector('video');
      if (twitch) {
        localStorage.setItem('tm-twitch-muted', 'false');
        const label = document.querySelector('#tm-volume-slider-value');
        window.__restartLabels = [label.textContent];
        window.__restartLabelObserver = new MutationObserver(() => window.__restartLabels.push(label.textContent));
        window.__restartLabelObserver.observe(label, { childList: true, characterData: true, subtree: true });
        // Worker/player initialization can mute after metadata restoration.
        video.addEventListener('loadedmetadata', () => { video.muted = true; }, { once: true });
      }
      video.src = '/replacement.wav'; video.load(); video.play();
    }, !youtube);
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status?.startsWith('Active'));
    await page.waitForFunction(() => window.__peak() > .001);
    assert.equal(await page.evaluate(() => document.querySelector('video').volume), compensation);
    assert.equal(await page.evaluate(() => document.querySelector('video').muted), false, 'source restart remained muted');
    assert.equal(await page.locator('#tm-volume-slider-value').textContent(), '40%', 'source restart left a stale mute indicator');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), 'tm-' + prefix + '-volume'), '40');
    if (!youtube) {
      const labels = await page.evaluate(() => {
        window.__restartLabelObserver.disconnect();
        return [...new Set(window.__restartLabels)];
      });
      assert.deepEqual(labels, ['40%'], 'an initialization mute flashed in the volume indicator');
      await page.evaluate(() => {
        const video = document.querySelector('video');
        localStorage.setItem('tm-twitch-muted', 'true'); video.muted = true;
        video.addEventListener('loadedmetadata', () => { video.muted = false; }, { once: true });
        video.src = '/muted-replacement.wav'; video.load(); video.play();
      });
      await page.waitForFunction(() => document.querySelector('video').readyState >= 2 && !document.querySelector('video').paused &&
        JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status === 'Waiting for audio');
      await page.waitForFunction(() => window.__peak() < 1e-7);
      assert.equal(await page.evaluate(() => document.querySelector('video').muted), true, 'source restart lost a deliberate mute');
      assert.equal(await page.locator('#tm-volume-slider-value').textContent(), 'Muted');
      // Resume with an explicit mute-button action and verify its saved choice.
      await page.evaluate(() => {
        const button = document.createElement('button'); button.dataset.aTarget = 'player-mute-unmute-button';
        button.onclick = () => { document.querySelector('video').muted = false; };
        document.querySelector('.video-player').append(button); button.click(); button.remove();
      });
      await page.waitForFunction(() => window.__peak() > .001);
      assert.equal(await page.evaluate(() => localStorage.getItem('tm-twitch-muted')), 'false');
      assert.equal(await page.locator('#tm-volume-slider-value').textContent(), '40%');
    }
    if (mode === 'worklet') {
      await page.evaluate(() => Object.defineProperty(window.__captures.at(-1).getAudioTracks()[0], 'muted', { configurable:true, value:true }));
      await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status?.startsWith('Audio unavailable'));
      await page.waitForFunction(() => document.querySelector('video').volume === .4, null, { timeout: 1000 });
      assert.equal(await page.evaluate(() => document.querySelector('video').volume), .4);
      await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status?.startsWith('Active'));
      await page.waitForFunction(() => window.__peak() > .001);
    }
    await page.evaluate(() => { const slider=document.querySelector('#tm-volume-slider-range');slider.value='0';slider.dispatchEvent(new Event('input',{bubbles:true})); });
    await page.waitForFunction(() => window.__peak() < 1e-7);
    await page.evaluate(() => { const slider=document.querySelector('#tm-volume-slider-range');slider.value='40';slider.dispatchEvent(new Event('input',{bubbles:true})); });
    await page.waitForFunction(() => window.__peak() > .001);
    await page.evaluate(() => document.querySelector('#tm-volume-options-button').click());
    await page.locator('#tm-volume-options-normalization').uncheck();
    await page.waitForFunction(factor => !document.documentElement.dataset.tmAudioNormalization && document.querySelector('video').volume === .4 * factor, compensation);
    await page.waitForFunction(() => window.__peak() > .001);
    await checkIdleResumeRace(page, '__graphContexts');
    await page.locator('#tm-volume-options-normalization').check();
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status?.startsWith('Active'));
    await page.waitForFunction(() => window.__peak() > .001);
    assert.equal(await page.evaluate(() => window.__elementSources), 1, 'the same media element was attached twice');
    assert.equal(await page.evaluate(() => window.__graphContexts.length), 1, 'source resets leaked contexts');
    await page.evaluate(() => { const old=document.querySelector('video');old.pause();const next=old.cloneNode();old.replaceWith(next);next.play(); });
    await page.waitForFunction(() => window.__elementSources === 2 && JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}').status?.startsWith('Active'));
    await page.waitForFunction(() => window.__peak() > .001);
    assert.equal(await page.evaluate(() => window.__graphContexts.length), 1, 'replacement elements leaked contexts');
    assert.equal(await page.evaluate(() => window.__lateAttackMessages), 0, 'opening-only measurements kept waking the page after startup');
    assert.deepEqual(errors, []);
    results.push({ platform, mode, backend: active.backend, peak, active, controls: 'mute/unmute/pause/resume/preference/source restart/zero/disable cleanup passed' });
    console.log(`${platform}/${mode}: live graph, peak protection and controls passed`);
    await context.close();
  }
} finally { await browser.close(); await writeFile(join(resultsDirectory, 'browser-results.json'), JSON.stringify(results, null, 2)); }
