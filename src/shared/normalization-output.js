// A media-element attachment cannot be undone or recreated. Keep one context
// per document and one source per element, with ordinary playback as its idle
// route. Normalization owns only the temporary graph connected to that source.
const documents = new WeakMap();

function registry(window) {
  let state = documents.get(window);
  if (!state) {
    state = { sources: new WeakMap(), reserved: new WeakSet(), external: new WeakSet() };
    documents.set(window, state);
  }
  return state;
}

export function installMediaOutputGuard(window) {
  const state = registry(window);
  const Context = window.AudioContext || window.webkitAudioContext;
  if (state.createSource || !Context?.prototype.createMediaElementSource) {
    return;
  }
  state.createSource = Context.prototype.createMediaElementSource;
  // Chrome rejects a second source already; Firefox can mix an uncontrolled
  // parallel path. Observe external claims, and protect only our owned elements.
  function externalSource(video, create) {
    if (state.reserved.has(video) || state.sources.has(video)) {
      throw new window.DOMException('Volume Slider already owns this media element', 'InvalidStateError');
    }
    const source = create();
    state.external.add(video);
    return source;
  }
  Context.prototype.createMediaElementSource = function (video) {
    return externalSource(video, () => state.createSource.call(this, video));
  };
  if (window.MediaElementAudioSourceNode) {
    window.MediaElementAudioSourceNode = new Proxy(window.MediaElementAudioSourceNode, {
      construct(target, args, newTarget) {
        return externalSource(args[1]?.mediaElement, () => Reflect.construct(target, args, newTarget));
      }
    });
  }
}

export function assertMediaOutputAvailable(window, video) {
  if (registry(window).external.has(video)) {
    throw mediaOutputConflict();
  }
}

export function reserveMediaOutput(window, video) {
  assertMediaOutputAvailable(window, video);
  // Keep the choice for this element until reload/replacement. 7TV can cache
  // a failed attachment even if no native source was created on our side yet.
  registry(window).reserved.add(video);
}

export function registerExternalMediaOutput(window, video) {
  if (video && !ownsMediaOutput(window, video)) {
    registry(window).external.add(video);
  }
}

function mediaOutputConflict() {
  const error = new Error('Another audio processor already owns this player');
  error.name = 'AudioSourceConflict';
  return error;
}

export function ownsMediaOutput(window, video) {
  const state = documents.get(window);
  return !!video && !!state && (state.reserved.has(video) || state.sources.has(video));
}

export function acquireMediaOutput(window, video) {
  installMediaOutputGuard(window);
  assertMediaOutputAvailable(window, video);
  const url = video.currentSrc && new URL(video.currentSrc, window.location.href);
  if (video.mediaKeys || (!video.srcObject && (!url || (url.origin !== window.location.origin && !video.crossOrigin)))) {
    throw new Error('Direct audio processing requires an accessible media source');
  }
  const document = registry(window);
  if (!document.context) {
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context({ latencyHint: 'interactive' });
    document.context = context;
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
        // Activation can yield before connection; another processor may win
        // that interval. Check again at the actual source-creation boundary.
        assertMediaOutputAvailable(window, video);
        try { source = document.createSource.call(document.context, video); }
        catch (error) {
          if (error.name === 'InvalidStateError') {
            throw mediaOutputConflict();
          }
          throw error;
        }
        document.sources.set(video, source);
        video.addEventListener('playing', document.resume);
      }
      source.disconnect(); source.connect(input);
    },
    restore() { if (source) { source.disconnect(); if (video.isConnected) source.connect(document.context.destination); } }
  };
}
