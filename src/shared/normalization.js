import { clampVolume } from './volume.js';
import { createAudiblePlayback } from './normalization-playback.js';
import { installMediaOutputGuard, reserveMediaOutput, fadeInMediaOutput } from './normalization-output.js';

// Own selected volume and lifecycle independently of the processed output.
export function createVolumeNormalizer({ window, getVolume, setVolume, isMuted, onStatusChanged = () => {} }) {
  installMediaOutputGuard(window);
  const retiring = new WeakMap();
  let enabled = false, sourceChanging = false, session = null, status = 'Off', lastUiAt = -Infinity, lastDiagnostic = null;
  const now = () => window.performance.now();
  function report(next, immediate = false) {
    const changed = status !== next; status = next;
    schedule();
    if (!changed && !immediate && now() - lastUiAt < 500) return;
    if (session) {
      const diagnostic = JSON.stringify({ status, selected: session.preferred,
        output: session.preferred === 0 ? 0 : session.blocked ? session.preferred : Math.round(100 * (session.metrics?.gain || 0)), backend: session.playback?.backend || 'starting',
        context: session.playback?.context.state, metrics: session.metrics || null, error: session.error || null });
      if (diagnostic !== lastDiagnostic) {
        lastDiagnostic = diagnostic;
        window.document.documentElement.dataset.tmAudioNormalization = diagnostic;
      }
    }
    lastUiAt = now(); onStatusChanged();
  }
  function schedule() {
    const owned = session;
    if (!owned) return;
    // Audio rendering is sample-clocked. Poll quickly only while establishing
    // it; media events wake lifecycle checks immediately at all other times.
    const cadence = owned.blocked || owned.video.paused || owned.video.ended ? 500
      : sourceChanging || owned.track?.muted || owned.track?.readyState === 'ended' || !owned.metrics || !owned.playback?.running ? 50 : 250;
    if (owned.cadence === cadence) return;
    window.clearInterval(owned.timer);
    owned.cadence = cadence;
    owned.timer = window.setInterval(tick, cadence);
  }
  function nativeWrite(owned, value, options = { preserveMute: true }) {
    owned.writing = true;
    try { owned.video.volume = value / 100; setVolume(owned.video, value, options); }
    finally { owned.writing = false; }
  }
  function silence(owned) {
    if (owned.releasing) return;
    const volume = owned.playback?.connected ? 100 : 0;
    // The site can apply loudness compensation below its selected volume.
    // Requiring the element to match too fights that compensation on every
    // asynchronous volumechange, flooding the player and starving analysis.
    // Before connection, zero must also reach the element immediately even
    // when an asynchronous site API has already acknowledged the command.
    if (getVolume(owned.video) !== volume || (volume === 0 && owned.video.volume !== 0)) nativeWrite(owned, volume);
  }
  function sync(owned) {
    if (!owned.playback) return;
    owned.playback.setState({ selected: owned.preferred / 100, muted: isMuted(owned.video), paused: owned.video.paused || owned.video.ended });
  }
  function release(owned) {
    owned.generation++;
    const finishing = owned.playback?.dispose() || owned.releasing;
    owned.playback = null;
    const stream = owned.stream; owned.stream = null;
    const stopTracks = () => { if (stream) { for (const track of stream.getTracks()) track.stop(); } };
    if (finishing) {
      const releasing = Promise.resolve(finishing).then(() => {
        stopTracks();
        if (owned.releasing === releasing) {
          owned.releasing = null;
          if (session === owned) tick();
        }
      });
      owned.releasing = releasing;
    } else { stopTracks(); }
    owned.track = null; owned.connecting = false; owned.metrics = null; owned.trackMutedAt = 0;
    return owned.releasing || Promise.resolve();
  }
  function reset(owned) {
    release(owned);
    reserveMediaOutput(window, owned.video);
    owned.blocked = false; owned.started = now(); owned.lastFrame = 0;
    silence(owned);
    report('Starting audio analysis');
  }
  function unavailable(owned, error) {
    if (session !== owned) return;
    const released = release(owned); owned.blocked = true; owned.error = String(error?.message || error || 'Audio unavailable');
    owned.sourceConflict = error?.name === 'AudioSourceConflict';
    owned.retryAt = now() + (owned.retryDelay || 1000);
    owned.retryDelay = Math.min(30000, (owned.retryDelay || 1000) * 2);
    released.then(() => {
      if (session !== owned || !owned.blocked) return;
      try { nativeWrite(owned, owned.preferred); }
      catch { /* the native element is restored even if its site API fails */ }
      fadeInMediaOutput(window, owned.video);
    });
    report(owned.sourceConflict ? 'Another audio processor is active — normal volume' : 'Audio unavailable — normal volume');
  }
  async function connect(owned) {
    if (owned.connecting || owned.playback?.analyzing || owned.blocked) return;
    owned.connecting = true; const generation = owned.generation;
    try {
      const capture = owned.video.captureStream || owned.video.mozCaptureStream;
      if (!capture || owned.video.mediaKeys) throw new Error('Audio capture is unavailable');
      owned.playback ||= createAudiblePlayback({ window, video: owned.video, selected: owned.preferred / 100,
        onMetrics(metrics) {
          if (session !== owned || owned.generation !== generation || owned.blocked) return;
          owned.metrics = metrics; owned.lastFrame = now();
          sync(owned);
          if (now() - owned.started > 3000) owned.retryDelay = 1000;
          owned.error = null;
          report(owned.video.paused || owned.video.ended || owned.video.readyState < 2 || sourceChanging ? 'Waiting for playback'
            : owned.track?.muted ? 'Waiting for accessible audio' : isMuted(owned.video) || owned.preferred === 0 ? 'Waiting for audio' : 'Active');
        },
        onFailure: error => { if (session === owned && owned.generation === generation) unavailable(owned, error); }
      });
      await owned.playback.ready;
      if (session !== owned || owned.generation !== generation || owned.blocked) return;
      // Changing the audible route can invalidate a capture made during player
      // initialization. Attach the protected graph and initialize native volume
      // first, then capture this stable output for analysis.
      silence(owned); sync(owned);
      if (owned.video.paused || owned.video.ended || owned.video.readyState < 2) { owned.connecting = false; return; }
      owned.stream ||= capture.call(owned.video);
      for (const track of owned.stream.getVideoTracks()) track.stop();
      const track = owned.stream.getAudioTracks().find(item => item.readyState === 'live');
      if (!track) { owned.connecting = false; return; }
      if (track.muted) throw new Error('Captured audio is inaccessible');
      owned.track = track;
      owned.started = now();
      await owned.playback.startAnalysis(track);
      if (session !== owned || owned.generation !== generation || owned.blocked) return;
      owned.connecting = false; silence(owned); sync(owned);
    } catch (error) { if (session === owned && owned.generation === generation) unavailable(owned, error); }
  }
  function tick() {
    try { check(); } finally { schedule(); }
  }
  function check() {
    const owned = session;
    if (!owned) return;
    if (!owned.video.isConnected) { bind(null); return; }
    if (owned.blocked) {
      if (owned.sourceConflict) { return; }
      if (sourceChanging || owned.video.paused || owned.video.readyState < 2 || now() < owned.retryAt) return;
      try { reset(owned); } catch (error) { unavailable(owned, error); return; }
    }
    try {
      silence(owned); sync(owned);
      if (sourceChanging) {
        if (now() - owned.changingAt > 3000) { sourceChanging = false; unavailable(owned, new Error('Source transition did not complete')); }
        else report('Waiting for playback');
        return;
      }
      if (owned.video.paused || owned.video.ended || owned.video.readyState < 2) {
        owned.lastFrame = 0; owned.started = now(); report('Waiting for playback'); return;
      }
      if (owned.track?.readyState === 'ended') reset(owned);
      connect(owned);
      if (owned.blocked) return;
      if (owned.track?.muted) {
        owned.trackMutedAt ||= now();
        if (now() - owned.trackMutedAt > 1500) unavailable(owned, new Error('Captured audio is inaccessible'));
        else report('Waiting for accessible audio');
        return;
      }
      owned.trackMutedAt = 0;
      if (!owned.playback?.running) {
        if (now() - owned.started > 3000) unavailable(owned, new Error('Click the player to activate audio processing'));
        else report(owned.playback?.connected && owned.playback.context.state === 'suspended' ? 'Click the player to activate' : 'Starting audio analysis');
        return;
      }
      // The first decoded audio can trail Twitch's video readiness. Keep the
      // startup guard through that priming, then use the shorter live watchdog.
      if (now() - (owned.lastFrame || owned.started) > (owned.metrics ? 1500 : 3000)) {
        unavailable(owned, new Error(owned.metrics ? 'Live audio processing stalled' : 'Audio analysis did not start'));
      }
    } catch (error) { unavailable(owned, error); }
  }
  function bind(video, preferredVolume) {
    if (session?.video === video) return;
    if (session) {
      const owned = session; session = null;
      window.clearInterval(owned.timer);
      for (const type of ['emptied', 'loadstart', 'seeking']) owned.video.removeEventListener(type, owned.reset);
      for (const type of ['play', 'playing', 'loadedmetadata', 'seeked', 'pause', 'ended', 'volumechange']) owned.video.removeEventListener(type, owned.update);
      window.document.removeEventListener('pointerdown', owned.gesture, true);
      window.document.removeEventListener('keydown', owned.gesture, true);
      retiring.set(owned.video, owned);
      release(owned).then(() => {
        if (retiring.get(owned.video) !== owned) return;
        if (owned.video.isConnected && session?.video !== owned.video) {
          try { nativeWrite(owned, owned.preferred, owned.restoreOptions); }
          catch { /* outgoing player failures must not retain analysis resources */ }
          fadeInMediaOutput(window, owned.video);
        }
        retiring.delete(owned.video);
      });
      delete window.document.documentElement.dataset.tmAudioNormalization;
      lastDiagnostic = null;
    }
    if (!enabled || !video) { report(enabled ? 'Waiting for playback' : 'Off'); return; }
    retiring.delete(video);
    const owned = session = { video, preferred: clampVolume(preferredVolume ?? getVolume(video)), generation: 0, started: now(), changingAt: now(), lastFrame: 0 };
    owned.reset = event => { if (event?.type !== 'seeking') sourceChanging = false; try { reset(owned); } catch (error) { unavailable(owned, error); } };
    owned.update = event => {
      if (owned.writing || owned.blocked) return;
      if (event.type === 'play' || event.type === 'playing') { owned.started = now(); owned.lastFrame = 0; }
      if (owned.updateQueued) return;
      owned.updateQueued = true;
      window.queueMicrotask(() => { owned.updateQueued = false; if (session === owned) tick(); });
    };
    owned.gesture = () => {
      if (owned.sourceConflict) { return; }
      if (owned.blocked) reset(owned);
      owned.playback?.resume().catch(() => {});
      tick();
    };
    for (const type of ['emptied', 'loadstart', 'seeking']) video.addEventListener(type, owned.reset);
    for (const type of ['play', 'playing', 'loadedmetadata', 'seeked', 'pause', 'ended', 'volumechange']) video.addEventListener(type, owned.update);
    window.document.addEventListener('pointerdown', owned.gesture, true);
    window.document.addEventListener('keydown', owned.gesture, true);
    try { reset(owned); tick(); } catch (error) { unavailable(owned, error); }
  }
  return {
    bind,
    isBoundTo: video => session?.video === video,
    setEnabled(value) { enabled = !!value; if (!enabled) bind(null); else if (!session) report('Waiting for playback'); },
    setSourceChanging(value) { const next = !!value; if (sourceChanging === next) return; sourceChanging = next; if (session) { if (next) { session.changingAt = now(); reset(session); } else tick(); } },
    getStatus: () => status,
    getDetails() {
      if (session?.sourceConflict) { return 'Turn off the other audio processor, then reload to use Auto-normalize volume.'; }
      if (!session || !status.startsWith('Active')) return '';
      const output = Math.round(100 * (session.metrics?.gain || 0));
      return `${output < session.preferred ? 'Reducing loud audio' : output > session.preferred ? 'Raising quiet audio' : 'No volume adjustment'}\nOutput ${output}% · Selected ${session.preferred}%`;
    },
    getPreferredVolume(video, raw) { return (session?.video === video ? session : retiring.get(video))?.preferred ?? raw; },
    acceptNativeVolume(video) {
      const owned = session?.video === video ? session : retiring.get(video);
      if (!owned || owned.writing) return;
      owned.preferred = clampVolume(getVolume(video));
      if (retiring.get(video) === owned) return;
      if (!owned.blocked) { silence(owned); sync(owned); }
      report(status, true);
    },
    setPreferredVolume(video, value, options) {
      const owned = session?.video === video ? session : retiring.get(video);
      if (!owned) { setVolume(video, value, options); return; }
      owned.preferred = clampVolume(value);
      if (retiring.get(video) === owned) { owned.restoreOptions = options; return; }
      if (owned.blocked) nativeWrite(owned, owned.preferred, options);
      else { nativeWrite(owned, owned.playback?.connected ? 100 : 0, options); sync(owned); }
      report(status, true);
    }
  };
}
