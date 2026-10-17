// Frozen pre-LUFS comparison oracle from commit 5701745. Test tooling only;
// never imported by production entry points.
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
export function createLoudnessTracker(initialGain = 1) {
  const history = [];
  let time = 0;
  let gain = initialGain;
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
