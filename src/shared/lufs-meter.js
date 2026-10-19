// Self-contained so the same sample-clocked meter runs in Node tests and an
// analysis-only AudioWorklet. BS.1770 K weighting, with EBU 400 ms / 3 s windows.
export function createLufsMeter(sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) throw new RangeError('Invalid audio sample rate');
  const shelfK = Math.tan(Math.PI * 1681.974450955533 / sampleRate);
  const shelfQ = 0.7071752369554196;
  const high = 10 ** (3.999843853973347 / 20);
  const middle = high ** 0.4996667741545416;
  const shelfDenominator = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf = [
    (high + middle * shelfK / shelfQ + shelfK * shelfK) / shelfDenominator,
    2 * (shelfK * shelfK - high) / shelfDenominator,
    (high - middle * shelfK / shelfQ + shelfK * shelfK) / shelfDenominator,
    2 * (shelfK * shelfK - 1) / shelfDenominator,
    (1 - shelfK / shelfQ + shelfK * shelfK) / shelfDenominator
  ];
  const highPassK = Math.tan(Math.PI * 38.13547087602444 / sampleRate);
  const highPassDenominator = 1 + highPassK / 0.5003270373238773 + highPassK * highPassK;
  const highPass = [1, -2, 1,
    2 * (highPassK * highPassK - 1) / highPassDenominator,
    (1 - highPassK / 0.5003270373238773 + highPassK * highPassK) / highPassDenominator];
  const frameLength = Math.round(sampleRate / 20);
  const attackLength = Math.round(sampleRate / 200);
  const powers = new Float64Array(60);
  const [s0, s1, s2, sa1, sa2] = shelf;
  const [h0, h1, h2, ha1, ha2] = highPass;
  let states = [], weights = [], rawEnergy = [], frameEnergy = [], attackEnergy = [];
  let frameSamples = 0, frameCount = 0, attackSamples = 0;
  let previousAttack = 0, rapidSamples = 0, reportEnergy = 0, reportSamples = 0;
  const lufs = power => power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;

  return {
    process(channels, onFrame, onAttack) {
      if (!channels.length || !channels[0]?.length) return;
      if (channels.length !== states.length) {
        if (channels.length > 6) throw new RangeError('Unsupported channel layout');
        states = channels.map(() => new Float64Array(4));
        weights = channels.length === 6 ? [1, 1, 1, 0, 1.41, 1.41]
          : channels.length === 5 ? [1, 1, 1, 1.41, 1.41]
          : channels.length === 4 ? [1, 1, 1.41, 1.41] : channels.map(() => 1);
        rawEnergy = channels.map(() => 0);
        frameEnergy = channels.map(() => 0);
        attackEnergy = channels.map(() => 0);
        powers.fill(0);
        frameSamples = frameCount = attackSamples = 0;
        previousAttack = rapidSamples = reportEnergy = reportSamples = 0;
      }
      let offset = 0;
      while (offset < channels[0].length) {
        // Stop at measurement boundaries so each channel can keep its filter
        // state in local scalars for a block, rather than reload it per sample.
        const count = Math.min(channels[0].length - offset, frameLength - frameSamples, attackLength - attackSamples);
        const end = offset + count;
        for (let channel = 0; channel < channels.length; channel++) {
          const input = channels[channel], state = states[channel], weight = weights[channel];
          let z0 = state[0], z1 = state[1], z2 = state[2], z3 = state[3];
          let raw = rawEnergy[channel], energy = frameEnergy[channel], attack = attackEnergy[channel];
          for (let index = offset; index < end; index++) {
            const value = input[index];
            if (!Number.isFinite(value)) throw new RangeError('Invalid audio sample');
            raw += value * value;
            const filtered = s0 * value + z0;
            z0 = s1 * value - sa1 * filtered + z1;
            z1 = s2 * value - sa2 * filtered;
            const weighted = h0 * filtered + z2;
            z2 = h1 * filtered - ha1 * weighted + z3;
            z3 = h2 * filtered - ha2 * weighted;
            const power = weight * weighted * weighted;
            energy += power;
            attack += power;
          }
          state[0] = z0; state[1] = z1; state[2] = z2; state[3] = z3;
          rawEnergy[channel] = raw; frameEnergy[channel] = energy; attackEnergy[channel] = attack;
        }
        offset = end;
        frameSamples += count;
        attackSamples += count;
        // Reuse the K-weighted samples for faster spike protection, without
        // changing the programme meter's 50 ms frames or LUFS windows.
        if (attackSamples === attackLength) {
          const energy = attackEnergy.reduce((sum, value) => sum + value, 0);
          const power = energy / attackLength;
          // Fast delivery matters around sharp rises. Steady audio retains
          // the 20 ms reporting cadence instead of waking the page at 200 Hz.
          if (power > 1e-8 && power > previousAttack * 2) rapidSamples = Math.round(sampleRate * .1);
          previousAttack = power;
          reportEnergy += energy;
          reportSamples += attackLength;
          if (rapidSamples > 0) onAttack?.(power);
          else if (reportSamples >= attackLength * 4) onAttack?.(reportEnergy / reportSamples);
          if (reportSamples >= attackLength * 4) reportEnergy = reportSamples = 0;
          rapidSamples = Math.max(0, rapidSamples - attackLength);
          attackSamples = 0;
          attackEnergy.fill(0);
        }
        if (frameSamples !== frameLength) continue;
        const power = frameEnergy.reduce((sum, value) => sum + value, 0) / frameLength;
        powers[frameCount % powers.length] = power;
        frameCount++;
        let momentary = 0, shortTerm = 0;
        for (let age = 0; age < Math.min(frameCount, powers.length); age++) {
          const value = powers[(frameCount - 1 - age) % powers.length];
          shortTerm += value;
          if (age < 8) momentary += value;
        }
        onFrame({ power, rawPower: Math.max(...rawEnergy) / frameLength,
          duration: frameLength / sampleRate,
          momentaryPower: momentary / Math.min(frameCount, 8),
          momentaryLufs: frameCount >= 8 ? lufs(momentary / 8) : null,
          shortTermLufs: frameCount >= 60 ? lufs(shortTerm / 60) : null });
        rawEnergy.fill(0);
        frameSamples = 0;
        frameEnergy.fill(0);
      }
    }
  };
}

