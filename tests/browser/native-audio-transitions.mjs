import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { launchChrome, launchFirefox } from '../helpers/browser.js';

// Record the audible graph boundary, including ordinary routing, rather than
// inferring click-free transitions from volume properties or lifecycle mocks.
const firefox = process.argv.includes('--firefox');
const browser = firefox ? await launchFirefox() : await launchChrome(['--autoplay-policy=no-user-gesture-required', '--mute-audio']);
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><video></video>' }));
  const code = (await build({ stdin: { contents: "export {createAudiblePlayback} from './src/shared/normalization-playback.js'; export {fadeInMediaOutput} from './src/shared/normalization-output.js';",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'iife', globalName: 'playbackTest' })).outputFiles[0].text;
  // Firefox's live media-source attachment requires the device's rate. The
  // offline kernel suite covers all three rates on Firefox independently.
  // Firefox delivers control commands in batches; repeat handoffs to cover
  // different command/renderer phases rather than retrying a failed assertion.
  for (let trial=0;trial<(firefox ? 3 : 1);trial++) for (const sampleRate of (firefox ? [undefined] : [44100, 48000, 96000])) for (const transition of ['navigation', 'restart', 'ordinary']) {
    await page.goto('https://audio-transitions.test/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async ({ transition, sampleRate }) => {
      const video = document.querySelector('video'), rate = 48000, frames = rate * 4;
      const wav = new ArrayBuffer(44 + frames * 2), view = new DataView(wav);
      function text(at, value) { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); }
      text(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 2, true);
      for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(.08 * 32767 * Math.sin(2 * Math.PI * 997 * i / rate)), true);
      video.src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })); video.volume = 0;
      await video.play();
      const streams = [];
      const connect = AudioNode.prototype.connect, blocks = [];
      const BaseContext = AudioContext, context = new BaseContext({ sampleRate });
      await context.audioWorklet.addModule(URL.createObjectURL(new Blob([`registerProcessor('recorder',class extends AudioWorkletProcessor {
        process(inputs){this.port.postMessage(new Float32Array(inputs[0]?.[0]||128));return true}
      })`], { type: 'application/javascript' })));
      const collector = new AudioWorkletNode(context, 'recorder', { channelCount: 1, channelCountMode: 'explicit' });
      collector.port.onmessage = ({ data }) => blocks.push(data);
      collector.connect(context.destination);
      window.AudioContext = class extends BaseContext { constructor() { return context; } };
      let residualAt = 0;
      AudioNode.prototype.connect = function(target, ...args) {
        if ((this instanceof GainNode || this instanceof MediaElementAudioSourceNode) && target === this.context.destination) connect.call(this, collector);
        return connect.call(this, target, ...args);
      };
      const failures = [];
      async function start() {
        const playback = playbackTest.createAudiblePlayback({ window, video, selected: .3,
          onMetrics() { playback.setState({ selected: .3, muted: false, paused: false }); }, onFailure: error => failures.push(`${error.name}: ${error.message}`) });
        await playback.ready; video.volume = 1;
        const stream = (video.captureStream || video.mozCaptureStream).call(video); streams.push(stream);
        await playback.startAnalysis(stream.getAudioTracks()[0]); return playback;
      }
      let playback = await start();
      await new Promise(resolve => setTimeout(resolve, 900));
      const disposed = playback.dispose();
      if (transition === 'ordinary') {
        await disposed; video.volume = .3; await playbackTest.fadeInMediaOutput(window, video);
      }
      if (transition === 'restart') playback = await start();
      await new Promise(resolve => setTimeout(resolve, 350));
      const values = Float32Array.from(blocks.flatMap(block => Array.from(block))), coefficient = 2 * Math.cos(2 * Math.PI * 997 / context.sampleRate);
      let residual = 0, peak = 0;
      // Startup is measured separately. This window covers the entire teardown
      // and any replacement graph, without excluding its first render quantum.
      for (let i = Math.round(context.sampleRate * .6); i < values.length; i++) {
        peak = Math.max(peak, Math.abs(values[i]));
        const error = Math.abs(values[i] - coefficient * values[i - 1] + values[i - 2]);
        if (error > residual) { residual = error; residualAt = i / context.sampleRate; }
      }
      const tail = values.subarray(Math.max(0, values.length - Math.round(context.sampleRate * .1)));
      const tailRms = Math.sqrt(tail.reduce((sum, value) => sum + value * value, 0) / tail.length);
      AudioNode.prototype.connect = connect; window.AudioContext = BaseContext;
      playback.dispose(); video.pause(); collector.disconnect();
      for (const stream of streams) for (const item of stream.getTracks()) item.stop();
      return { transition, residual, residualAt, peak, tailRms, failures, samples: values.length, rate: context.sampleRate };
    }, { transition, sampleRate });
    console.log(JSON.stringify({ trial, ...result }));
    assert.deepEqual(result.failures, []);
    assert.ok(result.samples > result.rate, 'audible transition was not recorded');
    assert.ok(result.peak > .005 && result.peak < .1, 'transition bypassed normal gain protection');
    assert.ok(result.residual < .001, 'teardown or reconnection introduced a waveform discontinuity');
    if (transition === 'navigation') assert.ok(result.tailRms < 1e-7, 'the outgoing player did not become silent');
    else assert.ok(result.tailRms > .005 && result.tailRms < .03, 'playback did not return at the protected or selected level');
  }
} finally { await browser.close(); }
