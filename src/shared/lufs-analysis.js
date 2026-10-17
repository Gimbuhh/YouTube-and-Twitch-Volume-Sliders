import { createLufsMeter } from './lufs-meter.js';

const modules = new WeakMap();

function loadMeter(window, context) {
  if (modules.has(context)) return modules.get(context);
  const source = `const createLufsMeter = ${createLufsMeter.toString()};
registerProcessor('tm-lufs-analysis', class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.meter = createLufsMeter(sampleRate);
    this.send = frame => this.port.postMessage(frame);
    this.port.onmessage = () => { this.stopped = true; };
  }
  process(inputs) {
    if (this.stopped) return false;
    try { this.meter.process(inputs[0] || [], this.send); }
    catch { this.port.postMessage({ failed: true }); return false; }
    return true;
  }
});`;
  const url = window.URL.createObjectURL(new window.Blob([source], { type: 'application/javascript' }));
  const loaded = Promise.resolve().then(() => context.audioWorklet.addModule(url))
    .finally(() => window.URL.revokeObjectURL(url));
  modules.set(context, loaded);
  loaded.catch(() => modules.delete(context));
  return loaded;
}

export function createLufsAnalysis({ window, context, source, track, onFrame, onFailure }) {
  const hasWorklet = context.audioWorklet && window.AudioWorkletNode && window.URL?.createObjectURL && window.Blob;
  if (!hasWorklet && !window.MediaStreamTrackProcessor) return null;
  let disposed = false, node = null, reader = null;
  function releaseNode() {
    if (!node) return;
    try { source.disconnect(node); } catch { /* construction can fail before connection */ }
    node.disconnect();
    node.port.onmessage = null;
    node.onprocessorerror = null;
    node.port.postMessage('stop');
    node.port.close();
    node = null;
  }
  const owned = {
    dispose() {
      disposed = true;
      if (reader) reader.cancel().catch(() => {});
      // Stop inputless processors instead of leaving their active-source flag set.
      releaseNode();
    }
  };
  const fail = () => { if (!disposed) { owned.dispose(); onFailure(); } };
  const readTrack = async () => {
    if (disposed) return;
    releaseNode();
    if (!window.MediaStreamTrackProcessor) { fail(); return; }
    try {
      // Some sites disallow Blob worklet modules. Read the captured copy's
      // AudioData directly, using the same LUFS meter and no audio output.
      reader = new window.MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
      let meter, rate, channels = [], stereo = [];
      while (!disposed) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        try {
          if (disposed) break;
          if (!meter || rate !== frame.sampleRate) {
            rate = frame.sampleRate;
            meter = createLufsMeter(rate);
          }
          if (channels.length !== frame.numberOfChannels || channels[0]?.length !== frame.numberOfFrames) {
            channels = Array.from({ length: frame.numberOfChannels }, () => new Float32Array(frame.numberOfFrames));
            stereo = Array.from({ length: 2 }, () => new Float32Array(frame.numberOfFrames));
          }
          channels.forEach((channel, planeIndex) => frame.copyTo(channel, { planeIndex, format: 'f32-planar' }));
          // Match the worklet's explicit stereo speaker downmix (Web Audio).
          if (channels.length === 1) meter.process([channels[0], channels[0]], onFrame);
          else if (channels.length === 4 || channels.length === 6) {
            for (let i = 0; i < frame.numberOfFrames; i++) {
              stereo[0][i] = channels.length === 4 ? 0.5 * (channels[0][i] + channels[2][i]) : channels[0][i] + Math.SQRT1_2 * (channels[2][i] + channels[4][i]);
              stereo[1][i] = channels.length === 4 ? 0.5 * (channels[1][i] + channels[3][i]) : channels[1][i] + Math.SQRT1_2 * (channels[2][i] + channels[5][i]);
            }
            meter.process(stereo, onFrame);
          } else meter.process(channels.slice(0, 2), onFrame);
        } finally { frame.close(); }
      }
    } catch { fail(); }
    finally { reader?.releaseLock(); }
  };
  if (!hasWorklet) { readTrack(); return owned; }
  try {
    loadMeter(window, context).then(() => {
      if (disposed || context.state === 'closed') return;
      // Match stereo playback, including mono duplication and surround downmix.
      // No outputs: this analysis branch cannot send captured audio to speakers.
      node = new window.AudioWorkletNode(context, 'tm-lufs-analysis', {
        numberOfInputs: 1, numberOfOutputs: 0,
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      node.port.onmessage = event => {
        if (disposed) return;
        if (event.data.failed) fail();
        else onFrame(event.data);
      };
      node.onprocessorerror = fail;
      source.connect(node);
    }).catch(readTrack);
  } catch { readTrack(); }
  return owned;
}
