// ==UserScript==
// @name         YouTube Volume Slider
// @namespace    https://github.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders
// @version      2.9
// @description  Compact YouTube volume controls with optional automatic volume normalization.
// @author       Gimbuhh (Made using AI)
// @icon         https://www.youtube.com/favicon.ico
// @match        https://www.youtube.com/*
// @updateURL    https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/youtube-volume-slider.user.js
// @downloadURL  https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/youtube-volume-slider.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==
"use strict";

(() => {
  // src/shared/volume.js
  var clampVolume = (value) => Math.min(100, Math.max(0, Number(value) || 0));
  var VOLUME_STEPS = [1, 2, 5, 10];
  function normalizeVolumeStep(value) {
    const step = Number(value);
    return VOLUME_STEPS.includes(step) ? step : null;
  }
  function snapToStep(value, step) {
    const normalizedStep = normalizeVolumeStep(step) || 1;
    return clampVolume(Math.round(clampVolume(value) / normalizedStep) * normalizedStep);
  }
  function stepVolume(value, direction, step) {
    const current = clampVolume(value);
    const normalizedStep = normalizeVolumeStep(step) || 1;
    if (direction > 0) {
      return clampVolume((Math.floor(current / normalizedStep) + 1) * normalizedStep);
    }
    if (direction < 0) {
      return clampVolume((Math.ceil(current / normalizedStep) - 1) * normalizedStep);
    }
    return current;
  }
  function getVolumeTickInterval(step) {
    const normalizedStep = normalizeVolumeStep(step) || 1;
    return normalizedStep === 1 ? 10 : normalizedStep;
  }
  function createVolumePersistence({ window: window2, storage, storageKey, debounceMs, getVolumeStep }) {
    let saveTimer = 0;
    let scheduledVolume = 0;
    function getSavedVolume() {
      try {
        const saved = storage.getItem(storageKey);
        if (saved === null) return null;
        const value = Math.min(100, Math.max(0, Number.parseInt(saved, 10)));
        return Number.isNaN(value) ? null : value;
      } catch {
        return null;
      }
    }
    function readSteppedSliderValue(slider) {
      const value = snapToStep(slider.value, getVolumeStep());
      slider.value = String(value);
      return value;
    }
    function saveVolume(value) {
      try {
        storage.setItem(storageKey, String(Math.round(value)));
      } catch {
      }
    }
    function cancelScheduledSaveVolume() {
      if (!saveTimer) return;
      window2.clearTimeout(saveTimer);
      saveTimer = 0;
    }
    function scheduleSaveVolume(value) {
      cancelScheduledSaveVolume();
      scheduledVolume = value;
      saveTimer = window2.setTimeout(flushScheduledSaveVolume, debounceMs);
    }
    function flushScheduledSaveVolume() {
      if (!saveTimer) return;
      cancelScheduledSaveVolume();
      saveVolume(scheduledVolume);
    }
    return { getSavedVolume, readSteppedSliderValue, saveVolume, scheduleSaveVolume, cancelScheduledSaveVolume, flushScheduledSaveVolume };
  }

  // src/shared/lufs-meter.js
  function createLufsMeter(sampleRate) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8e3) throw new RangeError("Invalid audio sample rate");
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
    const highPass = [
      1,
      -2,
      1,
      2 * (highPassK * highPassK - 1) / highPassDenominator,
      (1 - highPassK / 0.5003270373238773 + highPassK * highPassK) / highPassDenominator
    ];
    const frameLength = Math.round(sampleRate / 20);
    const attackLength = Math.round(sampleRate / 200);
    const powers = new Float64Array(60);
    const [s0, s1, s2, sa1, sa2] = shelf;
    const [h0, h1, h2, ha1, ha2] = highPass;
    let states = [], weights = [], rawEnergy = [], frameEnergy = [], attackEnergy = [];
    let frameSamples = 0, frameCount = 0, attackSamples = 0;
    let previousAttack = 0, rapidSamples = 0, reportEnergy = 0, reportSamples = 0;
    const lufs = (power) => power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
    return {
      process(channels, onFrame, onAttack) {
        if (!channels.length || !channels[0]?.length) return;
        if (channels.length !== states.length) {
          if (channels.length > 6) throw new RangeError("Unsupported channel layout");
          states = channels.map(() => new Float64Array(4));
          weights = channels.length === 6 ? [1, 1, 1, 0, 1.41, 1.41] : channels.length === 5 ? [1, 1, 1, 1.41, 1.41] : channels.length === 4 ? [1, 1, 1.41, 1.41] : channels.map(() => 1);
          rawEnergy = channels.map(() => 0);
          frameEnergy = channels.map(() => 0);
          attackEnergy = channels.map(() => 0);
          powers.fill(0);
          frameSamples = frameCount = attackSamples = 0;
          previousAttack = rapidSamples = reportEnergy = reportSamples = 0;
        }
        let offset = 0;
        while (offset < channels[0].length) {
          const count = Math.min(channels[0].length - offset, frameLength - frameSamples, attackLength - attackSamples);
          const end = offset + count;
          for (let channel = 0; channel < channels.length; channel++) {
            const input = channels[channel], state = states[channel], weight = weights[channel];
            let z0 = state[0], z1 = state[1], z2 = state[2], z3 = state[3];
            let raw = rawEnergy[channel], energy = frameEnergy[channel], attack = attackEnergy[channel];
            for (let index = offset; index < end; index++) {
              const value = input[index];
              if (!Number.isFinite(value)) throw new RangeError("Invalid audio sample");
              raw += value * value;
              const filtered = s0 * value + z0;
              z0 = s1 * value - sa1 * filtered + z1;
              z1 = s2 * value - sa2 * filtered;
              const weighted = h0 * filtered + z2;
              z2 = h1 * filtered - ha1 * weighted + z3;
              z3 = h2 * filtered - ha2 * weighted;
              const power2 = weight * weighted * weighted;
              energy += power2;
              attack += power2;
            }
            state[0] = z0;
            state[1] = z1;
            state[2] = z2;
            state[3] = z3;
            rawEnergy[channel] = raw;
            frameEnergy[channel] = energy;
            attackEnergy[channel] = attack;
          }
          offset = end;
          frameSamples += count;
          attackSamples += count;
          if (attackSamples === attackLength) {
            const energy = attackEnergy.reduce((sum, value) => sum + value, 0);
            const power2 = energy / attackLength;
            if (power2 > 1e-8 && power2 > previousAttack * 2) rapidSamples = Math.round(sampleRate * 0.1);
            previousAttack = power2;
            reportEnergy += energy;
            reportSamples += attackLength;
            if (rapidSamples > 0) onAttack?.(power2);
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
          onFrame({
            power,
            rawPower: Math.max(...rawEnergy) / frameLength,
            duration: frameLength / sampleRate,
            momentaryPower: momentary / Math.min(frameCount, 8),
            momentaryLufs: frameCount >= 8 ? lufs(momentary / 8) : null,
            shortTermLufs: frameCount >= 60 ? lufs(shortTerm / 60) : null
          });
          rawEnergy.fill(0);
          frameSamples = 0;
          frameEnergy.fill(0);
        }
      }
    };
  }

  // src/shared/normalization-gain.js
  var NORMALIZATION_PROFILE = Object.freeze({ targetLufs: -18, energyHeadroomLu: 3, lookaheadMs: 20, attackMs: 1, releaseMs: 180, holdMs: 20, riseDbPerSecond: 24, peakDb: -10 });
  function createProgrammeState(selected = 0.3, energyHeadroomLu = NORMALIZATION_PROFILE.energyHeadroomLu) {
    const history = [];
    const targetPower = 10 ** ((NORMALIZATION_PROFILE.targetLufs + 0.691) / 10), energyCeiling = targetPower * 10 ** (energyHeadroomLu / 10);
    let gain = 0, waiting = true, programmeGain = 1, shortCap = Infinity, time = 0, referenceHold = 0;
    return {
      setSelected(value) {
        selected = Math.max(0, Math.min(1, value));
      },
      getGain() {
        return (waiting ? gain : Math.min(programmeGain, shortCap, selected > 0 ? 1 / selected : 0)) * selected;
      },
      getProgrammeGain() {
        return selected > 0 ? Math.min(waiting ? gain : programmeGain, 1 / selected) : 0;
      },
      frame(frame) {
        if (waiting && (frame.rawPower < 1e-9 || frame.power < 1e-9)) return;
        waiting = false;
        time += frame.duration;
        while (history.length && history[0].time <= time - 3) history.shift();
        if (frame.rawPower < 1e-4 || frame.power <= 0) return;
        history.push({ time, power: frame.power, duration: frame.duration });
        const ordered = history.slice().sort((a, b) => a.power - b.power), duration = history.reduce((sum, item) => sum + item.duration, 0);
        let cumulative = 0, reference = 0;
        for (const item of ordered) {
          cumulative += item.duration;
          if (cumulative >= duration * 0.65) {
            reference = item.power;
            break;
          }
        }
        referenceHold *= 10 ** (-0.5 * frame.duration / 10);
        if (duration >= 1) referenceHold = Math.max(referenceHold, reference);
        reference = Math.max(reference, referenceHold);
        let desired = Math.min(1 / selected, 10 ** (6 / 20), Math.max(0.1, Math.sqrt(targetPower / reference)));
        if (!referenceHold) desired = Math.min(1, desired);
        if (desired < programmeGain) programmeGain = desired;
        else programmeGain = Math.exp(Math.log(programmeGain) + (Math.log(desired) - Math.log(programmeGain)) * (1 - Math.exp(-frame.duration / (time < 3 ? 0.9 : 3))));
      },
      short(power) {
        shortCap = power > 0 ? Math.sqrt(energyCeiling / power) : Infinity;
        if (waiting && power >= 1e-9) gain = Math.min(1, shortCap);
      }
    };
  }

  // src/shared/normalization-graph.js
  var GAIN_DB_RANGE = 60;
  var curves;
  function controlCurves() {
    if (curves) return curves;
    const sample = (count, fn) => Float32Array.from({ length: count }, (_, i) => fn(i / (count - 1) * 2 - 1));
    const peak = 10 ** (NORMALIZATION_PROFILE.peakDb / 20);
    const energy = 10 ** ((NORMALIZATION_PROFILE.targetLufs + 0.691 + NORMALIZATION_PROFILE.energyHeadroomLu) / 10);
    curves = {
      absolute: new Float32Array([1, 0, 1]),
      square: sample(4097, (x) => x * x),
      peak: sample(65537, (x) => x > peak / 4 ? Math.min(1, 20 * Math.log10(x * 4 / peak) / GAIN_DB_RANGE) : 0),
      energy: sample(131073, (x) => x > energy / 16 ? Math.min(1, 10 * Math.log10(x * 16 / energy) / GAIN_DB_RANGE) : 0),
      gain: sample(4097, (x) => 10 ** (-Math.max(0, x) * GAIN_DB_RANGE / 20))
    };
    return curves;
  }
  function createNativeGainGraph(context, { selected = 0.3 } = {}) {
    const rate = context.sampleRate, nodes = [], tables = controlCurves();
    const own = (node) => {
      nodes.push(node);
      return node;
    };
    function gain(value, mono = true) {
      const node = own(context.createGain());
      node.gain.value = value;
      if (mono) {
        node.channelCount = 1;
        node.channelCountMode = "explicit";
      }
      return node;
    }
    function shape(curve, mono = true) {
      const node = own(context.createWaveShaper());
      node.curve = curve;
      if (mono) {
        node.channelCount = 1;
        node.channelCountMode = "explicit";
      }
      return node;
    }
    function maximum(a, b) {
      const negative = gain(-1), absolute2 = shape(tables.absolute), out = gain(0.5);
      b.connect(negative);
      negative.connect(absolute2);
      a.connect(absolute2);
      a.connect(out);
      b.connect(out);
      absolute2.connect(out);
      return out;
    }
    function delay(input, samples) {
      const node = own(context.createDelay(0.1));
      node.delayTime.value = samples / rate;
      input.connect(node);
      return node;
    }
    const programme = gain(0, false);
    programme.channelCount = 2;
    programme.channelCountMode = "explicit";
    programme.channelInterpretation = "speakers";
    const k = Math.tan(Math.PI * 1681.974450955533 / rate), q = 0.7071752369554196;
    const high = 10 ** (3.999843853973347 / 20), middle = high ** 0.4996667741545416, denominator = 1 + k / q + k * k;
    const shelf = own(context.createIIRFilter([
      (high + middle * k / q + k * k) / denominator,
      2 * (k * k - high) / denominator,
      (high - middle * k / q + k * k) / denominator
    ], [1, 2 * (k * k - 1) / denominator, (1 - k / q + k * k) / denominator]));
    const h = Math.tan(Math.PI * 38.13547087602444 / rate), highPassDenominator = 1 + h / 0.5003270373238773 + h * h;
    const highPass = own(context.createIIRFilter([1, -2, 1], [
      1,
      2 * (h * h - 1) / highPassDenominator,
      (1 - h / 0.5003270373238773 + h * h) / highPassDenominator
    ]));
    programme.connect(shelf);
    shelf.connect(highPass);
    const scale = gain(0.25, false), square = shape(tables.square, false), sum = gain(2);
    highPass.connect(scale);
    scale.connect(square);
    square.connect(sum);
    const energy = own(context.createConvolver()), count = Math.round(rate * 5e-3), impulse = context.createBuffer(1, count, rate);
    impulse.getChannelData(0).fill(1 / count);
    energy.normalize = false;
    energy.buffer = impulse;
    sum.connect(energy);
    const energyAttenuation = shape(tables.energy);
    energy.connect(energyAttenuation);
    const peakScale = gain(0.25, false), absolute = shape(tables.absolute, false), split = own(context.createChannelSplitter(2));
    programme.connect(peakScale);
    peakScale.connect(absolute);
    absolute.connect(split);
    const left = gain(1), right = gain(1);
    split.connect(left, 0);
    split.connect(right, 1);
    const peak = maximum(left, right), peakAttenuation = shape(tables.peak);
    peak.connect(peakAttenuation);
    let held = maximum(energyAttenuation, peakAttenuation);
    const lookahead = 2 ** Math.ceil(Math.log2(rate * NORMALIZATION_PROFILE.lookaheadMs / 1e3));
    const window2 = 2 ** Math.ceil(Math.log2(lookahead + Math.round(rate * NORMALIZATION_PROFILE.holdMs / 1e3)));
    for (let span = 1; span < window2; span *= 2) held = maximum(held, delay(held, span));
    const memory = own(context.createDelay(0.1));
    memory.delayTime.value = 0;
    const attack = Math.exp(-1 / (rate * NORMALIZATION_PROFILE.attackMs / 1e3));
    const release = Math.exp(-1 / (rate * NORMALIZATION_PROFILE.releaseMs / 1e3));
    const decay = gain((release - attack) * release ** 127 / (1 - attack)), linear = gain(1);
    memory.connect(decay);
    memory.connect(linear);
    const offset = own(context.createConstantSource());
    offset.offset.value = -NORMALIZATION_PROFILE.riseDbPerSecond * (128 + attack / (1 - attack)) / rate / GAIN_DB_RANGE;
    offset.start();
    offset.connect(linear);
    const requested = maximum(held, maximum(decay, linear));
    const envelope = own(context.createIIRFilter([1 - attack], [1, -attack]));
    requested.connect(envelope);
    envelope.connect(memory);
    const multiplier = shape(tables.gain);
    envelope.connect(multiplier);
    const monitor = own(context.createAnalyser());
    monitor.fftSize = 32;
    multiplier.connect(monitor);
    const gainSamples = new Float32Array(32);
    const audio = delay(programme, lookahead), attenuated = gain(0, false), level = gain(selected, false);
    audio.connect(attenuated);
    multiplier.connect(attenuated.gain);
    attenuated.connect(level);
    let targetGain = 0;
    return {
      input: programme,
      output: level,
      lookaheadMs: lookahead / rate * 1e3,
      nodeCount: nodes.length,
      setGain(value, at = context.currentTime) {
        if (value === targetGain) return;
        targetGain = value;
        programme.gain.cancelAndHoldAtTime(at);
        programme.gain.setTargetAtTime(value, at, 3e-3);
      },
      setSelected(value, at = context.currentTime) {
        level.gain.cancelAndHoldAtTime(at);
        level.gain.setTargetAtTime(value, at, 5e-3);
      },
      readGain() {
        monitor.getFloatTimeDomainData(gainSamples);
        return programme.gain.value * level.gain.value * Math.max(0, gainSamples[gainSamples.length - 1]);
      },
      dispose() {
        try {
          offset.stop();
        } catch {
        }
        for (const node of nodes) node.disconnect();
      }
    };
  }

  // src/shared/normalization-output.js
  var documents = /* @__PURE__ */ new WeakMap();
  function acquireMediaOutput(window2, video) {
    const url = video.currentSrc && new URL(video.currentSrc, window2.location.href);
    if (video.mediaKeys || !video.srcObject && (!url || url.origin !== window2.location.origin && !video.crossOrigin)) {
      throw new Error("Direct audio processing requires an accessible media source");
    }
    let document2 = documents.get(window2);
    if (!document2) {
      const Context = window2.AudioContext || window2.webkitAudioContext;
      const context = new Context({ latencyHint: "interactive" });
      document2 = { context, sources: /* @__PURE__ */ new WeakMap() };
      documents.set(window2, document2);
      const resume = () => {
        if (context.state === "suspended") context.resume().catch(() => {
        });
      };
      window2.document.addEventListener("pointerdown", resume, true);
      window2.document.addEventListener("keydown", resume, true);
      document2.resume = resume;
    }
    let source = document2.sources.get(video);
    return {
      context: document2.context,
      get source() {
        return source;
      },
      connect(input) {
        if (document2.context.state !== "running") throw new Error("Audio processing requires player activation");
        if (!source) {
          source = document2.context.createMediaElementSource(video);
          document2.sources.set(video, source);
          video.addEventListener("playing", document2.resume);
        }
        source.disconnect();
        source.connect(input);
      },
      restore() {
        if (source) {
          source.disconnect();
          if (video.isConnected) source.connect(document2.context.destination);
        }
      }
    };
  }

  // src/shared/normalization-playback.js
  function createAudiblePlayback({ window: window2, video, track, selected, onMetrics, onFailure }) {
    const output = acquireMediaOutput(window2, video), { context } = output;
    const gate = context.createGain();
    gate.gain.value = 0;
    gate.connect(context.destination);
    let graph;
    try {
      graph = createNativeGainGraph(context, { selected });
      graph.output.connect(gate);
    } catch (error) {
      graph?.dispose();
      gate.disconnect();
      output.restore();
      throw error;
    }
    const programme = createProgrammeState(selected);
    let stopped = false, connected = false, node = null, reader = null, muted = true, paused = video.paused;
    let meterBackend = "starting", rate = 0, samples = 0, hasFrame = false, lastReport = -Infinity;
    function updateGain() {
      graph.setGain(programme.getProgrammeGain());
    }
    function short(power) {
      if (stopped || hasFrame) return;
      programme.short(power);
      updateGain();
    }
    function frame(value) {
      if (stopped) return;
      programme.frame(value);
      updateGain();
      if (value.rawPower >= 1e-9 && value.power >= 1e-9) hasFrame = true;
      const now = window2.performance.now();
      if (now - lastReport < 100) return;
      lastReport = now;
      onMetrics({
        gain: graph.readGain(),
        samples,
        delayMs: graph.lookaheadMs,
        backend: "native graph",
        meterBackend,
        baseLatencyMs: (context.baseLatency || 0) * 1e3,
        outputLatencyMs: (context.outputLatency || 0) * 1e3
      });
    }
    const owned = {
      context,
      backend: "native graph",
      get connected() {
        return connected;
      },
      get running() {
        return !stopped && context.state === "running";
      },
      setState(next) {
        if (stopped) return;
        if (selected !== next.selected) {
          selected = next.selected;
          programme.setSelected(selected);
          graph.setSelected(selected);
          updateGain();
        }
        paused = next.paused;
        const silent = next.muted || paused || selected === 0;
        if (muted !== silent) {
          muted = silent;
          gate.gain.cancelScheduledValues(context.currentTime);
          gate.gain.setValueAtTime(0, context.currentTime);
          if (!silent) gate.gain.linearRampToValueAtTime(1, context.currentTime + 5e-3);
        }
      },
      resume() {
        return context.state === "suspended" ? context.resume() : Promise.resolve();
      },
      dispose() {
        if (stopped) return;
        stopped = true;
        gate.gain.value = 0;
        video.volume = 0;
        reader?.cancel().catch(() => {
        });
        output.restore();
        if (node) {
          node.port.onmessage = null;
          node.onprocessorerror = null;
          node.port.postMessage("stop");
          node.disconnect();
          node.port.close();
        }
        graph.dispose();
        gate.disconnect();
      }
    };
    function fail(error) {
      if (!stopped) {
        owned.dispose();
        onFailure(error);
      }
    }
    function nativeAnalysis() {
      reader = new window2.MediaStreamTrackProcessor({ track, maxBufferSize: 8 }).readable.getReader();
      meterBackend = "native frames";
      (async () => {
        let meter, planes = [], input = [];
        try {
          while (!stopped) {
            const { value: data, done } = await reader.read();
            if (done) break;
            try {
              if (stopped || paused || context.state !== "running") continue;
              if (!meter || rate !== data.sampleRate) {
                rate = data.sampleRate;
                meter = createLufsMeter(rate);
              }
              const count = data.numberOfFrames;
              if (planes.length !== data.numberOfChannels || planes[0]?.length !== count) {
                planes = Array.from({ length: data.numberOfChannels }, () => new Float32Array(count));
                input = planes.length === 1 ? [planes[0], planes[0]] : planes.length === 2 ? planes : Array.from({ length: 2 }, () => new Float32Array(count));
              }
              for (let channel = 0; channel < planes.length; channel++) data.copyTo(planes[channel], { planeIndex: channel, format: "f32-planar" });
              const channels = planes.length;
              if (channels > 2) {
                for (let i = 0; i < count; i++) {
                  input[0][i] = channels === 4 ? 0.5 * (planes[0][i] + planes[2][i]) : planes[0][i] + Math.SQRT1_2 * (planes[2][i] + (channels >= 5 ? planes[channels - 2][i] : 0));
                  input[1][i] = channels === 4 ? 0.5 * (planes[1][i] + planes[3][i]) : planes[1][i] + Math.SQRT1_2 * (planes[2][i] + (channels >= 5 ? planes[channels - 1][i] : 0));
                }
              }
              samples += count;
              meter.process(input, frame, hasFrame ? void 0 : short);
            } finally {
              data.close();
            }
          }
          if (!stopped) fail(new Error("Audio analysis ended"));
        } catch (error) {
          fail(error);
        } finally {
          reader?.releaseLock();
        }
      })();
    }
    async function workletAnalysis() {
      if (!context.audioWorklet || !window2.AudioWorkletNode) throw new Error("No supported audio analysis input");
      const code = `const createLufsMeter=${createLufsMeter.toString()};
registerProcessor('tm-native-graph-meter',class extends AudioWorkletProcessor {
 constructor(){super();this.meter=createLufsMeter(sampleRate);this.send=frame=>{this.port.postMessage(frame);if(frame.rawPower>=1e-9&&frame.power>=1e-9)this.short=undefined};this.short=power=>this.port.postMessage({attackPower:power});this.port.onmessage=()=>{this.stopped=true}}
 process(inputs){if(this.stopped)return false;try{this.meter.process(inputs[0]||[],this.send,this.short);return true}catch(error){this.port.postMessage({failed:true,message:error.message});return false}}
});`;
      const url = window2.URL.createObjectURL(new window2.Blob([code], { type: "application/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
        if (stopped) return;
        node = new window2.AudioWorkletNode(context, "tm-native-graph-meter", {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 2,
          channelCountMode: "explicit",
          channelInterpretation: "speakers"
        });
        meterBackend = "audio worklet";
        rate = context.sampleRate;
        node.port.onmessage = ({ data }) => {
          if (stopped || paused) return;
          if (data.failed) fail(new Error(data.message));
          else if (data.attackPower != null) short(data.attackPower);
          else {
            samples += Math.round(data.duration * rate);
            frame(data);
          }
        };
        node.onprocessorerror = () => fail(new Error("Audio analysis failed"));
        output.source.connect(node);
      } finally {
        window2.URL.revokeObjectURL(url);
      }
    }
    owned.ready = (async () => {
      await owned.resume();
      if (stopped) return;
      output.connect(graph.input);
      connected = true;
      let native = false;
      if (window2.MediaStreamTrackProcessor) {
        try {
          nativeAnalysis();
          native = true;
        } catch {
        }
      }
      if (!native) await workletAnalysis();
    })().catch(fail);
    return owned;
  }

  // src/shared/normalization.js
  function createVolumeNormalizer({ window: window2, getVolume, setVolume, isMuted, onStatusChanged = () => {
  } }) {
    let enabled = false, sourceChanging = false, session = null, status = "Off", lastUiAt = -Infinity;
    const now = () => window2.performance.now();
    function report(next) {
      const changed = status !== next;
      status = next;
      if (session) window2.document.documentElement.dataset.tmAudioNormalization = JSON.stringify({
        status,
        selected: session.preferred,
        output: session.blocked ? session.preferred : Math.round(100 * (session.metrics?.gain || 0)),
        backend: session.playback?.backend || "starting",
        context: session.playback?.context.state,
        metrics: session.metrics || null,
        error: session.error || null
      });
      if (changed || now() - lastUiAt >= 500) {
        lastUiAt = now();
        onStatusChanged();
      }
    }
    function nativeWrite(owned, value, options = { preserveMute: true }) {
      owned.writing = true;
      try {
        owned.video.volume = value / 100;
        setVolume(owned.video, value, options);
      } finally {
        owned.writing = false;
      }
    }
    function silence(owned) {
      const volume = owned.playback?.connected ? 100 : 0;
      if (owned.video.volume !== volume / 100 || getVolume(owned.video) !== volume) nativeWrite(owned, volume);
    }
    function sync(owned) {
      if (!owned.playback) return;
      owned.playback.setState({ selected: owned.preferred / 100, muted: isMuted(owned.video), paused: owned.video.paused || owned.video.ended });
    }
    function release(owned) {
      owned.generation++;
      owned.playback?.dispose();
      owned.playback = null;
      if (owned.stream) {
        for (const track of owned.stream.getTracks()) track.stop();
        owned.stream = null;
      }
      owned.track = null;
      owned.connecting = false;
      owned.metrics = null;
      owned.trackMutedAt = 0;
    }
    function reset(owned) {
      release(owned);
      owned.blocked = false;
      owned.started = now();
      owned.lastFrame = 0;
      silence(owned);
      report("Starting audio analysis");
    }
    function unavailable(owned, error) {
      if (session !== owned) return;
      release(owned);
      owned.blocked = true;
      owned.error = String(error?.message || error || "Audio unavailable");
      owned.retryAt = now() + (owned.retryDelay || 1e3);
      owned.retryDelay = Math.min(3e4, (owned.retryDelay || 1e3) * 2);
      try {
        nativeWrite(owned, owned.preferred);
      } catch {
      }
      report("Audio unavailable \u2014 normal volume");
    }
    async function connect(owned) {
      if (owned.connecting || owned.playback || owned.blocked) return;
      owned.connecting = true;
      const generation = owned.generation;
      try {
        const capture = owned.video.captureStream || owned.video.mozCaptureStream;
        if (!capture || owned.video.mediaKeys) throw new Error("Audio capture is unavailable");
        owned.stream || (owned.stream = capture.call(owned.video));
        for (const track2 of owned.stream.getVideoTracks()) track2.stop();
        const track = owned.stream.getAudioTracks().find((item) => item.readyState === "live");
        if (!track) {
          owned.connecting = false;
          return;
        }
        if (track.muted) throw new Error("Captured audio is inaccessible");
        owned.track = track;
        owned.playback = createAudiblePlayback({
          window: window2,
          video: owned.video,
          track,
          selected: owned.preferred / 100,
          onMetrics(metrics) {
            if (session !== owned || owned.generation !== generation || owned.blocked) return;
            owned.metrics = metrics;
            owned.lastFrame = now();
            sync(owned);
            if (now() - owned.started > 3e3) owned.retryDelay = 1e3;
            owned.error = null;
            report(owned.video.paused || owned.video.ended || owned.video.readyState < 2 || sourceChanging ? "Waiting for playback" : owned.track?.muted ? "Waiting for accessible audio" : isMuted(owned.video) || owned.preferred === 0 ? "Waiting for audio" : "Active");
          },
          onFailure: (error) => {
            if (session === owned && owned.generation === generation) unavailable(owned, error);
          }
        });
        await owned.playback.ready;
        if (session !== owned || owned.generation !== generation || owned.blocked) return;
        owned.connecting = false;
        silence(owned);
        sync(owned);
      } catch (error) {
        if (session === owned && owned.generation === generation) unavailable(owned, error);
      }
    }
    function tick() {
      const owned = session;
      if (!owned) return;
      if (owned.blocked) {
        if (sourceChanging || owned.video.paused || owned.video.readyState < 2 || now() < owned.retryAt) return;
        try {
          reset(owned);
        } catch (error) {
          unavailable(owned, error);
          return;
        }
      }
      if (!owned.video.isConnected) {
        bind(null);
        return;
      }
      try {
        silence(owned);
        sync(owned);
        if (sourceChanging) {
          if (now() - owned.changingAt > 3e3) {
            sourceChanging = false;
            unavailable(owned, new Error("Source transition did not complete"));
          } else report("Waiting for playback");
          return;
        }
        if (owned.video.paused || owned.video.ended || owned.video.readyState < 2) {
          owned.lastFrame = 0;
          owned.started = now();
          report("Waiting for playback");
          return;
        }
        if (owned.track?.readyState === "ended") reset(owned);
        connect(owned);
        if (owned.blocked) return;
        if (owned.track?.muted) {
          owned.trackMutedAt || (owned.trackMutedAt = now());
          if (now() - owned.trackMutedAt > 1500) unavailable(owned, new Error("Captured audio is inaccessible"));
          else report("Waiting for accessible audio");
          return;
        }
        owned.trackMutedAt = 0;
        if (!owned.playback?.running) {
          if (now() - owned.started > 3e3) unavailable(owned, new Error("Click the player to activate audio processing"));
          else report(owned.playback?.connected && owned.playback.context.state === "suspended" ? "Click the player to activate" : "Starting audio analysis");
          return;
        }
        if (now() - (owned.lastFrame || owned.started) > 1500) unavailable(owned, new Error("Live audio processing stalled"));
      } catch (error) {
        unavailable(owned, error);
      }
    }
    function bind(video, preferredVolume) {
      if (session?.video === video) return;
      if (session) {
        const owned2 = session;
        session = null;
        window2.clearInterval(owned2.timer);
        for (const type of ["emptied", "loadstart", "seeking"]) owned2.video.removeEventListener(type, owned2.reset);
        for (const type of ["playing", "loadedmetadata", "seeked", "pause", "volumechange"]) owned2.video.removeEventListener(type, owned2.update);
        window2.document.removeEventListener("pointerdown", owned2.gesture, true);
        window2.document.removeEventListener("keydown", owned2.gesture, true);
        release(owned2);
        if (owned2.video.isConnected) {
          try {
            nativeWrite(owned2, owned2.preferred);
          } catch {
          }
        }
        delete window2.document.documentElement.dataset.tmAudioNormalization;
      }
      if (!enabled || !video) {
        report(enabled ? "Waiting for playback" : "Off");
        return;
      }
      const owned = session = { video, preferred: clampVolume(preferredVolume ?? getVolume(video)), generation: 0, started: now(), changingAt: now(), lastFrame: 0 };
      owned.reset = (event) => {
        if (event?.type !== "seeking") sourceChanging = false;
        try {
          reset(owned);
        } catch (error) {
          unavailable(owned, error);
        }
      };
      owned.update = () => {
        if (owned.writing || owned.blocked) return;
        window2.queueMicrotask(() => {
          if (session === owned) tick();
        });
      };
      owned.gesture = () => {
        if (owned.blocked) reset(owned);
        owned.playback?.resume().catch(() => {
        });
        tick();
      };
      for (const type of ["emptied", "loadstart", "seeking"]) video.addEventListener(type, owned.reset);
      for (const type of ["playing", "loadedmetadata", "seeked", "pause", "volumechange"]) video.addEventListener(type, owned.update);
      window2.document.addEventListener("pointerdown", owned.gesture, true);
      window2.document.addEventListener("keydown", owned.gesture, true);
      owned.timer = window2.setInterval(tick, 50);
      try {
        reset(owned);
        tick();
      } catch (error) {
        unavailable(owned, error);
      }
    }
    return {
      bind,
      isBoundTo: (video) => session?.video === video,
      setEnabled(value) {
        enabled = !!value;
        if (!enabled) bind(null);
        else if (!session) report("Waiting for playback");
      },
      setSourceChanging(value) {
        const next = !!value;
        if (sourceChanging === next) return;
        sourceChanging = next;
        if (session) {
          if (next) {
            session.changingAt = now();
            reset(session);
          } else tick();
        }
      },
      getStatus: () => status,
      getDetails() {
        if (!session || !status.startsWith("Active")) return "";
        const output = Math.round(100 * (session.metrics?.gain || 0));
        return `${output < session.preferred ? "Reducing loud audio" : output > session.preferred ? "Raising quiet audio" : "No volume adjustment"}
Output ${output}% \xB7 Selected ${session.preferred}%`;
      },
      getPreferredVolume(video, raw) {
        return session?.video === video ? session.preferred : raw;
      },
      acceptNativeVolume(video) {
        const owned = session?.video === video ? session : null;
        if (!owned || owned.writing) return;
        owned.preferred = clampVolume(getVolume(video));
        if (!owned.blocked) {
          silence(owned);
          sync(owned);
        }
      },
      setPreferredVolume(video, value, options) {
        const owned = session?.video === video ? session : null;
        if (!owned) {
          setVolume(video, value, options);
          return;
        }
        owned.preferred = clampVolume(value);
        if (owned.blocked) nativeWrite(owned, owned.preferred, options);
        else {
          nativeWrite(owned, owned.playback?.connected ? 100 : 0, options);
          sync(owned);
        }
      }
    };
  }

  // src/shared/native-volume-input.js
  function bindNativeVolumeInput({ window: window2, video, player, selector, normalizer, onChange }) {
    let active = true;
    const types = ["pointerdown", "pointermove", "input", "change", "wheel", "keydown"];
    const onInput = (event) => {
      if (!event.target?.closest?.(selector) || !player.contains(event.target)) return;
      if (event.type === "pointermove" && !event.buttons) return;
      if (event.type === "keydown" && !["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
      window2.queueMicrotask(() => {
        if (!active || !video.isConnected) return;
        normalizer.acceptNativeVolume(video);
        onChange();
      });
    };
    for (const type of types) window2.document.addEventListener(type, onInput, true);
    return () => {
      active = false;
      for (const type of types) window2.document.removeEventListener(type, onInput, true);
    };
  }

  // src/shared/speaker-icon.js
  function getSpeakerIconMode(pct, muted) {
    if (muted || pct <= 0) return "muted";
    if (pct >= 50) return "high";
    return "low";
  }
  function createSpeakerIconGroup(document2, mode) {
    const ns = "http://www.w3.org/2000/svg";
    const group = document2.createElementNS(ns, "g");
    const addPath = (d) => {
      const path = document2.createElementNS(ns, "path");
      path.setAttribute("fill", "currentColor");
      path.setAttribute("d", d);
      group.appendChild(path);
    };
    if (mode === "muted") {
      addPath("M11.48 2.14L3.91 6.68C3.02 7.21 2.28 7.97 1.77 8.87C1.26 9.77 1 10.79 1 11.83V12.16C1 13.20 1.26 14.22 1.77 15.12C2.28 16.02 3.02 16.78 3.91 17.31L11.48 21.85C11.63 21.94 11.80 21.99 11.98 21.99C12.25 22 12.51 21.90 12.70 21.71C12.89 21.52 13 21.26 13 21V3C13 2.73 12.89 2.48 12.70 2.29C12.51 2.10 12.25 2 11.98 2C11.80 2 11.63 2.05 11.48 2.14ZM4.94 8.40L11 4.76V19.22L4.94 15.59C4.35 15.23 3.85 14.73 3.51 14.13C3.17 13.53 3 12.85 3 12.16V11.83C3 11.14 3.18 10.46 3.52 9.86C3.86 9.26 4.35 8.76 4.94 8.40Z");
      addPath("M16.05 7.65L18.75 10.35L21.45 7.65L22.85 9.05L20.15 11.75L22.85 14.45L21.45 15.85L18.75 13.15L16.05 15.85L14.65 14.45L17.35 11.75L14.65 9.05L16.05 7.65Z");
      return group;
    }
    addPath("M11.60 2.08L11.48 2.14L3.91 6.68C3.02 7.21 2.28 7.97 1.77 8.87C1.26 9.77 1 10.79 1 11.83V12.16L1.01 12.56C1.07 13.52 1.37 14.46 1.87 15.29C2.38 16.12 3.08 16.81 3.91 17.31L11.48 21.85C11.63 21.94 11.80 21.99 11.98 21.99C12.16 22 12.33 21.95 12.49 21.87C12.64 21.78 12.77 21.65 12.86 21.50C12.95 21.35 13 21.17 13 21V3C12.99 2.83 12.95 2.67 12.87 2.52C12.80 2.37 12.68 2.25 12.54 2.16C12.41 2.07 12.25 2.01 12.08 2C11.92 1.98 11.75 2.01 11.60 2.08Z");
    addPath("M15.53 7.05C15.35 7.22 15.25 7.45 15.24 7.70C15.23 7.95 15.31 8.19 15.46 8.38L15.53 8.46L15.70 8.64C16.09 9.06 16.39 9.55 16.61 10.08L16.70 10.31C16.90 10.85 17 11.42 17 12L16.99 12.24C16.96 12.73 16.87 13.22 16.70 13.68L16.61 13.91C16.36 14.51 15.99 15.07 15.53 15.53C15.35 15.72 15.25 15.97 15.26 16.23C15.26 16.49 15.37 16.74 15.55 16.92C15.73 17.11 15.98 17.21 16.24 17.22C16.50 17.22 16.76 17.12 16.95 16.95C17.60 16.29 18.11 15.52 18.46 14.67L18.59 14.35C18.82 13.71 18.95 13.03 18.99 12.34L19 12C18.99 11.19 18.86 10.39 18.59 9.64L18.46 9.32C18.15 8.57 17.72 7.89 17.18 7.30L16.95 7.05L16.87 6.98C16.68 6.82 16.43 6.74 16.19 6.75C15.94 6.77 15.71 6.87 15.53 7.05Z");
    if (mode === "high") {
      addPath("M18.36 4.22C18.18 4.39 18.08 4.62 18.07 4.87C18.05 5.12 18.13 5.36 18.29 5.56L18.36 5.63L18.66 5.95C19.36 6.72 19.91 7.60 20.31 8.55L20.47 8.96C20.82 9.94 21 10.96 21 11.99L20.98 12.44C20.94 13.32 20.77 14.19 20.47 15.03L20.31 15.44C19.86 16.53 19.19 17.52 18.36 18.36C18.17 18.55 18.07 18.80 18.07 19.07C18.07 19.33 18.17 19.59 18.36 19.77C18.55 19.96 18.80 20.07 19.07 20.07C19.33 20.07 19.59 19.96 19.77 19.77C20.79 18.75 21.61 17.54 22.16 16.20L22.35 15.70C22.72 14.68 22.93 13.62 22.98 12.54L23 12C22.99 10.73 22.78 9.48 22.35 8.29L22.16 7.79C21.67 6.62 20.99 5.54 20.15 4.61L19.77 4.22L19.70 4.15C19.51 3.99 19.26 3.91 19.02 3.93C18.77 3.94 18.53 4.04 18.36 4.22Z");
    }
    return group;
  }

  // src/shared/volume-feedback.js
  function createVolumeFeedback({ window: window2, player }) {
    const document2 = player.ownerDocument;
    let popup = null;
    let timer = 0;
    const clear = () => {
      window2.clearTimeout(timer);
      timer = 0;
      popup?.remove();
      popup = null;
    };
    const onKey = (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") clear();
    };
    player.addEventListener("pointerdown", clear, true);
    player.addEventListener("keydown", onKey, true);
    return {
      show(value, muted = false) {
        const percent = Math.round(clampVolume(value));
        if (!popup) {
          popup = document2.createElement("div");
          popup.dataset.tmVolumeFeedback = "true";
          popup.setAttribute("role", "status");
          popup.setAttribute("aria-live", "polite");
          popup.setAttribute("aria-atomic", "true");
          Object.assign(popup.style, {
            all: "initial",
            position: "absolute",
            top: "10%",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxSizing: "border-box",
            maxWidth: "calc(100% - 24px)",
            padding: "8px 12px",
            borderRadius: "6px",
            background: "rgba(0,0,0,.7)",
            color: "#fff",
            font: "600 20px/1.2 Arial,Helvetica,sans-serif",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: "20"
          });
          const icon = document2.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("aria-hidden", "true");
          icon.setAttribute("focusable", "false");
          Object.assign(icon.style, { display: "block", flex: "none", width: "24px", height: "24px", color: "inherit" });
          popup.append(icon, document2.createTextNode(""));
          player.appendChild(popup);
        }
        const mode = getSpeakerIconMode(percent, muted);
        if (popup.dataset.volumeIcon !== mode) {
          popup.firstElementChild.replaceChildren(createSpeakerIconGroup(document2, mode));
          popup.dataset.volumeIcon = mode;
        }
        popup.setAttribute("aria-label", `${muted ? "Muted, volume" : "Volume"} ${percent}%`);
        popup.lastChild.nodeValue = `${percent}%`;
        window2.clearTimeout(timer);
        timer = window2.setTimeout(clear, 500);
      },
      clear,
      dispose() {
        clear();
        player.removeEventListener("pointerdown", clear, true);
        player.removeEventListener("keydown", onKey, true);
      }
    };
  }

  // src/shared/normalization-ui.js
  function createNormalizationIcon(document2) {
    const icon = document2.createElement("span");
    icon.className = "tm-normalization-icon";
    icon.hidden = true;
    icon.title = "Auto-normalize volume is on";
    icon.setAttribute("aria-hidden", "true");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document2.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("focusable", "false");
    const frame = document2.createElementNS(ns, "circle");
    frame.setAttribute("cx", "7");
    frame.setAttribute("cy", "7");
    frame.setAttribute("r", "6.5");
    const waveform = document2.createElementNS(ns, "path");
    waveform.setAttribute("d", "M3.5 5.5v3 M7 3.5v7 M10.5 5.5v3");
    svg.append(frame, waveform);
    icon.append(svg);
    return icon;
  }
  function updateNormalizationIcon(overlay, status) {
    if (!overlay) return;
    const visible = status.startsWith("Active") || status === "Waiting for playback" || status === "Starting audio analysis" || status === "Waiting for audio";
    const icon = overlay.querySelector(".tm-normalization-icon");
    const description = overlay.querySelector(".tm-normalization-description");
    if (!icon || !description || icon.hidden === !visible) return;
    overlay.classList.toggle("tm-normalization-enabled", visible);
    icon.hidden = !visible;
    for (const control of overlay.querySelectorAll('.tm-volume-icon-cell, input[type="range"]')) {
      const ids = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== description.id);
      if (visible) ids.push(description.id);
      if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
      else control.removeAttribute("aria-describedby");
    }
  }

  // src/shared/overlay-ui.js
  function createVolumeOverlay({ document: document2, overlayId }) {
    const overlay = document2.createElement("div");
    overlay.id = overlayId;
    overlay.className = "tm-collapsed";
    Object.assign(overlay.style, {
      position: "relative",
      transform: "translateY(0)",
      width: "40px",
      minWidth: "0",
      maxWidth: "none",
      height: "40px",
      minHeight: "40px",
      padding: "0",
      background: "transparent",
      backdropFilter: "none",
      WebkitBackdropFilter: "none",
      borderRadius: "20px",
      border: "none",
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: "0",
      zIndex: "2",
      pointerEvents: "auto",
      boxSizing: "border-box",
      overflow: "hidden",
      opacity: "1",
      flex: "0 0 auto",
      margin: "0 4px",
      alignSelf: "center",
      transition: "width 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
    });
    return overlay;
  }
  function createOverlayUi(dependencies) {
    const {
      document: document2,
      window: window2,
      isAlwaysExpandedEnabled,
      isSliderOnVideo,
      updateOverlayOpacity,
      finishExpandedHoldIfDue,
      getVolumeStep,
      accentLight: VOLUME_ACCENT_LIGHT,
      accentDark: VOLUME_ACCENT_DARK,
      accentMid: VOLUME_ACCENT_MID,
      arcTrack: VOLUME_ARC_TRACK,
      expandedHoldMs: VOLUME_CHANGE_EXPANDED_HOLD_MS
    } = dependencies;
    const DEFAULT_VISUAL_THUMB_SIZE_PX = 22;
    const VOLUME_INDICATOR_CENTER = "20";
    const VOLUME_INDICATOR_TEXT_Y = "20";
    const VOLUME_ARC_RADIUS = "14.5";
    const VOLUME_ARC_STROKE_WIDTH = "3";
    const VOLUME_INDICATOR_COMPACT_TEXT_LENGTH = "22.5";
    const VOLUME_TEXT_MAX_OPTICAL_SHIFT_PX = 1.5;
    function updateSliderBar(slider) {
      const value = Number(slider.value) || 0;
      const pct = Math.min(Math.max(value, 0), 100);
      const fadeStart = Math.max(0, pct - 1);
      const fadeEnd = Math.min(100, pct + 1);
      const thumbSize = getSliderThumbSize(slider);
      const background = `linear-gradient(to right,
            ${VOLUME_ACCENT_LIGHT} 0%,
            ${VOLUME_ACCENT_DARK} ${getThumbAlignedTrackStop(fadeStart, thumbSize)},
            ${VOLUME_ACCENT_MID} ${getThumbAlignedTrackStop(pct, thumbSize)},
            rgba(255, 255, 255, 0.15) ${getThumbAlignedTrackStop(fadeEnd, thumbSize)},
            rgba(255, 255, 255, 0.15) 100%)`;
      const track = slider.parentElement?.querySelector?.(".tm-slider-track");
      if (track) {
        track.style.background = background;
        slider.style.background = "transparent";
      } else {
        slider.style.background = background;
        slider.style.backgroundSize = "100% 100%";
        slider.style.backgroundPosition = "center";
        slider.style.backgroundRepeat = "no-repeat";
      }
    }
    function getSliderThumbSize(slider) {
      const style = window2.getComputedStyle?.(slider.parentElement || slider);
      const parsed = Number.parseFloat(style?.getPropertyValue("--tm-thumb-size"));
      return Number.isFinite(parsed) ? parsed : DEFAULT_VISUAL_THUMB_SIZE_PX;
    }
    function getThumbAlignedTrackStop(pct, thumbSize = DEFAULT_VISUAL_THUMB_SIZE_PX) {
      if (pct <= 0) return "0%";
      if (pct >= 100) return "100%";
      const thumbOffset = thumbSize * (0.5 - pct / 100);
      return `calc(${pct}% + ${thumbOffset.toFixed(2)}px)`;
    }
    function updateVolumeIndicator(overlay, value, muted) {
      if (!overlay) return;
      const pct = Math.min(Math.max(Number(value) || 0, 0), 100);
      overlay.removeAttribute("title");
      overlay.setAttribute("aria-label", muted ? `Muted, volume ${Math.round(pct)}%` : `Volume ${Math.round(pct)}%`);
      const muteButton = overlay.querySelector(".tm-volume-icon-cell");
      if (muteButton) {
        const action = muted ? "Unmute" : "Mute";
        muteButton.setAttribute("aria-label", action);
        muteButton.removeAttribute("title");
      }
      const indicator = overlay.querySelector(".tm-volume-indicator");
      if (indicator) {
        indicator.classList.toggle("muted", muted);
        indicator.dataset.volumeIcon = getSpeakerIconMode(pct, muted);
      }
      const percent = overlay.querySelector(".tm-volume-percent");
      if (percent) {
        const text = muted ? "M" : String(Math.round(pct));
        const isCompact = text.length > 2;
        percent.textContent = text;
        percent.setAttribute("x", VOLUME_INDICATOR_CENTER);
        percent.setAttribute("y", VOLUME_INDICATOR_TEXT_Y);
        if (isCompact) {
          percent.setAttribute("textLength", VOLUME_INDICATOR_COMPACT_TEXT_LENGTH);
          percent.setAttribute("lengthAdjust", "spacingAndGlyphs");
        } else {
          percent.removeAttribute("textLength");
          percent.removeAttribute("lengthAdjust");
        }
        opticallyCenterVolumeText(percent);
      }
      const arc = overlay.querySelector(".tm-volume-arc");
      if (arc) {
        arc.style.visibility = pct <= 0 ? "hidden" : "visible";
        arc.style.strokeLinecap = pct <= 0 ? "butt" : "round";
        const dash = pct >= 100 ? 100.01 : pct;
        const dashValue = `${dash} 100`;
        arc.setAttribute("stroke-dasharray", dashValue);
        arc.style.strokeDasharray = dashValue;
      }
    }
    function opticallyCenterVolumeText(textElement) {
      textElement.removeAttribute("transform");
      if (typeof textElement.getBBox !== "function") return;
      let box;
      try {
        box = textElement.getBBox();
      } catch {
        return;
      }
      if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.width) || box.width <= 0) {
        return;
      }
      const visualCenter = box.x + box.width / 2;
      const correction = Number(VOLUME_INDICATOR_CENTER) - visualCenter;
      const safeCorrection = Math.max(
        -VOLUME_TEXT_MAX_OPTICAL_SHIFT_PX,
        Math.min(VOLUME_TEXT_MAX_OPTICAL_SHIFT_PX, correction)
      );
      if (Math.abs(safeCorrection) < 0.01) return;
      textElement.setAttribute("transform", `translate(${safeCorrection.toFixed(2)} 0)`);
    }
    function setOverlayExpanded(overlay, expanded, force = false, options = {}) {
      if (!overlay) return;
      if (!expanded && isAlwaysExpandedEnabled() && !options.ignoreAlwaysExpanded) {
        expanded = true;
      }
      if (!force && (expanded && overlay.classList.contains("tm-expanded") || !expanded && overlay.classList.contains("tm-collapsed"))) {
        return;
      }
      const onVideo = isSliderOnVideo();
      overlay.classList.toggle("tm-on-video", onVideo);
      overlay.classList.toggle("tm-in-controls", !onVideo);
      const baseStyle = onVideo ? {
        position: "absolute",
        left: "50%",
        zIndex: "10000",
        margin: "0",
        alignSelf: "auto",
        flex: "0 0 auto",
        transition: "width 0.22s cubic-bezier(0.16, 1, 0.3, 1), bottom 0.25s ease"
      } : {
        position: "relative",
        left: "auto",
        bottom: "",
        zIndex: "2",
        margin: "0 4px",
        alignSelf: "center",
        flex: "0 0 auto",
        transition: "width 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
      };
      const pillStyle = {
        ...baseStyle,
        minWidth: "0",
        maxWidth: "none",
        height: "40px",
        minHeight: "40px",
        borderRadius: "20px",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "0",
        background: "transparent",
        transform: onVideo ? "translateX(-50%) scale(var(--tm-overlay-scale, 1))" : "translateY(0)",
        transformOrigin: onVideo ? "center bottom" : "center center"
      };
      overlay.classList.toggle("tm-expanded", expanded);
      overlay.classList.toggle("tm-collapsed", !expanded);
      Object.assign(overlay.style, pillStyle, {
        width: expanded ? "var(--tm-pill-expanded-width)" : "40px",
        padding: expanded ? "0 12px 0 0" : "0"
      });
      updateOverlayOpacity(overlay);
    }
    function shouldKeepOverlayExpanded(overlay) {
      return isAlwaysExpandedEnabled() || overlay.matches(":hover") || overlay.contains(document2.activeElement) || overlay.dataset.tmDragging === "true";
    }
    function clearExpandedHoldTimer(overlay) {
      if (overlay._expandedHoldTimer) {
        clearTimeout(overlay._expandedHoldTimer);
        overlay._expandedHoldTimer = 0;
      }
    }
    function clearExpandedHold(overlay) {
      overlay.dataset.tmKeepExpanded = "false";
      overlay._expandedHoldUntil = 0;
      clearExpandedHoldTimer(overlay);
    }
    function scheduleExpandedHoldRelease(overlay) {
      clearExpandedHoldTimer(overlay);
      const delay = Math.max(0, (overlay._expandedHoldUntil || 0) - Date.now());
      if (delay === 0) {
        finishExpandedHoldIfDue(overlay);
        return;
      }
      overlay._expandedHoldTimer = window2.setTimeout(() => {
        overlay._expandedHoldTimer = 0;
        finishExpandedHoldIfDue(overlay);
      }, delay);
    }
    function markVolumeChangedWhileExpanded(overlay) {
      if (!overlay) return;
      if (isAlwaysExpandedEnabled()) {
        setOverlayExpanded(overlay, true);
        return;
      }
      overlay.dataset.tmKeepExpanded = "true";
      overlay._expandedHoldUntil = Date.now() + VOLUME_CHANGE_EXPANDED_HOLD_MS;
      setOverlayExpanded(overlay, true);
      scheduleExpandedHoldRelease(overlay);
    }
    function formatCssPx(value) {
      if (!Number.isFinite(value)) return "0px";
      const rounded = Number(value.toFixed(3));
      return `${rounded}px`;
    }
    function getDevicePixelRatio() {
      const ratio = Number(window2.devicePixelRatio);
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    }
    function getTickOverlayScale(tickOverlay) {
      const overlay = tickOverlay?.closest?.("#tm-volume-slider-overlay");
      if (!overlay?.classList?.contains("tm-on-video")) return 1;
      const scales = [
        window2.getComputedStyle?.(overlay)?.getPropertyValue("--tm-overlay-scale"),
        overlay.style?.getPropertyValue?.("--tm-overlay-scale")
      ];
      for (const rawScale of scales) {
        const scale = Number.parseFloat(rawScale);
        if (Number.isFinite(scale) && scale > 0) return scale;
      }
      return 1;
    }
    function syncSliderTicksToDevicePixels(tickOverlay, ticks) {
      if (!tickOverlay || !ticks?.length) return false;
      const rect = tickOverlay.getBoundingClientRect?.();
      const scale = getTickOverlayScale(tickOverlay);
      const width = (Number(rect?.width) || 0) / scale;
      const ratio = getDevicePixelRatio();
      const tickWidth = 1 / (ratio * scale);
      tickOverlay.style.setProperty("--tm-slider-tick-width", formatCssPx(tickWidth));
      if (width <= 0) return false;
      ticks.forEach((tick) => {
        const pct = Number(tick.dataset.tmTickPct);
        if (!Number.isFinite(pct)) return;
        const rawCenter = width * (pct / 100);
        const rawLeft = rawCenter - tickWidth / 2;
        const rawScreenLeft = (Number(rect?.left) || 0) + rawLeft * scale;
        const snappedScreenLeft = Math.round(rawScreenLeft * ratio) / ratio;
        const snappedLeft = (snappedScreenLeft - (Number(rect?.left) || 0)) / scale;
        tick.style.left = formatCssPx(snappedLeft);
      });
      tickOverlay.style.visibility = "";
      return true;
    }
    function populateSliderTicks(tickOverlay) {
      if (!tickOverlay) return;
      tickOverlay._tmSliderTicksCleanup?.();
      tickOverlay.textContent = "";
      const ticks = [];
      const fragment = document2.createDocumentFragment();
      const interval = getVolumeTickInterval(getVolumeStep());
      tickOverlay.dataset.tmTickInterval = String(interval);
      for (let pct = interval; pct < 100; pct += interval) {
        const tick = document2.createElement("span");
        tick.className = "tm-slider-tick";
        tick.classList.toggle("tm-slider-tick-major", pct % 10 === 0);
        tick.dataset.tmTickPct = String(pct);
        tick.setAttribute("aria-hidden", "true");
        tick.style.left = `${pct}%`;
        fragment.appendChild(tick);
        ticks.push(tick);
      }
      tickOverlay.appendChild(fragment);
      let frame = 0;
      const sync = () => {
        frame = 0;
        return syncSliderTicksToDevicePixels(tickOverlay, ticks);
      };
      const scheduleSync = () => {
        if (frame) return;
        if (typeof window2.requestAnimationFrame === "function") {
          frame = window2.requestAnimationFrame(sync);
          return;
        }
        sync();
      };
      const resizeObserver = typeof window2.ResizeObserver === "function" ? new window2.ResizeObserver(scheduleSync) : null;
      resizeObserver?.observe(tickOverlay);
      window2.addEventListener("resize", scheduleSync, { passive: true });
      tickOverlay._tmSliderTicksPopulate = () => populateSliderTicks(tickOverlay);
      tickOverlay._tmSliderTicksSync = sync;
      tickOverlay._tmSliderTicksCleanup = () => {
        if (frame && typeof window2.cancelAnimationFrame === "function") {
          window2.cancelAnimationFrame(frame);
        }
        frame = 0;
        resizeObserver?.disconnect();
        window2.removeEventListener("resize", scheduleSync);
        delete tickOverlay._tmSliderTicksPopulate;
        delete tickOverlay._tmSliderTicksSync;
      };
      scheduleSync();
    }
    function makeVolumeIndicatorSvg() {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document2.createElementNS(ns, "svg");
      svg.setAttribute("width", "40");
      svg.setAttribute("height", "40");
      svg.setAttribute("viewBox", "0 0 40 40");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      const makeCircle = (className, attrs) => {
        const circle = document2.createElementNS(ns, "circle");
        if (className) circle.setAttribute("class", className);
        Object.entries(attrs).forEach(([key, value]) => {
          circle.setAttribute(key, value);
        });
        svg.appendChild(circle);
        return circle;
      };
      const appendSpeakerIcon = (className, mode, transform) => {
        const group = createSpeakerIconGroup(document2, mode);
        group.setAttribute("class", `${className} tm-volume-speaker-icon`);
        group.setAttribute("transform", transform);
        svg.appendChild(group);
      };
      makeCircle("tm-volume-arc-track", {
        cx: VOLUME_INDICATOR_CENTER,
        cy: VOLUME_INDICATOR_CENTER,
        r: VOLUME_ARC_RADIUS,
        fill: "none",
        stroke: VOLUME_ARC_TRACK,
        "stroke-width": VOLUME_ARC_STROKE_WIDTH,
        transform: "rotate(-90 20 20)"
      });
      makeCircle("tm-volume-arc", {
        cx: VOLUME_INDICATOR_CENTER,
        cy: VOLUME_INDICATOR_CENTER,
        r: VOLUME_ARC_RADIUS,
        fill: "none",
        stroke: VOLUME_ACCENT_LIGHT,
        "stroke-width": VOLUME_ARC_STROKE_WIDTH,
        "stroke-dasharray": "0 100",
        "visibility": "hidden",
        "pathLength": "100",
        transform: "rotate(-90 20 20)"
      });
      const percent = document2.createElementNS(ns, "text");
      percent.setAttribute("class", "tm-volume-percent");
      percent.setAttribute("x", VOLUME_INDICATOR_CENTER);
      percent.setAttribute("y", VOLUME_INDICATOR_TEXT_Y);
      percent.setAttribute("text-anchor", "middle");
      percent.setAttribute("dominant-baseline", "central");
      percent.setAttribute("alignment-baseline", "central");
      percent.setAttribute("font-family", "Arial, Helvetica, sans-serif");
      percent.setAttribute("font-size", "15");
      percent.setAttribute("font-weight", "700");
      percent.textContent = "0";
      svg.appendChild(percent);
      appendSpeakerIcon("tm-volume-speaker-muted", "muted", "translate(8 8)");
      appendSpeakerIcon("tm-volume-speaker-low", "low", "translate(8 8)");
      appendSpeakerIcon("tm-volume-speaker-high", "high", "translate(8 8)");
      return svg;
    }
    return { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHold, scheduleExpandedHoldRelease, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg, populateSliderTicks };
  }

  // src/shared/options-ui.js
  function createOptionsUi(dependencies) {
    const {
      document: document2,
      optionsPopupId: OPTIONS_POPUP_ID,
      refreshOptionsPopupState,
      getVolumeSliderMode,
      setVolumeSliderMode,
      getReplaceNativePlacement,
      setReplaceNativePlacement,
      getVolumeAppearance,
      setVolumeAppearance,
      isNormalizationEnabled,
      setNormalizationEnabled,
      getNormalizationStatus,
      getNormalizationDetails,
      getVolumeStep,
      setVolumeStep,
      isAlwaysExpandedEnabled,
      setAlwaysExpandedEnabled,
      isSliderOnVideo,
      setSliderLocation,
      getSavedOverlayOpacityPercent,
      setSavedOverlayOpacityPercent,
      resetSavedOverlayOpacityPercent,
      getSavedOverlaySizePercent,
      setSavedOverlaySizePercent,
      resetSavedOverlaySizePercent,
      getSavedSliderThicknessPercent,
      setSavedSliderThicknessPercent,
      resetSavedSliderThicknessPercent,
      beginThicknessSliderPreview,
      endThicknessSliderPreview,
      beginOpacitySliderPreview,
      endOpacitySliderPreview
    } = dependencies;
    const previewEndEvents = ["pointerup", "pointercancel", "mouseup", "touchend", "touchcancel"];
    const previewTargets = [document2, document2.defaultView].filter(Boolean);
    let activePreview = null;
    function stopOptionsPreview() {
      const preview = activePreview;
      if (!preview) {
        return;
      }
      activePreview = null;
      for (const target of previewTargets) {
        for (const type of previewEndEvents) {
          target.removeEventListener(type, stopOptionsPreview, true);
        }
      }
      preview.onEnd?.();
    }
    function getEnabledRadios(group) {
      return Array.from(group.querySelectorAll('[role="radio"]:not(:disabled)'));
    }
    function syncOptionsRadioGroups(popup) {
      popup?.querySelectorAll('[role="radiogroup"]').forEach((group) => {
        const radios = getEnabledRadios(group);
        const checked = radios.find((radio) => radio.getAttribute("aria-checked") === "true");
        const tabStop = checked || radios[0];
        group.querySelectorAll('[role="radio"]').forEach((radio) => {
          radio.tabIndex = radio === tabStop ? 0 : -1;
        });
      });
    }
    function syncNormalizationStatus(popup) {
      if (!popup) return;
      const normalizationStatus = popup.querySelector("#tm-volume-options-normalization-status");
      const status = getNormalizationStatus();
      if (normalizationStatus && normalizationStatus.textContent !== status) normalizationStatus.textContent = status;
      if (normalizationStatus) normalizationStatus.dataset.state = status.startsWith("Active") ? "active" : "idle";
      const feedback = popup.querySelector(".tm-volume-options-normalization-feedback");
      if (feedback) feedback.hidden = !isNormalizationEnabled();
      const normalizationDetails = popup.querySelector("#tm-volume-options-normalization-details");
      const details = getNormalizationDetails();
      if (normalizationDetails) {
        if (normalizationDetails.textContent !== details) normalizationDetails.textContent = details;
        normalizationDetails.hidden = !details;
      }
    }
    function syncOptionsPopupState(popup) {
      if (!popup) return;
      const selectedMode = getVolumeSliderMode();
      const selectedPlacement = getReplaceNativePlacement();
      const selectedAppearance = getVolumeAppearance();
      const selectedStep = getVolumeStep();
      const onVideo = isSliderOnVideo();
      popup.querySelector("#tm-volume-options-normalization")?.setAttribute("aria-checked", isNormalizationEnabled() ? "true" : "false");
      syncNormalizationStatus(popup);
      const modeSelect = popup.querySelector("#tm-volume-options-mode");
      if (modeSelect) modeSelect.value = selectedMode;
      const placementSection = popup.querySelector("#tm-volume-options-placement-section");
      const placementEnabled = selectedMode === "replace-native";
      if (placementSection) {
        placementSection.dataset.disabled = placementEnabled ? "false" : "true";
      }
      ["native", "custom"].forEach((placement) => {
        const radio = popup.querySelector(`#tm-volume-options-placement-${placement}`);
        if (!radio) return;
        radio.setAttribute("aria-checked", selectedPlacement === placement ? "true" : "false");
        radio.disabled = !placementEnabled;
      });
      ["new", "classic"].forEach((appearance) => {
        popup.querySelector(`#tm-volume-options-appearance-${appearance}`)?.setAttribute("aria-checked", selectedAppearance === appearance ? "true" : "false");
      });
      VOLUME_STEPS.forEach((step) => {
        popup.querySelector(`#tm-volume-options-step-${step}`)?.setAttribute("aria-checked", selectedStep === step ? "true" : "false");
      });
      popup.querySelector("#tm-volume-options-always-expanded")?.setAttribute("aria-checked", isAlwaysExpandedEnabled() ? "true" : "false");
      popup.querySelector("#tm-volume-options-location-video")?.setAttribute("aria-checked", onVideo ? "true" : "false");
      const onVideoDisplay = onVideo ? "" : "none";
      const opacitySection = popup.querySelector("#tm-volume-options-opacity-section");
      if (opacitySection) opacitySection.style.display = onVideoDisplay;
      const sizeSection = popup.querySelector("#tm-volume-options-size-section");
      if (sizeSection) sizeSection.style.display = onVideoDisplay;
      const appearanceHint = popup.querySelector(".tm-volume-options-appearance-hint");
      if (appearanceHint) appearanceHint.hidden = onVideo;
      syncOptionsRadioGroups(popup);
    }
    function handleRadioNavigation(event) {
      const radio = event.currentTarget;
      const group = radio.closest('[role="radiogroup"]');
      if (!group) return;
      const radios = getEnabledRadios(group);
      const currentIndex = radios.indexOf(radio);
      if (currentIndex < 0) return;
      let nextIndex;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (currentIndex - 1 + radios.length) % radios.length;
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (currentIndex + 1) % radios.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = radios.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const next = radios[nextIndex];
      next.click();
      next.focus();
    }
    function createOptionsButtonLabel(label) {
      const text = document2.createElement("span");
      text.className = "tm-volume-options-button-label";
      text.textContent = label;
      return text;
    }
    function createOptionsCheckboxRow(id, label, isChecked, onToggle) {
      const row = document2.createElement("button");
      row.type = "button";
      row.id = id;
      row.className = "tm-volume-options-row";
      row.setAttribute("role", "checkbox");
      row.setAttribute("aria-checked", isChecked ? "true" : "false");
      const text = createOptionsButtonLabel(label);
      const box = document2.createElement("span");
      box.className = "tm-volume-options-checkbox";
      box.setAttribute("aria-hidden", "true");
      row.appendChild(text);
      row.appendChild(box);
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = row.getAttribute("aria-checked") !== "true";
        row.setAttribute("aria-checked", next ? "true" : "false");
        onToggle(next);
        refreshOptionsPopupState();
      });
      return row;
    }
    function createOptionsRadio(id, label, isChecked, onSelect) {
      const btn = document2.createElement("button");
      btn.type = "button";
      btn.id = id;
      btn.className = "tm-volume-options-radio";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", isChecked ? "true" : "false");
      btn.tabIndex = isChecked ? 0 : -1;
      btn.appendChild(createOptionsButtonLabel(label));
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
        refreshOptionsPopupState();
      });
      btn.addEventListener("keydown", handleRadioNavigation);
      return btn;
    }
    function createOptionsSectionLabel(text) {
      const label = document2.createElement("div");
      label.className = "tm-volume-options-section-label";
      label.textContent = text;
      return label;
    }
    function createOptionsSegment(radios) {
      const segment = document2.createElement("div");
      segment.className = "tm-volume-options-segment";
      radios.forEach((radio) => segment.appendChild(radio));
      return segment;
    }
    function createModeSection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-mode";
      const label = document2.createElement("label");
      label.htmlFor = "tm-volume-options-mode";
      label.textContent = "Mode";
      const select = document2.createElement("select");
      select.id = label.htmlFor;
      for (const [value, text] of [["on", "On"], ["off", "Off"], ["replace-native", "Replace native"]]) {
        const option = document2.createElement("option");
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }
      select.value = getVolumeSliderMode();
      select.addEventListener("change", () => {
        setVolumeSliderMode(select.value);
        refreshOptionsPopupState();
      });
      select.addEventListener("keydown", (event) => event.stopPropagation());
      section.append(label, select);
      return section;
    }
    function createPlacementSection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-section";
      section.id = "tm-volume-options-placement-section";
      section.appendChild(createOptionsSectionLabel("Placement"));
      const segment = createOptionsSegment([
        createOptionsRadio(
          "tm-volume-options-placement-native",
          "Native spot",
          getReplaceNativePlacement() === "native",
          () => setReplaceNativePlacement("native")
        ),
        createOptionsRadio(
          "tm-volume-options-placement-custom",
          "Custom spot",
          getReplaceNativePlacement() === "custom",
          () => setReplaceNativePlacement("custom")
        )
      ]);
      segment.setAttribute("role", "radiogroup");
      segment.setAttribute("aria-label", "Position when replacing native");
      section.appendChild(segment);
      section.appendChild(createBehaviorRows());
      return section;
    }
    function createBehaviorRows() {
      const list = document2.createElement("div");
      list.className = "tm-volume-options-checklist";
      list.appendChild(createOptionsCheckboxRow(
        "tm-volume-options-location-video",
        "Show on video",
        isSliderOnVideo(),
        (next) => setSliderLocation(next ? "video" : "controls")
      ));
      list.appendChild(createOptionsCheckboxRow(
        "tm-volume-options-always-expanded",
        "Always expanded",
        isAlwaysExpandedEnabled(),
        (next) => setAlwaysExpandedEnabled(next)
      ));
      return list;
    }
    function createVolumeStepSection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-step-setting";
      section.id = "tm-volume-options-step-section";
      section.appendChild(createOptionsSectionLabel("Adjustment step"));
      const segment = createOptionsSegment(VOLUME_STEPS.map(
        (step) => createOptionsRadio(
          `tm-volume-options-step-${step}`,
          `${step}%`,
          getVolumeStep() === step,
          () => setVolumeStep(step)
        )
      ));
      segment.setAttribute("role", "radiogroup");
      segment.setAttribute("aria-label", "Volume adjustment step");
      section.appendChild(segment);
      return section;
    }
    function createNormalizationSection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-section";
      section.appendChild(createOptionsSectionLabel("Audio"));
      const list = document2.createElement("div");
      list.className = "tm-volume-options-checklist";
      const toggle = createOptionsCheckboxRow(
        "tm-volume-options-normalization",
        "Auto-normalize volume",
        isNormalizationEnabled(),
        setNormalizationEnabled
      );
      toggle.setAttribute("aria-describedby", "tm-volume-options-normalization-help tm-volume-options-normalization-status");
      list.appendChild(toggle);
      section.appendChild(list);
      const help = document2.createElement("p");
      help.id = "tm-volume-options-normalization-help";
      help.className = "tm-volume-options-help";
      help.textContent = "Keeps sources closer in loudness. Your slider sets the listening level. Increases are limited to normal player volume.";
      help.hidden = true;
      section.appendChild(help);
      const feedback = document2.createElement("div");
      feedback.className = "tm-volume-options-normalization-feedback";
      const status = document2.createElement("p");
      status.id = "tm-volume-options-normalization-status";
      status.className = "tm-volume-options-help";
      status.setAttribute("role", "status");
      status.textContent = getNormalizationStatus();
      feedback.appendChild(status);
      const details = document2.createElement("p");
      details.id = "tm-volume-options-normalization-details";
      details.className = "tm-volume-options-help";
      details.setAttribute("aria-live", "off");
      details.textContent = getNormalizationDetails();
      details.hidden = !details.textContent;
      feedback.appendChild(details);
      section.appendChild(feedback);
      section.appendChild(createVolumeStepSection());
      return section;
    }
    function createAppearanceSection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-section";
      section.id = "tm-volume-options-appearance-section";
      section.appendChild(createOptionsSectionLabel("Icon style"));
      const segment = createOptionsSegment([
        createOptionsRadio(
          "tm-volume-options-appearance-new",
          "New",
          getVolumeAppearance() === "new",
          () => setVolumeAppearance("new")
        ),
        createOptionsRadio(
          "tm-volume-options-appearance-classic",
          "Classic",
          getVolumeAppearance() === "classic",
          () => setVolumeAppearance("classic")
        )
      ]);
      segment.setAttribute("role", "radiogroup");
      segment.setAttribute("aria-label", "Icon style");
      section.appendChild(segment);
      return section;
    }
    function createRangeSettingRow({
      label,
      ariaLabel,
      resetAriaLabel,
      min,
      max,
      step,
      fallback,
      getValue,
      setValue,
      resetValue,
      onPreviewStart,
      onPreviewEnd,
      getFillPercent = (value) => value
    }) {
      const row = document2.createElement("div");
      row.className = "tm-volume-options-opacity-row";
      const labelGroup = document2.createElement("div");
      labelGroup.className = "tm-volume-options-opacity-label-group";
      const name = document2.createElement("span");
      name.className = "tm-volume-options-opacity-name";
      name.textContent = label;
      const valueEl = document2.createElement("span");
      valueEl.className = "tm-volume-options-opacity-value";
      const resetBtn = document2.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "tm-volume-options-opacity-reset";
      resetBtn.appendChild(createOptionsButtonLabel("Reset"));
      resetBtn.setAttribute("aria-label", resetAriaLabel);
      const slider = document2.createElement("input");
      slider.type = "range";
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.className = "tm-volume-options-opacity-slider";
      slider.setAttribute("aria-label", ariaLabel);
      const refresh = () => {
        const pct = getValue();
        slider.value = String(pct);
        slider.style.setProperty("--tm-opacity-fill", `${getFillPercent(pct)}%`);
        valueEl.textContent = `${Math.round(pct)}%`;
      };
      refresh();
      ["click", "mousedown", "pointerdown", "keydown"].forEach((type) => {
        slider.addEventListener(type, (event) => event.stopPropagation());
      });
      const hasPreview = !!(onPreviewStart || onPreviewEnd);
      if (hasPreview) {
        const startPreview = (event) => {
          if (activePreview?.slider === slider || event.type === "mousedown" && event.button !== 0) {
            return;
          }
          stopOptionsPreview();
          onPreviewStart?.();
          activePreview = { slider, onEnd: onPreviewEnd };
          for (const target of previewTargets) {
            for (const type of previewEndEvents) {
              target.addEventListener(type, stopOptionsPreview, true);
            }
          }
        };
        for (const type of ["pointerdown", "mousedown", "touchstart"]) {
          slider.addEventListener(type, startPreview);
        }
        slider.addEventListener("blur", (event) => {
          if (activePreview?.slider !== slider || document2.getElementById(OPTIONS_POPUP_ID)?.contains(event.relatedTarget)) {
            return;
          }
          stopOptionsPreview();
        });
      }
      slider.addEventListener("input", () => {
        const value = Number(slider.value);
        const pct = Number.isFinite(value) ? value : fallback;
        slider.style.setProperty("--tm-opacity-fill", `${getFillPercent(pct)}%`);
        valueEl.textContent = `${Math.round(pct)}%`;
        setValue(pct);
      });
      resetBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        resetValue();
        refresh();
      });
      labelGroup.appendChild(name);
      labelGroup.appendChild(valueEl);
      const controls = document2.createElement("div");
      controls.className = "tm-volume-options-opacity-controls";
      controls.appendChild(slider);
      controls.appendChild(resetBtn);
      row.appendChild(labelGroup);
      row.appendChild(controls);
      return row;
    }
    function createOpacityRow(label, focused) {
      return createRangeSettingRow({
        label,
        ariaLabel: `${label} opacity`,
        resetAriaLabel: `Reset ${label} opacity`,
        min: 0,
        max: 100,
        step: 1,
        fallback: 0,
        getValue: () => getSavedOverlayOpacityPercent(focused),
        setValue: (pct) => setSavedOverlayOpacityPercent(focused, pct),
        resetValue: () => resetSavedOverlayOpacityPercent(focused),
        onPreviewStart: () => beginOpacitySliderPreview?.(focused),
        onPreviewEnd: endOpacitySliderPreview
      });
    }
    function createOpacitySection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-section";
      section.id = "tm-volume-options-opacity-section";
      section.appendChild(createOptionsSectionLabel("On-video opacity"));
      section.appendChild(createOpacityRow("Idle", false));
      section.appendChild(createOpacityRow("Active", true));
      return section;
    }
    function createSizeSection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-section";
      section.id = "tm-volume-options-size-section";
      section.appendChild(createOptionsSectionLabel("On-video size"));
      section.appendChild(createRangeSettingRow({
        label: "Size",
        ariaLabel: "On-video size",
        resetAriaLabel: "Reset on-video size",
        min: 100,
        max: 200,
        step: 5,
        fallback: 100,
        getValue: getSavedOverlaySizePercent,
        setValue: setSavedOverlaySizePercent,
        resetValue: resetSavedOverlaySizePercent,
        getFillPercent: (pct) => pct - 100
      }));
      return section;
    }
    function createThicknessSection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-section";
      section.id = "tm-volume-options-thickness-section";
      section.appendChild(createOptionsSectionLabel("Bar thickness"));
      section.appendChild(createRangeSettingRow({
        label: "Thickness",
        ariaLabel: "Bar thickness",
        resetAriaLabel: "Reset bar thickness",
        min: 25,
        max: 125,
        step: 5,
        fallback: 75,
        getValue: getSavedSliderThicknessPercent,
        setValue: setSavedSliderThicknessPercent,
        resetValue: resetSavedSliderThicknessPercent,
        onPreviewStart: beginThicknessSliderPreview,
        onPreviewEnd: endThicknessSliderPreview,
        getFillPercent: (pct) => pct - 25
      }));
      return section;
    }
    function buildOptionsPopup() {
      stopOptionsPreview();
      const popup = document2.createElement("div");
      popup.id = OPTIONS_POPUP_ID;
      popup.setAttribute("role", "dialog");
      popup.setAttribute("aria-label", "Volume Slider Options");
      popup.tabIndex = -1;
      popup.toggleAttribute("hidden", true);
      const header = document2.createElement("div");
      header.className = "tm-volume-options-header";
      const title = document2.createElement("div");
      title.className = "tm-volume-options-title";
      title.textContent = "Volume Slider Options";
      header.appendChild(title);
      const body = document2.createElement("div");
      body.className = "tm-volume-options-body";
      const tabList = document2.createElement("div");
      tabList.className = "tm-volume-options-tabs";
      tabList.setAttribute("role", "tablist");
      tabList.setAttribute("aria-label", "Volume settings");
      const panels = ["general", "appearance"].map((name) => {
        const panel = document2.createElement("div");
        panel.id = `tm-volume-options-panel-${name}`;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", `tm-volume-options-tab-${name}`);
        body.appendChild(panel);
        return panel;
      });
      const tabs = panels.map((panel, index) => {
        const tab = document2.createElement("button");
        tab.type = "button";
        tab.id = panel.getAttribute("aria-labelledby");
        tab.className = "tm-volume-options-tab";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", panel.id);
        tab.appendChild(createOptionsButtonLabel(index ? "Appearance" : "General"));
        tab.addEventListener("click", () => selectTab(index));
        tab.addEventListener("keydown", (event) => {
          let next;
          if (event.key === "ArrowLeft") next = (index + panels.length - 1) % panels.length;
          else if (event.key === "ArrowRight") next = (index + 1) % panels.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = panels.length - 1;
          else return;
          event.preventDefault();
          event.stopPropagation();
          selectTab(next);
          tabs[next].focus();
        });
        tabList.appendChild(tab);
        return tab;
      });
      function selectTab(index) {
        stopOptionsPreview();
        tabs.forEach((tab, i) => {
          tab.setAttribute("aria-selected", i === index ? "true" : "false");
          tab.tabIndex = i === index ? 0 : -1;
          panels[i].hidden = i !== index;
        });
        body.scrollTop = 0;
      }
      panels[0].append(createNormalizationSection(), createPlacementSection());
      panels[1].append(createAppearanceSection(), createThicknessSection(), createSizeSection(), createOpacitySection());
      const hint = document2.createElement("p");
      hint.className = "tm-volume-options-help tm-volume-options-appearance-hint";
      hint.append("To adjust size and opacity,", document2.createElement("br"), "enable \u201CShow on video\u201D in General.");
      panels[1].appendChild(hint);
      selectTab(0);
      popup.appendChild(header);
      popup.appendChild(createModeSection());
      popup.appendChild(tabList);
      popup.appendChild(body);
      popup.addEventListener("click", (event) => event.stopPropagation());
      return popup;
    }
    return { buildOptionsPopup, syncOptionsPopupState, syncNormalizationStatus, stopOptionsPreview };
  }

  // src/shared/settings.js
  var MODES = ["off", "on", "replace-native"];
  var LOCATIONS = ["controls", "video"];
  var APPEARANCES = ["new", "classic"];
  function normalizeChoice(value, choices) {
    return choices.includes(value) ? value : null;
  }
  function normalizeBooleanSetting(value) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return null;
  }
  function normalizeVolumeSliderMode(mode) {
    return normalizeChoice(mode, MODES);
  }
  function normalizeReplaceNativePlacement(placement) {
    return normalizeChoice(placement, ["native", "custom"]);
  }
  function normalizeSliderLocation(location) {
    return normalizeChoice(location, LOCATIONS);
  }
  function normalizeVolumeAppearance(appearance) {
    return normalizeChoice(appearance, APPEARANCES);
  }
  function normalizeOpacityPercent(value, fallback) {
    if (value === null || value === void 0 || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(100, Math.max(0, number));
  }
  function normalizeOverlaySizePercent(value, fallback) {
    if (value === null || value === void 0 || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(200, Math.max(100, number));
  }
  function normalizeSliderThicknessPercent(value, fallback) {
    if (value === null || value === void 0 || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(125, Math.max(25, number));
  }
  function createVolumeSettings({
    document: document2,
    storage,
    userSettings,
    keys,
    defaults,
    overlayId,
    onPlacementChanged,
    onModeChanged,
    onNormalizationChanged = () => {
    },
    clearExpandedHold,
    setOverlayExpanded,
    collapseOverlayIfIdle,
    ensureOverlay
  }) {
    const sessionValues = /* @__PURE__ */ new Map();
    const read = (key) => {
      const cached = sessionValues.get(key);
      if (cached?.unsaved) {
        return cached.value;
      }
      try {
        const value = storage.getItem(key);
        sessionValues.set(key, { value, unsaved: false });
        return value;
      } catch {
        return cached?.value ?? null;
      }
    };
    const write = (key, value) => {
      const cached = { value, unsaved: true };
      sessionValues.set(key, cached);
      try {
        if (value === null) {
          storage.removeItem(key);
        } else {
          storage.setItem(key, value);
        }
        cached.unsaved = false;
      } catch {
      }
    };
    const remove = (key) => write(key, null);
    const getOverlay = () => ensureOverlay?.() || document2.getElementById(overlayId);
    function getSavedVolumeSliderMode() {
      return normalizeVolumeSliderMode(read(keys.mode)) || "on";
    }
    function getVolumeSliderMode() {
      return normalizeVolumeSliderMode(userSettings.volumeSliderMode) || getSavedVolumeSliderMode();
    }
    function getReplaceNativePlacement() {
      return normalizeReplaceNativePlacement(userSettings.replaceNativePlacement) || normalizeReplaceNativePlacement(read(keys.replacePlacement)) || "native";
    }
    function getSliderLocation() {
      return normalizeSliderLocation(userSettings.sliderLocation) || normalizeSliderLocation(read(keys.location)) || "controls";
    }
    const isSliderOnVideo = () => getSliderLocation() === "video";
    function getVolumeAppearance() {
      return normalizeVolumeAppearance(userSettings.volumeAppearance) || normalizeVolumeAppearance(read(keys.appearance)) || "new";
    }
    function updateOverlayAppearance(overlay) {
      if (!overlay) return;
      const appearance = getVolumeAppearance();
      const classic = appearance === "classic";
      overlay.dataset.tmAppearance = appearance;
      overlay.classList.toggle("tm-volume-appearance-classic", classic);
      overlay.classList.toggle("tm-volume-appearance-new", !classic);
      const topRow = overlay.querySelector?.(".tm-volume-top-row");
      if (topRow) topRow.style.width = classic ? "96px" : "50px";
      const arcTrack = overlay.querySelector?.(".tm-volume-arc-track");
      if (arcTrack) {
        arcTrack.setAttribute("r", classic ? "13" : "14.5");
        arcTrack.setAttribute("stroke-width", classic ? "4" : "3");
        if (classic) {
          arcTrack.setAttribute("stroke-dasharray", "100 100");
          arcTrack.setAttribute("pathLength", "100");
        } else {
          arcTrack.removeAttribute("stroke-dasharray");
          arcTrack.removeAttribute("pathLength");
        }
      }
      const arc = overlay.querySelector?.(".tm-volume-arc");
      if (arc) {
        arc.setAttribute("r", classic ? "13" : "14.5");
        arc.setAttribute("stroke-width", classic ? "4" : "3");
      }
      const label = overlay.querySelector?.("#tm-volume-slider-value");
      if (!label) return;
      Object.assign(label.style, classic ? {
        left: "36px",
        top: "50%",
        width: "58px",
        height: "auto",
        overflow: "visible",
        clipPath: "none",
        transform: "translateY(-50%)",
        whiteSpace: "nowrap"
      } : {
        left: "0",
        top: "0",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        clipPath: "inset(50%)",
        transform: "none",
        whiteSpace: "nowrap"
      });
    }
    function setVolumeAppearance(appearance) {
      write(keys.appearance, normalizeVolumeAppearance(appearance) || "new");
      updateOverlayAppearance(getOverlay());
    }
    function setSliderLocation(location) {
      write(keys.location, normalizeSliderLocation(location) || "controls");
      onPlacementChanged();
    }
    function setReplaceNativePlacement(placement) {
      write(keys.replacePlacement, normalizeReplaceNativePlacement(placement) || "native");
      onPlacementChanged();
    }
    function getSavedVolumeStep() {
      const savedStep = normalizeVolumeStep(read(keys.step));
      if (savedStep) return savedStep;
      return normalizeBooleanSetting(read(keys.legacySnap)) === true ? 5 : 1;
    }
    function getVolumeStep() {
      const override = normalizeVolumeStep(userSettings.volumeStep);
      if (override) return override;
      const legacyOverride = normalizeBooleanSetting(userSettings.snapToFive);
      if (legacyOverride !== null) return legacyOverride ? 5 : 1;
      return getSavedVolumeStep();
    }
    function updateVolumeStepUi(overlay) {
      if (!overlay) return;
      const step = getVolumeStep();
      const slider = overlay.querySelector?.("#tm-volume-slider-range");
      if (slider) {
        slider.dataset.tmVolumeStep = String(step);
      }
      overlay.querySelector?.(".tm-slider-ticks")?._tmSliderTicksPopulate?.();
    }
    function setVolumeStep(step) {
      write(keys.step, String(normalizeVolumeStep(step) || 1));
      if (keys.legacySnap) remove(keys.legacySnap);
      updateVolumeStepUi(getOverlay());
    }
    function isNormalizationEnabled() {
      return normalizeBooleanSetting(userSettings.normalizeVolume) ?? read(keys.normalization) === "true";
    }
    function setNormalizationEnabled(enabled) {
      write(keys.normalization, enabled ? "true" : "false");
      onNormalizationChanged();
    }
    function isAlwaysExpandedEnabled() {
      const override = normalizeBooleanSetting(userSettings.alwaysExpanded);
      return override ?? read(keys.expanded) === "true";
    }
    function setAlwaysExpandedEnabled(enabled) {
      write(keys.expanded, enabled ? "true" : "false");
      const overlay = getOverlay();
      if (!overlay) return;
      clearExpandedHold(overlay);
      if (enabled) setOverlayExpanded(overlay, true);
      else collapseOverlayIfIdle(overlay, true);
    }
    function getSavedOverlayOpacityPercent(focused) {
      const fallback = focused ? defaults.activeOpacity : defaults.idleOpacity;
      const setting = focused ? userSettings.overlayOpacityFocused : userSettings.overlayOpacityUnfocused;
      if (setting !== "saved") return normalizeOpacityPercent(setting, fallback);
      return normalizeOpacityPercent(read(focused ? keys.activeOpacity : keys.idleOpacity), fallback);
    }
    function updateOverlayOpacity(overlay) {
      if (!overlay) return;
      overlay.style.opacity = isSliderOnVideo() ? String(getSavedOverlayOpacityPercent(isOverlayInteractionFocused(overlay)) / 100) : "1";
      updateOverlaySize(overlay);
    }
    function setSavedOverlayOpacityPercent(focused, value) {
      const fallback = focused ? defaults.activeOpacity : defaults.idleOpacity;
      write(focused ? keys.activeOpacity : keys.idleOpacity, String(normalizeOpacityPercent(value, fallback)));
      updateOverlayOpacity(getOverlay());
    }
    function resetSavedOverlayOpacityPercent(focused) {
      remove(focused ? keys.activeOpacity : keys.idleOpacity);
      updateOverlayOpacity(getOverlay());
    }
    function getSavedOverlaySizePercent() {
      if (userSettings.overlaySize !== "saved") {
        return normalizeOverlaySizePercent(userSettings.overlaySize, defaults.overlaySize);
      }
      return normalizeOverlaySizePercent(read(keys.overlaySize), defaults.overlaySize);
    }
    function updateOverlaySize(overlay) {
      if (!overlay) return;
      const scale = isSliderOnVideo() ? getSavedOverlaySizePercent() / 100 : 1;
      overlay.style.setProperty("--tm-overlay-scale", String(scale));
      syncOverlayTicks(overlay);
      overlay.ownerDocument?.defaultView?.requestAnimationFrame?.(() => {
        syncOverlayTicks(overlay);
      });
    }
    function syncOverlayTicks(overlay) {
      overlay?.querySelector?.(".tm-slider-ticks")?._tmSliderTicksSync?.();
    }
    function setSavedOverlaySizePercent(value) {
      write(keys.overlaySize, String(normalizeOverlaySizePercent(value, defaults.overlaySize)));
      updateOverlaySize(getOverlay());
    }
    function resetSavedOverlaySizePercent() {
      remove(keys.overlaySize);
      updateOverlaySize(getOverlay());
    }
    function getSavedSliderThicknessPercent() {
      if (userSettings.sliderThickness !== "saved") {
        return normalizeSliderThicknessPercent(userSettings.sliderThickness, defaults.sliderThickness);
      }
      return normalizeSliderThicknessPercent(read(keys.sliderThickness), defaults.sliderThickness);
    }
    function updateSliderThickness(overlay) {
      if (!overlay) return;
      const pct = getSavedSliderThicknessPercent();
      const trackPx = pct * 0.11;
      const thumbPx = Math.min(28, Math.max(14, trackPx * 2));
      const thickness = `${trackPx.toFixed(2)}px`;
      const thumbSize = `${thumbPx.toFixed(2)}px`;
      overlay.style.setProperty("--tm-visual-track-h", thickness);
      overlay.style.setProperty("--tm-thumb-size", thumbSize);
      overlay.querySelectorAll?.(".tm-volume-slider-row").forEach((row) => {
        row.style.setProperty("--tm-visual-track-h", thickness);
        row.style.setProperty("--tm-thumb-size", thumbSize);
      });
      syncOverlayTicks(overlay);
    }
    function restoreOverlayPreview(overlay) {
      if (!overlay) return;
      delete overlay.dataset.tmOptionsPreview;
      if (isAlwaysExpandedEnabled()) setOverlayExpanded(overlay, true, true);
      else collapseOverlayIfIdle(overlay, true);
      updateOverlayOpacity(overlay);
    }
    function setSavedSliderThicknessPercent(value) {
      write(keys.sliderThickness, String(normalizeSliderThicknessPercent(value, defaults.sliderThickness)));
      updateSliderThickness(getOverlay());
    }
    function resetSavedSliderThicknessPercent() {
      remove(keys.sliderThickness);
      updateSliderThickness(getOverlay());
    }
    function beginThicknessSliderPreview() {
      const overlay = getOverlay();
      if (!overlay || isAlwaysExpandedEnabled()) return;
      overlay.dataset.tmOptionsPreview = "thickness";
      clearExpandedHold(overlay);
      setOverlayExpanded(overlay, true, true);
      updateOverlayOpacity(overlay);
    }
    function endThicknessSliderPreview() {
      const overlay = document2.getElementById(overlayId);
      if (overlay?.dataset.tmOptionsPreview !== "thickness") return;
      restoreOverlayPreview(overlay);
    }
    function beginOpacitySliderPreview(focused) {
      const overlay = getOverlay();
      if (!overlay) return;
      overlay.dataset.tmOptionsPreview = focused ? "opacity-active" : "opacity-idle";
      clearExpandedHold(overlay);
      setOverlayExpanded(overlay, focused, true, focused ? {} : { ignoreAlwaysExpanded: true });
      updateOverlayOpacity(overlay);
    }
    function endOpacitySliderPreview() {
      const overlay = document2.getElementById(overlayId);
      if (!overlay?.dataset.tmOptionsPreview?.startsWith("opacity-")) return;
      restoreOverlayPreview(overlay);
    }
    function isOverlayInteractionFocused(overlay) {
      return overlay?.dataset.tmOptionsPreview === "thickness" || overlay?.dataset.tmOptionsPreview === "opacity-active" || overlay?.dataset.tmDragging === "true" || overlay?.dataset.tmHovering === "true" || overlay?.matches?.(":hover") || overlay?.contains?.(document2.activeElement);
    }
    function setVolumeSliderMode(mode) {
      const normalizedMode = normalizeVolumeSliderMode(mode) || "on";
      write(keys.mode, normalizedMode);
      onModeChanged(normalizedMode);
    }
    const isOverlayEnabled = () => getVolumeSliderMode() !== "off";
    const isNativeVolumeReplacementEnabled = () => getVolumeSliderMode() === "replace-native";
    const shouldUseNativeReplacementSlot = () => isNativeVolumeReplacementEnabled() && getReplaceNativePlacement() === "native";
    return {
      isNormalizationEnabled,
      setNormalizationEnabled,
      getVolumeSliderMode,
      getReplaceNativePlacement,
      isSliderOnVideo,
      setSliderLocation,
      setReplaceNativePlacement,
      getVolumeAppearance,
      setVolumeAppearance,
      updateOverlayAppearance,
      getVolumeStep,
      setVolumeStep,
      isAlwaysExpandedEnabled,
      setAlwaysExpandedEnabled,
      getSavedOverlayOpacityPercent,
      setSavedOverlayOpacityPercent,
      resetSavedOverlayOpacityPercent,
      getSavedOverlaySizePercent,
      setSavedOverlaySizePercent,
      resetSavedOverlaySizePercent,
      getSavedSliderThicknessPercent,
      setSavedSliderThicknessPercent,
      resetSavedSliderThicknessPercent,
      beginThicknessSliderPreview,
      endThicknessSliderPreview,
      beginOpacitySliderPreview,
      endOpacitySliderPreview,
      updateSliderThickness,
      isOverlayInteractionFocused,
      updateOverlayOpacity,
      setVolumeSliderMode,
      isOverlayEnabled,
      isNativeVolumeReplacementEnabled,
      shouldUseNativeReplacementSlot
    };
  }

  // src/shared/options.js
  var focusableSelector = [
    'input:not(:disabled):not([tabindex="-1"])',
    'button:not(:disabled):not([tabindex="-1"])',
    'select:not(:disabled):not([tabindex="-1"])',
    'textarea:not(:disabled):not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");
  function isHiddenFromFocus(element, boundary) {
    const view = element.ownerDocument?.defaultView;
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute?.("aria-hidden") === "true") return true;
      const style = view?.getComputedStyle?.(current);
      if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return true;
      if (current === boundary) break;
    }
    return false;
  }
  function getOptionsPopupFocusable(popup) {
    return Array.from(popup.querySelectorAll(focusableSelector)).filter((element) => !isHiddenFromFocus(element, popup));
  }
  function bindOptionsPopupKeyboard({ document: document2, popup, closePopup }) {
    const handler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePopup(true);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = getOptionsPopupFocusable(popup);
      if (!focusable.length) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document2.activeElement === first || document2.activeElement === popup)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document2.activeElement === last || document2.activeElement === popup)) {
        event.preventDefault();
        first.focus();
      }
    };
    document2.addEventListener("keydown", handler, true);
    return () => document2.removeEventListener("keydown", handler, true);
  }
  function createOptionsButtonIconSvg(document2) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document2.createElementNS(namespace, "svg");
    svg.setAttribute("fill", "none");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const [row, x, y] of [["top", 15, 5], ["middle", 7, 11], ["bottom", 11, 17]]) {
      const track = document2.createElementNS(namespace, "rect");
      track.setAttribute("x", "3");
      track.setAttribute("y", String(y));
      track.setAttribute("width", "18");
      track.setAttribute("height", "2");
      track.setAttribute("fill", "#fff");
      const handle = document2.createElementNS(namespace, "rect");
      handle.setAttribute("class", `tm-options-handle tm-options-handle-${row}`);
      handle.setAttribute("x", String(x));
      handle.setAttribute("y", String(y - 2));
      handle.setAttribute("width", "2");
      handle.setAttribute("height", "6");
      handle.setAttribute("fill", "#fff");
      svg.append(track, handle);
    }
    return svg;
  }

  // src/shared/lifecycle.js
  function createOverlayLifecycle() {
    let active = null;
    return {
      get active() {
        return active;
      },
      owns(root) {
        return active?.root === root;
      },
      set(root, cleanup) {
        active = { root, cleanup };
      },
      dispose() {
        const owned = active;
        active = null;
        if (!owned) return;
        owned.cleanup();
        owned.root.remove();
      }
    };
  }
  function createCleanupRegistry() {
    const cleanups = [];
    let disposed = false;
    function add(cleanup) {
      if (typeof cleanup !== "function") return cleanup;
      if (disposed) cleanup();
      else cleanups.push(cleanup);
      return cleanup;
    }
    function listen(target, type, handler, options) {
      target?.addEventListener?.(type, handler, options);
      add(() => target?.removeEventListener?.(type, handler, options));
      return handler;
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      for (let index = cleanups.length - 1; index >= 0; index -= 1) {
        cleanups[index]();
      }
      cleanups.length = 0;
    }
    return { add, listen, dispose, get disposed() {
      return disposed;
    } };
  }
  function createVideoLocator(document2, window2) {
    let cachedVideo = null;
    function getVideoElement() {
      if (cachedVideo?.isConnected) return cachedVideo;
      const videos = document2.querySelectorAll("video");
      if (!videos.length) {
        cachedVideo = null;
        return null;
      }
      cachedVideo = [...videos].reduce((largest, video) => {
        const area = video.clientWidth * video.clientHeight;
        const largestArea = largest.clientWidth * largest.clientHeight;
        return area > largestArea ? video : largest;
      }, videos[0]);
      return cachedVideo;
    }
    function resetVideoElement() {
      cachedVideo = null;
    }
    function ensurePlayerPositioning(player) {
      if (player && window2.getComputedStyle(player).position === "static") player.style.position = "relative";
    }
    return { getVideoElement, resetVideoElement, ensurePlayerPositioning };
  }

  // src/shared/styles.js
  function createStyleElement(document2, id) {
    if (document2.getElementById(id)) return null;
    const parent = document2.head || document2.documentElement;
    if (!parent) return null;
    const style = document2.createElement("style");
    style.id = id;
    parent.appendChild(style);
    return style;
  }
  var fillStyleTemplate = (template, values) => template.replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Missing style token ${key}`);
    return values[key];
  });

  // src/shared/options-styles.js
  var OPTIONS_STYLE_TEMPLATE = String.raw`
            #{{optionsButtonId}} {
                opacity: 0.94;
            }
            #{{optionsButtonId}}:hover,
            #{{optionsButtonId}}:focus-visible,
            #{{optionsButtonId}}[aria-expanded="true"] {
                opacity: 1;
            }
            #{{optionsButtonId}}[data-tm-volume-mode="off"] svg {
                opacity: 0.58;
            }
            #{{optionsButtonId}} svg {
                display: block;
                height: 24px;
                width: 24px;
            }
            #{{optionsButtonId}} .tm-options-handle {
                transform: translateX(0);
                transition: transform 180ms cubic-bezier(0.2, 0, 0.2, 1);
            }
            #{{optionsButtonId}}[aria-expanded="true"] .tm-options-handle-top {
                transform: translateX(-8px);
            }
            #{{optionsButtonId}}[aria-expanded="true"] .tm-options-handle-middle {
                transform: translateX(8px);
            }
            #{{optionsButtonId}}[aria-expanded="true"] .tm-options-handle-bottom {
                transform: translateX(-6px);
            }
            @media (prefers-reduced-motion: reduce) {
                #{{optionsButtonId}} .tm-options-handle { transition: none; }
            }
            #{{optionsPopupId}} {
                background: rgba(18, 18, 18, 0.97);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.48);
                color: #fff;
                display: flex;
                flex-direction: column;
                font-family: Arial, sans-serif;
                font-size: 14px;
                line-height: 1;
                max-height: 70vh;
                max-width: calc(100vw - 16px);
                min-width: 288px;
                outline: none;
                overflow: hidden;
                position: absolute;
                user-select: none;
                width: 320px;
                z-index: 10001;
            }
            #{{optionsPopupId}},
            #{{optionsPopupId}} * {
                box-sizing: border-box;
            }
            #{{optionsPopupId}} button {
                -webkit-appearance: none;
                appearance: none;
                font-family: inherit;
                letter-spacing: normal;
                margin: 0;
                text-transform: none;
            }
            #{{optionsPopupId}} .tm-volume-options-button-label {
                display: block;
                font-size: 14px;
                font-weight: 400;
                min-width: 0;
            }
            #{{optionsPopupId}}[hidden] {
                display: none;
            }
            #{{optionsPopupId}} [hidden] {
                display: none !important;
            }
            #{{optionsPopupId}} .tm-volume-options-mode {
                align-items: center;
                display: flex;
                flex-shrink: 0;
                justify-content: space-between;
                gap: 12px;
                padding: 8px 16px 10px;
                line-height: 20px;
            }
            #{{optionsPopupId}} select {
                -webkit-appearance: none;
                appearance: none;
                background-color: rgba(255, 255, 255, 0.08);
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m3 4.5 3 3 3-3' fill='none' stroke='%23fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
                background-position: right 12px center;
                background-repeat: no-repeat;
                background-size: 12px 12px;
                border: 0;
                border-radius: 6px;
                color: #fff;
                color-scheme: dark;
                cursor: pointer;
                font: inherit;
                line-height: 20px;
                outline: none;
                padding: 7px 32px 7px 10px;
                width: 176px;
            }
            #{{optionsPopupId}} select:open {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m3 7.5 3-3 3 3' fill='none' stroke='%23fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
            }
            #{{optionsPopupId}} select:focus-visible {
                background-color: rgba(255, 255, 255, 0.16);
            }
            #{{optionsPopupId}} select option {
                background-color: #242424;
                color: #fff;
            }
            #{{optionsPopupId}} .tm-volume-options-tabs {
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: grid;
                flex-shrink: 0;
                grid-template-columns: 1fr 1fr;
                padding: 0 16px;
            }
            #{{optionsPopupId}} .tm-volume-options-tab {
                background: transparent;
                border: 0;
                color: rgba(255, 255, 255, 0.65);
                cursor: pointer;
                display: grid;
                padding: 11px 0;
                place-items: center;
            }
            #{{optionsPopupId}} .tm-volume-options-tab[aria-selected="true"] {
                box-shadow: inset 0 -2px {{accentDark}};
                color: #fff;
            }
            #{{optionsPopupId}} .tm-volume-options-tab:hover {
                color: #fff;
            }
            #{{optionsPopupId}} :is(button, input):focus-visible {
                outline: 2px solid {{accentDark}};
                outline-offset: -2px;
            }
            #{{optionsPopupId}} .tm-volume-options-normalization-feedback {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.09);
                border-radius: 6px;
                margin-top: 6px;
                padding: 8px 10px;
            }
            #{{optionsPopupId}} #tm-volume-options-normalization-status {
                color: rgba(255, 255, 255, 0.9);
                margin: 0;
            }
            #{{optionsPopupId}} #tm-volume-options-normalization-status::before {
                background: rgba(255, 255, 255, 0.45);
                border-radius: 50%;
                content: '';
                display: inline-block;
                height: 6px;
                margin-right: 7px;
                vertical-align: 1px;
                width: 6px;
            }
            #{{optionsPopupId}} #tm-volume-options-normalization-status[data-state="active"]::before {
                background: #60cf83;
            }
            #{{optionsPopupId}} #tm-volume-options-normalization-details {
                white-space: pre-line;
            }
            #{{optionsPopupId}} .tm-volume-options-step-setting {
                margin-top: 14px;
            }
            #{{optionsPopupId}} .tm-volume-options-step-setting .tm-volume-options-section-label {
                color: rgba(255, 255, 255, 0.75);
                font-size: 12px;
                font-weight: 400;
                margin-bottom: 8px;
            }
            #{{optionsPopupId}} .tm-volume-options-appearance-hint {
                padding: 8px 16px 0;
            }
            #{{optionsPopupId}} #tm-volume-options-placement-section > .tm-volume-options-checklist {
                margin-top: 8px;
            }
{{platformOptionsCss}}
            .tm-volume-options-header {
                align-items: center;
                display: flex;
                flex-shrink: 0;
                padding: 10px 16px 4px;
            }
            .tm-volume-options-title {
                color: #fff;
                font-size: 15px;
                font-weight: 600;
                line-height: 20px;
            }
            .tm-volume-options-body {
                flex: 1 1 auto;
                min-height: 0;
                overflow-x: hidden;
                overflow-y: auto;
                overscroll-behavior: contain;
                padding: 10px 0 8px;
                scrollbar-color: rgba(255, 255, 255, 0.34) rgba(255, 255, 255, 0.08);
                scrollbar-width: thin;
            }
            .tm-volume-options-body::-webkit-scrollbar {
                width: 8px;
            }
            .tm-volume-options-body::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.06);
                border-radius: 4px;
            }
            .tm-volume-options-body::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.28);
                background-clip: padding-box;
                border: 2px solid transparent;
                border-radius: 4px;
            }
            .tm-volume-options-body::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.42);
                background-clip: padding-box;
            }
            .tm-volume-options-section {
                padding: 10px 16px;
            }
            .tm-volume-options-section:first-child {
                padding-top: 0;
            }
            .tm-volume-options-section:last-child {
                padding-bottom: 0;
            }
            .tm-volume-options-section + .tm-volume-options-section {
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                padding-top: 12px;
            }
            .tm-volume-options-section-label {
                color: #fff;
                font-size: 14px;
                font-weight: 600;
                line-height: 20px;
                margin: 0 0 10px;
            }
            .tm-volume-options-checklist {
                display: flex;
                flex-direction: column;
            }
            #{{optionsPopupId}} .tm-volume-options-help {
                color: rgba(255, 255, 255, 0.7);
                font-size: 12px;
                line-height: 1.4;
                margin: 6px 0 0;
                white-space: normal;
            }
            #{{optionsPopupId}} .tm-volume-options-checklist .tm-volume-options-row {
                align-items: center;
                column-gap: 12px;
                display: grid;
                grid-template-columns: 1fr 32px;
                justify-content: stretch;
                margin: 0 -8px;
                min-height: 36px;
                padding: 5px 8px;
                width: calc(100% + 16px);
            }
            .tm-volume-options-checklist .tm-volume-options-row > .tm-volume-options-button-label {
                justify-self: start;
                min-width: 0;
            }
            .tm-volume-options-checklist .tm-volume-options-checkbox {
                justify-self: end;
            }
            .tm-volume-options-row {
                align-items: center;
                background: transparent;
                border: 0;
                border-radius: 6px;
                color: #fff;
                cursor: pointer;
                display: flex;
                font-size: 13px;
                font-weight: 400;
                line-height: 18px;
                min-height: 34px;
                padding: 7px 8px;
                text-align: left;
                transition: background 0.12s ease;
            }
            .tm-volume-options-row > .tm-volume-options-button-label {
                display: block;
                line-height: 18px;
            }
            .tm-volume-options-row:hover,
            .tm-volume-options-row:focus-visible {
                background: rgba(255, 255, 255, 0.08);
                outline: none;
            }
            .tm-volume-options-row:disabled {
                cursor: not-allowed;
                opacity: 0.45;
            }
            .tm-volume-options-checkbox {
                background: rgba(255, 255, 255, 0.22);
                border: 0;
                border-radius: 10px;
                display: block;
                flex-shrink: 0;
                height: 18px;
                position: relative;
                width: 32px;
            }
            .tm-volume-options-checkbox::after {
                background: #fff;
                border-radius: 50%;
                content: '';
                height: 14px;
                left: 2px;
                position: absolute;
                top: 2px;
                width: 14px;
            }
            .tm-volume-options-row[aria-checked="true"] .tm-volume-options-checkbox {
                background: {{accentDark}};
            }
            .tm-volume-options-row[aria-checked="true"] .tm-volume-options-checkbox::after {
                left: 16px;
            }
            .tm-volume-options-section-label + * {
                padding-top: 2px;
            }
            .tm-volume-options-segment {
                display: flex;
                gap: 8px;
                width: 100%;
            }
            .tm-volume-options-segment .tm-volume-options-radio {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.14);
            }
            .tm-volume-options-segment .tm-volume-options-radio:hover,
            .tm-volume-options-segment .tm-volume-options-radio:focus-visible {
                background: rgba(255, 255, 255, 0.14);
                border-color: rgba(255, 255, 255, 0.2);
            }
            .tm-volume-options-radio {
                align-items: center;
                background: transparent;
                border: 0;
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.82);
                cursor: pointer;
                display: grid;
                flex: 1 1 0;
                font-size: 12px;
                font-weight: 600;
                line-height: 16px;
                min-height: 34px;
                min-width: 0;
                padding: 0 10px;
                place-items: center;
                text-align: center;
                transition: background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
            }
            .tm-volume-options-radio > .tm-volume-options-button-label {
                line-height: 16px;
                max-width: 100%;
                text-align: center;
                width: 100%;
            }
            .tm-volume-options-radio:hover,
            .tm-volume-options-radio:focus-visible {
                background: rgba(255, 255, 255, 0.1);
                outline: none;
            }
            .tm-volume-options-radio[aria-checked="true"] {
                background: {{accentDark}};
                border-color: {{accentDark}};
                box-shadow: none;
                color: #fff;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
            }
            .tm-volume-options-section[data-disabled="true"] .tm-volume-options-radio {
                cursor: not-allowed;
                opacity: 0.4;
            }
            .tm-volume-options-section[data-disabled="true"] .tm-volume-options-radio:hover {
                background: transparent;
            }
            .tm-volume-options-section[data-disabled="true"] .tm-volume-options-radio[aria-checked="true"] {
                background: {{accentDisabled}};
            }
            .tm-volume-options-opacity-row {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .tm-volume-options-section-label + .tm-volume-options-opacity-row {
                margin-top: 2px;
            }
            .tm-volume-options-opacity-row + .tm-volume-options-opacity-row {
                margin-top: 12px;
            }
            .tm-volume-options-opacity-label-group {
                align-items: baseline;
                display: flex;
                gap: 6px;
                min-width: 0;
            }
            .tm-volume-options-opacity-name {
                color: #fff;
                font-size: 13px;
                line-height: 18px;
            }
            .tm-volume-options-opacity-value {
                color: rgba(255, 255, 255, 0.65);
                font-size: 12px;
                line-height: 18px;
            }
            .tm-volume-options-opacity-controls {
                align-items: center;
                display: flex;
                gap: 12px;
            }
            .tm-volume-options-opacity-reset {
                align-items: center;
                background: rgba(255, 255, 255, 0.12);
                border: 0;
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.9);
                cursor: pointer;
                display: grid;
                flex-shrink: 0;
                font-size: 11px;
                font-weight: 500;
                height: 28px;
                line-height: 16px;
                min-width: 52px;
                padding: 0 10px;
                place-items: center;
                text-align: center;
            }
            .tm-volume-options-opacity-reset > .tm-volume-options-button-label {
                line-height: 16px;
                text-align: center;
            }
            .tm-volume-options-opacity-reset:hover,
            .tm-volume-options-opacity-reset:focus-visible {
                background: rgba(255, 255, 255, 0.26);
            }
            .tm-volume-options-opacity-slider {
                -webkit-appearance: none;
                appearance: none;
                background: linear-gradient(to right,
                    rgba(255, 255, 255, 0.92) 0%,
                    rgba(255, 255, 255, 0.92) var(--tm-opacity-fill, 0%),
                    rgba(255, 255, 255, 0.22) var(--tm-opacity-fill, 0%),
                    rgba(255, 255, 255, 0.22) 100%);
                border-radius: 3px;
                cursor: pointer;
                display: block;
                flex: 1 1 auto;
                height: 4px;
                margin: 0;
                min-width: 0;
                outline: none;
                width: 100%;
            }
            .tm-volume-options-opacity-slider::-webkit-slider-runnable-track {
                background: transparent;
                border: none;
                height: 4px;
            }
            .tm-volume-options-opacity-slider::-moz-range-track {
                background: transparent;
                border: none;
                height: 4px;
            }
            .tm-volume-options-opacity-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                background: #fff;
                border: 0;
                border-radius: 50%;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
                cursor: pointer;
                height: 14px;
                margin-top: -5px;
                width: 14px;
            }
            .tm-volume-options-opacity-slider::-moz-range-thumb {
                background: #fff;
                border: 0;
                border-radius: 50%;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
                cursor: pointer;
                height: 14px;
                width: 14px;
            }
        `;
  function getPlatformOptionsCss(platform, closeHideControlsClass) {
    if (platform === "twitch") {
      return `            .tm-volume-options-controls-shell-hold,
            [data-a-target="player-controls"].tm-volume-options-controls-hold,
            [data-a-target="player-controls"].tm-volume-options-controls-hold #channel-player {
                opacity: 1 !important;
                pointer-events: auto !important;
                visibility: visible !important;
            }`;
    }
    return `            .tm-volume-options-open .ytp-tooltip {
                display: none !important;
            }
            #movie_player.ytp-autohide:not(.tm-volume-options-controls-hold) .ytp-chrome-bottom,
            #movie_player.ytp-hide-controls:not(.tm-volume-options-controls-hold) .ytp-chrome-bottom {
                pointer-events: none !important;
            }
            #movie_player.${closeHideControlsClass}:not(.tm-volume-options-controls-hold) .ytp-chrome-bottom {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            .tm-volume-options-controls-hold .ytp-chrome-bottom {
                opacity: 1 !important;
                pointer-events: auto !important;
                visibility: visible !important;
            }`;
  }
  function installOptionsStyles({
    document: document2,
    platform,
    styleId,
    optionsButtonId,
    optionsPopupId,
    accentDark,
    accentDisabled,
    closeHideControlsClass = ""
  }) {
    const style = createStyleElement(document2, styleId);
    if (!style) return;
    style.textContent = fillStyleTemplate(OPTIONS_STYLE_TEMPLATE, {
      optionsButtonId,
      optionsPopupId,
      accentDark,
      accentDisabled,
      platformOptionsCss: getPlatformOptionsCss(platform, closeHideControlsClass)
    });
  }

  // src/shared/slider-styles.js
  var SLIDER_STYLE_TEMPLATE = String.raw`
