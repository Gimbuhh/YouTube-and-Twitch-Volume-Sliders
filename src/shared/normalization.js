import { clampVolume } from './volume.js';
import { createLufsAnalysis, prepareLufsAnalysis } from './lufs-analysis.js';
import { createLufsGainController, MIN_NORMALIZATION_GAIN } from './lufs-meter.js';

// Player APIs round percentages; a positive preference must stay audible.
const outputPercent = (value) => value > 0 ? Math.max(1, Math.round(clampVolume(value))) : 0;

// Capture is an analysis-only branch. Never route it to speakers or attach a
// MediaElementAudioSourceNode: a CORS failure must not silence normal playback.
// Captured samples are independent of the element's volume/mute (W3C
// mediacapture-fromelement), so adjusting native volume creates no feedback loop.
export function createVolumeNormalizer({ window, getVolume, setVolume, isMuted, onStatusChanged = () => {} }) {
  let enabled = false;
  let sourceChanging = false;
  let session = null;
  let status = 'Off';
  let lastDetails = '';
  let lastUiUpdate = -Infinity;

  function getDetails() {
    if (!session || !status.startsWith('Active')) return '';
    const { preferred, applied } = session;
    const action = applied < preferred ? 'Reducing loud audio' : applied > preferred ? 'Raising quiet audio' : 'No volume adjustment';
    return `${action}\nOutput ${applied}% · Selected ${preferred}%`;
  }

  function report(next) {
    const changed = status !== next;
    status = next;
    const details = getDetails();
    const now = window.performance.now();
    if (!changed && (details === lastDetails || now - lastUiUpdate < 500)) return;
    lastDetails = details;
    lastUiUpdate = now;
    onStatusChanged();
  }

  function readPreferred(owned, rawVolume) {
    if (owned.writing) return owned.preferred;
    const actual = clampVolume(rawVolume ?? getVolume(owned.video));
    // Stream replacement and site restoration also write native volume. Only
    // explicit native-control input may change intent; repair passive writes
    // on the existing output tick, even when its desired output is unchanged.
    owned.outputChanged = Math.abs(actual - owned.applied) > .6;
    return owned.preferred;
  }

  function writeOutput(owned, value, gradual = false) {
    const next = outputPercent(value);
    const nativeChanged = owned.applied === 0 ? owned.video.volume !== 0
      : Math.abs(owned.video.volume - owned.applied / 100) > 1e-6;
    if (next === owned.applied && !owned.outputChanged && !nativeChanged) return;
    // A small margin above the rounding boundary prevents tiny fluctuations
    // from toggling whole percentages. Cuts and explicit input stay immediate.
    if (gradual && !owned.outputChanged && !nativeChanged && next > owned.applied &&
        value < owned.applied + .6) return;
    const now = window.performance.now();
    // Coalesce sub-0.5 dB recovery steps for at most 150 ms. Cuts, explicit
    // input and restoration stay immediate; the existing timer finishes even
    // the last small increase without allocating another timer or queue.
    if (gradual && !owned.outputChanged && !nativeChanged && next > owned.applied && owned.applied > 0 &&
        next / owned.applied < 10 ** (.5 / 20) && now - owned.lastWriteAt < 150) return;
    const previous = owned.applied;
    owned.applied = next; // Own synchronous and queued volumechange events.
    owned.writing = true;
    try {
      // Apply audible output now; a player API can acknowledge a command before
      // its playback worker applies it. Keep that API in sync for site controls.
      owned.video.volume = next / 100;
      setVolume(owned.video, next, { preserveMute: true });
      owned.lastWriteAt = now;
      owned.outputChanged = false;
    }
    catch (error) { owned.applied = previous; throw error; }
    finally { owned.writing = false; }
  }

  function restore(owned) {
    const preferred = readPreferred(owned);
    owned.gain = 1;
    owned.awaitingFrame = false;
    owned.startupPower = 0;
    owned.hasProgrammeFrame = false;
    writeOutput(owned, preferred);
    owned.lufsTracker = null;
    owned.lastLufsFrame = null;
    owned.catchUpAfter = 0;
    owned.analysisStarted = window.performance.now();
  }

  function resetAnalysis(owned) {
    readPreferred(owned);
    // Capture ignores native volume, so samples can establish the first
    // correction while playback is silent. Preserve the user's mute/intent.
    owned.gain = 0;
    owned.awaitingFrame = true;
    owned.startupPower = 0;
    owned.hasProgrammeFrame = false;
    writeOutput(owned, 0);
    owned.lufsTracker = null;
    owned.lastLufsFrame = null;
    owned.catchUpAfter = 0;
    owned.analysisStarted = window.performance.now();
  }

  function releaseCapture(owned) {
    owned.lufs?.dispose();
    owned.lufs = null;
    owned.lastLufsFrame = null;
    owned.track = null;
    if (owned.stream) {
      owned.stream.removeEventListener('addtrack', owned.onTrack);
      for (const track of owned.stream.getTracks()) track.stop();
      owned.stream = null;
    }
    if (owned.context) {
      owned.context.close().catch(() => {});
      owned.context = null;
    }
  }

  function unavailable(owned, retry = true) {
    try { restore(owned); } catch { /* the site's outgoing player may already be unavailable */ }
    releaseCapture(owned);
    owned.blocked = true;
    // A capture created during player startup can fail before audio is ready.
    // Reconnect on the existing timer, with backoff for inaccessible streams.
    owned.retryAt = retry ? window.performance.now() + owned.retryDelay : 0;
    if (retry) owned.retryDelay = Math.min(30000, owned.retryDelay * 2);
    report('Audio unavailable — normal volume');
  }

  function connectTrack(owned) {
    for (const track of owned.stream.getVideoTracks()) track.stop();
    const track = owned.stream.getAudioTracks().find((item) => item.readyState === 'live');
    if (!track || track === owned.track) return;
    resetAnalysis(owned);
    owned.lufs?.dispose();
    owned.track = track;
    owned.lufs = createLufsAnalysis({ window, context: owned.context, track,
      onFrame: frame => {
        if (session !== owned || !owned.video.isConnected || owned.blocked || sourceChanging) return;
        owned.lastLufsFrame = window.performance.now();
        owned.catchUpAfter = 0;
        if (owned.video.paused || owned.video.ended || owned.video.readyState < 2 || owned.track?.muted || owned.track?.readyState !== 'live' || owned.preferred === 0 || owned.lufs?.needsActivation) return;
        try {
          if (frame.attackPower == null) {
            if (!Number.isFinite(frame.power) || !Number.isFinite(frame.rawPower) || !Number.isFinite(frame.duration) || frame.duration <= 0) return;
            owned.hasProgrammeFrame = true;
            // Healthy decoder silence is not a loudness estimate. Quiet but
            // measurable recordings must still open instead of staying silent.
            if (owned.awaitingFrame && (frame.rawPower <= 0 || frame.power <= 0)) return;
          }
          if (owned.awaitingFrame && frame.attackPower != null) {
            if (!Number.isFinite(frame.attackPower) || frame.attackPower <= 0 || isMuted(owned.video)) return;
            owned.startupPower = Math.max(owned.startupPower, frame.attackPower);
            // Make the first samples audible only at the controller's lowest
            // possible output. Full loudness matching still needs its 50 ms frame.
            if (owned.gain === 0) {
              readPreferred(owned);
              owned.gain = MIN_NORMALIZATION_GAIN;
              writeOutput(owned, owned.preferred * owned.gain);
            }
            return;
          }
          owned.lufsTracker ||= createLufsGainController();
          // Most fast measurements cannot change gain. Skip player API reads
          // for those; the ordinary frames/timer still track native intent.
          if (frame.attackPower != null && !owned.lufsTracker.wantsAttack(frame.attackPower)) return;
          if (isMuted(owned.video)) return;
          // Respect native input before a fast cut, just as the polling path
          // does. Increases still wait for its regular 50 ms output tick.
          readPreferred(owned);
          const starting = owned.awaitingFrame;
          // A fresh capture can ramp in during its first frame. Its loudest
          // short measurement must also bound the initial audible correction.
          owned.gain = owned.lufsTracker.update(starting
            ? { ...frame, momentaryPower: Math.max(frame.momentaryPower ?? frame.power, owned.startupPower) } : frame,
          100 / Math.max(1, owned.preferred));
          const output = owned.preferred * owned.gain;
          owned.awaitingFrame = false;
          // A partial first frame can precede louder measurements already in
          // the capture queue. Open softly; increases use the existing tick.
          if (starting) writeOutput(owned, Math.min(output, owned.preferred * MIN_NORMALIZATION_GAIN));
          else if (outputPercent(output) < owned.applied) writeOutput(owned, output);
        } catch { unavailable(owned); }
      },
      onFailure: () => {
        if (session === owned) unavailable(owned);
      }
    });
    if (owned.blocked) { owned.lufs?.dispose(); owned.lufs = null; }
    else if (!owned.lufs) unavailable(owned);
  }

  function resume(owned) {
    if (!owned.context || !owned.lufs?.needsActivation || owned.context.state !== 'suspended' || owned.resuming) return;
    owned.resuming = true;
    owned.context.resume().catch(() => {}).finally(() => { owned.resuming = false; });
  }

  function prepareContext(owned) {
    if (owned.context || owned.video.mediaKeys) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const hasAnalysis = window.MediaStreamTrackProcessor || (window.AudioWorkletNode && window.Blob && window.URL?.createObjectURL);
    if (!(owned.video.captureStream || owned.video.mozCaptureStream) || !AudioContext || !window.MediaStream || !hasAnalysis) return;
    owned.context = new AudioContext();
    // Load the processor before playback when possible. Input and failure
    // handling still belong to connectTrack; preparation never attaches nodes.
    prepareLufsAnalysis({window, context:owned.context}).catch(() => {});
  }

  function tick() {
    const owned = session;
    if (!owned) return;
    const now = window.performance.now();
    const delayed = owned.lastTick != null && now - owned.lastTick > 500;
    owned.lastTick = now;
    const video = owned.video;
    if (!video.isConnected) { bind(null); return; }
    if (owned.blocked) {
      if (!owned.retryAt || now < owned.retryAt || video.paused || video.ended || video.readyState < 2) return;
      owned.blocked = false;
      owned.retryAt = 0;
    }
    if (video.mediaKeys) { unavailable(owned, false); return; }
    if (video.paused || video.ended || video.readyState < 2) {
      owned.lastLufsFrame = null;
      owned.analysisStarted = window.performance.now();
      report('Waiting for playback');
      return;
    }
    try {
      if (sourceChanging) {
        if (now - owned.analysisStarted > 3000) {
          sourceChanging = false;
          unavailable(owned);
        } else {
          readPreferred(owned);
          writeOutput(owned, 0);
          report('Waiting for playback');
        }
        return;
      }
      if (!owned.stream) {
        const capture = video.captureStream || video.mozCaptureStream;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const hasAnalysis = window.MediaStreamTrackProcessor || (window.AudioWorkletNode && window.Blob && window.URL?.createObjectURL);
        if (!capture || !AudioContext || !window.MediaStream || !hasAnalysis) {
          restore(owned);
          owned.blocked = true;
          report('Unavailable in this browser');
          return;
        }
        owned.stream = capture.call(video);
        owned.context ||= new AudioContext();
        owned.onTrack = () => {
          try { connectTrack(owned); } catch { unavailable(owned); }
        };
        owned.stream.addEventListener('addtrack', owned.onTrack);
        connectTrack(owned);
        if (owned.blocked) return;
        resume(owned);
      }
      // Track additions are handled by onTrack. A healthy existing track does
      // not need fresh audio/video track arrays on every output timer tick.
      if (!owned.track || owned.track.readyState !== 'live') connectTrack(owned);
      if (owned.blocked) return;
      readPreferred(owned);
      if (owned.awaitingFrame) writeOutput(owned, owned.preferred * owned.gain);
      if (owned.lufs?.needsActivation) {
        if (owned.awaitingFrame && owned.resuming && now - owned.analysisStarted < 3000) {
          report('Starting audio analysis');
          return;
        }
        restore(owned);
        report('Click the player to activate');
        return;
      }
      if (!owned.track || owned.track.muted || owned.track.readyState !== 'live') {
        if (!owned.awaitingFrame) restore(owned);
        else if (now - owned.analysisStarted > 3000) { unavailable(owned); return; }
        report('Waiting for accessible audio');
        return;
      }
      if (isMuted(video) || owned.preferred === 0) {
        owned.lastLufsFrame = null;
        owned.analysisStarted = window.performance.now();
        report('Waiting for audio');
        return;
      }
      const starting = !owned.hasProgrammeFrame || owned.lastLufsFrame == null;
      if (now - (starting ? owned.analysisStarted : owned.lastLufsFrame) > (starting ? 3000 : 500)) {
        // A long page task can run this overdue timer before queued audio.
        // Hold the correction for one bounded catch-up; genuine stalls still
        // fail if no fresh frame arrives, even if subsequent ticks are late.
        if (delayed && !owned.catchUpAfter) owned.catchUpAfter = now + 100;
        if (now < (owned.catchUpAfter || 0)) return;
        unavailable(owned); return;
      }
      if (starting || owned.awaitingFrame) {
        report(owned.hasProgrammeFrame && owned.awaitingFrame ? 'Waiting for audio' : 'Starting audio analysis');
        return;
      }
      writeOutput(owned, owned.preferred * owned.gain, true);
      if (now - owned.analysisStarted >= 3000) owned.retryDelay = 1000;
      // A quiet measurement does not mean the live capture source disappeared.
      report(owned.applied === 100 && owned.applied > owned.preferred ? 'Active — at volume limit' : 'Active');
    } catch {
      unavailable(owned);
    }
  }

  function bind(video, preferredVolume) {
    if (session?.video === video) return;
    if (session) {
      const owned = session;
      // A detached player's API can already point at the incoming player.
      try { if (owned.video.isConnected) restore(owned); }
      catch { /* a failing outgoing player must not prevent capture cleanup */ }
      session = null;
      window.clearInterval(owned.timer);
      for (const type of ['emptied', 'loadstart']) owned.video.removeEventListener(type, owned.reset);
      for (const type of ['playing', 'loadedmetadata']) owned.video.removeEventListener(type, owned.retry);
      owned.video.removeEventListener('volumechange', owned.holdOutput);
      window.document.removeEventListener('pointerdown', owned.gesture, true);
      window.document.removeEventListener('keydown', owned.gesture, true);
      releaseCapture(owned);
    }
    if (!enabled || !video) {
      report(enabled ? 'Waiting for playback' : 'Off');
      return;
    }
    const preferred = clampVolume(preferredVolume ?? getVolume(video));
    const owned = session = {
      video, preferred, applied: preferred, gain: 1, lastWriteAt: -Infinity, blocked: false, retryAt: 0, retryDelay: 1000
    };
    owned.reset = event => {
      // A native load event confirms that the outgoing source has been cleared.
      if (event) sourceChanging = false;
      try { resetAnalysis(owned); }
      catch { /* the source can become inaccessible before its load event */ }
      // A prepared context has no source-specific graph to discard yet.
      // Initial load events can reuse it instead of compiling the meter twice.
      if (owned.stream) releaseCapture(owned);
      owned.blocked = false;
      owned.retryAt = 0;
      owned.retryDelay = 1000;
      report('Waiting for playback');
      try { prepareContext(owned); } catch { unavailable(owned); }
    };
    owned.retry = () => { owned.blocked = false; owned.retryAt = 0; tick(); };
    owned.holdOutput = () => {
      if (owned.blocked || owned.writing) return;
      // Native-control intent is adopted in a microtask after its site handler.
      // Let that run first; passive site writes still close in this same turn.
      window.queueMicrotask(() => {
        if (session !== owned || !owned.video.isConnected || owned.blocked) return;
        // Repair the last applied output; recalculating here could bypass the
        // gradual timer and rounding guard on an unrelated site notification.
        try { readPreferred(owned); writeOutput(owned, owned.applied); }
        catch { unavailable(owned); }
      });
    };
    owned.gesture = () => {
      if (owned.blocked && owned.retryAt) owned.retry();
      else { resume(owned); tick(); }
    };
    for (const type of ['emptied', 'loadstart']) video.addEventListener(type, owned.reset);
    for (const type of ['playing', 'loadedmetadata']) video.addEventListener(type, owned.retry);
    video.addEventListener('volumechange', owned.holdOutput);
    window.document.addEventListener('pointerdown', owned.gesture, true);
    window.document.addEventListener('keydown', owned.gesture, true);
    owned.timer = window.setInterval(tick, 50);
    try { resetAnalysis(owned); prepareContext(owned); } catch { unavailable(owned); }
    tick();
  }

  return {
    bind,
    setSourceChanging(value) {
      const next = !!value;
      if (next === sourceChanging) return;
      sourceChanging = next;
      if (!session) return;
      if (next) session.reset();
      else tick();
    },
    isBoundTo: video => session?.video === video,
    setEnabled(value) {
      enabled = !!value;
      if (!enabled) bind(null);
      else if (!session) report('Waiting for playback');
    },
    getStatus: () => status,
    getDetails,
    getPreferredVolume(video, rawVolume) {
      return session?.video === video ? readPreferred(session, rawVolume) : rawVolume;
    },
    acceptNativeVolume(video) {
      const owned = session?.video === video ? session : null;
      if (!owned || owned.writing) return;
      const actual = clampVolume(getVolume(video));
      if (Math.abs(actual - owned.applied) > .6) {
        owned.preferred = Math.round(clampVolume(owned.applied > 0 && !owned.awaitingFrame
          ? owned.preferred * actual / owned.applied : actual));
        owned.applied = actual;
        owned.lastWriteAt = window.performance.now();
      }
      owned.outputChanged = false;
      if (owned.awaitingFrame) writeOutput(owned, owned.preferred * owned.gain);
    },
    setPreferredVolume(video, value, options) {
      let output = clampVolume(value);
      const owned = session?.video === video ? session : null;
      if (owned) {
        owned.preferred = output;
        output = outputPercent(output * owned.gain);
        owned.applied = output;
        owned.outputChanged = false;
        owned.lastWriteAt = window.performance.now();
        owned.writing = true;
      }
      try { setVolume(video, output, options); }
      finally { if (owned) owned.writing = false; }
    }
  };
}
