// A media-element attachment cannot be undone or recreated. Keep one context
// per document and one source per element, with ordinary playback as its idle
// route. Normalization owns only the temporary graph connected to that source.
const documents = new WeakMap();

export function acquireMediaOutput(window, video) {
  const url = video.currentSrc && new URL(video.currentSrc, window.location.href);
  if (video.mediaKeys || (!video.srcObject && (!url || (url.origin !== window.location.origin && !video.crossOrigin)))) {
    throw new Error('Direct audio processing requires an accessible media source');
  }
  let document = documents.get(window);
  if (!document) {
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context({ latencyHint: 'interactive' });
    document = { context, sources: new WeakMap() };
    documents.set(window, document);
    const resume = () => {
      if (context.state === 'suspended') {
        context.resume().catch(() => {});
      }
    };
    window.document.addEventListener('pointerdown', resume, true);
    window.document.addEventListener('keydown', resume, true);
    document.resume = resume;
  }
  let source = document.sources.get(video);
  return { context: document.context,
    get source() { return source; },
    connect(input) {
      // Do not divert ordinary audio into a context still awaiting activation.
      if (document.context.state !== 'running') throw new Error('Audio processing requires player activation');
      if (!source) {
        source = document.context.createMediaElementSource(video);
        document.sources.set(video, source);
        video.addEventListener('playing', document.resume);
      }
      source.disconnect(); source.connect(input);
    },
    restore() { if (source) { source.disconnect(); if (video.isConnected) source.connect(document.context.destination); } }
  };
}