#{{overlayId}} {
  --tm-pill-min-width: 228px;
  --tm-pill-zoom-adaptive-width: calc(34vw - 92px);
  --tm-pill-max-width: 368px;
  /* Browser zoom reduces the CSS viewport width, so this shrinks the expanded pill before it clips offscreen. */
  --tm-pill-expanded-width: clamp(var(--tm-pill-min-width), var(--tm-pill-zoom-adaptive-width), var(--tm-pill-max-width));
  --tm-label-row-width: 50px;
  --tm-slider-row-offset: 62px;
  --tm-normalization-accent: {{normalizationAccent}};
  filter: {{panelDropShadow}};
}
{{platformFootprintCss}}
#{{overlayId}}.tm-volume-appearance-classic {
  --tm-pill-min-width: 274px;
  --tm-pill-zoom-adaptive-width: calc(34vw - 46px);
  --tm-pill-max-width: 414px;
  --tm-label-row-width: 96px;
  --tm-slider-row-offset: 108px;
}{{compactCss}}
@media (max-width: 320px) {
  {{smallDefaultSelectors}} {
    --tm-pill-min-width: 176px;
    --tm-pill-zoom-adaptive-width: min(216px, calc(64vw - 14px));
  }

  {{smallClassicSelectors}} {
    --tm-pill-min-width: 196px;
    --tm-pill-zoom-adaptive-width: min(262px, calc(64vw + 6px));
  }

  #{{overlayId}} .tm-volume-slider-row {
    --tm-active-track-h: 9px;
    --tm-visual-track-h: 4px;
    --tm-thumb-size: 18px;
  }
}

