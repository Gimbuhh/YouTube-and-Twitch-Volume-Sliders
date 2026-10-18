import { clampVolume } from './volume.js';
import { createLufsAnalysis } from './lufs-analysis.js';
import { createLufsGainController } from './lufs-meter.js';

// Player APIs round percentages; a positive preference must stay audible.
const outputPercent = (value) => value > 0 ? Math.max(1, Math.round(clampVolume(value))) : 0;

// Capture is an analysis-only branch. Never route it to speakers or attach a
// MediaElementAudioSourceNode: a CORS failure must not silence normal playback.
// Captured samples are independent of the element's volume/mute (W3C
// mediacapture-fromelement), so adjusting native volume creates no feedback loop.
export function createVolumeNormalizer({ window, getVolume, setVolume, isMuted, onStatusChanged = () => {} }) {
  let enabled = false;
  let session = null;
  let status = 'Off';
  let lastDetails = '';
  let lastUiUpdate = -Infinity;

  function getDetails() {
    if (!session || !status.startsWith('Active')) return '';
    const { preferred, applied } = session;
    const action = applied < preferred ? 'Reducing loud audio' : applied > preferred ? 'Raising quiet audio' : 'Near target';
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
    if (Math.abs(actual - owned.applied) > 0.6) {
      // A native control or the site changed volume. That becomes new intent.
      owned.preferred = actual;
      owned.applied = actual;
      owned.gain = 1;
      owned.lufsTracker = null;
    }
    return owned.preferred;
  }

  function writeOutput(owned, value) {
    const next = outputPercent(value);
    if (next === owned.applied) return;
    const previous = owned.applied;
    owned.applied = next; // Own synchronous and queued volumechange events.
    owned.writing = true;
    try { setVolume(owned.video, next, { preserveMute: true }); }
    catch (error) { owned.applied = previous; throw error; }
    finally { owned.writing = false; }
  }

  function restore(owned) {
    const preferred = readPreferred(owned);
    owned.gain = 1;
    writeOutput(owned, preferred);
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
    if (owned.track) restore(owned);
    owned.lufs?.dispose();
    owned.lastLufsFrame = null;
    owned.track = track;
    owned.lufsTracker = null;
    owned.analysisStarted = window.performance.now();
    owned.lufs = createLufsAnalysis({ window, context: owned.context, track,
      onFrame: frame => {
        if (session !== owned || !owned.video.isConnected || owned.blocked) return;
        owned.lastLufsFrame = window.performance.now();
        owned.catchUpAfter = 0;
        if (owned.video.paused || owned.video.ended || owned.video.readyState < 2 || owned.track?.muted || owned.track?.readyState !== 'live' || owned.preferred === 0 || owned.lufs?.needsActivation) return;
        try {
          owned.lufsTracker ||= createLufsGainController();
          // Most fast measurements cannot change gain. Skip player API reads
          // for those; the ordinary frames/timer still track native intent.
          if (frame.attackPower != null && !owned.lufsTracker.wantsAttack(frame.attackPower)) return;
          if (isMuted(owned.video)) return;
          // Respect native input before a fast cut, just as the polling path
          // does. Increases still wait for its regular 50 ms output tick.
          readPreferred(owned);
          owned.lufsTracker ||= createLufsGainController();
          owned.gain = owned.lufsTracker.update(frame, 100 / Math.max(1, owned.preferred));
          const output = owned.preferred * owned.gain;
          if (outputPercent(output) < owned.applied) writeOutput(owned, output);
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
      if (!owned.stream) {
        const capture = video.captureStream || video.mozCaptureStream;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const hasAnalysis = window.MediaStreamTrackProcessor || (window.AudioWorkletNode && window.Blob && window.URL?.createObjectURL);
        if (!capture || !AudioContext || !window.MediaStream || !hasAnalysis) {
          owned.blocked = true;
          report('Unavailable in this browser');
          return;
        }
        owned.stream = capture.call(video);
        owned.context = new AudioContext();
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
      if (owned.lufs?.needsActivation) {
        restore(owned);
        report('Click the player to activate');
        return;
      }
      if (!owned.track || owned.track.muted || owned.track.readyState !== 'live') {
        restore(owned);
        report('Waiting for accessible audio');
        return;
      }
      if (isMuted(video) || owned.preferred === 0) {
        owned.lastLufsFrame = null;
        owned.analysisStarted = window.performance.now();
        report('Muted');
        return;
      }
      const starting = owned.lastLufsFrame == null;
      if (now - (starting ? owned.analysisStarted : owned.lastLufsFrame) > (starting ? 3000 : 500)) {
        // A long page task can run this overdue timer before queued audio.
        // Hold the correction for one bounded catch-up; genuine stalls still
        // fail if no fresh frame arrives, even if subsequent ticks are late.
        if (delayed && !owned.catchUpAfter) owned.catchUpAfter = now + 100;
        if (now < (owned.catchUpAfter || 0)) return;
        unavailable(owned); return;
      }
      if (starting) {
        report('Starting audio analysis');
        return;
      }
      writeOutput(owned, owned.preferred * owned.gain);
      if (now - owned.analysisStarted >= 3000) owned.retryDelay = 1000;
      // A quiet measurement does not mean the live capture source disappeared.
      report(owned.applied === 100 && owned.gain > 1 ? 'Active — at volume limit' : 'Active');
    } catch {
      unavailable(owned);
    }
  }

  function bind(video) {
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
      window.document.removeEventListener('pointerdown', owned.gesture, true);
      window.document.removeEventListener('keydown', owned.gesture, true);
      releaseCapture(owned);
    }
    if (!enabled || !video) {
      report(enabled ? 'Waiting for playback' : 'Off');
      return;
    }
    const preferred = clampVolume(getVolume(video));
    const owned = session = {
      video, preferred, applied: preferred, gain: 1, blocked: false, retryAt: 0, retryDelay: 1000
    };
    owned.reset = () => {
      try { restore(owned); }
      catch { /* the source can become inaccessible before its load event */ }
      releaseCapture(owned);
      owned.blocked = false;
      owned.retryAt = 0;
      owned.retryDelay = 1000;
      report('Waiting for playback');
    };
    owned.retry = () => { owned.blocked = false; owned.retryAt = 0; tick(); };
    owned.gesture = () => {
      if (owned.blocked && owned.retryAt) owned.retry();
      else { resume(owned); tick(); }
    };
    for (const type of ['emptied', 'loadstart']) video.addEventListener(type, owned.reset);
    for (const type of ['playing', 'loadedmetadata']) video.addEventListener(type, owned.retry);
    window.document.addEventListener('pointerdown', owned.gesture, true);
    window.document.addEventListener('keydown', owned.gesture, true);
    owned.timer = window.setInterval(tick, 50);
    tick();
  }

  return {
    bind,
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
    setPreferredVolume(video, value, options) {
      let output = clampVolume(value);
      const owned = session?.video === video ? session : null;
      if (owned) {
        owned.preferred = output;
        output = outputPercent(output * owned.gain);
        owned.applied = output;
        owned.writing = true;
      }
      try { setVolume(video, output, options); }
      finally { if (owned) owned.writing = false; }
    }
  };
}
