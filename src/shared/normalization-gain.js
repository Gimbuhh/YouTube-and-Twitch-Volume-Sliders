// Programme matching shared by the native renderer and offline comparisons.
export const NORMALIZATION_PROFILE = Object.freeze({
  targetLufs: -18, energyHeadroomLu: 3, lookaheadMs: 20, attackMs: 1,
  releaseMs: 180, holdMs: 20, riseDbPerSecond: 24, peakDb: -10,
  referenceDecayLuPerSecond: 3, programmeRecoveryMs: 1200, recoveryConfirmationMs: 3000
});

export function createProgrammeState(selected = .3, energyHeadroomLu = NORMALIZATION_PROFILE.energyHeadroomLu) {
  const history = [];
  const targetPower = 10 ** ((NORMALIZATION_PROFILE.targetLufs + .691) / 10);
  const energyCeiling = targetPower * 10 ** (energyHeadroomLu / 10);
  let startupGain = 0, waiting = true, programmeGain = 1, time = 0, referenceHold = 0, lowerDuration = 0;
  return {
    setSelected(value) { selected = Math.max(0, Math.min(1, value)); },
    getProgrammeGain() { return selected > 0 ? Math.min(waiting ? startupGain : programmeGain, 1 / selected) : 0; },
    frame(frame) {
      // Decoded AAC noise at -123 dBFS is not a meaningful first measurement.
      if (waiting && (frame.rawPower < 1e-9 || frame.power < 1e-9)) return;
      waiting = false; time += frame.duration;
      while (history.length && history[0].time <= time - 3) history.shift();
      // Silence must not relax the held reference or invite a boost.
      if (frame.rawPower < .0001 || frame.power <= 0) return;
      history.push({ time, power: frame.power, duration: frame.duration });
      const ordered = history.slice().sort((a, b) => a.power - b.power);
      const duration = history.reduce((sum, item) => sum + item.duration, 0);
      let cumulative = 0, reference = 0;
      for (const item of ordered) {
        cumulative += item.duration;
        if (cumulative >= duration * .65) { reference = item.power; break; }
      }
      // Confirm a sustained return to quieter material before relaxing a loud
      // reference. Word tails and rapidly changing passages keep cautious gain.
      lowerDuration = reference < referenceHold * 10 ** (-1 / 10) ? lowerDuration + frame.duration : 0;
      const recovering = lowerDuration >= NORMALIZATION_PROFILE.recoveryConfirmationMs / 1000;
      referenceHold = recovering && referenceHold > targetPower
        ? Math.max(targetPower, referenceHold * 10 ** (-NORMALIZATION_PROFILE.referenceDecayLuPerSecond * frame.duration / 10))
        : referenceHold * 10 ** (-.5 * frame.duration / 10);
      if (duration >= 1) referenceHold = Math.max(referenceHold, reference);
      reference = Math.max(reference, referenceHold);
      let desired = Math.min(1 / selected, 10 ** (6 / 20), Math.max(.1, Math.sqrt(targetPower / reference)));
      if (!referenceHold) desired = Math.min(1, desired);
      if (desired < programmeGain) programmeGain = desired;
      else {
        const recovery = time < 3 ? .9 : recovering && desired <= 1 ? NORMALIZATION_PROFILE.programmeRecoveryMs / 1000 : 3;
        programmeGain = Math.exp(Math.log(programmeGain) + (Math.log(desired) - Math.log(programmeGain)) * (1 - Math.exp(-frame.duration / recovery)));
      }
    },
    short(power) {
      // Lookahead protects playback; only startup needs this earlier measurement.
      if (waiting && power >= 1e-9) startupGain = Math.min(1, Math.sqrt(energyCeiling / power));
    }
  };
}