#{{overlayId}} input[type=range] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  height: 42px;
  border: none;
  border-radius: 999px;
  box-sizing: border-box;
  outline: none;
  position: relative;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  z-index: 2;
  overflow: visible;
}

#{{overlayId}} input[type=range]::-webkit-slider-runnable-track {
  border: none;
  background: transparent;
  height: var(--tm-active-track-h, 9px);
  border-radius: var(--tm-track-radius);
}

#{{overlayId}} input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: var(--tm-thumb-size);
  height: var(--tm-thumb-size);
  border-radius: 50%;
  background: linear-gradient(145deg, #ffffff, #f0f0f0);
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  margin-top: calc((var(--tm-active-track-h, 9px) - var(--tm-thumb-size, 22px)) / 2);
}

#{{overlayId}} input[type=range]::-webkit-slider-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

#{{overlayId}} input[type=range]::-webkit-slider-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

#{{overlayId}} input[type=range]::-moz-range-thumb {
  width: var(--tm-thumb-size);
  height: var(--tm-thumb-size);
  border-radius: 50%;
  background: linear-gradient(145deg, #ffffff, #f0f0f0);
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

#{{overlayId}} input[type=range]::-moz-range-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

#{{overlayId}} input[type=range]::-moz-range-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

#{{overlayId}} input[type=range]::-moz-range-track {
  background: transparent;
  height: var(--tm-active-track-h, 9px);
  border-radius: var(--tm-track-radius);
  border: none;
  outline: none;
}

