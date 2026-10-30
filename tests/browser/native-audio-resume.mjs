import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { launchChrome, launchFirefox } from '../helpers/browser.js';

const firefox = process.argv.includes('--firefox');
const browser = firefox ? await launchFirefox() : await launchChrome(['--autoplay-policy=no-user-gesture-required', '--mute-audio']);
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><video></video>' }));
  const code = (await build({ stdin: { contents: "export {createAudiblePlayback} from './src/shared/normalization-playback.js';",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'iife', globalName: 'playbackTest' })).outputFiles[0].text;
  for (const sampleRate of (firefox ? [undefined] : [44100, 48000, 96000])) {
    await page.goto('https://audio-resume.test/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async sampleRate => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const video = document.querySelector('video'), rate = 48000, frames = rate * 12;
      const wav = new ArrayBuffer(44 + frames * 2), view = new DataView(wav);
      function text(at, value) { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); }
      text(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 2, true);
      for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(.08 * 32767 * Math.sin(2 * Math.PI * 997 * i / rate)), true);
      video.src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })); video.volume = 0;
      await video.play();
      const BaseContext = AudioContext, context = new BaseContext({ sampleRate }), blocks = [], failures = [];
      await context.audioWorklet.addModule(URL.createObjectURL(new Blob([`registerProcessor('recorder',class extends AudioWorkletProcessor {
        process(inputs){this.port.postMessage({at:currentFrame,values:new Float32Array(inputs[0]?.[0]||128),raw:new Float32Array(inputs[1]?.[0]||128)});return true}
      })`], { type: 'application/javascript' })));
      const collector = new AudioWorkletNode(context, 'recorder', { numberOfInputs: 2, channelCount: 1, channelCountMode: 'explicit' });
      collector.port.onmessage = ({ data }) => blocks.push(data);
      collector.connect(context.destination);
      window.AudioContext = class extends BaseContext { constructor() { return context; } };
      const connect = AudioNode.prototype.connect;
      let source;
      AudioNode.prototype.connect = function(target, ...args) {
        if (this instanceof MediaElementAudioSourceNode) source = this;
        if (this instanceof GainNode && target === this.context.destination) connect.call(this, collector);
        return connect.call(this, target, ...args);
      };
      let lookahead = 0;
      const playback = playbackTest.createAudiblePlayback({ window, video, selected: .3,
        onMetrics(metrics) { lookahead = Math.round(metrics.delayMs * context.sampleRate / 1000); sync(); },
        onFailure: error => failures.push(`${error.name}: ${error.message}`) });
      function sync() { playback.setState({ selected: .3, muted: video.muted, paused: video.paused }); }
      for (const type of ['play', 'playing', 'pause']) video.addEventListener(type, sync);
      await playback.ready; video.volume = 1;
      source.connect(collector, 0, 1);
      const stream = (video.captureStream || video.mozCaptureStream).call(video);
      await playback.startAnalysis(stream.getAudioTracks()[0]);
      await sleep(900);
      const resumes = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        video.pause(); await sleep(300);
        const state = context.state, pausedAt = context.currentTime;
        await video.play();
        resumes.push({ state, at: pausedAt, media: video.currentTime });
        await sleep(650);
      }
      const values = new Float32Array(blocks.at(-1).at + 128), raw = new Float32Array(values.length);
      for (const block of blocks) { values.set(block.values, block.at); raw.set(block.raw, block.at); }
      const coefficient = 2 * Math.cos(2 * Math.PI * 997 / context.sampleRate);
      const windows = resumes.map(resume => {
        const bins = [];
        for (let ms = 0; ms < 400; ms += 10) {
          let residual = 0, rawResidual = 0, addedResidual = 0, energy = 0, peak = 0;
          // Suspended audio clocks concatenate the two sides of the real
          // wall-clock pause. Do not treat that boundary as adjacent PCM.
          const begin = Math.max(Math.round(resume.at * context.sampleRate) + 128,
            Math.round((resume.at + ms / 1000) * context.sampleRate));
          const end = Math.round((resume.at + (ms + 10) / 1000) * context.sampleRate);
          for (let i = begin; i < end; i++) {
            const error = Math.abs(values[i] - coefficient * values[i - 1] + values[i - 2]);
            const j = i - lookahead;
            const inputError = Math.abs(raw[j] - coefficient * raw[j - 1] + raw[j - 2]);
            residual = Math.max(residual, error); rawResidual = Math.max(rawResidual, inputError);
            // Compare against the same decoded PCM before gain/lookahead.
            // A browser-side source discontinuity must not be attributed to
            // the normalizer; at this selection its total gain stays below 1.
            addedResidual = Math.max(addedResidual, error - inputError);
            energy += values[i] ** 2; peak = Math.max(peak, Math.abs(values[i]));
          }
          bins.push({ ms, residual, rawResidual, addedResidual, peak, rms: Math.sqrt(energy / (end - begin)) });
        }
        return { ...resume, bins };
      });
      AudioNode.prototype.connect = connect; window.AudioContext = BaseContext;
      video.pause(); await playback.dispose(); collector.disconnect();
      for (const track of stream.getTracks()) track.stop();
      return { rate: context.sampleRate, failures, windows };
    }, sampleRate);
    console.log(JSON.stringify({ ...result, windows: result.windows.map(({ bins, ...window }) => ({ ...window,
      residual: Math.max(...bins.map(bin => bin.residual)), inputResidual: Math.max(...bins.map(bin => bin.rawResidual)),
      addedResidual: Math.max(...bins.map(bin => bin.addedResidual)),
      distortedBins: bins.filter(bin => bin.addedResidual >= .001),
      gaps: bins.filter(bin => bin.rms < .005).map(bin => bin.ms) })) }));
    assert.deepEqual(result.failures, []);
    for (const window of result.windows) {
      assert.equal(window.state, 'suspended');
      assert.ok(window.bins.every(bin => bin.addedResidual < .001), 'normalizer distorted the resumed tone');
      assert.ok(window.bins.every(bin => bin.peak < .1), 'resumed output bypassed normal gain protection');
      assert.ok(window.bins.slice(5).every(bin => bin.rms > .005), 'resumed tone had gaps');
    }
  }
} finally { await browser.close(); }
