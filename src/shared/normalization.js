import { clampVolume } from './volume.js';

// Player APIs round percentages; a positive preference must stay audible.
const outputPercent = (value) => value > 0 ? Math.max(1, Math.round(clampVolume(value))) : 0;
const TARGET_RMS = 0.1; // Leave more headroom to match quiet sources without amplification.

// Measure channels independently: an analyser's mono downmix can cancel stereo
// audio. The loudest channel also works for mono and center-channel dialogue.
export function measureAudioLevel(channels) {
  if (ArrayBuffer.isView(channels)) channels = [channels];
  let power = 0;
  for (const samples of channels) {
    let sum = 0;
    for (const sample of samples) {
      if (!Number.isFinite(sample)) return null;
      sum += sample * sample;
    }
    power = Math.max(power, sum / Math.max(1, samples.length));
  }
  return power;
}

// A gated RMS approximation; this is not a LUFS meter or peak limiter.
export function createLoudnessTracker() {
  const history = [];
  let time = 0;
  let gain = 1;
  return {
    update(samples, elapsedSeconds, maxGain = 100) {
      const measuredPower = measureAudioLevel(samples);
      const dt = Math.min(0.25, Math.max(0, elapsedSeconds));
      if (!Number.isFinite(dt)) return gain;
      time += dt;
      while (history.length && history[0].time <= time - 3) history.shift();
      // Freeze through silence/noise floors instead of turning them up.
      if (measuredPower === null || measuredPower < 0.0001 || dt === 0) return gain;
      history.push({ power: measuredPower, duration: dt, time });
      let audibleSeconds = 0, energy = 0;
      for (const frame of history) {
        audibleSeconds += frame.duration;
        energy += frame.power * frame.duration;
      }
      const average = energy / audibleSeconds;
      // Ignore frames more than 10 dB below the current active average, so a
      // sentence's quiet endings do not keep pulling the level estimate down.
      let duration = 0, gatedEnergy = 0;
      for (const frame of history) {
        if (frame.power < average * 0.1) continue;
        duration += frame.duration;
        gatedEnergy += frame.power * frame.duration;
      }
      const power = gatedEnergy / duration;
      // A new loud passage can attenuate immediately instead of waiting for
      // the three-second history to catch up. Quiet passages recover slowly.
      const reference = Math.max(power, measuredPower);
      let desired = Math.min(maxGain, Math.max(0.1, TARGET_RMS / Math.sqrt(reference)));
      if (audibleSeconds < 1) desired = Math.min(1, desired);
      if (desired < gain) {
        // Once louder audio is measured, remove the boost without another ramp.
        gain = desired;
      } else {
        // Recover cautiously between phrases; sustained quiet sources still match.
        const seconds = time < 3 ? 0.9 : 3;
        gain = Math.exp(Math.log(gain) + (Math.log(desired) - Math.log(gain)) * (1 - Math.exp(-dt / seconds)));
      }
      return gain;
    }
  };
}

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
      owned.tracker = createLoudnessTracker();
    }
    return owned.preferred;
  }

  function writeOutput(owned, value) {
    const next = outputPercent(value);
    if (next === owned.applied) return;
    owned.applied = next; // Own synchronous and queued volumechange events.
    owned.writing = true;
    try { setVolume(owned.video, next, { preserveMute: true }); }
    finally { owned.writing = false; }
  }

  function restore(owned) {
    const preferred = readPreferred(owned);
    owned.gain = 1;
    writeOutput(owned, preferred);
    owned.tracker = createLoudnessTracker();
  }

  function releaseCapture(owned) {
    owned.source?.disconnect();
    owned.splitter?.disconnect();
    owned.analysers?.forEach((analyser) => analyser.disconnect());
    owned.source = owned.splitter = owned.analysers = owned.track = null;
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

  function unavailable(owned) {
    try { restore(owned); } catch { /* the site's outgoing player may already be unavailable */ }
    releaseCapture(owned);
    owned.blocked = true;
    report('Audio unavailable — normal volume');
  }

  function connectTrack(owned) {
    for (const track of owned.stream.getVideoTracks()) track.stop();
    const track = owned.stream.getAudioTracks().find((item) => item.readyState === 'live');
    if (!track || track === owned.track) return;
    if (owned.track) restore(owned);
    owned.source?.disconnect();
    owned.source = owned.context.createMediaStreamSource(new window.MediaStream([track]));
    owned.source.connect(owned.splitter);
    owned.track = track;
    owned.tracker = createLoudnessTracker();
  }

  function resume(owned) {
    if (!owned.context || owned.context.state !== 'suspended' || owned.resuming) return;
    owned.resuming = true;
    owned.context.resume().catch(() => {}).finally(() => { owned.resuming = false; });
  }

  function tick() {
    const owned = session;
    if (!owned) return;
    const video = owned.video;
    if (!video.isConnected) { bind(null); return; }
    if (owned.blocked) return;
    if (video.mediaKeys) { unavailable(owned); return; }
    if (video.paused || video.ended || video.readyState < 2) {
      report('Waiting for playback');
      return;
    }
    try {
      if (!owned.stream) {
        const capture = video.captureStream || video.mozCaptureStream;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!capture || !AudioContext || !window.MediaStream) {
          owned.blocked = true;
          report('Unavailable in this browser');
          return;
        }
        owned.stream = capture.call(video);
        owned.context = new AudioContext();
        owned.splitter = owned.context.createChannelSplitter(6);
        owned.analysers = Array.from({ length: 6 }, (_, channel) => {
          const analyser = owned.context.createAnalyser();
          // Cover each 50 ms tick without retaining a long pre-spike average.
          analyser.fftSize = Math.min(32768, 2 ** Math.ceil(Math.log2((owned.context.sampleRate || 48000) * 0.05)));
          owned.splitter.connect(analyser, channel);
          return analyser;
        });
        owned.samples = owned.analysers.map((analyser) => new Float32Array(analyser.fftSize));
        owned.onTrack = () => {
          try { connectTrack(owned); } catch { unavailable(owned); }
        };
        owned.stream.addEventListener('addtrack', owned.onTrack);
        connectTrack(owned);
        resume(owned);
      }
      connectTrack(owned);
      readPreferred(owned);
      if (owned.context.state !== 'running') {
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
        report('Muted');
        return;
      }
      owned.analysers.forEach((analyser, channel) => analyser.getFloatTimeDomainData(owned.samples[channel]));
      const now = window.performance.now();
      const dt = (now - owned.lastSample) / 1000;
      owned.lastSample = now;
      owned.gain = owned.tracker.update(owned.samples, dt, 100 / Math.max(1, owned.preferred));
      writeOutput(owned, owned.preferred * owned.gain);
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
      if (owned.video.isConnected) restore(owned);
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
      video, preferred, applied: preferred, gain: 1, tracker: createLoudnessTracker(),
      lastSample: window.performance.now(), blocked: false
    };
    owned.reset = () => {
      restore(owned);
      releaseCapture(owned);
      owned.blocked = false;
      report('Waiting for playback');
    };
    owned.retry = () => { owned.blocked = false; tick(); };
    owned.gesture = () => { resume(owned); tick(); };
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