#{{overlayId}} input[type=range]::-moz-range-progress {
  background: transparent;
  border: none;
}

#{{overlayId}} input[type=range]::-moz-focus-outer {
  border: none;
  outline: none;
}

#{{overlayId}} .tm-volume-panel-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  border: none;
  background: {{panelBackground}};
  box-sizing: border-box;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  opacity: 1;
  pointer-events: none;
  transform: none;
  transition: none;
}

#{{overlayId}} .tm-volume-icon-cell {
  position: absolute;
  left: 0;
  top: 0;
  width: 40px;
  height: 40px;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  opacity: 1;
  transition: opacity 0.1s ease;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

#{{overlayId}} .tm-volume-icon-cell:focus-visible {
  outline: 2px solid #fff;
  outline-offset: -4px;
  border-radius: 50%;
}

#{{overlayId}}.tm-normalization-enabled {
  /* Keep the inset waveform visible at the pill's rounded edge. */
  overflow: clip !important;
  overflow-clip-margin: 8px;
}

#{{overlayId}} .tm-normalization-icon {
  position: absolute;
  left: 28px;
  top: 0;
  width: 12px;
  height: 12px;
  display: block;
  pointer-events: auto;
}

#{{overlayId}} .tm-normalization-icon svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

#{{overlayId}} .tm-normalization-icon circle {
  fill: #17171b;
  stroke: var(--tm-normalization-accent);
  stroke-width: 1;
}

