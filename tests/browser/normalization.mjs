import assert from 'node:assert/strict';
import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createLufsMeter } from '../../src/shared/lufs-meter.js';

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

function wav(amplitude, channels = 1, frequency = 440) {
  const rate = 48000, count = rate * 15;
  const bytes = Buffer.alloc(44 + count * channels * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(count * channels * 2, 40);
  for (let i = 0; i < count; i++) {
    const level = typeof amplitude === 'function' ? amplitude(i / rate) : amplitude;
    const sample = Math.round(32767 * level * Math.sin(2 * Math.PI * frequency * i / rate));
    for (let channel = 0; channel < channels; channel++) bytes.writeInt16LE(channel === 1 ? -sample : sample, 44 + (i * channels + channel) * 2);
  }
  return bytes;
}

const loud = wav(0.7), quiet = wav(0.06), stereo = wav(0.7, 2);
// Allow native capture to establish boost before testing the loud return.
// The required pre-onset boost and post-onset deadlines stay unchanged.
const burstOnset = 5;
const burst = wav(time => time < burstOnset ? 0.06 : 0.7);
const screamReturn = wav(time => time >= 4 && time < 4.5 ? .7 : .1);
const silentStart = wav(time => time < .8 ? 0 : .7);
// An ordinary background only 5 LU below speech catches reference loss that
// the previous very quiet background (20 LU below speech) did not expose.
const speechReturn = wav(time => time < 4 || time >= 9 ? .2 : .2 * 10 ** (-5 / 20));
const speechWords = wav(time => {
  const phase = time % .4;
  return phase < .005 ? .45 : phase < .15 ? .2 : phase < .35 ? .06 : 0;
}, 1, 1000);
// Continuous audible tone with a changing envelope, never digital silence.
const soft = wav(time => 0.016 + 0.012 * Math.sin(2 * Math.PI * time));
const bass = wav(0.2, 1, 80), high = wav(0.2, 1, 4000);
// Place a barely varying real tone at a native rounding boundary. Calibrate
// its energy for the existing mono-to-stereo analysis contract, not for latency.
function roundingFixture(preferred) {
  const signal = Float32Array.from({ length: 48000 }, (_, i) => .1 * Math.sin(2 * Math.PI * 1000 * i / 48000));
  let power;
  createLufsMeter(48000).process([signal, signal], frame => { power = frame.power; });
  const boundary = preferred === 30 ? 5.5 : 7.5;
  const amplitude = .1 * Math.sqrt(10 ** ((-18 + .691) / 10) / power) * preferred / boundary;
  return wav(time => amplitude * 10 ** ((.05 * Math.sin(2 * Math.PI * time / 8) - .02) / 20), 1, 1000);
}
const audioFixtures = new Map([
  ['/loud.wav', loud], ['/quiet.wav', quiet], ['/stereo.wav', stereo],
  ['/burst.wav', burst], ['/scream-return.wav', screamReturn],
  ['/silent-start.wav', silentStart], ['/speech-return.wav', speechReturn],
  ['/speech-words.wav', speechWords], ['/soft.wav', soft],
  ['/bass.wav', bass], ['/high.wav', high]
]);
const browser = await chromium.launch({ headless: true, executablePath, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-networking', '--no-first-run'] });
const attackResults = [];
const startupResults = [];
try {
  const cases = ['youtube', 'twitch'].flatMap(platform => [30, 40].map(preferred => [platform, preferred, 'lufs']));
  cases.push(['youtube', 30, 'csp'], ['twitch', 40, 'native'], ['twitch', 40, 'unsupported']);
  cases.push(['youtube', 30, 'csp-suspended'], ['twitch', 40, 'native-suspended'], ['youtube', 30, 'worklet-suspended']);
  cases.push(['youtube', 30, 'lufs-retry'], ['twitch', 40, 'native-retry']);
  cases.push(['youtube', 30, 'csp-startup'], ['youtube', 30, 'lufs-startup'], ['twitch', 40, 'lufs-startup'], ['twitch', 40, 'native-startup']);
  cases.push(['youtube', 30, 'lufs-navigation'], ['youtube', 30, 'csp-navigation']);
  cases.push(['twitch', 40, 'lufs-restart'], ['twitch', 40, 'native-restart']);
  cases.push(['youtube', 30, 'lufs-arrival'], ['youtube', 30, 'csp-arrival']);
  const selectedCases = process.env.VOLUME_SLIDER_NORMALIZATION_CASES?.split(',');
  const startupRepeats = Number(process.env.VOLUME_SLIDER_STARTUP_REPEATS || 1);
  const navigationRepeats = Number(process.env.VOLUME_SLIDER_NAVIGATION_REPEATS || 1);
  const startupLeadMs = Number(process.env.VOLUME_SLIDER_STARTUP_LEAD_MS || 0);
  assert.ok(Number.isInteger(startupRepeats) && startupRepeats >= 1 && startupRepeats <= 20);
  assert.ok(Number.isInteger(navigationRepeats) && navigationRepeats >= 1 && navigationRepeats <= 20);
  assert.ok(Number.isFinite(startupLeadMs) && startupLeadMs >= 0 && startupLeadMs <= 1000);
  for (const [platform, preferred, engine] of cases.filter(parts => !selectedCases || selectedCases.includes(parts.join('/')))
    .flatMap(parts => Array.from({length: parts[2].endsWith('-startup') ? startupRepeats : parts[2].endsWith('-navigation') ? navigationRepeats : 1}, () => parts))) {
    const youtube = platform === 'youtube';
    audioFixtures.set('/rounding.wav', roundingFixture(preferred));
    const suspended = engine.endsWith('-suspended');
    const retrying = engine.endsWith('-retry');
    const startup = engine.endsWith('-startup');
    const navigation = engine.endsWith('-navigation');
    const restarting = engine.endsWith('-restart');
    const arrival = engine.endsWith('-arrival');
    const prefix = youtube ? 'yt' : 'twitch';
    const origin = youtube ? 'https://www.youtube.com' : 'https://www.twitch.tv';
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const artifact = await readFile(process.env.VOLUME_SLIDER_NORMALIZATION_DIST
      ? join(process.env.VOLUME_SLIDER_NORMALIZATION_DIST, `${platform}-volume-slider.user.js`)
      : new URL(`../../dist/${platform}-volume-slider.user.js`, import.meta.url), 'utf8');
    const player = youtube
      ? '<div id="movie_player"><video class="html5-main-video" src="/loud.wav" loop></video><div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div></div>'
      : '<div class="video-player" data-a-target="player-overlay-click-handler"><video src="/loud.wav" loop></video><div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings">Settings</button></div></div></div>';
    let completeDocument;
    const documentGate = new Promise(resolve => { completeDocument = resolve; });
    const html = `<!doctype html><html><head><style>
      body{margin:20px;background:#111;color:white;font-family:Arial}#movie_player,.video-player{position:relative;width:900px;height:506px;background:#222}
      video{width:900px;height:466px}.ytp-left-controls,.ytp-right-controls{position:absolute;bottom:0;height:40px;display:flex;align-items:center}.ytp-left-controls{left:0}.ytp-right-controls{right:0}
      [data-a-target="player-controls"]{display:flex;align-items:center;justify-content:space-between;height:40px}.player-controls__left-control-group,.player-controls__right-control-group{display:flex;align-items:center}
      .ytp-volume-area,[data-a-target="player-volume-slider"]{width:80px;height:40px}
    </style></head><body>${player}<script>
      const video = document.querySelector('video'); video.volume = ${preferred / 100};
      const player = video.parentElement;
      window.__startupControls = [];
      if (${startup}) {
        window.__startupControls = [...player.querySelectorAll(${JSON.stringify(youtube ? '.ytp-left-controls, .ytp-right-controls' : '[data-a-target="player-controls"]')})];
        for (const control of window.__startupControls) control.remove();
      }
      video.addEventListener('playing', () => {
        window.__startupPlayingAt = performance.now();
        window.__startupPlayingVolume = video.volume;
      }, {once:true});
      video.addEventListener('volumechange', () => {
        if (${startup} && window.__startupCorrectionAt == null && video.volume > 0 && video.volume < ${preferred / 100 * .35}) window.__startupCorrectionAt = performance.now();
      });
      window.__startupWrites = [];
      let apiVolume = ${preferred / 100};
      const api = {getVolume:()=>(${arrival} ? apiVolume : video.volume) * ${youtube ? 100 : 1},setVolume:v=>{
        const output=v / ${youtube ? 100 : 1};
        if (${arrival}) { apiVolume=output; setTimeout(()=>{video.volume=output},80); }
        else video.volume=output;
        if (${startup || navigation || arrival}) window.__startupWrites.push({volume:output,measured:window.__lufsSeconds,time:performance.now(),mediaTime:video.currentTime,frame:window.__lastProgrammeFrame});
      },isMuted:()=>video.muted,mute:()=>{video.muted=true},unMute:()=>{video.muted=false},setMuted:v=>{video.muted=v}};
      ${youtube ? 'Object.assign(player,api);' : 'player.__reactFiber$fixture={return:{memoizedProps:{mediaPlayerInstance:api},return:null}};'}
      localStorage.setItem('tm-${prefix}-volume','${preferred}');
      if (${suspended || retrying || startup || navigation || restarting || arrival}) localStorage.setItem('tm-${prefix}-volume-slider-normalization','true');
      AudioContext.prototype.createMediaElementSource = () => {throw new Error('Must never reroute original playback')};
      window.__normalizationCaptures = 0;
      window.__retryPlaybackEvents = 0;
      for (const type of ['playing', 'loadedmetadata']) video.addEventListener(type, () => window.__retryPlaybackEvents++);
      window.__normalizationStreams = [];
      window.__normalizationContexts = [];
      window.__normalizationTracks = [];
      window.__lufsSeconds = 0;
      window.__nativeFrames = 0;
      window.__lufsOutputs = [];
      const NativeWorklet = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends NativeWorklet {
        constructor(...args) {
          super(...args);
          window.__lufsOutputs.push(this.numberOfOutputs);
          this.port.addEventListener('message', event => {
            if (Number.isFinite(event.data.power)) {
              window.__lufsSeconds += event.data.duration;
              if (${navigation}) window.__lastProgrammeFrame = {power:event.data.power,rawPower:event.data.rawPower};
            }
          });
          this.port.start();
        }
      };
      const NativeProcessor = window.MediaStreamTrackProcessor;
      if (NativeProcessor) window.MediaStreamTrackProcessor = class extends NativeProcessor {
        constructor(...args) {
          super(...args);
          window.__normalizationTracks.push(args[0].track);
          const getReader = this.readable.getReader.bind(this.readable);
          this.readable.getReader = (...args) => {
            const reader = getReader(...args), read = reader.read.bind(reader);
            reader.read = async () => {
              const result = await read();
              if (!result.done) {
                window.__nativeFrames++;
                window.__lufsSeconds += result.value.numberOfFrames / result.value.sampleRate;
              }
              return result;
            };
            return reader;
          };
        }
      };
      if (${engine.startsWith('native') || engine === 'unsupported'}) window.AudioWorkletNode = undefined;
      if (${JSON.stringify(engine)} === 'unsupported') window.MediaStreamTrackProcessor = undefined;
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        constructor(...args) {
          super(...args);
          window.__normalizationContexts.push(this);
          if (${suspended}) this.suspend();
        }
        resume() {
          // Keep real native capture separate from blocked Web Audio activation.
          if (${suspended} && !window.__allowAudioResume) return Promise.resolve();
          return super.resume();
        }
        createMediaStreamSource(stream) {
          window.__normalizationTracks.push(...stream.getAudioTracks());
          return super.createMediaStreamSource(stream);
        }
      };
      const originalCapture = HTMLMediaElement.prototype.captureStream;
      HTMLMediaElement.prototype.captureStream = function(...args) {
        window.__normalizationCaptures++;
        if (${retrying} && !window.__captureReady) throw new DOMException('Player capture is not ready', 'InvalidStateError');
        const stream = originalCapture.apply(this,args);
        window.__normalizationStreams.push(stream);
        return stream;
      };
    </script><script>${artifact.replaceAll('</script>', '<\\/script>')}</script>${startup ? '<script src="/finish-document.js"></script>' : ''}</body></html>`;
    await page.route('**/*', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/finish-document.js') {
        return documentGate.then(() => route.fulfill({ contentType: 'text/javascript', body: 'document.querySelector("video").parentElement.append(...window.__startupControls);' }));
      }
      if (path.endsWith('.wav')) return route.fulfill({ status: 200, contentType: 'audio/wav', body: audioFixtures.get(path) ?? loud });
      // YouTube can send a policy without blob: in script-src. Reproduce the
      // actual module rejection, rather than mocking addModule's return value.
      const headers = engine.startsWith('csp') ? { 'Content-Security-Policy': "script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'" } : {};
      return route.fulfill({ status: 200, contentType: 'text/html', headers, body: html });
    });
    try {
      await page.goto(`${origin}/${arrival ? '' : youtube ? 'watch?v=normalization' : 'normalization'}`, {waitUntil: startup ? 'commit' : 'load'});
      if (arrival) {
        await page.evaluate(async () => {
          window.dispatchEvent(new Event('yt-navigate-start'));
          history.replaceState(null, '', '/watch?v=incoming');
          await document.querySelector('video').play();
        });
        assert.equal(await page.evaluate(() => window.__startupPlayingVolume), 0, 'actual media output is held before its first playing event');
        await page.waitForFunction(() => document.querySelector('video').currentTime > .4 && document.querySelector('video').volume > 0);
        const repaired = await page.evaluate(() => new Promise(resolve => {
          const v = document.querySelector('video');
          v.addEventListener('volumechange', () => queueMicrotask(() => resolve(v.volume)), {once:true});
          v.volume = .3;
        }));
        assert.ok(repaired <= preferred / 100 * .35, 'a stale native restoration is repaired after the first measurement too');
        assert.ok(await page.evaluate(maximum => window.__startupWrites.every(write => write.volume <= maximum), preferred / 100 * .35), 'no ordinary-volume command is queued before startup protection');
        await page.evaluate(() => window.dispatchEvent(new Event('yt-navigate-finish')));
        await page.locator('#tm-volume-options-button').click();
        await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent === 'Active');
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
        assert.equal(await page.evaluate(() => localStorage.getItem('tm-yt-volume')), String(preferred));
        await page.locator('#tm-volume-options-normalization').click();
        await page.waitForFunction(() => window.__normalizationContexts.every(context => context.state === 'closed'));
        assert.deepEqual(errors, []);
        console.log(`${platform} (${engine}): first playing event is silent before navigation completion; delayed API commands, stale native restoration, selection and cleanup passed`);
        continue;
      }
      if (restarting) {
        await page.evaluate(() => document.querySelector('video').play());
        await page.waitForFunction(preference => document.querySelector('video').volume > 0 && document.querySelector('video').volume < preference / 100 * .35, preferred);
        await page.locator('#tm-volume-options-button').click();
        await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent === 'Active');
        await page.waitForTimeout(2100);
        await page.evaluate(async () => { const v = document.querySelector('video'); v.muted = true; v.src = '/loud.wav'; await v.play(); });
        await page.waitForFunction(() => !document.querySelector('video').muted && document.querySelector('video').volume > 0 && document.querySelector('#tm-volume-options-normalization-status').textContent === 'Active');
        assert.equal(await page.evaluate(() => localStorage.getItem('tm-twitch-muted')), 'false');
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
        await page.locator('#tm-volume-slider-overlay .tm-volume-icon-cell').click();
        assert.equal(await page.evaluate(() => localStorage.getItem('tm-twitch-muted')), 'true');
        await page.evaluate(async () => { const v = document.querySelector('video'); v.muted = false; v.src = '/quiet.wav'; await v.play(); });
        await page.waitForFunction(() => document.querySelector('video').readyState >= 2 && document.querySelector('video').muted);
        assert.equal(await page.evaluate(() => localStorage.getItem('tm-twitch-muted')), 'true');
        await page.locator('#tm-volume-options-button').click();
        await page.locator('#tm-volume-options-normalization').click();
        await page.waitForFunction(() => window.__normalizationContexts.every(context => context.state === 'closed'));
        assert.equal(await page.evaluate(() => document.querySelector('video').muted), true);
        assert.equal(await page.evaluate(() => document.querySelector('video').volume), preferred / 100);
        assert.deepEqual(errors, []);
        console.log(`${platform} (${engine}): initialization mute after source restart restores saved intent; intentional mute, selected volume and cleanup passed`);
        continue;
      }
      if (navigation) {
        await page.waitForSelector('#tm-volume-options-button');
        await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/quiet.wav'; await v.play(); });
        await page.waitForFunction(preference => document.querySelector('video').volume > preference / 100 * 1.4, preferred);
        const oldCapture = await page.evaluate(() => window.__normalizationCaptures);
        await page.evaluate(() => window.dispatchEvent(new Event('yt-navigate-start')));
        assert.equal(await page.evaluate(() => document.querySelector('video').volume), 0);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
        assert.equal(await page.evaluate(() => document.querySelector('video').volume), 0, 'outgoing audio cannot release the transition hold');
        assert.equal(await page.evaluate(() => window.__normalizationCaptures), oldCapture, 'no outgoing recapture while navigation is pending');
        await page.evaluate(() => {
          history.replaceState(null, '', '/watch?v=reused');
          window.dispatchEvent(new Event('yt-navigate-finish'));
        });
        await page.waitForFunction(count => window.__normalizationCaptures === count + 1 && document.querySelector('video').volume > 0, oldCapture);
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
        // Real source loading may precede the SPA completion event. Silence
        // must not release ordinary volume while waiting for its first sound.
        await page.evaluate(async () => {
          window.dispatchEvent(new Event('yt-navigate-start'));
          window.__startupWrites = [];
          const v = document.querySelector('video'); v.src = '/silent-start.wav'; await v.play();
        });
        await page.waitForFunction(() => document.querySelector('video').currentTime >= .4);
        assert.equal(await page.evaluate(() => document.querySelector('video').volume), 0, 'healthy silent programme frames retain startup protection');
        await page.waitForFunction(() => document.querySelector('video').currentTime >= 1.1);
        const writes = await page.evaluate(() => window.__startupWrites);
        assert.ok(writes.some(write => write.volume > 0), 'the new source opens when its own sound is measurable');
        assert.ok(writes.every(write => write.volume <= preferred / 100 * .35), `the new loud source never receives ordinary output: ${JSON.stringify(writes)}`);
        await page.evaluate(() => window.dispatchEvent(new Event('yt-navigate-finish')));
        await page.locator('#tm-volume-options-button').click();
        await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent === 'Active');
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
        assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
        assert.equal(await page.evaluate(() => window.__nativeFrames > 0), engine.startsWith('csp'));
        await page.locator('#tm-volume-options-normalization').click();
        await page.waitForFunction(() => window.__normalizationContexts.every(context => context.state === 'closed'));
        assert.equal(await page.evaluate(() => document.querySelector('video').volume), preferred / 100);
        assert.deepEqual(errors, []);
        console.log(`${platform} (${engine}): reused-element navigation, silent decoder startup, first-sound correction, preference and cleanup passed`);
        continue;
      }
      if (startup) {
        const cdp = await context.newCDPSession(page);
        const read = async expression => {
          const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false });
          assert.ok(!result.exceptionDetails, result.exceptionDetails?.text);
          return result.result.value;
        };
        const wait = expression => read(`(async () => {
          const deadline = performance.now() + 4000;
          while (!(${expression})) {
            if (performance.now() > deadline) throw new Error('Early startup condition timed out');
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        })()`);
        await wait(`window.__normalizationContexts != null`);
        await wait(`document.querySelector('video').volume === 0`);
        if (startupLeadMs) {
          await read(`new Promise(resolve => setTimeout(resolve, ${startupLeadMs}))`);
        }
        await read(`document.querySelector('video').play()`);
        await wait(`window.__startupCorrectionAt != null`);
        assert.equal(await read(`document.readyState`), 'loading', 'analysis does not wait for DOMContentLoaded');
        assert.equal(await read(`!!document.querySelector('#tm-volume-slider-overlay')`), false, 'controls are still absent');
        assert.equal(await read(`navigator.userActivation.hasBeenActive`), false);
        const reaction = await read(`window.__startupCorrectionAt - window.__startupPlayingAt`);
        assert.ok(reaction >= 0 && reaction < 500, `early correction after ${reaction.toFixed(1)} ms of playing`);
        assert.equal(await read(`window.__startupPlayingVolume`), 0, 'playback begins with output held silent');
        await wait(`window.__lufsSeconds >= .1`);
        const writes = await read(`window.__startupWrites`);
        const hold = writes.findIndex(write => write.volume === 0);
        assert.ok(hold >= 0);
        assert.ok(writes.slice(hold).some(write => write.volume > 0), 'captured audio is available despite zero player output');
        assert.ok(writes.slice(hold).every(write => write.volume <= Math.max(1, Math.round(preferred * .1)) / 100
          || write.measured >= .05 && write.volume < preferred / 100 * .35),
          `startup never restores unmeasured output: ${JSON.stringify(writes)}`);
        const playingAt = await read('window.__startupPlayingAt');
        startupResults.push({platform, engine, reactionMs: reaction,
          audibleMs: writes.slice(hold).find(write => write.volume > 0).time - playingAt,
          matchedMs: writes.slice(hold).find(write => write.volume > Math.max(1, Math.round(preferred * .1)) / 100)?.time - playingAt,
          firstOutput: writes.slice(hold).find(write => write.volume > 0).volume});
        completeDocument();
        await page.waitForSelector('#tm-volume-options-button');
        assert.equal(await read(`window.__normalizationCaptures`), 1, 'controls retain the early capture');
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
        await page.locator('#tm-volume-options-button').click();
        await page.locator('#tm-volume-options-normalization').click();
        assert.equal(await read(`document.querySelector('video').volume`), preferred / 100);
        assert.ok(await read(`window.__normalizationTracks.length > 0 && window.__normalizationTracks.every(track => track.readyState === 'ended')`));
        assert.deepEqual(errors, []);
        console.log(`${platform} (${engine}): protected audio after ${reaction.toFixed(1)} ms, before controls/DOMContentLoaded, without input; one capture, preference and cleanup passed`);
        continue;
      }
      if (retrying) {
        const cdp = await context.newCDPSession(page);
        const evaluate = async expression => {
          const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false });
          assert.ok(!result.exceptionDetails, result.exceptionDetails?.text);
          return result.result.value;
        };
        await evaluate(`document.querySelector('video').play()`);
        const wait = async expression => evaluate(`(async () => {
          const deadline = performance.now() + 6000;
          while (!(${expression})) {
            if (performance.now() > deadline) throw new Error('Automatic recovery condition timed out');
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        })()`);
        await wait(`window.__normalizationCaptures > 0 && document.querySelector('video').currentTime > .2`);
        assert.equal(await evaluate(`navigator.userActivation.hasBeenActive`), false);
        const failedIconVisible = await evaluate(`!document.querySelector('.tm-normalization-icon').hidden`);
        const attempts = await evaluate(`window.__normalizationCaptures`);
        const playbackEvents = await evaluate(`window.__retryPlaybackEvents`);
        await evaluate(`window.__captureReady = true`);
        // No toggle, playback event, or trusted gesture triggers reconnection.
        await wait(`window.__lufsSeconds > .2 && document.querySelector('video').volume < ${preferred / 100 * .25}`);
        assert.equal(await evaluate(`navigator.userActivation.hasBeenActive`), false);
        assert.equal(await evaluate(`window.__normalizationCaptures`), attempts + 1);
        assert.equal(await evaluate(`window.__retryPlaybackEvents`), playbackEvents, 'recovery does not depend on a playback event');
        assert.equal(failedIconVisible, false, 'the failure hides the icon before recovery');
        assert.equal(await evaluate(`window.__nativeFrames > 0`), engine === 'native-retry');
        await page.locator('.tm-normalization-icon').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
        assert.equal(await evaluate(`localStorage.getItem('tm-${prefix}-volume')`), String(preferred));
        await page.locator('#tm-volume-options-button').click();
        assert.equal(await page.locator('#tm-volume-options-normalization').getAttribute('aria-checked'), 'true');
        await page.locator('#tm-volume-options-normalization').click();
        assert.equal(await page.locator('.tm-normalization-icon').isVisible(), false);
        await page.waitForFunction(() => window.__normalizationContexts.every(context => context.state === 'closed'));
        assert.ok(await evaluate(`window.__normalizationTracks.length > 0 && window.__normalizationTracks.every(track => track.readyState === 'ended')`));
        assert.equal(await evaluate(`document.querySelector('video').volume`), preferred / 100);
        assert.deepEqual(errors, []);
        console.log(`${platform} (${engine}): transient startup failure retries without input; error indication, preference and cleanup passed`);
        continue;
      }
      if (suspended) {
        // Playwright evaluations carry a user gesture. Use explicit CDP calls
        // for the pre-activation proof so the harness cannot activate the tab.
        const cdp = await context.newCDPSession(page);
        const read = async (fn, argument) => {
          const result = await cdp.send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(argument)})`, userGesture: false, awaitPromise: true, returnByValue: true });
          assert.ok(!result.exceptionDetails, result.exceptionDetails?.text);
          return result.result.value;
        };
        const wait = async (fn, argument) => read(async ({ source, argument }) => {
          const condition = (0, eval)(`(${source})`), deadline = performance.now() + 5000;
          while (!condition(argument)) {
            if (performance.now() > deadline) throw new Error('Pre-activation condition timed out');
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        }, { source: fn.toString(), argument });
        await wait(() => !!document.querySelector('#tm-volume-options-button'));
        await read(() => document.querySelector('video').play());
        await wait(() => window.__normalizationContexts.length > 0 && window.__normalizationContexts.every(context => context.state === 'suspended'));
        assert.equal(await read(() => navigator.userActivation.hasBeenActive), false, 'no trusted input has activated this tab');
        if (engine === 'worklet-suspended') {
          await wait(() => window.__lufsOutputs.length > 0);
          await wait(preference => document.querySelector('video').volume === preference / 100, preferred);
          assert.equal(await read(() => window.__lufsSeconds), 0);
          assert.equal(await read(() => document.querySelector('video').volume), preferred / 100);
        } else {
          await wait(preference => window.__nativeFrames > 0 && document.querySelector('video').volume < preference / 100 * .25, preferred);
          assert.equal(await read(() => navigator.userActivation.hasBeenActive), false, 'native analysis needs no extra activation click');
        }
        await page.evaluate(() => document.querySelector('#tm-volume-options-button').click());
        const toggle = page.locator('#tm-volume-options-normalization');
        assert.equal(await toggle.getAttribute('aria-checked'), 'true');
        if (engine === 'worklet-suspended') {
          await page.waitForFunction(() => /Click the player/.test(document.querySelector('#tm-volume-options-normalization-status').textContent));
          await page.evaluate(() => { window.__allowAudioResume = true; });
          await page.locator('video').click();
          await page.waitForFunction(preference => document.querySelector('video').volume < preference / 100 * .25, preferred);
          await page.evaluate(() => document.querySelector('#tm-volume-options-button').click());
        }
        await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent.startsWith('Active'));
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
        assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
        if (engine !== 'worklet-suspended') {
          await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/quiet.wav'; await v.play(); });
          await page.waitForFunction(preference => document.querySelector('video').volume > preference / 100 * 1.1, preferred, { timeout: 5000 });
          assert.ok(await page.evaluate(() => window.__normalizationContexts.every(context => ['closed', 'suspended'].includes(context.state))), 'source replacement does not activate the unused context');
        }
        await page.evaluate(() => { document.querySelector('video').muted = true; });
        await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent === 'Waiting for audio');
        await toggle.click();
        await page.waitForFunction(() => window.__normalizationContexts.every(context => context.state === 'closed'));
        // A retained capture stream can receive new tracks after a source
        // replacement. Check every track actually consumed by our analysis.
        assert.ok(await page.evaluate(() => window.__normalizationTracks.length > 0 && window.__normalizationTracks.every(track => track.readyState === 'ended')));
        assert.deepEqual(await page.evaluate(() => ({ volume: document.querySelector('video').volume, muted: document.querySelector('video').muted })), { volume: preferred / 100, muted: true });
        assert.deepEqual(errors, []);
        console.log(`${platform} (${engine}): ${engine === 'worklet-suspended' ? 'worklet waits for genuine activation and then recovers' : 'native LUFS starts before any trusted input while its unused context stays suspended'}; preference, mute, source cleanup and disable passed`);
        continue;
      }
      await page.waitForSelector('#tm-volume-options-button');
      await page.evaluate(() => document.querySelector('video').play());
      await page.locator('#tm-volume-options-button').click();
      const toggle = page.locator('#tm-volume-options-normalization');
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await toggle.click();
      if (engine === 'unsupported') {
        await page.waitForFunction(() => /unavailable/i.test(document.querySelector('#tm-volume-options-normalization-status').textContent));
        assert.equal(await page.evaluate(() => window.__lufsSeconds), 0);
        assert.equal(await page.evaluate(() => document.querySelector('video').volume), preferred / 100);
        const before = await page.evaluate(() => document.querySelector('video').currentTime);
        await page.waitForFunction(time => document.querySelector('video').currentTime > time + .2, before);
        await toggle.click();
        await page.waitForFunction(() => window.__normalizationContexts.every(context => context.state === 'closed'));
        assert.ok(await page.evaluate(() => window.__normalizationStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))));
        assert.equal(await page.evaluate(() => document.querySelector('video').volume), preferred / 100);
        assert.deepEqual(errors, []);
        console.log(`${platform}: unsupported analysis keeps ordinary playback at the selected volume and releases capture`);
        continue;
      }
      await page.waitForFunction(() => window.__lufsSeconds >= .2);
      assert.equal(await page.evaluate(() => window.__nativeFrames > 0), engine !== 'lufs', 'the expected LUFS input path is used');
      assert.ok((await page.evaluate(() => window.__lufsOutputs)).every(outputs => outputs === 0), 'continuous LUFS analysis has no speaker output');
      let speechReturnExcessDb;
      if (preferred === 30 || engine === 'native') {
        await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/speech-return.wav'; await v.play(); });
        await page.waitForFunction(() => document.querySelector('video').currentTime >= 3.5);
        const speechVolume = await page.evaluate(() => document.querySelector('video').volume);
        // Inspect the gain while background audio is still playing, before
        // the detector can react to the returning word at nine seconds.
        await page.waitForFunction(() => document.querySelector('video').currentTime >= 8.5);
        const beforeWord = await page.evaluate(() => document.querySelector('video').volume);
        speechReturnExcessDb = 20 * Math.log10(beforeWord / speechVolume);
        assert.ok(speechReturnExcessDb < 2, `background must not leave speech overboosted: ${speechReturnExcessDb.toFixed(2)} dB`);
        await page.waitForFunction(() => document.querySelector('video').currentTime >= 9.2);
        const returned = await page.evaluate(() => document.querySelector('video').volume);
        assert.ok(20 * Math.log10(returned / speechVolume) < 2, 'returning speech stays near its established level');
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
        assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
        console.log(`${platform} (${engine}): ${speechReturnExcessDb.toFixed(2)} dB excess gain before speech returns after background audio`);
        await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/loud.wav'; await v.play(); });
      }
      // Capture ramps in over its first frames. Compare the settled output,
      // rather than the first coarse attenuation during that startup window.
      await page.waitForFunction(preference => {
        const target = 0.1 * preference / 100;
        const output = 0.7 / Math.sqrt(2) * document.querySelector('video').volume;
        return Math.abs(output / target - 1) < .1;
      }, preferred, { timeout: 3000 });
      assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
      await page.waitForFunction(() => /Reducing loud audio/.test(document.querySelector('#tm-volume-options-normalization-details').textContent));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
      assert.equal(await page.locator('#tm-volume-options-normalization-status').textContent(), 'Active');
      const loudOutput = await page.evaluate(() => document.querySelector('video').volume);
      assert.match(await page.locator('#tm-volume-options-normalization-details').textContent(), /Reducing loud audio/);
      // A native mute must survive both analysis ticks and disabling the mode.
      await page.evaluate(() => { document.querySelector('video').muted = true; });
      await page.waitForFunction(() => document.querySelector('#tm-volume-options-normalization-status').textContent === 'Waiting for audio');
      await toggle.click();
      assert.deepEqual(await page.evaluate(() => ({ volume: document.querySelector('video').volume, muted: document.querySelector('video').muted })), { volume: preferred / 100, muted: true });
      await page.evaluate(() => { document.querySelector('video').muted = false; });
      await toggle.click();
      await page.waitForFunction(preference => document.querySelector('video').volume < preference / 100 * .25, preferred);
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/quiet.wav'; await v.play(); });
      await page.waitForFunction(preference => {
        // This tone is limited by the new boost ceiling. Compare integer
        // player steps, allowing two steps for the asymptotic upward ramp.
        const target = Math.min(100, Math.round(preference * 10 ** (6 / 20)));
        const output = Math.round(document.querySelector('video').volume * 100);
        return output >= target - 2 && output <= target;
      }, preferred, { timeout: 10000 });
      assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
      const quietOutput = await page.evaluate(() => document.querySelector('video').volume);
      assert.ok(quietOutput > preferred / 100 * 1.9, 'quiet source still receives useful boost');
      assert.ok(quietOutput <= Math.min(100, Math.round(preferred * 10 ** (6 / 20))) / 100, 'quiet boost is capped before a louder sound can arrive');
      const differenceDb = 20 * Math.log10((.06 * quietOutput) / (.7 * loudOutput));
      assert.ok(Math.abs(differenceDb) < 2, `${platform} ${preferred}%: bounded boost keeps these quiet/loud sources within 2 dB (${differenceDb.toFixed(2)} dB; loud ${loudOutput}, quiet ${quietOutput})`);
      await page.waitForFunction(() => /Raising quiet audio/.test(document.querySelector('#tm-volume-options-normalization-details').textContent));
      if (process.env.VOLUME_SLIDER_SCREENSHOTS) {
        await page.locator('#tm-volume-options-normalization-details').scrollIntoViewIfNeeded();
        await mkdir(process.env.VOLUME_SLIDER_SCREENSHOTS, { recursive: true });
        await page.locator('#tm-volume-options-popup').screenshot({ path: join(process.env.VOLUME_SLIDER_SCREENSHOTS, `${platform}-normalization.png`) });
      }
      // A loud return within the same source retains the preceding quiet boost.
      // Source replacement alone cannot reproduce that gain-transition bug.
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/burst.wav'; await v.play(); });
      await page.waitForFunction(onset => document.querySelector('video').currentTime >= onset - .5, burstOnset);
      assert.ok(Math.round(await page.evaluate(() => document.querySelector('video').volume) * 100) >= Math.round(preferred * 1.5), 'the quiet lead-in has at least 50% boost in native player steps');
      const burstTrace = await page.evaluate(() => new Promise(resolve => {
        const video = document.querySelector('video');
        const rows = [];
        const timer = setInterval(() => rows.push({ time: video.currentTime, volume: video.volume }), 10);
        setTimeout(() => { clearInterval(timer); resolve(rows); }, 1300);
      }));
      const afterAttack = burstTrace.filter(row => row.time >= burstOnset + .25 && row.time <= burstOnset + .7);
      assert.ok(afterAttack.length > 0, 'the captured trace includes the loud return');
      const worstBurstDb = Math.max(...afterAttack.map(row => 20 * Math.log10((0.7 / Math.sqrt(2) * row.volume) / (0.1 * preferred / 100))));
      assert.ok(worstBurstDb < 2, `loud return settles within 250 ms: ${worstBurstDb.toFixed(2)} dB above target`);
      const withinTarget = row => 20 * Math.log10((0.7 / Math.sqrt(2) * row.volume) / (0.1 * preferred / 100)) < 2;
      const settledIndex = burstTrace.findIndex((row, index) => row.time >= burstOnset && withinTarget(row) && burstTrace.slice(index).filter(next => next.time <= burstOnset + .7).every(withinTarget));
      assert.ok(settledIndex >= 0, 'the loud return has a stable correction');
      const reactionMs = (burstTrace[settledIndex].time - burstOnset) * 1000;
      attackResults.push({ platform, preferred, engine, reactionMs, worstBurstDb, speechReturnExcessDb });
      assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
      console.log(`${platform} (${engine}) at ${preferred}%: loud-return correction after ${reactionMs.toFixed(1)} ms; ${worstBurstDb.toFixed(2)} dB above target after 250 ms`);
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/scream-return.wav'; await v.play(); });
      await page.waitForFunction(() => document.querySelector('video').currentTime >= 3.5);
      const beforeScream = await page.evaluate(() => document.querySelector('video').volume);
      await page.waitForFunction(() => document.querySelector('video').currentTime >= 4.2);
      assert.ok(await page.evaluate(() => document.querySelector('video').volume) < beforeScream / 3, 'the brief scream still receives an immediate cut');
      await page.waitForFunction(() => document.querySelector('video').currentTime >= 6);
      const recoveryDb = 20 * Math.log10(await page.evaluate(() => document.querySelector('video').volume) / beforeScream);
      assert.ok(Math.abs(recoveryDb) < 1.5, `ordinary audio recovers within 1.5 dB in 1.5 seconds: ${recoveryDb.toFixed(2)} dB`);
      assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
      console.log(`${platform} (${engine}): brief-scream recovery ${recoveryDb.toFixed(2)} dB from the established level after 1.5 seconds`);
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/speech-words.wav'; await v.play(); });
      await page.waitForFunction(() => document.querySelector('video').currentTime >= 8);
      const wordVolumes = await page.evaluate(() => new Promise(resolve => {
        const video = document.querySelector('video'), volumes = [];
        const timer = setInterval(() => volumes.push(video.volume), 10);
        setTimeout(() => { clearInterval(timer); resolve(volumes); }, 1200);
      }));
      const wordMinimum = Math.min(...wordVolumes), wordMaximum = Math.max(...wordVolumes);
      assert.ok(wordVolumes.length >= 20, 'the trace covers repeated consonants and quieter word tails');
      assert.ok(wordMinimum > preferred / 100 * .5, 'ordinary speech avoids a deep transient cut');
      assert.ok(wordMaximum < preferred / 100 * .8, 'speech keeps a conservative gain before the next consonant');
      const wordSwingDb = 20 * Math.log10(wordMaximum / wordMinimum);
      assert.ok(wordSwingDb < 1, `native volume stays steady through repeated word onsets: ${wordSwingDb.toFixed(2)} dB`);
      assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
      console.log(`${platform} (${engine}): repeated word onsets keep native volume within ${wordSwingDb.toFixed(2)} dB`);
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = '/rounding.wav'; await v.play(); });
      await page.waitForFunction(() => document.querySelector('video').currentTime >= 10);
      const roundingVolumes = await page.evaluate(() => new Promise(resolve => {
        const video = document.querySelector('video'), volumes = [];
        const timer = setInterval(() => volumes.push(Math.round(video.volume * 100)), 20);
        setTimeout(() => { clearInterval(timer); resolve(volumes); }, 10000);
      }));
      assert.ok(roundingVolumes.length >= 100, 'the trace covers a full cycle of the slow level variation');
      assert.deepEqual([...new Set(roundingVolumes)], [preferred === 30 ? 5 : 7], 'tiny level variations cannot toggle neighboring native percentages');
      await page.evaluate(() => { document.querySelector('video').volume = .5; });
      await page.waitForFunction(expected => Math.round(document.querySelector('video').volume * 100) === expected, roundingVolumes[0]);
      assert.equal(await page.locator('#tm-volume-slider-range').inputValue(), String(preferred));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `tm-${prefix}-volume`), String(preferred));
      console.log(`${platform} (${engine}): tiny level variations keep native output steady at ${roundingVolumes[0]}%`);
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
      if (preferred === 30) {
        const volumes = [];
        for (const name of ['bass', 'high']) {
          const before = await page.evaluate(() => window.__lufsSeconds);
          await page.evaluate(async name => { const v = document.querySelector('video'); v.src = `/${name}.wav`; await v.play(); }, name);
          await page.waitForFunction(before => window.__lufsSeconds >= before + 1.2, before);
          volumes.push(await page.evaluate(() => document.querySelector('video').volume));
        }
        const difference = 20 * Math.log10(volumes[0] / volumes[1]);
        assert.ok(Math.abs(difference - 5.7) < 1, `native output follows K weighting for equal-RMS bass/treble: ${difference} dB`);
        console.log(`${platform}: equal-RMS bass/treble receive ${difference.toFixed(2)} dB different correction`);
      }
      // Tainted media must continue playing at ordinary volume after capture
      // fails. The route intentionally sends no Access-Control-Allow-Origin.
      await page.evaluate(async () => { const v = document.querySelector('video'); v.src = 'https://media.example.invalid/loud.wav'; await v.play(); });
      await page.waitForFunction(() => /unavailable|accessible/i.test(document.querySelector('#tm-volume-options-normalization-status').textContent), null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => document.querySelector('video').volume), preferred / 100);
      const before = await page.evaluate(() => document.querySelector('video').currentTime);
      await page.waitForFunction(time => document.querySelector('video').currentTime > time + .2, before);
      await toggle.click();
      await page.waitForFunction(() => window.__normalizationContexts.every(context => context.state === 'closed'));
      assert.ok(await page.evaluate(() => window.__normalizationStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), 'source changes and disable stop captured tracks');
      assert.deepEqual(errors, []);
      console.log(`${platform} (${engine}) at ${preferred}%: loud output ${(loudOutput * 100).toFixed(0)}%, quiet output ${(quietOutput * 100).toFixed(0)}%, remaining difference ${differenceDb.toFixed(2)} dB; stereo, mute/preference and CORS fallback passed`);
    } catch (error) {
      console.error(`${platform}/${preferred}/${engine}:`, await page.evaluate(() => ({
        time: document.querySelector('video').currentTime,
        volume: document.querySelector('video').volume,
        muted: document.querySelector('video').muted,
        measuredSeconds: window.__lufsSeconds,
        nativeFrames: window.__nativeFrames,
        captures: window.__normalizationCaptures,
        contexts: window.__normalizationContexts.map(context => context.state),
        streams: window.__normalizationStreams.map(stream => stream.getTracks().map(track => `${track.kind}/${track.readyState}`)),
        status: document.querySelector('#tm-volume-options-normalization-status')?.textContent,
        details: document.querySelector('#tm-volume-options-normalization-details')?.textContent
      })));
      throw error;
    } finally { completeDocument(); await context.close(); }
  }
} finally {
  await browser.close();
  if (process.env.VOLUME_SLIDER_ATTACK_REPORT) await writeFile(process.env.VOLUME_SLIDER_ATTACK_REPORT, JSON.stringify(attackResults, null, 2));
  if (process.env.VOLUME_SLIDER_STARTUP_REPORT) await writeFile(process.env.VOLUME_SLIDER_STARTUP_REPORT, JSON.stringify(startupResults, null, 2));
}
