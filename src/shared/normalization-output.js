// A media-element attachment cannot be undone or recreated. Keep one context
// per document and one source per element, with ordinary playback as its idle
// route. Normalization owns only the temporary graph connected to that source.
const documents = new WeakMap();

// Commands can reach the renderer a batch after currentTime was read. Firefox
// reports zero baseLatency on some devices; outputLatency covers that batch.
// This lead is for output gates only, never the sample-clocked limiter.
export function mediaTransitionTime(context) {
  return context.currentTime + Math.max(context.baseLatency || 0, context.outputLatency || 0, 128 / context.sampleRate);
}

export function waitForMediaRender(window, context, time) {
  return new Promise(resolve => {
    const check = () => {
      if (context.state !== 'running' || context.currentTime >= time) resolve();
      else window.setTimeout(check, 2);
    };
    check();
  });
}

// The native volume command must reach the renderer before ordinary audio
// fades back in. A new normalizer invalidates this gate before connecting.
export function fadeInMediaOutput(window, video) {
  const document = documents.get(window), route = document?.routes.get(video), gate = route?.ordinary;
  if (!gate || route.pending) return Promise.resolve();
  const context = document.context;
  return waitForMediaRender(window, context, context.currentTime + (context.baseLatency || 0) + 256 / context.sampleRate).then(() => {
    if (route.ordinary !== gate || route.pending) return;
    const at = mediaTransitionTime(context);
    gate.gain.setValueAtTime(0, at);
    gate.gain.linearRampToValueAtTime(1, at + .005);
  });
}

function registry(window) {
  let state = documents.get(window);
  if (!state) {
    state = { sources: new WeakMap(), routes: new WeakMap(), active: new Set(), reserved: new WeakSet(), external: new WeakSet() };
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

// Suspending preserves the element attachment and the programme history. Track
// ordinary routes too: disabling one normalizer must not silence another player.
function reconcile(document) {
  for (const route of document.active) {
    if (!route.video.isConnected) {
      document.sources.get(route.video)?.disconnect();
      route.ordinary?.disconnect(); route.ordinary = null;
      document.active.delete(route);
    }
  }
  const context = document.context;
  if (context.state === 'running') document.activated = true;
  if (document.active.size) {
    if (document.suspending) return document.suspending.then(() => reconcile(document));
    if (context.state === 'suspended') {
      return context.resume().then(() => {
        // A pause or detachment can arrive while resume is still in flight.
        // Recheck after activation instead of leaving an idle context running.
        if (context.state === 'running') return reconcile(document);
      });
    }
    return Promise.resolve();
  }
  if (context.state === 'running' && !document.suspending && context.suspend) {
    document.suspending = context.suspend().finally(() => {
      document.suspending = null;
      if (document.active.size) { reconcile(document).catch(() => {}); }
    });
    return document.suspending;
  }
  return Promise.resolve();
}

function activity(document, route, paused) {
  if (!paused && (route.pending || document.sources.has(route.video))) document.active.add(route);
  else document.active.delete(route);
  return reconcile(document);
}

export function acquireMediaOutput(window, video, { onPause } = {}) {
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
    const resume = () => { reconcile(document).catch(() => {}); };
    window.document.addEventListener('pointerdown', resume, true);
    window.document.addEventListener('keydown', resume, true);
  }
  let route = document.routes.get(video);
  if (!route) {
    route = { video, pending: false };
    document.routes.set(video, route);
    for (const type of ['play', 'playing', 'pause', 'ended']) {
      video.addEventListener(type, () => {
        const paused = video.paused || video.ended;
        // Close the owned gate before this listener can freeze rendering,
        // regardless of the order of the player's other pause listeners.
        if (paused && route.pending) route.onPause?.();
        if (!paused) route.pausing = null;
        if (!route.pausing) activity(document, route, paused).catch(() => {});
      });
    }
  }
  route.pending = true;
  route.onPause = onPause;
  let source = document.sources.get(video);
  function restoreRoute() {
    route.pending = false;
    route.ordinary?.disconnect(); route.ordinary = null;
    if (source) {
      source.disconnect();
      if (video.isConnected) {
        const gate = route.ordinary = document.context.createGain();
        gate.gain.value = 0; gate.connect(document.context.destination); source.connect(gate);
      }
    }
    activity(document, route, video.paused || video.ended).catch(() => {});
  }
  return { context: document.context,
    get source() { return source; },
    setPaused(paused, after) {
      if (paused && after && document.context.state === 'running') {
        if (route.pausing === after) return;
        route.pausing = after;
        after.then(() => {
          if (route.pausing !== after) return;
          route.pausing = null;
          activity(document, route, video.paused || video.ended).catch(() => {});
        });
      } else {
        route.pausing = null;
        activity(document, route, paused).catch(() => {});
      }
    },
    resume() {
      // A replacement graph must not cut short the outgoing graph's fade or
      // be disconnected by its deferred restoration of ordinary playback.
      return route.restoring ? route.restoring.then(() => activity(document, route, video.paused || video.ended))
        : activity(document, route, video.paused || video.ended);
    },
    connect(input) {
      // Do not divert ordinary audio into a context still awaiting activation.
      const context = document.context;
      // Activation may have succeeded and then returned to idle because the
      // user paused. Keep its protected route ready for the next play event.
      const activatedPause = context.state === 'suspended' && document.activated && (video.paused || video.ended);
      if (context.state !== 'running' && !activatedPause) throw new Error('Audio processing requires player activation');
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
      }
      route.ordinary?.disconnect(); route.ordinary = null;
      source.disconnect(); source.connect(input);
    },
    restore(after) {
      if (route.onPause === onPause) route.onPause = null;
      if (after) {
        route.pending = false;
        route.restoring = after.then(() => {
          route.restoring = null;
          // An incoming normalizer has reserved this element during the fade.
          // Never insert an ordinary, unprotected route between the two graphs.
          if (route.pending) { source?.disconnect(); }
          else { restoreRoute(); }
        });
        return route.restoring;
      }
      if (route.restoring) { route.pending = false; return route.restoring; }
      restoreRoute();
    }
  };
}