#{{overlayId}} .tm-normalization-icon path {
  fill: none;
  stroke: #fff;
  stroke-width: 1.25;
  stroke-linecap: round;
}

#{{overlayId}} .tm-normalization-icon[hidden] {
  display: none;
}

#{{overlayId}} .tm-normalization-description {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

#{{overlayId}} .tm-volume-indicator {
  position: relative;
  width: 40px;
  height: 40px;
  opacity: 1;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

#{{overlayId}} .tm-volume-indicator svg {
  display: block;
  width: 40px;
  height: 40px;
  overflow: visible;
  shape-rendering: geometricPrecision;
}

#{{overlayId}} .tm-volume-arc-track,
#{{overlayId}} .tm-volume-arc {
  shape-rendering: geometricPrecision;
}

#{{overlayId}} .tm-volume-arc {
  stroke-linecap: round;
}

#{{overlayId}} .tm-volume-speaker-icon {
  color: rgba(255, 255, 255, 0.94);
  display: none;
}

#{{overlayId}}.tm-volume-appearance-classic .tm-volume-percent {
  display: none;
}

#{{overlayId}}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="muted"] .tm-volume-speaker-muted,
#{{overlayId}}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="low"] .tm-volume-speaker-low,
#{{overlayId}}.tm-volume-appearance-classic .tm-volume-indicator[data-volume-icon="high"] .tm-volume-speaker-high {
  display: block;
}

