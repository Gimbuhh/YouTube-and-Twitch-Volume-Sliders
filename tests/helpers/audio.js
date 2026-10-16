// A controllable analysis-only capture contract. Real Web Audio coverage lives
// in tests/browser/normalization.mjs; this fixture never claims browser support.
export function mockAudioCapture(window, video) {
  const state = { amplitude: 0.5, paused: false, readyState: 4, muted: false, captures: 0, contexts: [], streams: [], captureError: null, sampleError: false };
  class Track extends window.EventTarget {
    constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.muted = false; }
    stop() { this.readyState = 'ended'; }
  }
  class Stream extends window.EventTarget {
    constructor(tracks = []) { super(); this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  }
  class AudioContext {
    constructor() { this.state = 'running'; this.closed = false; state.contexts.push(this); }
    createAnalyser() {
      return { fftSize: 2048, disconnect() {}, getFloatTimeDomainData(samples) {
        if (state.sampleError) throw new Error('Audio access lost');
        samples.fill(state.amplitude);
      } };
    }
    createMediaStreamSource(stream) {
      return { stream, connect() {}, disconnect() {} };
    }
    createChannelSplitter() { return { connect() {}, disconnect() {} }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  window.AudioContext = AudioContext;
  window.MediaStream = Stream;
  video.captureStream = () => {
    state.captures++;
    if (state.captureError) throw state.captureError;
    const stream = new Stream([new Track('audio'), new Track('video')]);
    state.streams.push(stream);
    return stream;
  };
  Object.defineProperties(video, {
    paused: { configurable: true, get: () => state.paused },
    readyState: { configurable: true, get: () => state.readyState }
  });
  return state;
}
