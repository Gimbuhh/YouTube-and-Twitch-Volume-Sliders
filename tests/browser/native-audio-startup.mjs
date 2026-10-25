import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { launchChrome } from '../helpers/browser.js';

const directory = process.argv[2] || fileURLToPath(new URL('../../dist/', import.meta.url)), baseline = process.argv.includes('--baseline');
const resultsDirectory = process.env.VOLUME_SLIDER_NORMALIZATION_RESULTS || join(tmpdir(), 'volume-slider-native-checks');
await mkdir(resultsDirectory, { recursive: true });
const contextRate = Number(process.env.VOLUME_SLIDER_AUDIO_RATE || 96000);
if (!directory) throw Error('Supply a local build/results directory outside dist/');
const script = await readFile(join(directory, 'youtube-volume-slider.user.js'), 'utf8');
const rate = 48000, count = rate * 12, wav = Buffer.alloc(44 + count * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 4, 40);
for (let i = 0; i < count; i++) for (let c = 0; c < 2; c++) wav.writeInt16LE(Math.round(.08 * 32767 * Math.sin(2 * Math.PI * 997 * i / rate)), 44 + i * 4 + c * 2);
const browser = await launchChrome(['--autoplay-policy=no-user-gesture-required', '--disable-background-networking', '--mute-audio']);
const results = [];
try {
  for (const load of (process.argv.includes('--quiet') ? [false] : [false, true])) {
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    let recording;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('.wav')) return route.fulfill({ contentType: 'audio/wav', body: wav });
      if (path === '/recording') { recording = route.request().postDataBuffer(); return route.fulfill({ body: 'ok' }); }
      return route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': "script-src 'unsafe-inline' 'unsafe-eval' 'self';worker-src 'none'" },
        body: `<!doctype html><div id="movie_player"><video class="html5-main-video" src="/audio.wav"></video>
        <div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div></div>
        <script>
        const video=document.querySelector('video'),player=video.parentElement;video.volume=.3;
        Object.assign(player,{getVolume:()=>video.volume*100,setVolume:value=>{video.volume=value/100},isMuted:()=>video.muted,mute:()=>{video.muted=true},unMute:()=>{video.muted=false}});
        localStorage.setItem('tm-yt-volume','30');localStorage.setItem('tm-yt-volume-slider-normalization','true');
        const BaseContext=AudioContext;window.AudioContext=class extends BaseContext{constructor(options){super({...options,sampleRate:${contextRate}})}};
        const gain=AudioContext.prototype.createGain;window.__contexts=[];
        AudioContext.prototype.createGain=function(){const node=gain.call(this);if(!window.__contexts.includes(this)){window.__contexts.push(this);window.__recording=this.createMediaStreamDestination();node.connect(window.__recording)}return node};
        </script>` });
    });
    for (const phase of ['load', 'refresh']) {
      if (phase === 'refresh') await page.reload();
      else await page.goto('https://www.youtube.com/watch?v=native-startup');
      await page.addScriptTag({ content: script });
      await page.evaluate(() => document.querySelector('video').play());
      await page.waitForFunction(() => window.__recording && window.__contexts.at(-1).state === 'running');
      const metadata = await page.evaluate(async load => {
        const mime = 'audio/webm;codecs=pcm';
        if (!MediaRecorder.isTypeSupported(mime)) throw Error('This test requires native PCM recording support');
        const recorder = new MediaRecorder(window.__recording.stream, { mimeType: mime }), chunks = [];
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(Error(event.error?.message || 'Recording failed')); });
        recorder.start(250);
        // The first group models observed YouTube loading tasks. Later tasks
        // prove that an initial quiet-time guard cannot mask a packet renderer.
        if (load) for (const [at, duration] of [[100,55],[450,290],[1000,114],[1400,252],[2600,55],[3200,290],[4000,252]]) {
          setTimeout(() => { const until = performance.now() + duration; while (performance.now() < until) {} }, at);
        }
        await new Promise(resolve => setTimeout(resolve, 5000)); recorder.stop(); await stopped;
        await fetch('/recording', { method: 'POST', body: await new Blob(chunks, { type: mime }).arrayBuffer() });
        const result = { state: JSON.parse(document.documentElement.dataset.tmAudioNormalization || '{}'),
          nativeVolume: document.querySelector('video').volume, savedVolume: localStorage.getItem('tm-yt-volume'), contextRate: window.__contexts.at(-1).sampleRate };
        document.querySelector('video').pause(); return result;
      }, load);
      const name = `startup-${load ? 'busy' : 'quiet'}-${phase}`;
      await writeFile(join(resultsDirectory, name + '.webm'), recording);
      // Select one channel; a generic stereo downmix can add gain or cancel PCM.
      const decoded = spawnSync(process.env.VOLUME_SLIDER_FFMPEG || 'ffmpeg', ['-v','error','-i','pipe:0','-af','pan=mono|c0=c0','-ar',String(rate),'-f','f32le','pipe:1'],
        { input: recording, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      if (decoded.status !== 0) throw Error(decoded.stderr.toString());
      const values = new Float32Array(decoded.stdout.buffer.slice(decoded.stdout.byteOffset, decoded.stdout.byteOffset + decoded.stdout.byteLength));
      let firstAudio = -1;
      for (let start = 0; start + 240 < values.length; start += 240) {
        let energy = 0; for (let i = start; i < start + 240; i++) energy += values[i] ** 2;
        if (energy / 240 > 1e-8) { firstAudio = start / rate; break; }
      }
      const begin = Math.max(Math.ceil(rate * .1), Math.ceil((firstAudio + .015) * rate)), end = values.length - Math.ceil(rate * .1);
      const coefficient = 2 * Math.cos(2 * Math.PI * 997 / rate);
      let peak = 0, nonfinite = 0, maxResidual = 0, energy = 0, silentBins = 0, bins = 0, maxResidualAt = 0;const silentAt=[];
      for (let i = begin; i < end; i++) {
        const value = values[i]; if (!Number.isFinite(value)) nonfinite++;
        peak = Math.max(peak, Math.abs(value)); energy += value * value;
        const residual=Math.abs(value-coefficient*values[i-1]+values[i-2]);if(residual>maxResidual){maxResidual=residual;maxResidualAt=i/rate}
        if ((i - begin + 1) % 240 === 0) { bins++; if (energy / 240 < 1e-9){silentBins++;silentAt.push(i/rate)} energy = 0; }
      }
      const result = { load, phase, ...metadata, firstAudio, peak, nonfinite, maxResidual, maxResidualAt, silentBins, silentAt, bins, errors: [...errors] };
      results.push(result); console.log(JSON.stringify(result));
    }
    await context.close();
  }
} finally { await browser.close(); await writeFile(join(resultsDirectory, 'startup-results.json'), JSON.stringify(results, null, 2)); }
if (baseline) {
  assert.ok(results.some(row => row.load && (row.silentBins > 0 || row.maxResidual > .0002)), 'the frozen packet-renderer regression did not reproduce');
} else for (const result of results) {
  assert.deepEqual(result.errors, []); assert.equal(result.nonfinite, 0); assert.equal(result.nativeVolume, 1); assert.equal(result.savedVolume, '30');
  assert.equal(result.state.backend, 'native graph'); assert.equal(result.state.metrics.meterBackend, 'native frames');
  assert.ok(result.firstAudio >= 0 && result.firstAudio < .5, 'opening audio remained muted too long');
  assert.ok(result.peak > .01 && result.peak <= .3 * 10 ** (-10 / 20) + .00001);
  assert.equal(result.silentBins, 0, 'audible output had gaps during page-load work');
  assert.ok(result.maxResidual < .0002, 'audible waveform was interrupted');
}
