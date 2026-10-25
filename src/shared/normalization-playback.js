import { createLufsMeter } from './lufs-meter.js';
import { createProgrammeState } from './normalization-gain.js';
import { createNativeGainGraph } from './normalization-graph.js';
import { acquireMediaOutput } from './normalization-output.js';

// Native nodes process the player's own audio. Captured AudioData and worklets
// are interchangeable analysis inputs, never playback renderers.
export function createAudiblePlayback({ window, video, track, selected, onMetrics, onFailure }) {
  const output = acquireMediaOutput(window, video), { context } = output;
  const gate = context.createGain(); gate.gain.value = 0; gate.connect(context.destination);
  let graph;
  try {
    graph = createNativeGainGraph(context, { selected });
    graph.output.connect(gate);
  } catch (error) {
    graph?.dispose(); gate.disconnect(); output.restore(); throw error;
  }
  const programme = createProgrammeState(selected);
  let stopped = false, connected = false, node = null, reader = null, muted = true, paused = video.paused;
  let meterBackend = 'starting', rate = 0, samples = 0, hasFrame = false, lastReport = -Infinity;

  function updateGain() { graph.setGain(programme.getProgrammeGain()); }
  function short(power) {
    if (stopped || hasFrame) return;
    programme.short(power); updateGain();
  }
  function frame(value) {
    if (stopped) return;
    programme.frame(value); updateGain();
    if (value.rawPower >= 1e-9 && value.power >= 1e-9) hasFrame = true;
    const now = window.performance.now();
    if (now - lastReport < 100) return;
    lastReport = now;
    onMetrics({ gain: graph.readGain(), samples, delayMs: graph.lookaheadMs, backend: 'native graph', meterBackend,
      baseLatencyMs: (context.baseLatency || 0) * 1000, outputLatencyMs: (context.outputLatency || 0) * 1000 });
  }
  const owned = {
    context,
    backend: 'native graph',
    get connected() { return connected; },
    get running() { return !stopped && context.state === 'running'; },
    setState(next) {
      if (stopped) return;
      if (selected !== next.selected) {
        selected = next.selected; programme.setSelected(selected); graph.setSelected(selected); updateGain();
      }
      paused = next.paused;
      const silent = next.muted || paused || selected === 0;
      if (muted !== silent) {
        muted = silent;
        gate.gain.cancelScheduledValues(context.currentTime); gate.gain.setValueAtTime(0, context.currentTime);
        if (!silent) gate.gain.linearRampToValueAtTime(1, context.currentTime + .005);
      }
    },
    resume() { return context.state === 'suspended' ? context.resume() : Promise.resolve(); },
    dispose() {
      if (stopped) return;
      stopped = true; gate.gain.value = 0; video.volume = 0;
      reader?.cancel().catch(() => {});
      output.restore();
      if (node) {
        node.port.onmessage = null; node.onprocessorerror = null;
        node.port.postMessage('stop'); node.disconnect(); node.port.close();
      }
      graph.dispose(); gate.disconnect();
    }
  };
  function fail(error) { if (!stopped) { owned.dispose(); onFailure(error); } }

  function nativeAnalysis() {
    reader = new window.MediaStreamTrackProcessor({ track, maxBufferSize: 8 }).readable.getReader();
    meterBackend = 'native frames';
    (async () => {
      let meter, planes = [], input = [];
      try {
        while (!stopped) {
          const { value: data, done } = await reader.read();
          if (done) break;
          try {
            if (stopped || paused || context.state !== 'running') continue;
            if (!meter || rate !== data.sampleRate) { rate = data.sampleRate; meter = createLufsMeter(rate); }
            const count = data.numberOfFrames;
            if (planes.length !== data.numberOfChannels || planes[0]?.length !== count) {
              planes = Array.from({ length: data.numberOfChannels }, () => new Float32Array(count));
              input = planes.length === 1 ? [planes[0], planes[0]] : planes.length === 2 ? planes
                : Array.from({ length: 2 }, () => new Float32Array(count));
            }
            for (let channel = 0; channel < planes.length; channel++) data.copyTo(planes[channel], { planeIndex: channel, format: 'f32-planar' });
            // Mono/stereo can use the decoded planes directly. Surround input
            // retains the native graph's explicit stereo speaker downmix.
            const channels = planes.length;
            if (channels > 2) {
              for (let i = 0; i < count; i++) {
                input[0][i] = channels === 4 ? .5 * (planes[0][i] + planes[2][i])
                  : planes[0][i] + Math.SQRT1_2 * (planes[2][i] + (channels >= 5 ? planes[channels - 2][i] : 0));
                input[1][i] = channels === 4 ? .5 * (planes[1][i] + planes[3][i])
                  : planes[1][i] + Math.SQRT1_2 * (planes[2][i] + (channels >= 5 ? planes[channels - 1][i] : 0));
              }
            }
            samples += count; meter.process(input, frame, hasFrame ? undefined : short);
          } finally { data.close(); }
        }
        if (!stopped) fail(new Error('Audio analysis ended'));
      } catch (error) { fail(error); }
      finally { reader?.releaseLock(); }
    })();
  }

  async function workletAnalysis() {
    if (!context.audioWorklet || !window.AudioWorkletNode) throw new Error('No supported audio analysis input');
    const code = `const createLufsMeter=${createLufsMeter.toString()};
registerProcessor('tm-native-graph-meter',class extends AudioWorkletProcessor {
 constructor(){super();this.meter=createLufsMeter(sampleRate);this.send=frame=>{this.port.postMessage(frame);if(frame.rawPower>=1e-9&&frame.power>=1e-9)this.measured=true};this.short=power=>{if(!this.measured)this.port.postMessage({attackPower:power})};this.port.onmessage=()=>{this.stopped=true}}
 process(inputs){if(this.stopped)return false;try{this.meter.process(inputs[0]||[],this.send,this.measured?undefined:this.short);return true}catch(error){this.port.postMessage({failed:true,message:error.message});return false}}
});`;
    const url = window.URL.createObjectURL(new window.Blob([code], { type: 'application/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
      if (stopped) return;
      node = new window.AudioWorkletNode(context, 'tm-native-graph-meter', { numberOfInputs: 1, numberOfOutputs: 0,
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      meterBackend = 'audio worklet'; rate = context.sampleRate;
      node.port.onmessage = ({ data }) => {
        if (stopped || paused) return;
        if (data.failed) fail(new Error(data.message));
        else if (data.attackPower != null) short(data.attackPower);
        else { samples += Math.round(data.duration * rate); frame(data); }
      };
      node.onprocessorerror = () => fail(new Error('Audio analysis failed'));
      output.source.connect(node);
    } finally { window.URL.revokeObjectURL(url); }
  }
  owned.ready = (async () => {
    await owned.resume();
    if (stopped) return;
    output.connect(graph.input); connected = true;
    let native = false;
    if (window.MediaStreamTrackProcessor) {
      try { nativeAnalysis(); native = true; }
      catch { /* Some browsers expose video-only native processors. */ }
    }
    if (!native) await workletAnalysis();
  })().catch(fail);
  return owned;
}