#{{overlayId}} .tm-volume-percent {
  fill: rgba(255, 255, 255, 0.96);
  font: 700 15px/1 Arial, Helvetica, sans-serif;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-synthesis: none;
  letter-spacing: 0;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.75);
  text-rendering: geometricPrecision;
  user-select: none;
}

#{{overlayId}} .tm-volume-indicator.muted {
  filter: saturate(0.45);
  opacity: 0.78;
}

#{{overlayId}} .tm-volume-controls {
  position: relative;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity 0.08s ease 0.14s, visibility 0s linear 0.22s;
}

#{{overlayId}}.tm-collapsed .tm-volume-controls {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity 0.08s ease 0.14s, visibility 0s linear 0.22s;
}

#{{overlayId}}.tm-expanded .tm-volume-controls {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
  transition: opacity 0.1s ease, visibility 0s linear 0s;
}

#{{overlayId}} .tm-volume-top-row {
  flex: 0 0 auto;
  position: relative;
  width: var(--tm-label-row-width);
  height: 40px;
  box-sizing: border-box;
  pointer-events: {{topRowPointerEvents}};
}

#{{overlayId}} #{{valueLabelId}} {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
{{labelVisualCss}}}

#{{overlayId}}.tm-volume-appearance-classic #{{valueLabelId}} {
  left: 36px;
  top: 50%;
  width: 58px;
  height: auto;
  overflow: visible;
  clip-path: none;
  transform: translateY(-50%);
}

#{{overlayId}} .tm-volume-slider-row {
  --tm-active-track-h: 11px;
  --tm-visual-track-h: 5px;
  --tm-thumb-size: 22px;
  --tm-track-radius: calc(var(--tm-visual-track-h, 5px) / 2);
  flex: 0 0 calc(var(--tm-pill-expanded-width) - var(--tm-slider-row-offset));
  width: calc(var(--tm-pill-expanded-width) - var(--tm-slider-row-offset));
  min-width: 0;
  height: 40px;
}

#{{overlayId}} .tm-slider-track {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  height: var(--tm-visual-track-h, 5px);
  border-radius: 999px;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

#{{overlayId}} .tm-slider-ticks {
  position: absolute;
  left: calc(var(--tm-thumb-size, 22px) / 2);
  right: calc(var(--tm-thumb-size, 22px) / 2);
  top: 50%;
  transform: translateY(-50%);
  height: var(--tm-visual-track-h, 5px);
  overflow: visible;
  pointer-events: none;
  opacity: 1;
  transition: none;
  z-index: 1;
}

#{{overlayId}} .tm-slider-tick {
  position: absolute;
  top: 25%;
  bottom: 25%;
  width: var(--tm-slider-tick-width, 1px);
  height: auto;
  background: rgba(255,255,255,0.18);
  transform: none;
}

