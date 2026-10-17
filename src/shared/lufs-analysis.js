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

export function createLufsAnalysis({ window, context, source, onFrame, onFailure }) {
  if (!context.audioWorklet || !window.AudioWorkletNode || !window.URL?.createObjectURL || !window.Blob) return null;
  let disposed = false, node = null;
  const owned = {
    dispose() {
      disposed = true;
      if (!node) return;
      try { source.disconnect(node); } catch { /* construction can fail before connection */ }
      node.disconnect();
      node.port.onmessage = null;
      node.onprocessorerror = null;
      // A zero-output processor returns true to stay active. Explicitly stop it
      // when replacing a track or falling back within the same audio context.
      node.port.postMessage('stop');
      node.port.close();
      node = null;
    }
  };
  const fail = () => { if (!disposed) { owned.dispose(); onFailure(); } };
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
    }).catch(fail);
  } catch { fail(); }
  return owned;
}