// The meter stays ungated. This separate live gain policy excludes quiet phrase
// endings and preserves the noise-floor hold. Temporary protection recovers
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
        gain = Math.min(gain, Math.max(.1, Math.sqrt(targetPower / power)));
        return gain;
      }
      const dt = Math.min(0.25, Math.max(0, frame.duration));
      if (!Number.isFinite(dt) || !Number.isFinite(frame.power) || !Number.isFinite(frame.rawPower)) return gain;
      time += dt;
      while (history.length && history[0].time <= time - 3) history.shift();
      if (dt === 0 || frame.rawPower < 0.0001 || frame.power <= 0) return gain;
      history.push({ power: frame.power, duration: dt, time });
      let duration = 0, energy = 0;
      for (const item of history) { duration += item.duration; energy += item.power * item.duration; }
      const threshold = energy / duration * 0.1;
      let activeDuration = 0, activeEnergy = 0;
      for (const item of history) {
        if (item.power < threshold) continue;
        activeDuration += item.duration;
        activeEnergy += item.power * item.duration;
      }
      // Remember established programme loudness across quieter backgrounds,
      // including ordinary game audio only a few LU below speech. Release
      // by 0.5 LU/s; silence holds the reference and source resets discard it.
      referenceHold *= 10 ** (-.5 * dt / 10);
      const rollingReference = activeEnergy / activeDuration;
      if (duration >= 1) referenceHold = Math.max(referenceHold, rollingReference);
      const reference = Math.max(rollingReference, referenceHold);
      let desired = Math.min(maxGain, maxBoost, Math.max(0.1, Math.sqrt(targetPower / reference)));
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
      const ceiling = Math.min(maxGain, Math.max(0.1, Math.sqrt(targetPower / safetyPower)));
      desired = Math.min(programmeGain, ceiling);
      if (desired < gain) gain = desired;
      else {
        // Restore attenuation promptly, but rebuild amplification cautiously
        // so a short cut cannot repeatedly rebound to a large speech boost.
        const current = Math.log(gain), target = Math.log(desired);
        const attenuation = Math.min(0, target) - Math.min(0, current);
        const boost = Math.max(0, target) - Math.max(0, current);
        gain = Math.exp(current + attenuation * (1 - Math.exp(-dt / .25))
          + boost * (1 - Math.exp(-dt / .9)));
      }
      return gain;
    }
  };
}