#{{overlayId}} .tm-slider-tick-major {
  top: 0;
  bottom: 0;
  background: rgba(255,255,255,0.46);
}

        `;
  var YOUTUBE_LABEL_VISUAL_CSS = '  font: 500 14px/40px "YouTube Noto", Roboto, Arial, Helvetica, sans-serif;\n  color: #fff;\n  text-align: center;\n  text-shadow: 0 0 2px rgb(0, 0, 0);\n  user-select: none;\n  letter-spacing: 0;\n';
  function getSliderPlatformStyles(platform, overlayId) {
    if (platform !== "twitch") {
      return {
        platformFootprintCss: "",
        compactCss: "\n",
        smallDefaultSelectors: `#${overlayId}`,
        smallClassicSelectors: `#${overlayId}.tm-volume-appearance-classic`,
        panelBackground: "rgba(8, 13, 15, 0.34)",
        topRowPointerEvents: "none !important",
        labelVisualCss: YOUTUBE_LABEL_VISUAL_CSS
      };
    }
    return {
      platformFootprintCss: `
/* Match Twitch's native control footprint so the custom control does not raise the control row. */
#${overlayId}.tm-in-controls {
  height: 32px !important;
  min-height: 32px !important;
  overflow: clip !important;
  overflow-clip-margin: 4px;
  transform: translateY(0) !important;
}

#${overlayId}.tm-in-controls .tm-volume-panel-bg {
  top: -4px;
  bottom: auto;
  height: 40px;
}

#${overlayId}.tm-in-controls .tm-volume-icon-cell {
  top: -4px;
  left: 0;
}
`,
      compactCss: `

#${overlayId}.tm-volume-compact-layout {
  --tm-pill-min-width: 208px;
  --tm-pill-zoom-adaptive-width: min(252px, calc(64vw - 14px));
}

#${overlayId}.tm-volume-compact-layout.tm-volume-appearance-classic {
  --tm-pill-min-width: 228px;
  --tm-pill-zoom-adaptive-width: min(292px, calc(64vw + 6px));
}

#${overlayId}.tm-volume-compact-layout .tm-volume-slider-row {
  --tm-active-track-h: 9px;
  --tm-visual-track-h: 4px;
  --tm-thumb-size: 18px;
}
`,
      smallDefaultSelectors: `#${overlayId},
  #${overlayId}.tm-volume-compact-layout`,
      smallClassicSelectors: `#${overlayId}.tm-volume-appearance-classic,
  #${overlayId}.tm-volume-compact-layout.tm-volume-appearance-classic`,
      panelBackground: "rgba(55, 48, 62, 0.34)",
      topRowPointerEvents: "none",
      labelVisualCss: ""
    };
  }
  function installVolumeSliderStyles({ document: document2, platform, overlayId, valueLabelId, panelDropShadow }) {
    const style = createStyleElement(document2, "tm-volume-slider-style");
    if (!style) return;
    style.textContent = fillStyleTemplate(SLIDER_STYLE_TEMPLATE, {
      overlayId,
      valueLabelId,
      panelDropShadow,
      normalizationAccent: platform === "twitch" ? "#a970ff" : "#cc4444",
      ...getSliderPlatformStyles(platform, overlayId)
    });
  }

  // src/shared/slider-interactions.js
  function createVolumeControlElements({
    document: document2,
    overlay,
    sliderId,
    valueLabelId,
    makeVolumeIndicatorSvg,
    populateSliderTicks,
    getVolumeStep
  }) {
    const iconCell = document2.createElement("button");
    iconCell.type = "button";
    iconCell.className = "tm-volume-icon-cell";
    const indicator = document2.createElement("div");
    indicator.className = "tm-volume-indicator";
    indicator.appendChild(makeVolumeIndicatorSvg());
    iconCell.appendChild(indicator);
    const normalizationIcon = createNormalizationIcon(document2);
    const normalizationDescription = document2.createElement("span");
    normalizationDescription.className = "tm-normalization-description";
    normalizationDescription.id = `${overlay.id}-normalization-description`;
    normalizationDescription.textContent = normalizationIcon.title;
    iconCell.append(normalizationIcon, normalizationDescription);
    const panelBg = document2.createElement("div");
    panelBg.className = "tm-volume-panel-bg";
    const topRow = document2.createElement("div");
    topRow.className = "tm-volume-controls tm-volume-top-row";
    const label = document2.createElement("div");
    label.id = valueLabelId;
    label.textContent = "100%";
    topRow.appendChild(label);
    const sliderWrap = document2.createElement("div");
    sliderWrap.className = "tm-volume-controls tm-volume-slider-row";
    Object.assign(sliderWrap.style, {
      position: "relative",
      height: "40px",
      display: "flex",
      alignItems: "center"
    });
    const tickOverlay = document2.createElement("div");
    tickOverlay.className = "tm-slider-ticks";
    populateSliderTicks(tickOverlay);
    const sliderTrack = document2.createElement("div");
    sliderTrack.className = "tm-slider-track";
    const slider = document2.createElement("input");
    slider.id = sliderId;
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.dataset.tmVolumeStep = String(getVolumeStep());
    Object.assign(slider.style, {
      width: "100%",
      display: "block",
      margin: "0",
      cursor: "pointer"
    });
    slider.setAttribute("aria-label", "Volume");
    slider.setAttribute("aria-describedby", valueLabelId);
    sliderWrap.append(sliderTrack, slider, tickOverlay);
    overlay.append(panelBg, iconCell, topRow, sliderWrap);
    return { iconCell, topRow, label, tickOverlay, slider };
  }
  function syncVolumeControl({ slider, label, overlay, value, muted, updateSliderBar, updateVolumeIndicator }) {
    slider.value = String(value);
    label.textContent = muted ? "Muted" : `${value}%`;
    updateSliderBar(slider);
    updateVolumeIndicator(overlay, value, muted);
  }
  function bindWheelVolumeStep({ target, slider, getVolumeStep, beforeApply, applyValue }) {
    const pixelThreshold = 40;
    const gestureGapMs = 250;
    let accumulatedPixels = 0;
    let lastDirection = 0;
    let lastTime = 0;
    const handler = (event) => {
      if (event.ctrlKey || event.metaKey || event.defaultPrevented || !Number.isFinite(event.deltaY) || event.deltaY === 0) {
        accumulatedPixels = 0;
        lastDirection = 0;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? 1 : -1;
      if (direction !== lastDirection || event.timeStamp - lastTime > gestureGapMs) {
        accumulatedPixels = 0;
      }
      lastDirection = direction;
      lastTime = event.timeStamp;
      accumulatedPixels += (event.deltaMode || 0) === 0 ? Math.min(Math.abs(event.deltaY), pixelThreshold) : pixelThreshold;
      if (accumulatedPixels < pixelThreshold) {
        return;
      }
      accumulatedPixels -= pixelThreshold;
      const currentValue = Number(slider.value) || 0;
      const step = getVolumeStep();
      const nextValue = stepVolume(currentValue, direction, step);
      if (nextValue === currentValue) {
        return;
      }
      beforeApply?.(event, nextValue);
      slider.value = String(nextValue);
      applyValue(nextValue);
    };
    target.addEventListener("wheel", handler, { passive: false });
    return () => target.removeEventListener("wheel", handler, { passive: false });
  }
  function getMajorTickPressValue(slider, clientX, volumeStep) {
    if (volumeStep !== 1 && volumeStep !== 2) return null;
    if (!Number.isFinite(clientX)) return null;
    const tickOverlay = slider?.parentElement?.querySelector?.(".tm-slider-ticks");
    const overlayRect = tickOverlay?.getBoundingClientRect?.();
    if (!overlayRect || !Number.isFinite(overlayRect.width) || overlayRect.width <= 0) return null;
    const majorTicks = Array.from(tickOverlay.querySelectorAll?.(".tm-slider-tick-major") || []);
    let nearestValue = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const tick of majorTicks) {
      const value = Number(tick.dataset?.tmTickPct);
      const rect = tick.getBoundingClientRect?.();
      if (!Number.isFinite(value) || !rect) continue;
      const center = Number(rect.left) + Number(rect.width) / 2;
      const distance = Math.abs(clientX - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestValue = value;
      }
    }
    const majorTickSpacing = overlayRect.width / 10;
    const hitRadius = Math.max(4, Math.min(8, majorTickSpacing * 0.3));
    return nearestDistance <= hitRadius ? nearestValue : null;
  }
  function bindRangePointerInteraction({
    window: window2,
    slider,
    overlay,
    getVolumeStep,
    readSteppedValue,
    snapValue,
    applyValue,
    setExpanded,
    updateOpacity,
    collapseIfIdle,
    onFinish,
    finishLayout
  }) {
    let pointerStartX = 0;
    let pointerStartY = 0;
    let pointerStartValue = 0;
    let pointerMoved = false;
    let pointerDisplaced = false;
    let clickSnapHandled = false;
    let majorTickPressHandled = false;
    let pointerActive = false;
    const snapMajorTickPressIfNeeded = (event) => {
      if (!pointerActive || pointerDisplaced || majorTickPressHandled) return false;
      const pressedValue = getMajorTickPressValue(slider, event?.clientX ?? pointerStartX, getVolumeStep?.());
      if (pressedValue === null) return false;
      majorTickPressHandled = true;
      clickSnapHandled = true;
      const currentValue = Number(slider.value) || 0;
      if (pressedValue !== currentValue) {
        slider.value = String(pressedValue);
        applyValue(pressedValue);
      }
      return true;
    };
    const snapDirectClickIfNeeded = (event) => {
      if (snapMajorTickPressIfNeeded(event)) return;
      const currentValue = Number(slider.value) || 0;
      if (clickSnapHandled || pointerMoved || currentValue === pointerStartValue) return;
      const snappedValue = snapValue(currentValue);
      slider.value = String(snappedValue);
      applyValue(snappedValue);
      clickSnapHandled = true;
    };
    const readPressAwareValue = () => {
      const value = readSteppedValue(slider);
      if (pointerActive && !pointerDisplaced && !majorTickPressHandled) {
        const pressedValue = getMajorTickPressValue(slider, pointerStartX, getVolumeStep?.());
        if (pressedValue !== null) {
          slider.value = String(pressedValue);
          majorTickPressHandled = true;
          clickSnapHandled = true;
          return pressedValue;
        }
      }
      if (pointerActive && !pointerMoved && !clickSnapHandled && value !== pointerStartValue) {
        clickSnapHandled = true;
      }
      return value;
    };
    const finish = (event) => {
      if (!pointerActive) return;
      const wasDragging = overlay.dataset.tmDragging === "true";
      if (event?.type === "pointerup" && wasDragging) snapDirectClickIfNeeded();
      overlay.dataset.tmDragging = "false";
      pointerActive = false;
      onFinish?.(event, wasDragging);
      if (finishLayout) {
        finishLayout(!overlay.matches(":hover"));
        return;
      }
      updateOpacity();
      collapseIfIdle(!overlay.matches(":hover"));
    };
    const start = (event) => {
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
      pointerStartValue = Number(slider.value) || 0;
      pointerMoved = false;
      pointerDisplaced = false;
      clickSnapHandled = false;
      majorTickPressHandled = false;
      pointerActive = true;
      overlay.dataset.tmDragging = "true";
      setExpanded();
      updateOpacity();
    };
    const move = (event) => {
      if (Math.abs(event.clientX - pointerStartX) > 1 || Math.abs(event.clientY - pointerStartY) > 1) {
        pointerDisplaced = true;
      }
      if (Math.abs(event.clientX - pointerStartX) > 3 || Math.abs(event.clientY - pointerStartY) > 3) {
        pointerMoved = true;
      }
    };
    slider.addEventListener("pointerdown", start);
    slider.addEventListener("pointermove", move);
    slider.addEventListener("click", snapDirectClickIfNeeded);
    window2.addEventListener("pointerup", finish, true);
    window2.addEventListener("pointercancel", finish, true);
    window2.addEventListener("blur", finish);
    return {
      readPressAwareValue,
      dispose() {
        slider.removeEventListener("pointerdown", start);
        slider.removeEventListener("pointermove", move);
        slider.removeEventListener("click", snapDirectClickIfNeeded);
        window2.removeEventListener("pointerup", finish, true);
        window2.removeEventListener("pointercancel", finish, true);
        window2.removeEventListener("blur", finish);
      }
    };
  }

  // src/platforms/youtube.js
  function startYouTubeVolumeSlider() {
    "use strict";
    let storage = null;
    try {
      storage = localStorage;
    } catch {
    }
    const OVERLAY_ID = "tm-volume-slider-overlay";
    const SLIDER_ID = "tm-volume-slider-range";
    const VALUE_LABEL_ID = "tm-volume-slider-value";
    const OPTIONS_STYLE_ID = "tm-volume-options-style";
    const OPTIONS_BUTTON_ID = "tm-volume-options-button";
    const OPTIONS_POPUP_ID = "tm-volume-options-popup";
    const OPTIONS_CLOSE_HIDE_CONTROLS_CLASS = "tm-volume-options-close-hide-controls";
    const STORAGE_KEY = "tm-yt-volume";
    const MUTE_STORAGE_KEY = "tm-yt-muted";
    const VOLUME_MODE_KEY = "tm-yt-volume-slider-mode";
    const SLIDER_LOCATION_KEY = "tm-yt-volume-slider-location";
    const REPLACE_NATIVE_PLACEMENT_KEY = "tm-yt-volume-slider-replace-placement";
    const VOLUME_STEP_KEY = "tm-yt-volume-slider-step";
    const LEGACY_SNAP_TO_5_KEY = "tm-yt-volume-slider-snap-to-5";
    const ALWAYS_EXPANDED_KEY = "tm-yt-volume-slider-always-expanded";
    const OVERLAY_OPACITY_IDLE_KEY = "tm-yt-volume-slider-opacity-idle";
    const OVERLAY_OPACITY_ACTIVE_KEY = "tm-yt-volume-slider-opacity-active";
    const OVERLAY_SIZE_KEY = "tm-yt-volume-slider-size";
    const SLIDER_THICKNESS_KEY = "tm-yt-volume-slider-thickness";
    const VOLUME_APPEARANCE_KEY = "tm-yt-volume-slider-appearance";
    const DEFAULT_OVERLAY_OPACITY_IDLE = 45;
    const DEFAULT_OVERLAY_OPACITY_ACTIVE = 95;
    const DEFAULT_OVERLAY_SIZE = 100;
    const DEFAULT_SLIDER_THICKNESS = 75;
    const STORAGE_WRITE_DEBOUNCE_MS = 150;
    const VOLUME_CHANGE_EXPANDED_HOLD_MS = 1200;
    const KEYBOARD_VOLUME_STEP = 5;
    const NAV_REATTACH_DELAY_MS = 700;
    const NAV_DEBOUNCE_MS = 180;
    const INITIAL_ATTACH_RETRY_MS = 50;
    const INITIAL_ATTACH_MAX_ATTEMPTS = 80;
    const USER_VOLUME_INTENT_GRACE_MS = 5e3;
    const USER_VOLUME_TOLERANCE = 1;
    const ON_VIDEO_IDLE_BOTTOM_PX = 12;
    const ON_VIDEO_MAX_CONTROLS_OFFSET_PX = 140;
    const VOLUME_ACCENT_LIGHT = "#cc4444";
    const VOLUME_ACCENT_DARK = "#bb3333";
    const VOLUME_ACCENT_MID = "#cc5555";
    const VOLUME_ACCENT_DISABLED = "rgba(187, 51, 51, 0.55)";
    const VOLUME_ARC_TRACK = "rgba(255, 255, 255, 0.38)";
    const VOLUME_PANEL_DROP_SHADOW = "drop-shadow(0 2px 5px rgba(0, 0, 0, 0.06))";
    const USER_SETTINGS = {
      // Volume slider mode: 'saved', 'off', 'on', or 'replace-native'. Default: 'saved'
      volumeSliderMode: "saved",
      // Slider location: 'saved', 'controls', or 'video'. Default: 'saved'
      sliderLocation: "saved",
      // Replace-native placement: 'saved', 'native', or 'custom'. Default: 'saved'
      replaceNativePlacement: "saved",
      // Volume adjustment step: 'saved', 1, 2, 5, or 10. Default: 'saved'
      volumeStep: "saved",
      // Keep the volume pill expanded: 'saved', true, or false. Default: 'saved'
      alwaysExpanded: "saved",
      // On-video slider opacity when unfocused: 'saved' or 0-100 as a percentage. Default: 45
      overlayOpacityUnfocused: "saved",
      // On-video slider opacity when focused/hovered: 'saved' or 0-100 as a percentage. Default: 95
      overlayOpacityFocused: "saved",
      // On-video slider size: 'saved' or 100-200 as a percentage. Default: 100
      overlaySize: "saved",
      // Bar thickness: 'saved' or 25-125 as a percentage of the 2.5 bar. Default: 75
      sliderThickness: "saved",
      // Volume icon style: 'saved', 'new', or 'classic'. Default: 'saved'
      volumeAppearance: "saved",
      // Loudness normalization: 'saved', true, or false. Default: off
      normalizeVolume: "saved"
    };
    let cachedYtPlayer = null;
    const nativeVolumeOwners = /* @__PURE__ */ new WeakSet();
    const nativeMuteOwners = /* @__PURE__ */ new WeakSet();
    let navReattachTimer = 0;
    let navDebounceTimer = 0;
    let attachObserver = null;
    let attachObserverTarget = null;
    let attachBootstrapObserver = null;
    let playerControlsObserver = null;
    let playerControlsObserverTarget = null;
    let requestedVolumeIntent = null;
    const overlayLifecycle = createOverlayLifecycle();
    const { getVideoElement, resetVideoElement, ensurePlayerPositioning } = createVideoLocator(document, window);
    const { isNormalizationEnabled, setNormalizationEnabled, getVolumeSliderMode, getReplaceNativePlacement, isSliderOnVideo, setSliderLocation, setReplaceNativePlacement, getVolumeAppearance, setVolumeAppearance, updateOverlayAppearance, getVolumeStep, setVolumeStep, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled, getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent, getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent, getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent, beginThicknessSliderPreview, endThicknessSliderPreview, beginOpacitySliderPreview, endOpacitySliderPreview, updateSliderThickness, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode, isOverlayEnabled, isNativeVolumeReplacementEnabled, shouldUseNativeReplacementSlot } = createVolumeSettings({
      document,
      storage,
      userSettings: USER_SETTINGS,
      overlayId: OVERLAY_ID,
      keys: { normalization: "tm-yt-volume-slider-normalization", mode: VOLUME_MODE_KEY, location: SLIDER_LOCATION_KEY, replacePlacement: REPLACE_NATIVE_PLACEMENT_KEY, step: VOLUME_STEP_KEY, legacySnap: LEGACY_SNAP_TO_5_KEY, expanded: ALWAYS_EXPANDED_KEY, idleOpacity: OVERLAY_OPACITY_IDLE_KEY, activeOpacity: OVERLAY_OPACITY_ACTIVE_KEY, overlaySize: OVERLAY_SIZE_KEY, sliderThickness: SLIDER_THICKNESS_KEY, appearance: VOLUME_APPEARANCE_KEY },
      defaults: { idleOpacity: DEFAULT_OVERLAY_OPACITY_IDLE, activeOpacity: DEFAULT_OVERLAY_OPACITY_ACTIVE, overlaySize: DEFAULT_OVERLAY_SIZE, sliderThickness: DEFAULT_SLIDER_THICKNESS },
      onPlacementChanged: () => {
        attachSliderIfPossible();
        applyNativeVolumeVisibility();
      },
      onNormalizationChanged: () => syncNormalization(),
      onModeChanged: (mode) => {
        if (mode === "off") removeOverlay();
        else attachSliderIfPossible();
        applyNativeVolumeVisibility();
        injectVolumeOptionsButton();
        refreshOptionsPopupState();
        updateOptionsButtonState();
        syncNormalization();
      },
      clearExpandedHold: (overlay) => clearExpandedHold(overlay),
      setOverlayExpanded: (overlay, expanded, force, options) => setOverlayExpanded(overlay, expanded, force, options),
      collapseOverlayIfIdle: (overlay, force) => collapseOverlayIfIdle(overlay, force),
      ensureOverlay: () => {
        attachSliderIfPossible();
        return document.getElementById(OVERLAY_ID);
      }
    });
    const normalizer = createVolumeNormalizer({
      window,
      getVolume: getRawVolume,
      setVolume: setRawVolume,
      isMuted,
      onStatusChanged: () => {
        syncNormalizationStatus(getOptionsPopup());
        syncNormalizationIcon();
      }
    });
    function syncNormalization(video = overlayLifecycle.active?.root?._tmVolumeVideo || null, preferredVolume) {
      const enabled = isNormalizationEnabled() && isOverlayEnabled();
      normalizer.setEnabled(enabled);
      normalizer.bind(video, preferredVolume);
      refreshOptionsPopupState();
      syncNormalizationIcon();
    }
    function syncNormalizationIcon() {
      updateNormalizationIcon(document.getElementById(OVERLAY_ID), normalizer.getStatus());
    }
    const { getSavedVolume, readSteppedSliderValue, saveVolume, scheduleSaveVolume, cancelScheduledSaveVolume, flushScheduledSaveVolume } = createVolumePersistence({
      window,
      storage,
      storageKey: STORAGE_KEY,
      debounceMs: STORAGE_WRITE_DEBOUNCE_MS,
      getVolumeStep
    });
    function shouldHideNativeVolume() {
      return isYouTubeSupportedPage() && isOverlayEnabled() && isNativeVolumeReplacementEnabled();
    }
    function ensureNativeVolumeVisibilityGuard() {
      const style = createStyleElement(document, "tm-volume-native-visibility-style");
      if (style) {
        style.textContent = `
html.tm-yt-volume-native-replacement-active .ytp-volume-area {
  display: none !important;
}
            `;
      }
      document.documentElement.classList.toggle(
        "tm-yt-volume-native-replacement-active",
        shouldHideNativeVolume()
      );
    }
    function applyNativeVolumeVisibility() {
      ensureNativeVolumeVisibilityGuard();
      const shouldHideNative = shouldHideNativeVolume();
      if (shouldHideNative) {
        const overlay = document.getElementById(OVERLAY_ID);
        const player = getPlayerContainer();
        const controlsHost = getYouTubeControlsHost(player);
        if (overlay && player) {
          placeOverlay(overlay, player, controlsHost);
        }
      }
    }
    function getPlayerContainer(video = getVideoElement()) {
      const moviePlayer = document.getElementById("movie_player");
      if (moviePlayer) {
        return moviePlayer;
      }
      return video ? video.parentElement : null;
    }
    function getYouTubeControlsHost(player) {
      if (!player) return null;
      return player.querySelector(".ytp-left-controls") || document.querySelector(".ytp-left-controls");
    }
    function getNativeVolumeArea(controlsHost) {
      return controlsHost?.querySelector?.(".ytp-volume-area") || document.querySelector(".ytp-volume-area");
    }
    function positionOverlayAboveScrubber(overlay, player) {
      const progressBar = document.querySelector(".ytp-progress-bar-padding");
      const barEl = progressBar ? progressBar.closest(".ytp-progress-bar") || progressBar.parentElement : null;
      const ref = barEl || progressBar;
      if (!overlay || !player || !ref) {
        if (overlay) overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
        return;
      }
      const playerRect = player.getBoundingClientRect();
      const barRect = ref.getBoundingClientRect();
      const hasUsableBarRect = barRect.width > 0 && barRect.height > 0 && barRect.top >= playerRect.top && barRect.top < playerRect.bottom;
      if (!hasUsableBarRect) {
        overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
        return;
      }
      const bottomPx = playerRect.bottom - barRect.top + 8;
      const safeBottomPx = Math.min(Math.max(20, bottomPx), ON_VIDEO_MAX_CONTROLS_OFFSET_PX);
      overlay.style.bottom = `${safeBottomPx}px`;
    }
    function updateVideoOverlayPosition(overlay, player) {
      if (!overlay || !player || !isSliderOnVideo()) return;
      if (player.classList.contains("ytp-autohide")) {
        overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
        return;
      }
      positionOverlayAboveScrubber(overlay, player);
    }
    function placeOverlayInControls(overlay, controlsHost) {
      if (!overlay || !controlsHost) return;
      const nativeVolumeArea = getNativeVolumeArea(controlsHost);
      if (shouldUseNativeReplacementSlot() && nativeVolumeArea && nativeVolumeArea.parentElement === controlsHost) {
        if (overlay.parentElement !== controlsHost || overlay.nextElementSibling !== nativeVolumeArea) {
          controlsHost.insertBefore(overlay, nativeVolumeArea);
        }
      } else if (overlay.parentElement !== controlsHost || overlay.nextElementSibling) {
        controlsHost.appendChild(overlay);
      }
    }
    function placeOverlay(overlay, player, controlsHost) {
      if (!overlay || !player) return;
      if (isSliderOnVideo()) {
        ensurePlayerPositioning(player);
        if (overlay.parentElement !== player) {
          player.appendChild(overlay);
        }
        updateVideoOverlayPosition(overlay, player);
      } else if (controlsHost) {
        placeOverlayInControls(overlay, controlsHost);
        overlay.style.bottom = "";
      }
      const expanded = overlay.classList.contains("tm-expanded") || isAlwaysExpandedEnabled();
      setOverlayExpanded(overlay, expanded, true);
      updateOverlayOpacity(overlay);
    }
    function createStylesIfNeeded() {
      installVolumeSliderStyles({
        document,
        platform: "youtube",
        overlayId: OVERLAY_ID,
        valueLabelId: VALUE_LABEL_ID,
        panelDropShadow: VOLUME_PANEL_DROP_SHADOW
      });
    }
    const { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHold, scheduleExpandedHoldRelease, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg, populateSliderTicks } = createOverlayUi({
      document,
      window,
      isAlwaysExpandedEnabled,
      isSliderOnVideo,
      updateOverlayOpacity,
      finishExpandedHoldIfDue,
      getVolumeStep,
      accentLight: VOLUME_ACCENT_LIGHT,
      accentDark: VOLUME_ACCENT_DARK,
      accentMid: VOLUME_ACCENT_MID,
      arcTrack: VOLUME_ARC_TRACK,
      expandedHoldMs: VOLUME_CHANGE_EXPANDED_HOLD_MS
    });
    function areYouTubeControlsHidden() {
      const player = getPlayerContainer();
      return !!player?.classList?.contains("ytp-autohide") || !!player?.classList?.contains("ytp-hide-controls");
    }
    function finishExpandedHoldIfDue(overlay) {
      if (!overlay?.isConnected) {
        clearExpandedHold(overlay);
        return;
      }
      if (isAlwaysExpandedEnabled() || shouldKeepOverlayExpanded(overlay)) {
        return;
      }
      if (Date.now() < (overlay._expandedHoldUntil || 0)) {
        scheduleExpandedHoldRelease(overlay);
        return;
      }
      clearExpandedHold(overlay);
      if (areYouTubeControlsHidden()) {
        setOverlayExpanded(overlay, false);
        return;
      }
      collapseOverlayIfIdle(overlay, true);
    }
    function collapseOverlayIfIdle(overlay, force = false) {
      window.setTimeout(() => {
        if (isAlwaysExpandedEnabled()) {
          setOverlayExpanded(overlay, true);
          return;
        }
        if (overlay.dataset.tmKeepExpanded === "true" && !areYouTubeControlsHidden()) {
          return;
        }
        if (overlay.dataset.tmKeepExpanded === "true") {
          clearExpandedHold(overlay);
        }
        if (force || !shouldKeepOverlayExpanded(overlay)) {
          setOverlayExpanded(overlay, false);
        }
      }, 0);
    }
    function getYouTubePlayer() {
      if (cachedYtPlayer && cachedYtPlayer.isConnected && typeof cachedYtPlayer.getVolume === "function" && typeof cachedYtPlayer.setVolume === "function") {
        return cachedYtPlayer;
      }
      const player = document.getElementById("movie_player");
      if (player && typeof player.getVolume === "function" && typeof player.setVolume === "function") {
        cachedYtPlayer = player;
        return player;
      }
      cachedYtPlayer = null;
      return null;
    }
    function getVolume(video) {
      return isMuted(video) ? 0 : getUnderlyingVolume(video);
    }
    function getUnderlyingVolume(video) {
      return normalizer.getPreferredVolume(video, getRawVolume(video));
    }
    function getRawVolume(video) {
      if (!nativeVolumeOwners.has(video)) {
        try {
          const ytPlayer = getYouTubePlayer();
          if (ytPlayer) return Math.round(ytPlayer.getVolume());
        } catch {
        }
      }
      return Math.round((Number(video?.volume) || 0) * 100);
    }
    function isMuted(video) {
      if (!nativeMuteOwners.has(video)) {
        try {
          const ytPlayer = getYouTubePlayer();
          if (ytPlayer && typeof ytPlayer.isMuted === "function") return ytPlayer.isMuted();
        } catch {
        }
      }
      return !!video.muted;
    }
    function toggleMute(video) {
      setMuted(video, !isMuted(video));
    }
    function setMuted(video, muted) {
      try {
        const ytPlayer = getYouTubePlayer();
        const method = muted ? "mute" : "unMute";
        if (typeof ytPlayer?.[method] === "function") {
          ytPlayer[method]();
          nativeMuteOwners.delete(video);
          return;
        }
      } catch {
      }
      nativeMuteOwners.add(video);
      video.muted = !!muted;
    }
    function setVolume(video, value, options = {}) {
      normalizer.setPreferredVolume(video, value, options);
    }
    function setRawVolume(video, value, options = {}) {
      if (!options.preserveMute && isMuted(video)) setMuted(video, false);
      const ytPlayer = getYouTubePlayer();
      try {
        if (ytPlayer) {
          ytPlayer.setVolume(value);
          nativeVolumeOwners.delete(video);
          return;
        }
      } catch {
      }
      nativeVolumeOwners.add(video);
      video.volume = value / 100;
      if (!options.preserveMute) video.muted = false;
    }
    function restoreSavedVolume(video) {
      const wasMuted = isMuted(video);
      const value = getSavedVolume();
      if (value !== null) {
        setVolume(video, value);
      }
      try {
        const savedMute = localStorage.getItem(MUTE_STORAGE_KEY);
        if (savedMute === "true") {
          setMuted(video, true);
        } else if (savedMute === "false") {
          setMuted(video, false);
        } else if (wasMuted && !isMuted(video)) {
          setMuted(video, true);
        }
      } catch (e) {
      }
    }
    function saveMute(muted) {
      try {
        localStorage.setItem(MUTE_STORAGE_KEY, muted ? "true" : "false");
      } catch (e) {
      }
    }
    function setSliderFromPlayer(slider, label, video) {
      const muted = isMuted(video);
      const displayValue = muted ? getUnderlyingVolume(video) : getVolume(video);
      slider.value = String(displayValue);
      if (label) {
        label.textContent = muted ? "Muted" : `${displayValue}%`;
      }
      updateSliderBar(slider);
      updateVolumeIndicator(document.getElementById(OVERLAY_ID), displayValue, muted);
    }
    function ensureOptionsStyles() {
      installOptionsStyles({
        document,
        platform: "youtube",
        styleId: OPTIONS_STYLE_ID,
        optionsButtonId: OPTIONS_BUTTON_ID,
        optionsPopupId: OPTIONS_POPUP_ID,
        accentDark: VOLUME_ACCENT_DARK,
        accentDisabled: VOLUME_ACCENT_DISABLED,
        closeHideControlsClass: OPTIONS_CLOSE_HIDE_CONTROLS_CLASS
      });
    }
    function closeYouTubeSettingsPopupIfOpen() {
      const isOpen = Array.from(document.querySelectorAll(".ytp-settings-menu")).some((popup) => popup.style.display !== "none" && popup.offsetParent !== null);
      if (isOpen) {
        document.querySelector(".ytp-settings-button")?.click();
      }
    }
    function getVolumeModeLabel(mode = getVolumeSliderMode()) {
      if (mode === "off") return "Off";
      return mode === "replace-native" ? "Replace native" : "On";
    }
    function updateOptionsButtonState(btn = document.getElementById(OPTIONS_BUTTON_ID)) {
      if (!btn) return;
      const mode = getVolumeSliderMode();
      const label = `Volume Slider Options (${getVolumeModeLabel(mode)})`;
      btn.dataset.tmVolumeMode = mode;
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
    }
    function getRightControlsHost(player) {
      if (!player) return null;
      return player.querySelector(".ytp-right-controls-left") || player.querySelector(".ytp-right-controls");
    }
    function isOptionsButtonInPreferredSlot() {
      const player = getPlayerContainer();
      const host = getRightControlsHost(player);
      const settingsBtn = host?.querySelector?.(".ytp-settings-button");
      const btn = document.getElementById(OPTIONS_BUTTON_ID);
      return !!(host && settingsBtn && btn && btn.parentElement === host && btn.nextElementSibling === settingsBtn);
    }
    function injectVolumeOptionsButton() {
      ensureOptionsStyles();
      const player = getPlayerContainer();
      const host = getRightControlsHost(player);
      const settingsBtn = host?.querySelector?.(".ytp-settings-button");
      if (!host || !settingsBtn) return;
      let btn = document.getElementById(OPTIONS_BUTTON_ID);
      if (btn && btn.parentElement === host && btn.nextElementSibling === settingsBtn) {
        updateOptionsButtonState();
        return;
      }
      btn?.remove();
      btn = document.createElement("button");
      btn.id = OPTIONS_BUTTON_ID;
      btn.type = "button";
      btn.className = "ytp-button";
      btn.dataset.priority = "6";
      btn.setAttribute("aria-haspopup", "true");
      btn.setAttribute("aria-expanded", "false");
      btn.appendChild(createOptionsButtonIconSvg(document));
      updateOptionsButtonState(btn);
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleVolumeOptionsPopup();
      });
      host.insertBefore(btn, settingsBtn);
      ensurePlayerControlsObserver();
    }
    function removeVolumeOptionsButton() {
      document.getElementById(OPTIONS_BUTTON_ID)?.remove();
      closeVolumeOptionsPopup();
    }
    let optionsPopupOutsideHandler = null;
    let optionsPopupKeyboardCleanup = null;
    let optionsPopupRepositionHandler = null;
    let optionsCloseHideControlsHandler = null;
    let optionsPopupOpener = null;
    function getOptionsPopup() {
      return document.getElementById(OPTIONS_POPUP_ID);
    }
    function isOptionsPopupOpen() {
      const popup = getOptionsPopup();
      return !!popup && !popup.hasAttribute("hidden");
    }
    const { buildOptionsPopup, syncOptionsPopupState, syncNormalizationStatus, stopOptionsPreview } = createOptionsUi({
      document,
      optionsPopupId: OPTIONS_POPUP_ID,
      refreshOptionsPopupState,
      getVolumeSliderMode,
      setVolumeSliderMode,
      getReplaceNativePlacement,
      setReplaceNativePlacement,
      getVolumeAppearance,
      setVolumeAppearance,
      isNormalizationEnabled,
      setNormalizationEnabled,
      getNormalizationStatus: () => normalizer.getStatus(),
      getNormalizationDetails: () => normalizer.getDetails(),
      getVolumeStep,
      setVolumeStep,
      isAlwaysExpandedEnabled,
      setAlwaysExpandedEnabled,
      isSliderOnVideo,
      setSliderLocation,
      getSavedOverlayOpacityPercent,
      setSavedOverlayOpacityPercent,
      resetSavedOverlayOpacityPercent,
      getSavedOverlaySizePercent,
      setSavedOverlaySizePercent,
      resetSavedOverlaySizePercent,
      getSavedSliderThicknessPercent,
      setSavedSliderThicknessPercent,
      resetSavedSliderThicknessPercent,
      beginThicknessSliderPreview,
      endThicknessSliderPreview,
      beginOpacitySliderPreview,
      endOpacitySliderPreview
    });
    function refreshOptionsPopupState() {
      syncOptionsPopupState(getOptionsPopup());
    }
    function ensureOptionsPopup() {
      const player = getPlayerContainer();
      if (!player) return null;
      let popup = getOptionsPopup();
      if (!popup || !popup.isConnected) {
        closeVolumeOptionsPopup();
        popup?.remove();
        popup = buildOptionsPopup();
        ensurePlayerPositioning(player);
        player.appendChild(popup);
      }
      return popup;
    }
    function positionOptionsPopup(popup, resetScroll = false) {
      const btn = document.getElementById(OPTIONS_BUTTON_ID);
      const player = getPlayerContainer();
      if (!btn || !player || !popup) return;
      const playerRect = player.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const barRect = Array.from(player.querySelectorAll(".ytp-progress-bar-padding")).map((bar) => (bar.closest(".ytp-progress-bar") || bar.parentElement)?.getBoundingClientRect()).find((rect) => rect && rect.width > 0 && rect.height > 0);
      const bottomPx = barRect ? playerRect.bottom - barRect.top + 8 : playerRect.bottom - btnRect.top + 8;
      popup.style.right = `${Math.max(8, playerRect.right - btnRect.right)}px`;
      popup.style.bottom = `${Math.max(8, bottomPx)}px`;
      popup.style.left = "auto";
      popup.style.top = "auto";
      const margin = 8;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const playerHeight = playerRect.height - Math.max(margin, bottomPx) - margin;
      popup.style.maxHeight = `${Math.floor(Math.max(120, Math.min(playerHeight, viewportHeight - margin * 2)))}px`;
      const body = popup.querySelector(".tm-volume-options-body");
      if (!body) return;
      if (resetScroll) body.scrollTop = 0;
      else body.scrollTop = Math.min(body.scrollTop, Math.max(0, body.scrollHeight - body.clientHeight));
    }
    function keepYouTubeControlsVisible() {
      const player = getPlayerContainer();
      if (!player) return;
      clearOptionsCloseControlsHide();
      player.classList.add("tm-volume-options-controls-hold");
      if (typeof player.showControls === "function") {
        try {
          player.showControls();
        } catch (e) {
        }
      }
      player.classList.remove("ytp-autohide", "ytp-hide-controls");
    }
    function releaseYouTubeControlsVisibility() {
      getPlayerContainer()?.classList?.remove("tm-volume-options-controls-hold");
    }
    function clearOptionsCloseControlsHide() {
      getPlayerContainer()?.classList?.remove(OPTIONS_CLOSE_HIDE_CONTROLS_CLASS);
      if (!optionsCloseHideControlsHandler) return;
      document.removeEventListener("pointermove", optionsCloseHideControlsHandler, true);
      document.removeEventListener("pointerdown", optionsCloseHideControlsHandler, true);
      optionsCloseHideControlsHandler = null;
    }
    function hideControlsUntilPlayerPointerReturn() {
      const player = getPlayerContainer();
      if (!player) return;
      clearOptionsCloseControlsHide();
      player.classList.add(OPTIONS_CLOSE_HIDE_CONTROLS_CLASS);
      optionsCloseHideControlsHandler = (event) => {
        if (getPlayerContainer()?.contains?.(event.target)) {
          clearOptionsCloseControlsHide();
        }
      };
      document.addEventListener("pointermove", optionsCloseHideControlsHandler, true);
      document.addEventListener("pointerdown", optionsCloseHideControlsHandler, true);
    }
    function isYouTubeVideoSurfaceClick(event) {
      const target = event.target;
      const player = getPlayerContainer();
      if (!target || !player?.contains?.(target)) return false;
      return !target.closest?.(
        '.ytp-chrome-bottom, .ytp-chrome-top, button, a, input, select, textarea, [role="button"], [role="slider"], [role="menuitem"]'
      );
    }
    function startOptionsControlsHold() {
      keepYouTubeControlsVisible();
      ensurePlayerControlsObserver();
    }
    function stopOptionsControlsHold() {
      releaseYouTubeControlsVisibility();
    }
    function openVolumeOptionsPopup() {
      ensureOptionsStyles();
      const popup = ensureOptionsPopup();
      if (!popup) return;
      closeYouTubeSettingsPopupIfOpen();
      optionsPopupOpener = document.activeElement;
      refreshOptionsPopupState();
      popup.removeAttribute("hidden");
      positionOptionsPopup(popup, true);
      getPlayerContainer()?.classList?.add("tm-volume-options-open");
      startOptionsControlsHold();
      document.getElementById(OPTIONS_BUTTON_ID)?.setAttribute("aria-expanded", "true");
      popup.focus({ preventScroll: true });
      if (!optionsPopupOutsideHandler) {
        optionsPopupOutsideHandler = (event) => {
          const btn = document.getElementById(OPTIONS_BUTTON_ID);
          if (popup.contains(event.target) || btn?.contains(event.target)) return;
          if (event.target?.closest?.(".ytp-settings-button")) {
            window.setTimeout(() => closeVolumeOptionsPopup(), 0);
            return;
          }
          const clickedOutsidePlayer = !getPlayerContainer()?.contains?.(event.target);
          const clickedVideoSurface = isYouTubeVideoSurfaceClick(event);
          closeVolumeOptionsPopup();
          if (clickedOutsidePlayer) hideControlsUntilPlayerPointerReturn();
          if (clickedVideoSurface) {
            event.preventDefault();
            event.stopPropagation();
          }
        };
        document.addEventListener("click", optionsPopupOutsideHandler, true);
      }
      if (!optionsPopupKeyboardCleanup) {
        optionsPopupKeyboardCleanup = bindOptionsPopupKeyboard({ document, popup, closePopup: closeVolumeOptionsPopup });
      }
      if (!optionsPopupRepositionHandler) {
        optionsPopupRepositionHandler = () => positionOptionsPopup(popup);
        window.addEventListener("resize", optionsPopupRepositionHandler, true);
        window.visualViewport?.addEventListener("resize", optionsPopupRepositionHandler, true);
        window.visualViewport?.addEventListener("scroll", optionsPopupRepositionHandler, true);
      }
    }
    function closeVolumeOptionsPopup(restoreFocus = false) {
      stopOptionsPreview();
      const popup = getOptionsPopup();
      if (popup) {
        if (popup.contains(document.activeElement)) document.activeElement.blur();
        popup.setAttribute("hidden", "");
      }
      getPlayerContainer()?.classList?.remove("tm-volume-options-open");
      stopOptionsControlsHold();
      document.getElementById(OPTIONS_BUTTON_ID)?.setAttribute("aria-expanded", "false");
      if (optionsPopupOutsideHandler) {
        document.removeEventListener("click", optionsPopupOutsideHandler, true);
        optionsPopupOutsideHandler = null;
      }
      optionsPopupKeyboardCleanup?.();
      optionsPopupKeyboardCleanup = null;
      if (optionsPopupRepositionHandler) {
        window.removeEventListener("resize", optionsPopupRepositionHandler, true);
        window.visualViewport?.removeEventListener("resize", optionsPopupRepositionHandler, true);
        window.visualViewport?.removeEventListener("scroll", optionsPopupRepositionHandler, true);
        optionsPopupRepositionHandler = null;
      }
      if (restoreFocus) {
        const fallback = document.getElementById(OPTIONS_BUTTON_ID);
        (optionsPopupOpener?.isConnected ? optionsPopupOpener : fallback)?.focus();
      }
      optionsPopupOpener = null;
    }
    function disconnectPlayerControlsObserver() {
      playerControlsObserver?.disconnect();
      playerControlsObserver = null;
      playerControlsObserverTarget = null;
    }
    function onPlayerControlsMutation() {
      if (isOptionsPopupOpen() && areYouTubeControlsHidden()) {
        keepYouTubeControlsVisible();
      }
      const overlay = document.getElementById(OVERLAY_ID);
      if (overlay?.dataset?.tmKeepExpanded === "true" && areYouTubeControlsHidden()) {
        clearExpandedHold(overlay);
        setOverlayExpanded(overlay, false);
      }
    }
    function ensurePlayerControlsObserver() {
      const player = getPlayerContainer();
      if (!player) return;
      if (playerControlsObserverTarget === player) return;
      disconnectPlayerControlsObserver();
      playerControlsObserverTarget = player;
      playerControlsObserver = new MutationObserver(onPlayerControlsMutation);
      playerControlsObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
    }
    function toggleVolumeOptionsPopup() {
      if (isOptionsPopupOpen()) {
        closeVolumeOptionsPopup();
      } else {
        openVolumeOptionsPopup();
      }
    }
    function createOverlay(video, player, controlsHost) {
      const existing = document.getElementById(OVERLAY_ID);
      if (existing) {
        return existing;
      }
      createStylesIfNeeded();
      const overlay = createVolumeOverlay({ document, overlayId: OVERLAY_ID });
      const cleanupRegistry = createCleanupRegistry();
      const keyboardFeedback = createVolumeFeedback({ window, player });
      cleanupRegistry.add(() => keyboardFeedback.dispose());
      let hasPointerIntent = false;
      const markPointerIntent = () => {
        hasPointerIntent = true;
        window.removeEventListener("pointermove", markPointerIntent, true);
      };
      cleanupRegistry.listen(window, "pointermove", markPointerIntent, true);
      overlay.addEventListener("mouseenter", () => {
        if (!hasPointerIntent) return;
        overlay.dataset.tmHovering = "true";
        setOverlayExpanded(overlay, true);
        updateOverlayOpacity(overlay);
      });
      overlay.addEventListener("mouseleave", () => {
        overlay.dataset.tmHovering = "false";
        overlay.dataset.tmDragging = "false";
        updateOverlayOpacity(overlay);
        collapseOverlayIfIdle(overlay, true);
      });
      overlay.addEventListener("focusin", () => {
        setOverlayExpanded(overlay, true);
        updateOverlayOpacity(overlay);
      });
      overlay.addEventListener("focusout", () => {
        updateOverlayOpacity(overlay);
        collapseOverlayIfIdle(overlay);
      });
      const collapseHeldSliderOnVideoClick = (event) => {
        if (overlay.dataset.tmKeepExpanded !== "true" || !isYouTubeVideoSurfaceClick(event)) return;
        clearExpandedHold(overlay);
        setOverlayExpanded(overlay, false);
      };
      cleanupRegistry.listen(document, "click", collapseHeldSliderOnVideoClick, true);
      const { iconCell, label, tickOverlay, slider } = createVolumeControlElements({
        document,
        overlay,
        sliderId: SLIDER_ID,
        valueLabelId: VALUE_LABEL_ID,
        makeVolumeIndicatorSvg,
        populateSliderTicks,
        getVolumeStep
      });
      cleanupRegistry.add(() => tickOverlay._tmSliderTicksCleanup?.());
      iconCell.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      iconCell.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleMute(video);
        saveMute(isMuted(video));
        setSliderFromPlayer(slider, label, video);
        markVolumeChangedWhileExpanded(overlay);
      });
      const syncInitialSliderState = (value, muted = false) => {
        syncVolumeControl({ slider, label, overlay, value, muted, updateSliderBar, updateVolumeIndicator });
      };
      const initVol = getSavedVolume();
      if (initVol !== null) {
        syncInitialSliderState(initVol, isMuted(video));
      } else {
        syncInitialSliderState(getVolume(video), isMuted(video));
      }
      const applySliderValue = (value, { markInteraction = true } = {}) => {
        requestedVolumeIntent = { value, until: Date.now() + USER_VOLUME_INTENT_GRACE_MS, overlay };
        setVolume(video, value);
        saveMute(false);
        label.textContent = `${value}%`;
        updateSliderBar(slider);
        updateVolumeIndicator(overlay, value, isMuted(video));
        scheduleSaveVolume(value);
        if (markInteraction) markVolumeChangedWhileExpanded(overlay);
      };
      cleanupRegistry.add(bindWheelVolumeStep({
        target: iconCell,
        slider,
        getVolumeStep,
        applyValue: applySliderValue
      }));
      const rangePointer = bindRangePointerInteraction({
        window,
        slider,
        overlay,
        getVolumeStep,
        readSteppedValue: readSteppedSliderValue,
        snapValue: (value) => snapToStep(value, getVolumeStep()),
        applyValue: applySliderValue,
        setExpanded: () => setOverlayExpanded(overlay, true),
        updateOpacity: () => updateOverlayOpacity(overlay),
        collapseIfIdle: (force) => collapseOverlayIfIdle(overlay, force)
      });
      cleanupRegistry.add(() => rangePointer.dispose());
      slider.addEventListener("input", () => {
        applySliderValue(rangePointer.readPressAwareValue());
      });
      slider.addEventListener("change", () => {
        applySliderValue(readSteppedSliderValue(slider));
        cancelScheduledSaveVolume();
        saveVolume(Number(slider.value) || 0);
      });
      const applyKeyboardVolumeStep = (event, { markInteraction = true } = {}) => {
        const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        if (requestedVolumeIntent?.overlay === overlay) requestedVolumeIntent = null;
        const currentValue = Number(slider.value) || 0;
        const nextValue = clampVolume(currentValue + direction * KEYBOARD_VOLUME_STEP);
        if (nextValue === currentValue) return;
        slider.value = String(nextValue);
        applySliderValue(nextValue, { markInteraction });
      };
      slider.addEventListener("keydown", applyKeyboardVolumeStep);
      const applyPlayerKeyboardVolumeStep = (event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (isOptionsPopupOpen()) return;
        if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (!player.contains(event.target) && !player.contains(document.activeElement)) return;
        slider.value = String(getUnderlyingVolume(video));
        applyKeyboardVolumeStep(event, { markInteraction: false });
        keyboardFeedback.show(Number(slider.value), isMuted(video));
      };
      document.addEventListener("keydown", applyPlayerKeyboardVolumeStep, true);
      cleanupRegistry.add(() => document.removeEventListener("keydown", applyPlayerKeyboardVolumeStep, true));
      const onVideoVolumeChange = () => {
        if (!document.getElementById(OVERLAY_ID)) return;
        const muted = isMuted(video);
        saveMute(muted);
        const playerVolume = getVolume(video);
        const intent = requestedVolumeIntent;
        if (intent?.overlay === overlay) {
          if (Math.abs(playerVolume - intent.value) <= USER_VOLUME_TOLERANCE) {
            requestedVolumeIntent = null;
          } else if (Date.now() <= intent.until && !muted) {
            return;
          } else {
            requestedVolumeIntent = null;
          }
        }
        setSliderFromPlayer(slider, label, video);
        if (!muted) scheduleSaveVolume(playerVolume);
      };
      video.addEventListener("volumechange", onVideoVolumeChange);
      cleanupRegistry.add(bindNativeVolumeInput({ window, video, player, selector: ".ytp-volume-area", normalizer, onChange: onVideoVolumeChange }));
      updateOverlayAppearance(overlay);
      if (isAlwaysExpandedEnabled()) {
        setOverlayExpanded(overlay, true, true);
      }
      placeOverlay(overlay, player, controlsHost);
      if (initVol === null) setSliderFromPlayer(slider, label, video);
      else syncInitialSliderState(initVol, isMuted(video));
      setOverlayExpanded(overlay, false, true);
      updateSliderThickness(overlay);
      updateVideoOverlayPosition(overlay, player);
      const onLayoutChange = () => {
        if (!overlay.isConnected || isOverlayInteractionFocused(overlay)) return;
        placeOverlay(overlay, player, controlsHost);
      };
      window.addEventListener("resize", onLayoutChange);
      const controlsObserver = new MutationObserver(onLayoutChange);
      controlsObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
      const cleanup = () => {
        if (requestedVolumeIntent?.overlay === overlay) requestedVolumeIntent = null;
        video.removeEventListener("volumechange", onVideoVolumeChange);
        window.removeEventListener("resize", onLayoutChange);
        controlsObserver.disconnect();
        cleanupRegistry.dispose();
        clearExpandedHold(overlay);
      };
      overlayLifecycle.set(overlay, cleanup);
      return overlay;
    }
    function disposeActiveOverlay() {
      normalizer.bind(null);
      flushScheduledSaveVolume();
      stopOptionsPreview();
      requestedVolumeIntent = null;
      overlayLifecycle.dispose();
    }
    function removeOverlay() {
      cancelScheduledSaveVolume();
      disposeActiveOverlay();
      document.getElementById(OVERLAY_ID)?.remove();
      applyNativeVolumeVisibility();
    }
    function attachSliderIfPossible() {
      if (!isYouTubeSupportedPage()) {
        removeOverlay();
        removeVolumeOptionsButton();
        disconnectPlayerControlsObserver();
        disconnectAttachObserver();
        return false;
      }
      const video = getVideoElement();
      const player = getPlayerContainer(video);
      const controlsHost = getYouTubeControlsHost(player);
      if (!player) {
        return false;
      }
      if (!isOverlayEnabled()) {
        removeOverlay();
        applyNativeVolumeVisibility();
        injectVolumeOptionsButton();
        return !!document.getElementById(OPTIONS_BUTTON_ID);
      }
      if (!video) {
        injectVolumeOptionsButton();
        return false;
      }
      if (overlayLifecycle.active && !overlayLifecycle.active.root.isConnected) disposeActiveOverlay();
      let existingOverlay = document.getElementById(OVERLAY_ID);
      if (existingOverlay && existingOverlay._tmVolumeVideo !== video) {
        disposeActiveOverlay();
        existingOverlay.remove();
        existingOverlay = null;
      }
      if (!existingOverlay && isNormalizationEnabled() && !normalizer.isBoundTo(video)) {
        syncNormalization(video, getSavedVolume() ?? getRawVolume(video));
        restoreSavedVolume(video);
      }
      if (!controlsHost && !isSliderOnVideo()) {
        injectVolumeOptionsButton();
        return false;
      }
      if (existingOverlay) {
        placeOverlay(existingOverlay, player, controlsHost);
      } else {
        restoreSavedVolume(video);
        const overlay = createOverlay(video, player, controlsHost);
        overlay._tmVolumeVideo = video;
      }
      applyNativeVolumeVisibility();
      injectVolumeOptionsButton();
      ensurePlayerControlsObserver();
      ensureAttachObserver();
      syncNormalization();
      return true;
    }
    function getAttachObserverRoot() {
      if (!isYouTubeSupportedPage()) return null;
      return document.getElementById("movie_player") || document.querySelector(".html5-video-player") || document.getElementById("primary");
    }
    function mutationAddsVideo(mutations) {
      return mutations.some((mutation) => [...mutation.addedNodes].some(
        (node) => node.nodeName === "VIDEO" || !!node.querySelector?.("video")
      ));
    }
    let lastAttach = 0;
    const ATTACH_COOLDOWN_MS = 1e3;
    let attachQueued = false;
    let trailingAttachTimer = 0;
    function isYouTubeSupportedPage() {
      return document.location.pathname === "/watch";
    }
    function handleAttachObserverMutations(mutations) {
      if (!isYouTubeSupportedPage()) return;
      const hasAddedNodes = mutations.some((m) => m.addedNodes && m.addedNodes.length > 0);
      const hasRemovedNodes = mutations.some((m) => m.removedNodes && m.removedNodes.length > 0);
      if (!hasAddedNodes && !hasRemovedNodes) return;
      const videoAdded = isOverlayEnabled() && mutationAddsVideo(mutations);
      if (videoAdded && isNormalizationEnabled()) {
        resetVideoElement();
        const video = getVideoElement();
        if (video && !normalizer.isBoundTo(video) && attachSliderIfPossible()) {
          lastAttach = Date.now();
          return;
        }
      }
      if (attachQueued) return;
      applyNativeVolumeVisibility();
      const overlay = document.getElementById(OVERLAY_ID);
      const button = document.getElementById(OPTIONS_BUTTON_ID);
      const overlayMissing = isOverlayEnabled() && (!overlay || !overlay.isConnected);
      const buttonMissing = !button || !button.isConnected;
      const buttonMisplaced = !buttonMissing && !isOptionsButtonInPreferredSlot();
      if (buttonMissing || buttonMisplaced) {
        injectVolumeOptionsButton();
      }
      const videoMayHaveChanged = !!overlay && videoAdded;
      if (!overlayMissing && !videoMayHaveChanged) return;
      attachQueued = true;
      requestAnimationFrame(() => {
        attachQueued = false;
        if (videoMayHaveChanged) resetVideoElement();
        const now = Date.now();
        if (now - lastAttach < ATTACH_COOLDOWN_MS) {
          clearTimeout(trailingAttachTimer);
          trailingAttachTimer = window.setTimeout(() => {
            trailingAttachTimer = 0;
            resetVideoElement();
            if (isYouTubeSupportedPage() && attachSliderIfPossible()) lastAttach = Date.now();
          }, ATTACH_COOLDOWN_MS - (now - lastAttach));
          return;
        }
        if (!isYouTubeSupportedPage()) return;
        if (attachSliderIfPossible()) {
          lastAttach = now;
        }
      });
    }
    function disconnectAttachObserver() {
      if (trailingAttachTimer) {
        window.clearTimeout(trailingAttachTimer);
        trailingAttachTimer = 0;
      }
      attachObserver?.disconnect();
      attachObserver = null;
      attachObserverTarget = null;
      attachBootstrapObserver?.disconnect();
      attachBootstrapObserver = null;
    }
    function ensureAttachObserver() {
      if (!window.MutationObserver) return;
      const root = getAttachObserverRoot();
      if (!root) return;
      attachBootstrapObserver?.disconnect();
      attachBootstrapObserver = null;
      if (attachObserverTarget === root) return;
      attachObserver?.disconnect();
      attachObserverTarget = root;
      attachObserver = new MutationObserver(handleAttachObserverMutations);
      attachObserver.observe(root, { childList: true, subtree: true });
      injectVolumeOptionsButton();
    }
    function setupAttachObserver() {
      if (!window.MutationObserver) return;
      ensureAttachObserver();
      if (attachObserverTarget || attachBootstrapObserver) return;
      const bootstrapRoot = document.body || document.documentElement;
      if (!bootstrapRoot) return;
      attachBootstrapObserver = new MutationObserver(() => {
        if (!getAttachObserverRoot()) return;
        ensureAttachObserver();
        attachSliderIfPossible();
      });
      attachBootstrapObserver.observe(bootstrapRoot, { childList: true, subtree: true });
    }
    function setupInitialAttempts() {
      const attemptAttach = (attempt) => {
        if (attachSliderIfPossible() || attempt >= INITIAL_ATTACH_MAX_ATTEMPTS) return;
        window.setTimeout(() => attemptAttach(attempt + 1), INITIAL_ATTACH_RETRY_MS);
      };
      attemptAttach(0);
    }
    function setupYtNavigationHandler() {
      if (window.__tmYtVolumeNavBound) return;
      window.__tmYtVolumeNavBound = true;
      const protectIncomingPlayback = (event) => {
        const video = event.target;
        if (!(video instanceof window.HTMLVideoElement) || !video.matches("#movie_player video.html5-main-video")) return;
        if (!isYouTubeSupportedPage() || !isOverlayEnabled() || !isNormalizationEnabled() || normalizer.isBoundTo(video)) return;
        resetVideoElement();
        cachedYtPlayer = null;
        attachSliderIfPossible();
        if (normalizer.isBoundTo(video)) normalizer.setSourceChanging(false);
      };
      for (const type of ["loadstart", "play"]) window.addEventListener(type, protectIncomingPlayback, true);
      const cancelPendingReattach = () => {
        if (navDebounceTimer) {
          clearTimeout(navDebounceTimer);
          navDebounceTimer = 0;
        }
        if (navReattachTimer) {
          clearTimeout(navReattachTimer);
          navReattachTimer = 0;
        }
      };
      const runReattach = () => {
        cancelPendingReattach();
        resetVideoElement();
        cachedYtPlayer = null;
        closeVolumeOptionsPopup();
        clearOptionsCloseControlsHide();
        disconnectPlayerControlsObserver();
        disconnectAttachObserver();
        navReattachTimer = window.setTimeout(() => {
          navReattachTimer = 0;
          removeOverlay();
          removeVolumeOptionsButton();
          if (attachSliderIfPossible()) normalizer.setSourceChanging(false);
        }, NAV_REATTACH_DELAY_MS);
      };
      const scheduleReattach = () => {
        cancelPendingReattach();
        navDebounceTimer = window.setTimeout(() => {
          navDebounceTimer = 0;
          runReattach();
        }, NAV_DEBOUNCE_MS);
      };
      const handleNavigationStart = () => {
        normalizer.setSourceChanging(true);
        if (isOverlayEnabled() && isNativeVolumeReplacementEnabled()) {
          document.documentElement.classList.add("tm-yt-volume-native-replacement-active");
        }
      };
      const handleNavigationComplete = () => {
        resetVideoElement();
        cachedYtPlayer = null;
        applyNativeVolumeVisibility();
        const attached = attachSliderIfPossible();
        if (attached || !isYouTubeSupportedPage()) {
          normalizer.setSourceChanging(false);
          cancelPendingReattach();
          return;
        }
        scheduleReattach();
      };
      window.addEventListener("yt-navigate-start", handleNavigationStart, true);
      window.addEventListener("yt-navigate-finish", handleNavigationComplete, true);
      window.addEventListener("yt-page-data-updated", handleNavigationComplete, true);
      window.addEventListener("popstate", handleNavigationComplete, true);
    }
    function init() {
      applyNativeVolumeVisibility();
      setupInitialAttempts();
      setupAttachObserver();
      setupYtNavigationHandler();
    }
    init();
  }

  // src/entries/youtube.user.js
  startYouTubeVolumeSlider();
})();
