// Controllable routing and analysis contracts. Native DSP behavior is verified
// with real Web Audio in the browser suites, never inferred from these stubs.
export function mockAudioCapture(window, video) {
  const state = { amplitude: 0.5, paused: false, readyState: 4, captures: 0, contexts: [], streams: [], nodes: [],
    captureError: null, loadError: false, processorError: false, stalled: false };
  class Track extends window.EventTarget {
    constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.muted = kind === 'audio' && !!state.captureMuted; }
    stop() { this.readyState = 'ended'; }
  }
  class Stream extends window.EventTarget {
    constructor(tracks = []) { super(); this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  }
  class AudioContext {
    constructor() {
      this.state = 'running'; this.closed = false; this.sampleRate = 48000; this.currentTime = 0;
      this.destination = this.node(); this.sources = new Map(); state.contexts.push(this);
      this.audioWorklet = { addModule: async () => { if (state.loadError) throw new Error('Module blocked'); } };
    }
    parameter(value = 0) {
      // Keep the shared browser API subset; optional methods must not mask compatibility failures.
      return { value, cancelScheduledValues() {},
        setValueAtTime(next) { this.value = next; }, setTargetAtTime(next) { this.value = next; }, linearRampToValueAtTime(next) { this.value = next; } };
    }
    node() {
      const connected = new Set();
      return { connections: connected, connect(node) { connected.add(node); node.connected = true; return node; },
        disconnect(node) {
          for (const item of connected) if (!node || node === item) { item.connected = false; connected.delete(item); }
        } };
    }
    createMediaStreamSource(stream) { return Object.assign(this.node(), { stream }); }
    createMediaElementSource(element) {
      if (this.sources.has(element)) throw new Error('Media element attached twice');
      const source = this.node(); this.sources.set(element, source); return source;
    }
    createGain() { return Object.assign(this.node(), { gain: this.parameter(1) }); }
    createDelay() { return Object.assign(this.node(), { delayTime: this.parameter() }); }
    createIIRFilter() { return this.node(); }
    createWaveShaper() { return this.node(); }
    createConvolver() { return this.node(); }
    createConstantSource() { return Object.assign(this.node(), { offset: this.parameter(), start() {}, stop() {} }); }
    createBuffer(channels, count) { const planes = Array.from({ length: channels }, () => new Float32Array(count)); return { getChannelData: index => planes[index] }; }
    createAnalyser() { return Object.assign(this.node(), { getFloatTimeDomainData: array => array.fill(1) }); }
    createChannelSplitter() { return this.node(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  window.AudioContext = AudioContext;
  window.MediaStream = Stream;
  window.Blob ||= class {};
  window.URL ||= {};
  window.URL.createObjectURL = () => 'blob:mock-audio';
  window.URL.revokeObjectURL = () => {};
  window.AudioWorkletNode = class {
    constructor(context) {
      state.nodes.push(this);
      this.port = { onmessage: null, postMessage() {}, close: () => {
        this.port.closed = true; window.clearInterval(this.timer);
      } };
      this.timer = window.setInterval(() => {
        if (!this.connected || context.state !== 'running' || state.stalled) return;
        if (state.processorError) { this.onprocessorerror?.(); return; }
        // Controlled stereo energy frames, not a replacement audio engine.
        // Native meter behavior is covered by the real-browser audio suite.
        const rawPower = state.amplitude ** 2, power = 2 * rawPower;
        this.port.onmessage?.({ data: { power, rawPower, momentaryPower: power, duration: 0.05 } });
      }, 50);
    }
    disconnect() { this.connected = false; }
  };
  video.captureStream = () => {
    state.captures++;
    if (state.captureError) throw state.captureError;
    const stream = new Stream([new Track('audio'), new Track('video')]);
    state.streams.push(stream);
    return stream;
  };
  Object.defineProperties(video, {
    currentSrc: { configurable: true, get: () => window.location.origin + '/mock-audio' },
    paused: { configurable: true, get: () => state.paused },
    readyState: { configurable: true, get: () => state.readyState }
  });
  return state;
}
