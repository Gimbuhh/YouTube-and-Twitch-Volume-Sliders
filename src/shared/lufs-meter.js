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
  const attackLength = Math.round(sampleRate / 50);
  const powers = new Float64Array(60);
  let states = [], weights = [], rawEnergy = [];
  let frameSamples = 0, frameEnergy = 0, frameCount = 0;
  let attackSamples = 0, attackEnergy = 0;
  const lufs = power => power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;

  function filter(value, coefficients, state, offset) {
    const output = coefficients[0] * value + state[offset];
    state[offset] = coefficients[1] * value - coefficients[3] * output + state[offset + 1];
    state[offset + 1] = coefficients[2] * value - coefficients[4] * output;
    return output;
  }

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
        powers.fill(0);
        frameSamples = frameEnergy = frameCount = 0;
        attackSamples = attackEnergy = 0;
      }
      for (let index = 0; index < channels[0].length; index++) {
        for (let channel = 0; channel < channels.length; channel++) {
          const value = channels[channel][index];
          if (!Number.isFinite(value)) throw new RangeError('Invalid audio sample');
          rawEnergy[channel] += value * value;
          const weighted = filter(filter(value, shelf, states[channel], 0), highPass, states[channel], 2);
          frameEnergy += weights[channel] * weighted * weighted;
          attackEnergy += weights[channel] * weighted * weighted;
        }
        // Reuse the K-weighted samples for faster spike protection, without
        // changing the programme meter's 50 ms frames or LUFS windows.
        if (++attackSamples === attackLength) {
          onAttack?.(attackEnergy / attackLength);
          attackSamples = attackEnergy = 0;
        }
        if (++frameSamples !== frameLength) continue;
        const power = frameEnergy / frameLength;
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
        frameSamples = frameEnergy = 0;
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
  const history = [];
  let time = 0, gain = 1, programmeGain = 1, fastUntil = -Infinity;
  return {
    update(frame, maxGain = 100) {
      if (frame.attackPower != null) {
        const power = frame.attackPower;
        if (!Number.isFinite(power) || power <= 0) return gain;
        // Reserve the short-window cut for output >10 LU above target, so
        // ordinary speech peaks keep the established programme behavior.
        if (power * programmeGain * programmeGain > targetPower * 10) fastUntil = time + .1;
        if (time < fastUntil) gain = Math.min(gain, Math.max(.1, Math.sqrt(targetPower / power)));
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
      const reference = activeEnergy / activeDuration;
      let desired = Math.min(maxGain, Math.max(0.1, Math.sqrt(targetPower / reference)));
      if (duration < 1) desired = Math.min(1, desired);
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
      else gain = Math.exp(Math.log(gain) + (Math.log(desired) - Math.log(gain)) * (1 - Math.exp(-dt / 0.25)));
      return gain;
    }
  };
}
