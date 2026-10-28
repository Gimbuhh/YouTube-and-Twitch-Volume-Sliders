// Frozen reactive controller for offline historical comparisons only.
export const MIN_NORMALIZATION_GAIN = .1;

// The meter stays ungated. This separate live gain policy tracks the typical
// active level and preserves the noise-floor hold. Temporary protection recovers
// separately so one transient cannot keep the programme quiet for seconds.
export function createLufsGainController() {
  // Source reference before the user's volume, close to the previous steady-tone
  // level. This is a live listening target, not the EBU broadcast target.
  const targetPower = 10 ** ((-18 + 0.691) / 10);
  // Bound the boost already present before an unknown loud sound arrives.
  // Native volume is reactive; faster measurements cannot undo that onset.
  const maxBoost = 10 ** (6 / 20);
  const history = [];
  let time = 0, gain = 1, programmeGain = 1, fastUntil = -Infinity, referenceHold = 0;
  const attackState = power => !Number.isFinite(power) || power <= 0 ? 0
    : power * programmeGain * programmeGain > targetPower * 10 ? 2 : time < fastUntil ? 1 : 0;
  return {
    wantsAttack: power => attackState(power) !== 0,
    update(frame, maxGain = 100) {
      if (frame.attackPower != null) {
        const power = frame.attackPower;
        const state = attackState(power);
        if (!state) return gain;
        // Reserve the short-window cut for output >10 LU above target, so
        // ordinary speech peaks keep the established programme behavior.
        if (state === 2) fastUntil = time + .1;
        gain = Math.min(gain, Math.max(MIN_NORMALIZATION_GAIN, Math.sqrt(targetPower / power)));
        return gain;
      }
      const dt = Math.min(0.25, Math.max(0, frame.duration));
      if (!Number.isFinite(dt) || !Number.isFinite(frame.power) || !Number.isFinite(frame.rawPower)) return gain;
      time += dt;
      while (history.length && history[0].time <= time - 3) history.shift();
      if (dt === 0 || frame.rawPower < 0.0001 || frame.power <= 0) return gain;
      history.push({ power: frame.power, duration: dt, time });
      // Favor the voiced part of speech over its quieter tails. The 65th
      // percentile avoids boosting into a word and then cutting its consonant,
      // while brief loud events still cannot dominate the programme reference.
      let duration = 0;
      for (const item of history) duration += item.duration;
      const ordered = history.slice().sort((a, b) => a.power - b.power);
      let cumulative = 0, rollingReference = 0;
      for (const item of ordered) {
        cumulative += item.duration;
        if (cumulative >= duration * .65) { rollingReference = item.power; break; }
      }
      // Remember established programme loudness across quieter backgrounds,
      // including ordinary game audio only a few LU below speech. Release
      // by 0.5 LU/s; silence holds the reference and source resets discard it.
      referenceHold *= 10 ** (-.5 * dt / 10);
      if (duration >= 1) referenceHold = Math.max(referenceHold, rollingReference);
      const reference = Math.max(rollingReference, referenceHold);
      let desired = Math.min(maxGain, maxBoost, Math.max(MIN_NORMALIZATION_GAIN, Math.sqrt(targetPower / reference)));
      // Silence may expire rolling history, but an established source must
      // not lose its boost and repeat the initial measurement gate afterward.
      if (!referenceHold) desired = Math.min(1, desired);
      if (desired < programmeGain) programmeGain = desired;
      else {
        const seconds = time < 3 ? 0.9 : 3;
        programmeGain = Math.exp(Math.log(programmeGain) + (Math.log(desired) - Math.log(programmeGain)) * (1 - Math.exp(-dt / seconds)));
      }
      // A jump >6 LU above the recent active reference bypasses the 400 ms
      // window, preserving the first-frame cut when loud audio returns.
      const safetyPower = Math.max(frame.momentaryPower ?? frame.power, frame.power > reference * 4 ? frame.power : 0);
      const ceiling = Math.min(maxGain, Math.max(MIN_NORMALIZATION_GAIN, Math.sqrt(targetPower / safetyPower)));
      desired = Math.min(programmeGain, ceiling);
      if (desired < gain) gain = desired;
      else {
        // Restore attenuation promptly, but rebuild amplification cautiously
        // so a short cut cannot repeatedly rebound to a large speech boost.
        const current = Math.log(gain), target = Math.log(desired);
        const attenuation = Math.min(0, target) - Math.min(0, current);
        const boost = Math.max(0, target) - Math.max(0, current);
        // Bound the steep start of recovery after a deep cut. The existing
        // curves still ease into the target; downward protection stays instant.
        gain = Math.exp(current + Math.min(40 * Math.LN10 / 20 * dt,
          attenuation * (1 - Math.exp(-dt / .2)) + boost * (1 - Math.exp(-dt / .9))));
      }
      return gain;
    }
  };
}
