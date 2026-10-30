// ==UserScript==
// @name         Twitch Volume Slider
// @namespace    https://github.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders
// @version      3.0.2
// @description  Compact Twitch volume controls with optional automatic volume normalization.
// @author       Gimbuhh (Made using AI)
// @icon         https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png
// @match        https://www.twitch.tv/*
// @match        https://*.ext-twitch.tv/*
// @updateURL    https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/twitch-volume-slider.user.js
// @downloadURL  https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/twitch-volume-slider.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==
"use strict";

(() => {
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

  // src/shared/player-tooltips.js
  var selector = "[data-tm-tooltip]";
  var tooltipId = "tm-volume-player-tooltip";
  var css = `
.tm-player-tooltip {
  box-sizing:border-box; position:absolute; z-index:10002; width:max-content;
  max-width:320px; padding:5px 9px; border:0; border-radius:8px;
  background:rgba(0,0,0,.3); color:#eee; backdrop-filter:blur(12px);
  font:500 13px/15px "YouTube Noto",Roboto,Arial,Helvetica,sans-serif;
  letter-spacing:normal; text-align:left; text-shadow:none; text-transform:none;
  white-space:normal; overflow-wrap:anywhere; pointer-events:none;
  animation:none; transition:none;
}
.tm-player-tooltip[data-platform="twitch"] {
  position:fixed;
  padding:4px 8px; border-radius:4px; backdrop-filter:none;
  background:var(--color-background-tooltip,#fff); color:var(--color-text-tooltip,#0e0e10);
  font:600 14px/1.4 var(--font-base,Inter,Roobert,"Helvetica Neue",Helvetica,Arial,sans-serif);
  animation:tm-tooltip-pop-in 100ms ease backwards;
  transform-origin:center;
}
@keyframes tm-tooltip-pop-in {
  from { opacity:0; transform:scale(.9); }
  to { opacity:1; transform:scale(1); }
}
@media (prefers-reduced-motion:reduce) {
  .tm-player-tooltip[data-platform="twitch"] { animation:none; }
}
.tm-player-tooltip[data-platform="twitch"]::after {
  content:""; position:absolute; top:100%; left:var(--tm-tooltip-arrow-x,50%);
  transform:translateX(-50%); border:5px solid transparent; border-bottom:0;
  border-top-color:var(--color-background-tooltip,#fff);
}
.tm-player-tooltip[data-platform="twitch"][data-placement="bottom"]::after {
  top:auto; bottom:100%; border-top:0; border-bottom:5px solid var(--color-background-tooltip,#fff);
}
/* YouTube keeps its previous tooltip fading after entering a custom control.
   Keep one label visible and make control-button handoffs immediate. Seek
   previews retain their own transitions. Display remains owned by YouTube. */
#movie_player:has(.tm-player-tooltip[data-platform="youtube"]) .ytp-tooltip {
  visibility:hidden !important;
}
#movie_player:has(.ytp-chrome-bottom button:hover:not([data-tm-tooltip])) .ytp-tooltip.ytp-bottom:not(.ytp-preview):not(.ytp-tooltip-progress-bar-style) {
  opacity:1 !important; transition:none !important;
}`;
  function installPlayerTooltips(window2, platform) {
    const { document: document2 } = window2;
    let target = null, tooltip = null, observer = null, showTimer = null;
    const rootSelector = platform === "youtube" ? "#movie_player" : '.video-player,[data-a-target="player-overlay-click-handler"]';
    function getVisiblePlayer(element) {
      if (!element?.isConnected || element.hidden || !element.dataset.tmTooltip) {
        return null;
      }
      const root = element.closest(rootSelector);
      if (!root) {
        return null;
      }
      if (platform === "youtube") {
        if (element.getAttribute("aria-expanded") === "true" || document2.getElementById("tm-volume-options-popup")?.hasAttribute("hidden") === false) {
          return null;
        }
        if (root.classList.contains("ytp-settings-shown")) {
          return null;
        }
        for (const menu of root.querySelectorAll(".ytp-popup:not(button)")) {
          if (menu.getClientRects().length && window2.getComputedStyle(menu).visibility !== "hidden") {
            return null;
          }
        }
      } else if (element.closest('[data-a-target="player-controls"]')?.getAttribute("data-a-visible") === "false") {
        return null;
      }
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = window2.getComputedStyle(ancestor);
        if (ancestor.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return null;
        }
        if (ancestor === root && platform === "youtube") {
          break;
        }
      }
      return root;
    }
    function hide() {
      window2.clearTimeout(showTimer);
      observer?.disconnect();
      observer = null;
      tooltip?.remove();
      tooltip = null;
      target = null;
    }
    function show() {
      const root = getVisiblePlayer(target);
      if (!root) {
        hide();
        return;
      }
      const style = createStyleElement(document2, "tm-volume-player-tooltip-style");
      if (style) {
        style.textContent = css;
      }
      tooltip = document2.createElement("div");
      tooltip.id = tooltipId;
      tooltip.className = "tm-player-tooltip";
      tooltip.dataset.platform = platform;
      tooltip.setAttribute("role", "tooltip");
      tooltip.textContent = target.dataset.tmTooltip;
      const nativeText = platform === "youtube" && root.querySelector(".ytp-tooltip .ytp-tooltip-bottom-text");
      if (nativeText) {
        const native = window2.getComputedStyle(nativeText);
        for (const property of ["font", "color", "backgroundColor", "borderRadius", "padding", "backdropFilter", "boxShadow"]) {
          tooltip.style[property] = native[property];
        }
      }
      const fixed = platform === "twitch";
      const host = fixed ? document2.fullscreenElement || document2.body : root;
      host.appendChild(tooltip);
      const box = root.getBoundingClientRect(), anchor = target.getBoundingClientRect();
      const sx = fixed ? 1 : box.width / root.offsetWidth || 1, sy = fixed ? 1 : box.height / root.offsetHeight || 1;
      const originX = fixed ? 0 : box.left + root.clientLeft * sx, originY = fixed ? 0 : box.top + root.clientTop * sy;
      const leftEdge = Math.max(fixed ? box.left + 8 : 8, (8 - originX) / sx);
      const rightEdge = Math.min(fixed ? box.right - 8 : root.clientWidth - 8, (window2.innerWidth - 8 - originX) / sx);
      tooltip.style.maxWidth = `${Math.max(0, Math.min(320, rightEdge - leftEdge))}px`;
      const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
      const center = ((anchor.left + anchor.right) / 2 - originX) / sx;
      const desiredLeft = platform === "twitch" ? (anchor.right - originX) / sx - width : center - width / 2;
      const left = Math.max(leftEdge, Math.min(desiredLeft, rightEdge - width));
      const controls = platform === "youtube" && target.closest(".ytp-chrome-bottom");
      const anchorTop = controls ? controls.getBoundingClientRect().top : anchor.top;
      const above = Math.floor((anchorTop - originY) / sy - height - 10);
      const below = above < (fixed ? Math.max(0, box.top) : Math.max(0, -originY / sy));
      tooltip.dataset.placement = below ? "bottom" : "top";
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${below ? (anchor.bottom - originY) / sy + 10 : above}px`;
      tooltip.style.setProperty("--tm-tooltip-arrow-x", `${Math.max(8, Math.min(width - 8, center - left))}px`);
      observer = new window2.MutationObserver(() => {
        if (!getVisiblePlayer(target) || tooltip.textContent !== target.dataset.tmTooltip) {
          hide();
        }
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "aria-expanded", "data-tm-tooltip", "data-a-visible", "class", "style"]
      });
      if (fixed) {
        for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
          observer.observe(ancestor, { childList: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
        }
      }
    }
    function enter(element, delay) {
      if (element === target) {
        return;
      }
      hide();
      if (!getVisiblePlayer(element)) {
        return;
      }
      target = element;
      if (delay) {
        showTimer = window2.setTimeout(show, delay);
      } else {
        show();
      }
    }
    document2.addEventListener("pointerover", (event) => {
      if (event.pointerType === "touch") {
        return;
      }
      const element = event.target.closest?.(selector);
      if (element) {
        enter(element, platform === "youtube" ? 0 : 200);
      } else if (target && !target.contains(event.target)) {
        hide();
      }
    }, true);
    document2.addEventListener("pointerout", (event) => {
      if (!target?.contains(event.target) || target.contains(event.relatedTarget)) {
        return;
      }
      hide();
    }, true);
    document2.addEventListener("focusin", (event) => {
      const element = event.target.closest?.(selector);
      if (element?.matches(":focus-visible")) {
        enter(element, 0);
      }
    }, true);
    document2.addEventListener("focusout", (event) => {
      if (target?.contains(event.target)) {
        hide();
      }
    }, true);
    for (const type of ["pointerdown", "click"]) {
      document2.addEventListener(type, hide, true);
    }
    document2.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hide();
      }
    }, true);
    window2.addEventListener("scroll", (event) => {
      if (event.target === document2 || event.target === window2 || event.target.contains?.(target)) {
        hide();
      }
    }, true);
    window2.addEventListener("resize", hide);
    document2.addEventListener("fullscreenchange", hide);
  }

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
    let trackingAttack = false;
    const lufs = (power) => power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
    return {
      process(channels, onFrame, onAttack) {
        if (!channels.length || !channels[0]?.length) return;
        if (trackingAttack && !onAttack) {
          attackSamples = previousAttack = rapidSamples = reportEnergy = reportSamples = 0;
          attackEnergy.fill(0);
        }
        trackingAttack = !!onAttack;
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
          const count = Math.min(channels[0].length - offset, frameLength - frameSamples, trackingAttack ? attackLength - attackSamples : Infinity);
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
              if (trackingAttack) attack += power2;
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
          if (trackingAttack) attackSamples += count;
          if (trackingAttack && attackSamples === attackLength) {
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
  var NORMALIZATION_PROFILE = Object.freeze({
    targetLufs: -18,
    energyHeadroomLu: 3,
    lookaheadMs: 20,
    attackMs: 1,
    releaseMs: 180,
    holdMs: 20,
    riseDbPerSecond: 24,
    peakDb: -10,
    referenceDecayLuPerSecond: 3,
    programmeRecoveryMs: 1200,
    recoveryConfirmationMs: 3e3
  });
  function createProgrammeState(selected = 0.3, energyHeadroomLu = NORMALIZATION_PROFILE.energyHeadroomLu) {
    const history2 = [];
    const targetPower = 10 ** ((NORMALIZATION_PROFILE.targetLufs + 0.691) / 10);
    const energyCeiling = targetPower * 10 ** (energyHeadroomLu / 10);
    let startupGain = 0, waiting = true, programmeGain = 1, time = 0, referenceHold = 0, lowerDuration = 0;
    return {
      setSelected(value) {
        selected = Math.max(0, Math.min(1, value));
      },
      getProgrammeGain() {
        return selected > 0 ? Math.min(waiting ? startupGain : programmeGain, 1 / selected) : 0;
      },
      frame(frame) {
        if (waiting && (frame.rawPower < 1e-9 || frame.power < 1e-9)) return;
        waiting = false;
        time += frame.duration;
        while (history2.length && history2[0].time <= time - 3) history2.shift();
        if (frame.rawPower < 1e-4 || frame.power <= 0) return;
        history2.push({ time, power: frame.power, duration: frame.duration });
        const ordered = history2.slice().sort((a, b) => a.power - b.power);
        const duration = history2.reduce((sum, item) => sum + item.duration, 0);
        let cumulative = 0, reference = 0;
        for (const item of ordered) {
          cumulative += item.duration;
          if (cumulative >= duration * 0.65) {
            reference = item.power;
            break;
          }
        }
        lowerDuration = reference < referenceHold * 10 ** (-1 / 10) ? lowerDuration + frame.duration : 0;
        const recovering = lowerDuration >= NORMALIZATION_PROFILE.recoveryConfirmationMs / 1e3;
        referenceHold = recovering && referenceHold > targetPower ? Math.max(targetPower, referenceHold * 10 ** (-NORMALIZATION_PROFILE.referenceDecayLuPerSecond * frame.duration / 10)) : referenceHold * 10 ** (-0.5 * frame.duration / 10);
        if (duration >= 1) referenceHold = Math.max(referenceHold, reference);
        reference = Math.max(reference, referenceHold);
        let desired = Math.min(1 / selected, 10 ** (6 / 20), Math.max(0.1, Math.sqrt(targetPower / reference)));
        if (!referenceHold) desired = Math.min(1, desired);
        if (desired < programmeGain) programmeGain = desired;
        else {
          const recovery = time < 3 ? 0.9 : recovering && desired <= 1 ? NORMALIZATION_PROFILE.programmeRecoveryMs / 1e3 : 3;
          programmeGain = Math.exp(Math.log(programmeGain) + (Math.log(desired) - Math.log(programmeGain)) * (1 - Math.exp(-frame.duration / recovery)));
        }
      },
      short(power) {
        if (waiting && power >= 1e-9) startupGain = Math.min(1, Math.sqrt(energyCeiling / power));
      }
    };
  }

  // src/shared/normalization-graph.js
  var GAIN_DB_RANGE = 60;
  var CONTROL_RANGE = 8;
  var curves;
  function controlCurves() {
    if (curves) return curves;
    const sample = (count, fn) => Float32Array.from({ length: count }, (_, i) => fn(i / (count - 1) * 2 - 1));
    const peak = 10 ** (NORMALIZATION_PROFILE.peakDb / 20);
    const energy = 10 ** ((NORMALIZATION_PROFILE.targetLufs + 0.691 + NORMALIZATION_PROFILE.energyHeadroomLu) / 10);
    curves = {
      absolute: new Float32Array([1, 0, 1]),
      square: sample(4097, (x) => x * x),
      peak: sample(65537, (x) => x > peak / CONTROL_RANGE ? Math.min(1, 20 * Math.log10(x * CONTROL_RANGE / peak) / GAIN_DB_RANGE) : 0),
      energy: sample(131073, (x) => x > energy / CONTROL_RANGE ** 2 ? Math.min(1, 10 * Math.log10(x * CONTROL_RANGE ** 2 / energy) / GAIN_DB_RANGE) : 0),
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
    const scale = gain(1 / CONTROL_RANGE, false), square = shape(tables.square, false), sum = gain(2);
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
    const peakScale = gain(1 / CONTROL_RANGE, false), absolute = shape(tables.absolute, false), split = own(context.createChannelSplitter(2));
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
        programme.gain.setTargetAtTime(value, at, 3e-3);
      },
      setSelected(value, at = context.currentTime) {
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
  function mediaTransitionTime(context) {
    return context.currentTime + Math.max(context.baseLatency || 0, context.outputLatency || 0, 128 / context.sampleRate);
  }
  function waitForMediaRender(window2, context, time) {
    return new Promise((resolve) => {
      const check = () => {
        if (context.state !== "running" || context.currentTime >= time) resolve();
        else window2.setTimeout(check, 2);
      };
      check();
    });
  }
  function fadeInMediaOutput(window2, video) {
    const document2 = documents.get(window2), route = document2?.routes.get(video), gate = route?.ordinary;
    if (!gate || route.pending) return Promise.resolve();
    const context = document2.context;
    return waitForMediaRender(window2, context, context.currentTime + (context.baseLatency || 0) + 256 / context.sampleRate).then(() => {
      if (route.ordinary !== gate || route.pending) return;
      const at = mediaTransitionTime(context);
      gate.gain.setValueAtTime(0, at);
      gate.gain.linearRampToValueAtTime(1, at + 5e-3);
    });
  }
  function registry(window2) {
    let state = documents.get(window2);
    if (!state) {
      state = { sources: /* @__PURE__ */ new WeakMap(), routes: /* @__PURE__ */ new WeakMap(), active: /* @__PURE__ */ new Set(), reserved: /* @__PURE__ */ new WeakSet(), external: /* @__PURE__ */ new WeakSet() };
      documents.set(window2, state);
    }
    return state;
  }
  function installMediaOutputGuard(window2) {
    const state = registry(window2);
    const Context = window2.AudioContext || window2.webkitAudioContext;
    if (state.createSource || !Context?.prototype.createMediaElementSource) {
      return;
    }
    state.createSource = Context.prototype.createMediaElementSource;
    function externalSource(video, create) {
      if (state.reserved.has(video) || state.sources.has(video)) {
        throw new window2.DOMException("Volume Slider already owns this media element", "InvalidStateError");
      }
      const source = create();
      state.external.add(video);
      return source;
    }
    Context.prototype.createMediaElementSource = function(video) {
      return externalSource(video, () => state.createSource.call(this, video));
    };
    if (window2.MediaElementAudioSourceNode) {
      window2.MediaElementAudioSourceNode = new Proxy(window2.MediaElementAudioSourceNode, {
        construct(target, args, newTarget) {
          return externalSource(args[1]?.mediaElement, () => Reflect.construct(target, args, newTarget));
        }
      });
    }
  }
  function assertMediaOutputAvailable(window2, video) {
    if (registry(window2).external.has(video)) {
      throw mediaOutputConflict();
    }
  }
  function reserveMediaOutput(window2, video) {
    assertMediaOutputAvailable(window2, video);
    registry(window2).reserved.add(video);
  }
  function registerExternalMediaOutput(window2, video) {
    if (video && !ownsMediaOutput(window2, video)) {
      registry(window2).external.add(video);
    }
  }
  function mediaOutputConflict() {
    const error = new Error("Another audio processor already owns this player");
    error.name = "AudioSourceConflict";
    return error;
  }
  function ownsMediaOutput(window2, video) {
    const state = documents.get(window2);
    return !!video && !!state && (state.reserved.has(video) || state.sources.has(video));
  }
  function reconcile(document2) {
    for (const route of document2.active) {
      if (!route.video.isConnected) {
        document2.sources.get(route.video)?.disconnect();
        route.ordinary?.disconnect();
        route.ordinary = null;
        document2.active.delete(route);
      }
    }
    const context = document2.context;
    if (context.state === "running") document2.activated = true;
    if (document2.active.size) {
      if (document2.suspending) return document2.suspending.then(() => reconcile(document2));
      if (context.state === "suspended") {
        return context.resume().then(() => {
          if (context.state === "running") return reconcile(document2);
        });
      }
      return Promise.resolve();
    }
    if (context.state === "running" && !document2.suspending && context.suspend) {
      document2.suspending = context.suspend().finally(() => {
        document2.suspending = null;
        if (document2.active.size) {
          reconcile(document2).catch(() => {
          });
        }
      });
      return document2.suspending;
    }
    return Promise.resolve();
  }
  function activity(document2, route, paused) {
    if (!paused && (route.pending || document2.sources.has(route.video))) document2.active.add(route);
    else document2.active.delete(route);
    return reconcile(document2);
  }
  function acquireMediaOutput(window2, video, { onPause } = {}) {
    installMediaOutputGuard(window2);
    assertMediaOutputAvailable(window2, video);
    const url = video.currentSrc && new URL(video.currentSrc, window2.location.href);
    if (video.mediaKeys || !video.srcObject && (!url || url.origin !== window2.location.origin && !video.crossOrigin)) {
      throw new Error("Direct audio processing requires an accessible media source");
    }
    const document2 = registry(window2);
    if (!document2.context) {
      const Context = window2.AudioContext || window2.webkitAudioContext;
      const context = new Context({ latencyHint: "interactive" });
      document2.context = context;
      const resume = () => {
        reconcile(document2).catch(() => {
        });
      };
      window2.document.addEventListener("pointerdown", resume, true);
      window2.document.addEventListener("keydown", resume, true);
    }
    let route = document2.routes.get(video);
    if (!route) {
      route = { video, pending: false };
      document2.routes.set(video, route);
      for (const type of ["play", "playing", "pause", "ended"]) {
        video.addEventListener(type, () => {
          const paused = video.paused || video.ended;
          if (paused && route.pending) route.onPause?.();
          if (!paused) route.pausing = null;
          if (!route.pausing) activity(document2, route, paused).catch(() => {
          });
        });
      }
    }
    route.pending = true;
    route.onPause = onPause;
    let source = document2.sources.get(video);
    function restoreRoute() {
      route.pending = false;
      route.ordinary?.disconnect();
      route.ordinary = null;
      if (source) {
        source.disconnect();
        if (video.isConnected) {
          const gate = route.ordinary = document2.context.createGain();
          gate.gain.value = 0;
          gate.connect(document2.context.destination);
          source.connect(gate);
        }
      }
      activity(document2, route, video.paused || video.ended).catch(() => {
      });
    }
    return {
      context: document2.context,
      get source() {
        return source;
      },
      setPaused(paused, after) {
        if (paused && after && document2.context.state === "running") {
          if (route.pausing === after) return;
          route.pausing = after;
          after.then(() => {
            if (route.pausing !== after) return;
            route.pausing = null;
            activity(document2, route, video.paused || video.ended).catch(() => {
            });
          });
        } else {
          route.pausing = null;
          activity(document2, route, paused).catch(() => {
          });
        }
      },
      resume() {
        return route.restoring ? route.restoring.then(() => activity(document2, route, video.paused || video.ended)) : activity(document2, route, video.paused || video.ended);
      },
      connect(input) {
        const context = document2.context;
        const activatedPause = context.state === "suspended" && document2.activated && (video.paused || video.ended);
        if (context.state !== "running" && !activatedPause) throw new Error("Audio processing requires player activation");
        if (!source) {
          assertMediaOutputAvailable(window2, video);
          try {
            source = document2.createSource.call(document2.context, video);
          } catch (error) {
            if (error.name === "InvalidStateError") {
              throw mediaOutputConflict();
            }
            throw error;
          }
          document2.sources.set(video, source);
        }
        route.ordinary?.disconnect();
        route.ordinary = null;
        source.disconnect();
        source.connect(input);
      },
      restore(after) {
        if (route.onPause === onPause) route.onPause = null;
        if (after) {
          route.pending = false;
          route.restoring = after.then(() => {
            route.restoring = null;
            if (route.pending) {
              source?.disconnect();
            } else {
              restoreRoute();
            }
          });
          return route.restoring;
        }
        if (route.restoring) {
          route.pending = false;
          return route.restoring;
        }
        restoreRoute();
      }
    };
  }

  // src/shared/normalization-playback.js
  function createAudiblePlayback({ window: window2, video, selected, onMetrics, onFailure }) {
    const output = acquireMediaOutput(window2, video, {
      onPause: () => owned.setState({ selected, muted: video.muted, paused: true })
    }), { context } = output;
    let gate, graph, disposal, analysis, silenced;
    const programme = createProgrammeState(selected);
    let stopped = false, connected = false, node = null, reader = null, muted = true, paused = video.paused;
    let meterBackend = "starting", rate = 0, samples = 0, hasFrame = false, lastReport = -Infinity;
    function updateGain() {
      graph?.setGain(programme.getProgrammeGain());
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
      get analyzing() {
        return !!analysis;
      },
      get running() {
        return !stopped && !!analysis && context.state === "running";
      },
      startAnalysis(track) {
        if (stopped) return Promise.resolve();
        return analysis || (analysis = (async () => {
          let native = false;
          if (window2.MediaStreamTrackProcessor) {
            try {
              nativeAnalysis(track);
              native = true;
            } catch {
            }
          }
          if (!native) await workletAnalysis();
        })().catch(fail));
      },
      setState(next) {
        if (stopped) return;
        if (selected !== next.selected) {
          selected = next.selected;
          programme.setSelected(selected);
          graph?.setSelected(selected);
          updateGain();
        }
        paused = next.paused;
        const silent = next.muted || paused || selected === 0;
        if (gate && muted !== silent) {
          muted = silent;
          const now = context.currentTime;
          const value = gate.gain.value;
          gate.gain.cancelScheduledValues(now);
          if (silent) {
            gate.gain.setValueAtTime(value, now);
            gate.gain.linearRampToValueAtTime(0, now + 5e-3);
            silenced = waitForMediaRender(window2, context, mediaTransitionTime(context) + 5e-3 + 128 / context.sampleRate);
          } else {
            silenced = null;
            const at = mediaTransitionTime(context);
            gate.gain.setValueAtTime(0, now);
            gate.gain.setValueAtTime(0, at);
            gate.gain.linearRampToValueAtTime(1, at + 5e-3);
          }
        }
        output.setPaused(paused, silenced);
      },
      resume() {
        return output.resume();
      },
      dispose() {
        if (stopped) return disposal;
        stopped = true;
        if (!gate) {
          return disposal = Promise.resolve(output.restore());
        }
        const at = mediaTransitionTime(context);
        gate.gain.cancelScheduledValues(at);
        gate.gain.setValueAtTime(gate.gain.value, at);
        gate.gain.linearRampToValueAtTime(0, at + 5e-3);
        reader?.cancel().catch(() => {
        });
        if (node) {
          node.port.onmessage = null;
          node.onprocessorerror = null;
          node.port.postMessage("stop");
          node.disconnect();
          node.port.close();
        }
        const silenced2 = waitForMediaRender(window2, context, at + 5e-3 + 128 / context.sampleRate).then(() => {
          video.volume = 0;
          return waitForMediaRender(window2, context, context.currentTime + (context.baseLatency || 0) + 256 / context.sampleRate);
        });
        return disposal = output.restore(silenced2).then(() => {
          graph?.dispose();
          gate.disconnect();
        });
      }
    };
    function fail(error) {
      if (!stopped) {
        owned.dispose();
        onFailure(error);
      }
    }
    function nativeAnalysis(track) {
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
 constructor(){super();this.meter=createLufsMeter(sampleRate);this.send=frame=>{this.port.postMessage(frame);if(frame.rawPower>=1e-9&&frame.power>=1e-9)this.measured=true};this.short=power=>{if(!this.measured)this.port.postMessage({attackPower:power})};this.port.onmessage=()=>{this.stopped=true}}
 process(inputs){if(this.stopped)return false;try{this.meter.process(inputs[0]||[],this.send,this.measured?undefined:this.short);return true}catch(error){this.port.postMessage({failed:true,message:error.message});return false}}
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
      gate = context.createGain();
      gate.gain.value = 0;
      gate.connect(context.destination);
      graph = createNativeGainGraph(context, { selected });
      graph.output.connect(gate);
      output.connect(graph.input);
      connected = true;
    })().catch(fail);
    return owned;
  }

  // src/shared/normalization.js
  function createVolumeNormalizer({ window: window2, getVolume, setVolume, isMuted, onStatusChanged = () => {
  } }) {
    installMediaOutputGuard(window2);
    const retiring = /* @__PURE__ */ new WeakMap();
    let enabled = false, sourceChanging = false, session = null, status = "Off", lastUiAt = -Infinity, lastDiagnostic = null;
    const now = () => window2.performance.now();
    function report(next, immediate = false) {
      const changed = status !== next;
      status = next;
      schedule();
      if (!changed && !immediate && now() - lastUiAt < 500) return;
      if (session) {
        const diagnostic = JSON.stringify({
          status,
          selected: session.preferred,
          output: session.preferred === 0 ? 0 : session.blocked ? session.preferred : Math.round(100 * (session.metrics?.gain || 0)),
          backend: session.playback?.backend || "starting",
          context: session.playback?.context.state,
          metrics: session.metrics || null,
          error: session.error || null
        });
        if (diagnostic !== lastDiagnostic) {
          lastDiagnostic = diagnostic;
          window2.document.documentElement.dataset.tmAudioNormalization = diagnostic;
        }
      }
      lastUiAt = now();
      onStatusChanged();
    }
    function schedule() {
      const owned = session;
      if (!owned) return;
      const cadence = owned.blocked || owned.video.paused || owned.video.ended ? 500 : sourceChanging || owned.track?.muted || owned.track?.readyState === "ended" || !owned.metrics || !owned.playback?.running ? 50 : 250;
      if (owned.cadence === cadence) return;
      window2.clearInterval(owned.timer);
      owned.cadence = cadence;
      owned.timer = window2.setInterval(tick, cadence);
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
      if (owned.releasing) return;
      const volume = owned.playback?.connected ? 100 : 0;
      if (getVolume(owned.video) !== volume || volume === 0 && owned.video.volume !== 0) nativeWrite(owned, volume);
    }
    function sync(owned) {
      if (!owned.playback) return;
      owned.playback.setState({ selected: owned.preferred / 100, muted: isMuted(owned.video), paused: owned.video.paused || owned.video.ended });
    }
    function release(owned) {
      owned.generation++;
      const finishing = owned.playback?.dispose() || owned.releasing;
      owned.playback = null;
      const stream = owned.stream;
      owned.stream = null;
      const stopTracks = () => {
        if (stream) {
          for (const track of stream.getTracks()) track.stop();
        }
      };
      if (finishing) {
        const releasing = Promise.resolve(finishing).then(() => {
          stopTracks();
          if (owned.releasing === releasing) {
            owned.releasing = null;
            if (session === owned) tick();
          }
        });
        owned.releasing = releasing;
      } else {
        stopTracks();
      }
      owned.track = null;
      owned.connecting = false;
      owned.metrics = null;
      owned.trackMutedAt = 0;
      return owned.releasing || Promise.resolve();
    }
    function reset(owned) {
      release(owned);
      reserveMediaOutput(window2, owned.video);
      owned.blocked = false;
      owned.started = now();
      owned.lastFrame = 0;
      silence(owned);
      report("Starting audio analysis");
    }
    function unavailable(owned, error) {
      if (session !== owned) return;
      const released = release(owned);
      owned.blocked = true;
      owned.error = String(error?.message || error || "Audio unavailable");
      owned.sourceConflict = error?.name === "AudioSourceConflict";
      owned.retryAt = now() + (owned.retryDelay || 1e3);
      owned.retryDelay = Math.min(3e4, (owned.retryDelay || 1e3) * 2);
      released.then(() => {
        if (session !== owned || !owned.blocked) return;
        try {
          nativeWrite(owned, owned.preferred);
        } catch {
        }
        fadeInMediaOutput(window2, owned.video);
      });
      report(owned.sourceConflict ? "Another audio processor is active \u2014 normal volume" : "Audio unavailable \u2014 normal volume");
    }
    async function connect(owned) {
      if (owned.connecting || owned.playback?.analyzing || owned.blocked) return;
      owned.connecting = true;
      const generation = owned.generation;
      try {
        const capture = owned.video.captureStream || owned.video.mozCaptureStream;
        if (!capture || owned.video.mediaKeys) throw new Error("Audio capture is unavailable");
        owned.playback || (owned.playback = createAudiblePlayback({
          window: window2,
          video: owned.video,
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
        }));
        await owned.playback.ready;
        if (session !== owned || owned.generation !== generation || owned.blocked) return;
        silence(owned);
        sync(owned);
        if (owned.video.paused || owned.video.ended || owned.video.readyState < 2) {
          owned.connecting = false;
          return;
        }
        owned.stream || (owned.stream = capture.call(owned.video));
        for (const track2 of owned.stream.getVideoTracks()) track2.stop();
        const track = owned.stream.getAudioTracks().find((item) => item.readyState === "live");
        if (!track) {
          owned.connecting = false;
          return;
        }
        if (track.muted) throw new Error("Captured audio is inaccessible");
        owned.track = track;
        owned.started = now();
        await owned.playback.startAnalysis(track);
        if (session !== owned || owned.generation !== generation || owned.blocked) return;
        owned.connecting = false;
        silence(owned);
        sync(owned);
      } catch (error) {
        if (session === owned && owned.generation === generation) unavailable(owned, error);
      }
    }
    function tick() {
      try {
        check();
      } finally {
        schedule();
      }
    }
    function check() {
      const owned = session;
      if (!owned) return;
      if (!owned.video.isConnected) {
        bind(null);
        return;
      }
      if (owned.blocked) {
        if (owned.sourceConflict) {
          return;
        }
        if (sourceChanging || owned.video.paused || owned.video.readyState < 2 || now() < owned.retryAt) return;
        try {
          reset(owned);
        } catch (error) {
          unavailable(owned, error);
          return;
        }
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
          else report(owned.metrics ? "Waiting for playback" : owned.playback?.connected && owned.playback.context.state === "suspended" ? "Click the player to activate" : "Starting audio analysis");
          return;
        }
        if (now() - (owned.lastFrame || owned.started) > (owned.metrics ? 1500 : 3e3)) {
          unavailable(owned, new Error(owned.metrics ? "Live audio processing stalled" : "Audio analysis did not start"));
        }
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
        for (const type of ["play", "playing", "loadedmetadata", "seeked", "pause", "ended", "volumechange"]) owned2.video.removeEventListener(type, owned2.update);
        window2.document.removeEventListener("pointerdown", owned2.gesture, true);
        window2.document.removeEventListener("keydown", owned2.gesture, true);
        retiring.set(owned2.video, owned2);
        release(owned2).then(() => {
          if (retiring.get(owned2.video) !== owned2) return;
          if (owned2.video.isConnected && session?.video !== owned2.video) {
            try {
              nativeWrite(owned2, owned2.preferred, owned2.restoreOptions);
            } catch {
            }
            fadeInMediaOutput(window2, owned2.video);
          }
          retiring.delete(owned2.video);
        });
        delete window2.document.documentElement.dataset.tmAudioNormalization;
        lastDiagnostic = null;
      }
      if (!enabled || !video) {
        report(enabled ? "Waiting for playback" : "Off");
        return;
      }
      retiring.delete(video);
      const owned = session = { video, preferred: clampVolume(preferredVolume ?? getVolume(video)), generation: 0, started: now(), changingAt: now(), lastFrame: 0 };
      owned.reset = (event) => {
        if (event?.type !== "seeking") sourceChanging = false;
        try {
          reset(owned);
        } catch (error) {
          unavailable(owned, error);
        }
      };
      owned.update = (event) => {
        if (owned.writing || owned.blocked) return;
        if (event.type === "play" || event.type === "playing") {
          owned.started = now();
          owned.lastFrame = 0;
        }
        if (owned.updateQueued) return;
        owned.updateQueued = true;
        window2.queueMicrotask(() => {
          owned.updateQueued = false;
          if (session === owned) tick();
        });
      };
      owned.gesture = () => {
        if (owned.sourceConflict) {
          return;
        }
        if (owned.blocked) reset(owned);
        owned.playback?.resume().catch(() => {
        });
        tick();
      };
      for (const type of ["emptied", "loadstart", "seeking"]) video.addEventListener(type, owned.reset);
      for (const type of ["play", "playing", "loadedmetadata", "seeked", "pause", "ended", "volumechange"]) video.addEventListener(type, owned.update);
      window2.document.addEventListener("pointerdown", owned.gesture, true);
      window2.document.addEventListener("keydown", owned.gesture, true);
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
        if (session?.sourceConflict) {
          return "Turn off the other audio processor, then reload to use Auto-normalize volume.";
        }
        if (!session || !status.startsWith("Active")) return "";
        const output = Math.round(100 * (session.metrics?.gain || 0));
        return `${output < session.preferred ? "Reducing loud audio" : output > session.preferred ? "Raising quiet audio" : "No volume adjustment"}
Output ${output}% \xB7 Selected ${session.preferred}%`;
      },
      getPreferredVolume(video, raw) {
        return (session?.video === video ? session : retiring.get(video))?.preferred ?? raw;
      },
      acceptNativeVolume(video) {
        const owned = session?.video === video ? session : retiring.get(video);
        if (!owned || owned.writing) return;
        owned.preferred = clampVolume(getVolume(video));
        if (retiring.get(video) === owned) return;
        if (!owned.blocked) {
          silence(owned);
          sync(owned);
        }
        report(status, true);
      },
      setPreferredVolume(video, value, options) {
        const owned = session?.video === video ? session : retiring.get(video);
        if (!owned) {
          setVolume(video, value, options);
          return;
        }
        owned.preferred = clampVolume(value);
        if (retiring.get(video) === owned) {
          owned.restoreOptions = options;
          return;
        }
        if (owned.blocked) nativeWrite(owned, owned.preferred, options);
        else {
          nativeWrite(owned, owned.playback?.connected ? 100 : 0, options);
          sync(owned);
        }
        report(status, true);
      }
    };
  }

  // src/shared/native-volume-input.js
  function bindNativeVolumeInput({ window: window2, video, player, selector: selector3, excludeSelector, normalizer, onChange }) {
    let active = true;
    const types = ["pointerdown", "pointermove", "input", "change", "wheel", "keydown"];
    const onInput = (event) => {
      if (!event.target?.closest?.(selector3) || !player.contains(event.target)) return;
      if (excludeSelector && event.target.closest(excludeSelector)) return;
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
    function show(value, muted = false, label) {
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
      popup.setAttribute("aria-label", label ? `${label}, volume ${percent}%` : `${muted ? "Muted, volume" : "Volume"} ${percent}%`);
      popup.lastChild.nodeValue = label || `${percent}%`;
      window2.clearTimeout(timer);
      timer = window2.setTimeout(clear, 500);
    }
    return {
      show,
      showMute(value, muted) {
        show(value, muted, muted ? "Muted" : "Unmuted");
      },
      clear,
      dispose() {
        clear();
        player.removeEventListener("pointerdown", clear, true);
        player.removeEventListener("keydown", onKey, true);
      }
    };
  }

  // src/platforms/twitch-extension-keys.js
  var messageType = "tm-volume-player-key-v1";
  var playerKeys = /* @__PURE__ */ new Set(["ArrowUp", "ArrowDown", " "]);
  var recentCommands = /* @__PURE__ */ new WeakMap();
  var extensionOrigin = (origin) => /^https:\/\/[a-z0-9-]+\.ext-twitch\.tv$/i.test(origin);
  var interactive = 'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="button"], [role="slider"], [role="combobox"]';
  function validMessage(event) {
    return extensionOrigin(event.origin) && event.data?.type === messageType && typeof event.data.id === "string" && event.data.id.length > 0 && event.data.id.length <= 64 && playerKeys.has(event.data.key) && !(event.data.key === " " && event.data.repeat);
  }
  function startTwitchExtensionKeys(window2) {
    if (window2.parent === window2 || !extensionOrigin(window2.location.origin)) return;
    window2.addEventListener("keydown", (event) => {
      if (!playerKeys.has(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === " " && event.repeat) return;
      if (event.target?.closest?.(interactive)) return;
      window2.queueMicrotask(() => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        window2.parent.postMessage({ type: messageType, id: window2.crypto.randomUUID(), key: event.key, repeat: event.repeat }, "*");
      });
    });
    window2.addEventListener("message", (event) => {
      const frame = window2.document.activeElement;
      if (validMessage(event) && frame?.tagName === "IFRAME" && frame.contentWindow === event.source) {
        window2.parent.postMessage({ type: messageType, id: event.data.id, key: event.data.key, repeat: event.data.repeat === true }, "*");
      }
    });
  }
  function focusedTwitchExtensionKey(event, player) {
    const frame = player?.ownerDocument.activeElement;
    if (!validMessage(event) || !frame?.matches?.("iframe.extension-view__iframe") || !player.contains(frame) || frame.contentWindow !== event.source) return null;
    let seen = recentCommands.get(frame);
    if (!seen) {
      seen = /* @__PURE__ */ new Set();
      recentCommands.set(frame, seen);
    }
    if (seen.has(event.data.id)) return null;
    seen.add(event.data.id);
    if (seen.size > 64) seen.delete(seen.values().next().value);
    return event.data.key;
  }

  // src/shared/normalization-ui.js
  function createNormalizationIcon(document2) {
    const icon = document2.createElement("span");
    icon.className = "tm-normalization-icon";
    icon.hidden = true;
    icon.dataset.tmTooltip = "Auto-normalize volume is on";
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
    const visible = status.startsWith("Active") || status === "Waiting for playback" || status === "Starting audio analysis" || status === "Waiting for audio" || status === "Waiting for accessible audio";
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

  // src/shared/volume-number.js
  var VOLUME_NUMBER_FONT_FAMILY = '"Segoe UI", system-ui, sans-serif';
  var VOLUME_NUMBER_FONT_WEIGHT = 600;
  var VOLUME_NUMBER_FONT_SIZE = 16;
  var VOLUME_NUMBER_COMPACT_SIZE = 15;
  var VOLUME_NUMBER_COMPACT_SPACING = -0.25;
  var COMPACT_MAX_WIDTH = 22.5;
  function createVolumeNumberRenderer(document2, center) {
    let context;
    let pixelRatio;
    const positions = /* @__PURE__ */ new Map();
    return (element, text) => {
      const compact = text.length > 2;
      const size = compact ? VOLUME_NUMBER_COMPACT_SIZE : VOLUME_NUMBER_FONT_SIZE;
      const ratio = document2.defaultView?.devicePixelRatio || 1;
      if (ratio !== pixelRatio) {
        positions.clear();
        pixelRatio = ratio;
      }
      if (element.textContent !== text) {
        element.textContent = text;
      }
      element.toggleAttribute("data-compact", compact);
      if (context === void 0) {
        context = document2.defaultView?.CanvasRenderingContext2D ? document2.createElement("canvas").getContext("2d") : null;
      }
      if (!context) {
        return;
      }
      let position = positions.get(text);
      if (!position) {
        context.font = `${VOLUME_NUMBER_FONT_WEIGHT} ${size}px ${VOLUME_NUMBER_FONT_FAMILY}`;
        let metrics = context.measureText(text);
        const spacing = compact ? VOLUME_NUMBER_COMPACT_SPACING * (text.length - 1) : 0;
        const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight + spacing;
        let fittedSize = size;
        if (compact && width > COMPACT_MAX_WIDTH) {
          fittedSize = Number((size * COMPACT_MAX_WIDTH / width).toFixed(3));
          context.font = `${VOLUME_NUMBER_FONT_WEIGHT} ${fittedSize}px ${VOLUME_NUMBER_FONT_FAMILY}`;
          metrics = context.measureText(text);
        }
        const {
          actualBoundingBoxLeft: left,
          actualBoundingBoxRight: right,
          actualBoundingBoxAscent: ascent,
          actualBoundingBoxDescent: descent
        } = metrics;
        if (![left, right, ascent, descent].every(Number.isFinite) || left + right <= 0 || ascent + descent <= 0) {
          return;
        }
        position = {
          x: center + (left - right - spacing) / 2,
          y: center + (ascent - descent) / 2,
          fontSize: fittedSize
        };
        positions.set(text, position);
      }
      element.setAttribute("text-anchor", "start");
      element.setAttribute("dominant-baseline", "alphabetic");
      element.setAttribute("alignment-baseline", "alphabetic");
      element.style.fontSize = position.fontSize < size ? `${position.fontSize}px` : "";
      element.setAttribute("x", String(Number(position.x.toFixed(3))));
      element.setAttribute("y", String(Number(position.y.toFixed(3))));
    };
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
    const renderVolumeNumber = createVolumeNumberRenderer(document2, Number(VOLUME_INDICATOR_CENTER));
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
        renderVolumeNumber(percent, muted ? "M" : String(Math.round(pct)));
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
      return isAlwaysExpandedEnabled() || overlay.matches(":hover") || overlay.contains(document2.activeElement) && document2.activeElement.matches(":focus-visible") || overlay.dataset.tmDragging === "true";
    }
    function clearExpandedHoldTimer(overlay) {
      if (overlay._expandedHoldTimer) {
        clearTimeout(overlay._expandedHoldTimer);
        overlay._expandedHoldTimer = 0;
      }
    }
    function finishExpandedHoldIfDue(overlay) {
      if (!overlay) return;
      if (!overlay.isConnected) {
        clearExpandedHold(overlay);
        return;
      }
      if (shouldKeepOverlayExpanded(overlay)) return;
      if (Date.now() < (overlay._expandedHoldUntil || 0)) {
        scheduleExpandedHoldRelease(overlay);
        return;
      }
      clearExpandedHold(overlay);
      setOverlayExpanded(overlay, false);
    }
    function collapseOverlayIfIdle(overlay) {
      window2.setTimeout(() => finishExpandedHoldIfDue(overlay), 0);
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
      percent.setAttribute("font-family", VOLUME_NUMBER_FONT_FAMILY);
      percent.setAttribute("font-size", String(VOLUME_NUMBER_FONT_SIZE));
      percent.setAttribute("font-weight", String(VOLUME_NUMBER_FONT_WEIGHT));
      percent.textContent = "0";
      svg.appendChild(percent);
      appendSpeakerIcon("tm-volume-speaker-muted", "muted", "translate(8 8)");
      appendSpeakerIcon("tm-volume-speaker-low", "low", "translate(8 8)");
      appendSpeakerIcon("tm-volume-speaker-high", "high", "translate(8 8)");
      return svg;
    }
    return { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHold, collapseOverlayIfIdle, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg, populateSliderTicks };
  }

  // src/shared/options-ui.js
  function createOptionsUi(dependencies) {
    const {
      document: document2,
      optionsPopupId: OPTIONS_POPUP_ID,
      refreshOptionsPopupState,
      getVolumeSliderMode,
      setVolumeSliderMode,
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
      const selectedAppearance = getVolumeAppearance();
      const selectedStep = getVolumeStep();
      const onVideo = isSliderOnVideo();
      popup.querySelector("#tm-volume-options-normalization")?.setAttribute("aria-checked", isNormalizationEnabled() ? "true" : "false");
      syncNormalizationStatus(popup);
      const modeSelect = popup.querySelector("#tm-volume-options-mode");
      if (modeSelect) modeSelect.value = selectedMode;
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
    function createBehaviorSection() {
      const section = document2.createElement("div");
      section.className = "tm-volume-options-section";
      section.appendChild(createOptionsSectionLabel("Behavior"));
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
      section.appendChild(list);
      return section;
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
      panels[0].append(createNormalizationSection(), createBehaviorSection());
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
  function normalizeSliderLocation(location2) {
    return normalizeChoice(location2, LOCATIONS);
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
    const pendingSizeFrames = /* @__PURE__ */ new WeakSet();
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
    function setSliderLocation(location2) {
      write(keys.location, normalizeSliderLocation(location2) || "controls");
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
      else collapseOverlayIfIdle(overlay);
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
      const view = overlay.ownerDocument?.defaultView;
      if (view?.requestAnimationFrame && !pendingSizeFrames.has(overlay)) {
        pendingSizeFrames.add(overlay);
        view.requestAnimationFrame(() => {
          pendingSizeFrames.delete(overlay);
          if (overlay.isConnected) syncOverlayTicks(overlay);
        });
      }
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
      else collapseOverlayIfIdle(overlay);
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
      return overlay?.dataset.tmOptionsPreview === "thickness" || overlay?.dataset.tmOptionsPreview === "opacity-active" || overlay?.dataset.tmDragging === "true" || overlay?.dataset.tmHovering === "true" || overlay?.matches?.(":hover") || overlay?.contains?.(document2.activeElement) && document2.activeElement.matches(":focus-visible");
    }
    function setVolumeSliderMode(mode) {
      const normalizedMode = normalizeVolumeSliderMode(mode) || "on";
      write(keys.mode, normalizedMode);
      onModeChanged(normalizedMode);
    }
    const isOverlayEnabled = () => getVolumeSliderMode() !== "off";
    const isNativeVolumeReplacementEnabled = () => getVolumeSliderMode() === "replace-native";
    return {
      isNormalizationEnabled,
      setNormalizationEnabled,
      getVolumeSliderMode,
      isSliderOnVideo,
      setSliderLocation,
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
      isNativeVolumeReplacementEnabled
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
    closeHideControlsClass = ""
  }) {
    const style = createStyleElement(document2, styleId);
    if (!style) return;
    style.textContent = fillStyleTemplate(OPTIONS_STYLE_TEMPLATE, {
      optionsButtonId,
      optionsPopupId,
      accentDark,
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
  font: {{numberFont}};
  font-variant-numeric: normal;
  font-feature-settings: normal;
  font-synthesis: none;
  letter-spacing: 0;
  text-shadow: none;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.95));
  text-rendering: geometricPrecision;
  user-select: none;
}

#{{overlayId}} .tm-volume-percent[data-compact] {
  font-size: {{numberCompactSize}}px;
  letter-spacing: {{numberCompactSpacing}}px;
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
      numberFont: `${VOLUME_NUMBER_FONT_WEIGHT} ${VOLUME_NUMBER_FONT_SIZE}px/1 ${VOLUME_NUMBER_FONT_FAMILY}`,
      numberCompactSize: VOLUME_NUMBER_COMPACT_SIZE,
      numberCompactSpacing: VOLUME_NUMBER_COMPACT_SPACING,
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
    normalizationDescription.textContent = normalizationIcon.dataset.tmTooltip;
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
        finishLayout();
        return;
      }
      updateOpacity();
      collapseIfIdle();
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

  // src/platforms/twitch-controls-visibility.js
  function createTwitchControlsVisibilityManager({
    window: window2,
    MutationObserver: MutationObserver2,
    getTargets,
    areControlsHidden
  }) {
    const owners = /* @__PURE__ */ new Map();
    let observer = null;
    let observedTargets = [];
    let disposed = false;
    const touchedElements = /* @__PURE__ */ new Set();
    function reveal() {
      if (disposed || owners.size === 0) return;
      const { root, shell, controls } = getTargets();
      [root, shell, controls].filter(Boolean).forEach((element) => touchedElements.add(element));
      if (shell) {
        shell.classList.add("tm-volume-options-controls-shell-hold");
        shell.setAttribute("aria-hidden", "false");
        shell.style.opacity = "1";
        shell.style.visibility = "visible";
      }
      if (root) {
        root.classList.add("tm-volume-options-controls-hold");
        root.setAttribute("data-a-visible", "true");
        root.setAttribute("aria-hidden", "false");
        root.style.opacity = "1";
        root.style.visibility = "visible";
      }
      if (controls) {
        controls.setAttribute("aria-hidden", "false");
        controls.style.opacity = "1";
        controls.style.visibility = "visible";
      }
      observeTargets();
    }
    function releaseStyles() {
      const { root, shell, controls } = getTargets();
      [root, shell, controls].filter(Boolean).forEach((element) => touchedElements.add(element));
      for (const element of touchedElements) {
        element?.classList?.remove("tm-volume-options-controls-shell-hold");
        element?.classList?.remove("tm-volume-options-controls-hold");
        element?.style?.removeProperty("opacity");
        element?.style?.removeProperty("visibility");
        element?.style?.removeProperty("pointer-events");
      }
      touchedElements.clear();
    }
    function disconnectObserver() {
      observer?.disconnect();
      observer = null;
      observedTargets = [];
    }
    function observeTargets() {
      if (disposed || owners.size === 0 || !MutationObserver2) return;
      const { root, shell, controls } = getTargets();
      const nextTargets = [shell, root, controls].filter(Boolean);
      if (nextTargets.length === observedTargets.length && nextTargets.every((target, index) => target === observedTargets[index])) return;
      disconnectObserver();
      if (!nextTargets.length) return;
      observedTargets = nextTargets;
      observer = new MutationObserver2(() => {
        if (owners.size && areControlsHidden()) reveal();
      });
      if (shell) observer.observe(shell, { attributes: true, attributeFilter: ["aria-hidden", "style", "class"] });
      if (root) observer.observe(root, { attributes: true, attributeFilter: ["data-a-visible", "aria-hidden", "style", "class"] });
      if (controls) observer.observe(controls, { attributes: true, attributeFilter: ["aria-hidden", "style", "class"] });
    }
    function clearOwnerTimer(owner) {
      const entry = owners.get(owner);
      if (entry?.timer) window2.clearTimeout(entry.timer);
    }
    function hold(owner, duration = 0, onExpire) {
      if (disposed || !owner) return;
      clearOwnerTimer(owner);
      const entry = { timer: 0 };
      owners.set(owner, entry);
      reveal();
      if (duration > 0) {
        entry.timer = window2.setTimeout(() => {
          entry.timer = 0;
          release(owner);
          onExpire?.();
        }, duration);
      }
    }
    function release(owner) {
      if (!owners.has(owner)) return;
      clearOwnerTimer(owner);
      owners.delete(owner);
      if (owners.size) {
        reveal();
        return;
      }
      disconnectObserver();
      releaseStyles();
    }
    function has(owner) {
      return owners.has(owner);
    }
    function dispose() {
      if (disposed) return;
      for (const owner of owners.keys()) clearOwnerTimer(owner);
      owners.clear();
      disconnectObserver();
      releaseStyles();
      disposed = true;
    }
    return { hold, release, has, reveal, dispose, get size() {
      return owners.size;
    } };
  }

  // src/platforms/twitch-audio-compatibility.js
  var buttons = /* @__PURE__ */ new WeakMap();
  var selector2 = '[data-a-target="seventv-player-audio-compressor-button"]';
  var explanation = "7TV compressor unavailable while Volume Slider controls audio. Reload with Auto-normalize volume off to use it.";
  function registerExistingTwitchAudio(window2, video) {
    if (window2.document.querySelector('[data-a-target="seventv-player-audio-compressor-button"].is-active:not(.is-unavailable)')) {
      registerExternalMediaOutput(window2, video);
    }
  }
  function syncTwitchAudioCompatibility(window2, video, mutations) {
    if (mutations && !mutations.some(({ target, addedNodes }) => target.nodeType === 1 && target.closest(selector2) || [...addedNodes].some((node) => node.nodeType === 1 && (node.matches(selector2) || node.querySelector(selector2))))) {
      return;
    }
    const owned = ownsMediaOutput(window2, video);
    for (const button of window2.document.querySelectorAll(selector2)) {
      let saved = buttons.get(button);
      if (owned) {
        if (!saved) {
          saved = {
            disabled: button.disabled,
            label: button.getAttribute("aria-label"),
            title: button.getAttribute("title"),
            tooltip: button.getAttribute("data-tm-tooltip"),
            hover: (event) => event.stopImmediatePropagation()
          };
          buttons.set(button, saved);
          button.addEventListener("mouseenter", saved.hover, true);
        }
        if (!button.disabled) {
          button.disabled = true;
        }
        if (button.getAttribute("aria-label") !== explanation) {
          button.setAttribute("aria-label", explanation);
        }
        if (button.dataset.tmTooltip !== explanation) {
          button.dataset.tmTooltip = explanation;
        }
        if (button.hasAttribute("title")) {
          button.removeAttribute("title");
        }
      } else if (saved) {
        button.disabled = saved.disabled;
        for (const [attribute, value] of [["aria-label", saved.label], ["title", saved.title], ["data-tm-tooltip", saved.tooltip]]) {
          if (value === null) {
            button.removeAttribute(attribute);
          } else {
            button.setAttribute(attribute, value);
          }
        }
        button.removeEventListener("mouseenter", saved.hover, true);
        buttons.delete(button);
      }
    }
  }

  // src/platforms/twitch.js
  function startTwitchVolumeSlider() {
    "use strict";
    installPlayerTooltips(window, "twitch");
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
    const STORAGE_KEY = "tm-twitch-volume";
    const MUTE_STORAGE_KEY = "tm-twitch-muted";
    const VOLUME_MODE_KEY = "tm-twitch-volume-slider-mode";
    const SLIDER_LOCATION_KEY = "tm-twitch-volume-slider-location";
    const VOLUME_STEP_KEY = "tm-twitch-volume-slider-step";
    const LEGACY_SNAP_TO_5_KEY = "tm-twitch-volume-slider-snap-to-5";
    const ALWAYS_EXPANDED_KEY = "tm-twitch-volume-slider-always-expanded";
    const OVERLAY_OPACITY_IDLE_KEY = "tm-twitch-volume-slider-opacity-idle";
    const OVERLAY_OPACITY_ACTIVE_KEY = "tm-twitch-volume-slider-opacity-active";
    const OVERLAY_SIZE_KEY = "tm-twitch-volume-slider-size";
    const SLIDER_THICKNESS_KEY = "tm-twitch-volume-slider-thickness";
    const VOLUME_APPEARANCE_KEY = "tm-twitch-volume-slider-appearance";
    const DEFAULT_OVERLAY_OPACITY_IDLE = 45;
    const DEFAULT_OVERLAY_OPACITY_ACTIVE = 95;
    const DEFAULT_OVERLAY_SIZE = 100;
    const DEFAULT_SLIDER_THICKNESS = 75;
    const STORAGE_WRITE_DEBOUNCE_MS = 150;
    const VOLUME_CHANGE_EXPANDED_HOLD_MS = 1200;
    const KEYBOARD_VOLUME_STEP = 5;
    const VOLUME_LABEL_ROW_WIDTH_PX = 50;
    const TWITCH_CONTROLS_OUTSIDE_CLOSE_HOLD_MS = 5e3;
    const KEYBOARD_CONTROLS_HOLD_MS = 3e3;
    const TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR = '[data-a-target="player-settings-button"], button[aria-label="Settings"]';
    const TWITCH_NATIVE_SETTINGS_UI_SELECTOR = `${TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR}, [data-a-target="player-settings-menu"], [data-a-target="player-settings-submenu"], [data-a-target="player-settings-submenu-back-button"]`;
    const TWITCH_PREVIEW_PLAYER_MAX_WIDTH_PX = 720;
    const ON_VIDEO_IDLE_BOTTOM_PX = 12;
    const ON_VIDEO_MAX_CONTROLS_OFFSET_PX = 140;
    const COMPACT_CONTROLS_MAX_WIDTH_PX = 640;
    const VOLUME_ACCENT_LIGHT = "#a970ff";
    const VOLUME_ACCENT_DARK = "#9146ff";
    const VOLUME_ACCENT_MID = "#b38cff";
    const VOLUME_ARC_TRACK = "rgba(255, 255, 255, 0.38)";
    const VOLUME_PANEL_DROP_SHADOW = "drop-shadow(0 2px 5px rgba(0, 0, 0, 0.06))";
    const STARTUP_MUTE_GUARD_MS = 4e3;
    const STARTUP_MUTE_GUARD_INTERVAL_MS = 50;
    const USER_SETTINGS = {
      // Volume slider mode: 'saved', 'off', 'on', or 'replace-native'. Default: 'saved'
      volumeSliderMode: "saved",
      // Slider location: 'saved', 'controls', or 'video'. Default: 'saved'
      sliderLocation: "saved",
      // Volume adjustment step: 'saved', 1, 2, 5, or 10. Default: 'saved'
      volumeStep: "saved",
      // Keep the volume pill expanded: 'saved', true, or false. Default: 'saved'
      alwaysExpanded: "saved",
      // Opacity for the on-video slider when idle/focused: 'saved' or 0-100. Default: 'saved'
      overlayOpacityUnfocused: "saved",
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
    let cachedApi = null;
    let cachedApiFromElement = null;
    const nativeVolumeOwners = /* @__PURE__ */ new WeakSet();
    const nativeMuteOwners = /* @__PURE__ */ new WeakSet();
    let startupLockUntil = 0;
    let startupCorrectionApplied = false;
    let stopActiveStartupMuteGuard = null;
    let userIntentUntil = 0;
    let navReattachTimer = 0;
    let navLateRestoreTimer = 0;
    let navDebounceTimer = 0;
    let lastKnownPath = window.location.pathname;
    let attachObserver = null;
    let attachObserverTarget = null;
    let attachBootstrapObserver = null;
    let nativeSettingsObserver = null;
    let nativeSettingsObserverTarget = null;
    let delayedFirstAttachRestoreTimer = 0;
    let playerBoundaryResizeFrame = 0;
    const overlayLifecycle = createOverlayLifecycle();
    const { getVideoElement, resetVideoElement, ensurePlayerPositioning } = createVideoLocator(document, window);
    const USER_INTENT_GRACE_MS = 5e3;
    const NAV_REATTACH_DELAY_MS = 700;
    const NAV_LATE_RESTORE_DELAY_MS = 4200;
    const NAV_DEBOUNCE_MS = 180;
    const { isNormalizationEnabled, setNormalizationEnabled, getVolumeSliderMode, isSliderOnVideo, setSliderLocation, getVolumeAppearance, setVolumeAppearance, updateOverlayAppearance, getVolumeStep, setVolumeStep, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled, getSavedOverlayOpacityPercent, setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent, getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent, getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent, beginThicknessSliderPreview, endThicknessSliderPreview, beginOpacitySliderPreview, endOpacitySliderPreview, updateSliderThickness, isOverlayInteractionFocused, updateOverlayOpacity, setVolumeSliderMode, isOverlayEnabled, isNativeVolumeReplacementEnabled } = createVolumeSettings({
      document,
      storage,
      userSettings: USER_SETTINGS,
      overlayId: OVERLAY_ID,
      keys: { normalization: "tm-twitch-volume-slider-normalization", mode: VOLUME_MODE_KEY, location: SLIDER_LOCATION_KEY, step: VOLUME_STEP_KEY, legacySnap: LEGACY_SNAP_TO_5_KEY, expanded: ALWAYS_EXPANDED_KEY, idleOpacity: OVERLAY_OPACITY_IDLE_KEY, activeOpacity: OVERLAY_OPACITY_ACTIVE_KEY, overlaySize: OVERLAY_SIZE_KEY, sliderThickness: SLIDER_THICKNESS_KEY, appearance: VOLUME_APPEARANCE_KEY },
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
      collapseOverlayIfIdle: (overlay) => collapseOverlayIfIdle(overlay),
      ensureOverlay: () => {
        attachSliderIfPossible();
        return document.getElementById(OVERLAY_ID);
      }
    });
    registerExistingTwitchAudio(window, getVideoElement());
    const normalizer = createVolumeNormalizer({
      window,
      getVolume: getRawVolume,
      setVolume: setRawVolume,
      isMuted,
      onStatusChanged: () => {
        syncNormalizationStatus(getOptionsPopup());
        syncNormalizationIcon();
        syncTwitchAudioCompatibility(window, getVideoElement());
      }
    });
    function syncNormalization(video = overlayLifecycle.active?.root?._tmVolumeVideo || null) {
      const enabled = isNormalizationEnabled() && isOverlayEnabled();
      normalizer.setEnabled(enabled);
      normalizer.bind(video);
      refreshOptionsPopupState();
      syncNormalizationIcon();
    }
    function syncNormalizationIcon() {
      updateNormalizationIcon(document.getElementById(OVERLAY_ID), normalizer.getStatus());
    }
    const { getSavedVolume, readSteppedSliderValue, saveVolume, scheduleSaveVolume, cancelScheduledSaveVolume } = createVolumePersistence({
      window,
      storage,
      storageKey: STORAGE_KEY,
      debounceMs: STORAGE_WRITE_DEBOUNCE_MS,
      getVolumeStep
    });
    const makeControlsVisibilityManager = () => createTwitchControlsVisibilityManager({
      window,
      MutationObserver: window.MutationObserver,
      getTargets: () => ({
        root: getTwitchPlayerControlsRoot(),
        shell: getTwitchPlayerControlsShell(),
        controls: getTwitchPlayerControlsSection()
      }),
      areControlsHidden: () => areTwitchControlsHidden()
    });
    let controlsVisibility = makeControlsVisibilityManager();
    function getPlayerContainer(video = getVideoElement()) {
      if (!video) {
        return null;
      }
      return video.closest('[data-a-target="video-player"], .video-player') || video.closest(".video-player__container") || video.parentElement;
    }
    function getVideoOverlayContainer(video = getVideoElement(), player = getPlayerContainer(video)) {
      return video?.closest?.(".video-player__container") || player;
    }
    function isTwitchPreviewPlayer(player = getPlayerContainer()) {
      const isBrowsePage = /^\/(?:$|(?:directory|following|search)(?:\/|$))/.test(window.location.pathname);
      const rect = player?.getBoundingClientRect?.();
      const width = Number(rect?.width);
      return isBrowsePage && Number.isFinite(width) && width > 0 && width <= TWITCH_PREVIEW_PLAYER_MAX_WIDTH_PX;
    }
    function getTwitchControlsHost(player = getPlayerContainer()) {
      return player?.querySelector?.(".player-controls__left-control-group") || document.querySelector("#channel-player .player-controls__left-control-group") || document.querySelector('[aria-label="Player Controls"] .player-controls__left-control-group') || document.querySelector(".player-controls__left-control-group");
    }
    function getTwitchPlayerControlsRoot(player = getPlayerContainer()) {
      return player?.querySelector?.('[data-a-target="player-controls"].player-controls') || player?.querySelector?.('[data-a-target="player-controls"]') || document.querySelector('[data-a-target="player-controls"].player-controls') || document.querySelector('[data-a-target="player-controls"]');
    }
    function getTwitchPlayerControlsShell(player = getPlayerContainer()) {
      return getTwitchPlayerControlsRoot(player)?.closest?.(".tw-transition") || null;
    }
    function getTwitchPlayerControlsSection(player = getPlayerContainer()) {
      return player?.querySelector?.('#channel-player, [aria-label="Player Controls"]') || document.querySelector('#channel-player, [aria-label="Player Controls"]');
    }
    function getTwitchRightControlsHost(player = getPlayerContainer()) {
      return player?.querySelector?.(".player-controls__right-control-group") || document.querySelector("#channel-player .player-controls__right-control-group") || document.querySelector('[aria-label="Player Controls"] .player-controls__right-control-group') || document.querySelector(".player-controls__right-control-group");
    }
    function getTwitchSettingsButton(host = getTwitchRightControlsHost()) {
      return host?.querySelector?.('[data-a-target="player-settings-button"]') || host?.querySelector?.('button[aria-label="Settings"]') || null;
    }
    function getLayoutWidth(element) {
      const rectWidth = element?.getBoundingClientRect?.().width || 0;
      return rectWidth > 0 ? rectWidth : element?.clientWidth || 0;
    }
    function updateControlsCompactLayout(overlay, controlsHost) {
      if (!overlay) return;
      const controlsWidth = getLayoutWidth(getTwitchPlayerControlsRoot()) || getLayoutWidth(getTwitchPlayerControlsSection()) || getLayoutWidth(controlsHost);
      overlay.classList.toggle(
        "tm-volume-compact-layout",
        !isSliderOnVideo() && controlsWidth > 0 && controlsWidth <= COMPACT_CONTROLS_MAX_WIDTH_PX
      );
    }
    function isNativeSettingsMenuOpen() {
      return getTwitchSettingsButton()?.getAttribute("aria-expanded") === "true";
    }
    function isClickOnNativeSettingsUi(event) {
      return !!event.target?.closest?.(TWITCH_NATIVE_SETTINGS_UI_SELECTOR);
    }
    function getDirectChildOf(parent, child) {
      let node = child;
      while (node && node.parentElement && node.parentElement !== parent) {
        node = node.parentElement;
      }
      return node && node.parentElement === parent ? node : null;
    }
    function getNativeVolumeGroup(controlsHost = getTwitchControlsHost()) {
      if (!controlsHost) return null;
      const muteButton = controlsHost.querySelector('[data-a-target="player-mute-unmute-button"]');
      return muteButton ? getDirectChildOf(controlsHost, muteButton) : null;
    }
    function getTwitchSettingsWrapper(host = getTwitchRightControlsHost()) {
      const settingsBtn = getTwitchSettingsButton(host);
      return host && settingsBtn ? getDirectChildOf(host, settingsBtn) : null;
    }
    function positionOverlayAboveControls(overlay, overlayHost, player = getPlayerContainer()) {
      const controls = getTwitchPlayerControlsSection(player);
      if (!overlay || !overlayHost || !controls) {
        if (overlay) overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
        return;
      }
      const playerRect = overlayHost.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      const hasUsableControlsRect = controlsRect.width > 0 && controlsRect.height > 0 && controlsRect.top >= playerRect.top && controlsRect.top < playerRect.bottom;
      if (!hasUsableControlsRect) {
        overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
        return;
      }
      const bottomPx = playerRect.bottom - controlsRect.top + 8;
      const safeBottomPx = Math.min(Math.max(20, bottomPx), ON_VIDEO_MAX_CONTROLS_OFFSET_PX);
      overlay.style.bottom = `${safeBottomPx}px`;
    }
    function updateVideoOverlayPosition(overlay, overlayHost, player = getPlayerContainer()) {
      if (!overlay || !overlayHost || !isSliderOnVideo()) return;
      if (areTwitchControlsHidden(player)) {
        overlay.style.bottom = `${ON_VIDEO_IDLE_BOTTOM_PX}px`;
        return;
      }
      positionOverlayAboveControls(overlay, overlayHost, player);
    }
    function placeOverlayInControls(overlay, controlsHost) {
      if (!overlay || !controlsHost) return;
      const nativeVolumeGroup = getNativeVolumeGroup(controlsHost);
      if (isNativeVolumeReplacementEnabled() && nativeVolumeGroup && nativeVolumeGroup.parentElement === controlsHost) {
        if (overlay.parentElement !== controlsHost || overlay.nextElementSibling !== nativeVolumeGroup) {
          controlsHost.insertBefore(overlay, nativeVolumeGroup);
        }
        return;
      }
      if (nativeVolumeGroup && nativeVolumeGroup.parentElement === controlsHost) {
        if (overlay.parentElement === controlsHost && overlay.previousElementSibling === nativeVolumeGroup) {
          return;
        }
        nativeVolumeGroup.insertAdjacentElement("afterend", overlay);
        return;
      }
      if (overlay.parentElement !== controlsHost || overlay.nextElementSibling) {
        controlsHost.appendChild(overlay);
      }
    }
    function placeOverlay(overlay, player, controlsHost) {
      if (!overlay || !player) return;
      if (isSliderOnVideo()) {
        const overlayHost = getVideoOverlayContainer(void 0, player);
        ensurePlayerPositioning(overlayHost);
        if (overlay.parentElement !== overlayHost) {
          overlayHost.appendChild(overlay);
        }
        updateVideoOverlayPosition(overlay, overlayHost, player);
      } else if (controlsHost) {
        placeOverlayInControls(overlay, controlsHost);
        overlay.style.bottom = "";
      }
      updateControlsCompactLayout(overlay, controlsHost);
      const expanded = overlay.classList.contains("tm-expanded") || isAlwaysExpandedEnabled();
      setOverlayExpanded(overlay, expanded, true);
      updateOverlayOpacity(overlay);
    }
    function applyNativeVolumeVisibility() {
      const video = getVideoElement();
      const player = getPlayerContainer(video);
      const controlsHost = getTwitchControlsHost(player);
      const nativeVolumeGroup = getNativeVolumeGroup(controlsHost);
      const isPreviewPlayer = isTwitchPreviewPlayer(player);
      if (nativeVolumeGroup) {
        const shouldHideNative = !isPreviewPlayer && isOverlayEnabled() && isNativeVolumeReplacementEnabled();
        const nextDisplay = shouldHideNative ? "none" : "";
        if (nativeVolumeGroup.style.display !== nextDisplay) {
          nativeVolumeGroup.style.display = nextDisplay;
        }
      }
      const overlay = document.getElementById(OVERLAY_ID);
      if (overlay && player && !isPreviewPlayer && !isOverlayInteractionFocused(overlay)) {
        placeOverlay(overlay, player, controlsHost);
      }
    }
    function createStylesIfNeeded() {
      installVolumeSliderStyles({
        document,
        platform: "twitch",
        overlayId: OVERLAY_ID,
        valueLabelId: VALUE_LABEL_ID,
        panelDropShadow: VOLUME_PANEL_DROP_SHADOW
      });
    }
    const { updateSliderBar, updateVolumeIndicator, setOverlayExpanded, shouldKeepOverlayExpanded, clearExpandedHold, collapseOverlayIfIdle, markVolumeChangedWhileExpanded, makeVolumeIndicatorSvg, populateSliderTicks } = createOverlayUi({
      document,
      window,
      isAlwaysExpandedEnabled,
      isSliderOnVideo,
      updateOverlayOpacity,
      getVolumeStep,
      accentLight: VOLUME_ACCENT_LIGHT,
      accentDark: VOLUME_ACCENT_DARK,
      accentMid: VOLUME_ACCENT_MID,
      arcTrack: VOLUME_ARC_TRACK,
      expandedHoldMs: VOLUME_CHANGE_EXPANDED_HOLD_MS
    });
    function areTwitchControlsHidden(player = getPlayerContainer()) {
      const controlsRoot = getTwitchPlayerControlsRoot(player);
      const controlsShell = getTwitchPlayerControlsShell(player);
      const controls = getTwitchPlayerControlsSection(player);
      if (controlsShell?.getAttribute("aria-hidden") === "true") return true;
      if (controlsRoot?.getAttribute("data-a-visible") === "false") return true;
      if (controlsRoot?.getAttribute("aria-hidden") === "true") return true;
      if (!controls) return false;
      if (controls.getAttribute("aria-hidden") === "true") return true;
      const shellStyle = controlsShell ? window.getComputedStyle(controlsShell) : null;
      const rootStyle = controlsRoot ? window.getComputedStyle(controlsRoot) : null;
      const controlsStyle = window.getComputedStyle(controls);
      return shellStyle?.display === "none" || shellStyle?.visibility === "hidden" || Number(shellStyle?.opacity) === 0 || rootStyle?.display === "none" || rootStyle?.visibility === "hidden" || Number(rootStyle?.opacity) === 0 || controlsStyle.display === "none" || controlsStyle.visibility === "hidden" || Number(controlsStyle.opacity) === 0;
    }
    function getTwitchPlayerApi(video) {
      try {
        const playerSel = 'div[data-a-target="player-overlay-click-handler"], [data-a-target="video-player"], .video-player';
        const player = getPlayerContainer(video);
        const candidates = [
          video?.closest?.(playerSel),
          player,
          player?.closest?.(playerSel),
          player?.querySelector?.(playerSel),
          document.querySelector(playerSel)
        ].filter(Boolean);
        const uniqueCandidates = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
        if (cachedApi && uniqueCandidates.includes(cachedApiFromElement)) {
          return cachedApi;
        }
        for (const el of uniqueCandidates) {
          let instance;
          for (const key in el) {
            if (key.startsWith("__reactInternalInstance$") || key.startsWith("__reactFiber$")) {
              instance = el[key];
              break;
            }
          }
          if (!instance) continue;
          let parent = instance.return;
          for (let i = 0; i < 50; i++) {
            if (!parent || !parent.memoizedProps) break;
            const player2 = parent.memoizedProps.mediaPlayerInstance;
            if (player2) {
              const api = player2.core ?? player2.playerInstance?.core ?? player2;
              if (typeof api?.getVolume === "function" && typeof api?.setVolume === "function") {
                cachedApi = api;
                cachedApiFromElement = el;
                return api;
              }
            }
            parent = parent.return;
          }
        }
      } catch (e) {
      }
      cachedApi = null;
      cachedApiFromElement = null;
      return null;
    }
    function getVolume(video) {
      return isMuted(video) ? 0 : getUnderlyingVolume(video);
    }
    function getUnderlyingVolume(video) {
      return normalizer.getPreferredVolume(video, getRawVolume(video));
    }
    function getRawVolume(video) {
      try {
        const api = getTwitchPlayerApi(video);
        if (api && !nativeVolumeOwners.has(video)) {
          const vol = api.getVolume();
          return Math.round((typeof vol === "number" ? vol : 0) * 100);
        }
      } catch (e) {
      }
      return Math.round((Number(video?.volume) || 0) * 100);
    }
    function setNativeVideoMuted(video, muted) {
      if (!video) return;
      video.muted = video.defaultMuted = !!muted;
    }
    function setVolume(video, value, options = {}) {
      normalizer.setPreferredVolume(video, value, options);
    }
    function setRawVolume(video, value, options = {}) {
      const preserveMute = options.preserveMute === true;
      if (!preserveMute && isMuted(video)) setMuted(video, false);
      const api = getTwitchPlayerApi(video);
      if (api) {
        try {
          nativeVolumeOwners.delete(video);
          api.setVolume(Math.min(1, Math.max(0, value / 100)));
          return;
        } catch (e) {
        }
      }
      nativeVolumeOwners.add(video);
      video.volume = value / 100;
      if (!preserveMute) {
        setNativeVideoMuted(video, false);
      }
    }
    function isMuted(video) {
      try {
        const api = getTwitchPlayerApi(video);
        if (api && api.isMuted && !nativeMuteOwners.has(video)) return api.isMuted();
      } catch (e) {
      }
      return !!video.muted;
    }
    function isMutedForDisplay(video) {
      const savedMute = Date.now() <= startupLockUntil ? readSavedMute() : null;
      return savedMute ?? isMuted(video);
    }
    function setMuted(video, muted) {
      const nextMuted = !!muted;
      if (!nextMuted) {
        stopStartupMuteGuard();
      }
      try {
        const api = getTwitchPlayerApi(video);
        if (api && api.setMuted) {
          nativeMuteOwners.delete(video);
          api.setMuted(nextMuted);
          setNativeVideoMuted(video, nextMuted);
          return;
        }
      } catch (e) {
      }
      nativeMuteOwners.add(video);
      setNativeVideoMuted(video, nextMuted);
    }
    function toggleMute(video) {
      setMuted(video, !isMutedForDisplay(video));
    }
    function restoreSavedVolume(video) {
      const savedMute = readSavedMute();
      const wasMuted = savedMute === null ? isMuted(video) : savedMute;
      if (savedMute === true) {
        setMuted(video, true);
      }
      const value = getSavedVolume();
      if (value !== null) {
        setVolume(video, value, { preserveMute: wasMuted });
      }
      setMuted(video, wasMuted);
      if (wasMuted) {
        startStartupMuteGuard(video);
      }
    }
    function readSavedMute() {
      try {
        const savedMute = localStorage.getItem(MUTE_STORAGE_KEY);
        if (savedMute === "true") return true;
        if (savedMute === "false") return false;
      } catch (e) {
      }
      return null;
    }
    function restoreSavedVolumeBeforeControls(video = getVideoElement()) {
      if (!video) return false;
      startupLockUntil = Math.max(startupLockUntil, Date.now() + 2e3);
      restoreSavedVolume(video);
      return true;
    }
    function stopStartupMuteGuard() {
      stopActiveStartupMuteGuard?.();
      stopActiveStartupMuteGuard = null;
    }
    function startStartupMuteGuard(video) {
      if (!shouldHoldSavedMute(video)) return;
      stopStartupMuteGuard();
      const guardUntil = Math.max(startupLockUntil, Date.now() + STARTUP_MUTE_GUARD_MS);
      const enforceSavedMute = () => {
        if (Date.now() > guardUntil || !shouldHoldSavedMute(video)) {
          stopStartupMuteGuard();
          return;
        }
        try {
          const api = getTwitchPlayerApi(video);
          if (api?.setMuted && (!api.isMuted || !api.isMuted())) {
            api.setMuted(true);
          }
        } catch (e) {
        }
        if (!video.muted || !video.defaultMuted) {
          setNativeVideoMuted(video, true);
        }
      };
      const timer = window.setInterval(enforceSavedMute, STARTUP_MUTE_GUARD_INTERVAL_MS);
      stopActiveStartupMuteGuard = () => {
        window.clearInterval(timer);
      };
      enforceSavedMute();
    }
    function shouldHoldSavedMute(video) {
      return !!video?.isConnected && readSavedMute() === true && Date.now() > userIntentUntil;
    }
    function saveMute(muted) {
      try {
        localStorage.setItem(MUTE_STORAGE_KEY, muted ? "true" : "false");
      } catch (e) {
      }
    }
    function markUserVolumeIntent() {
      cancelDelayedFirstAttachRestore();
      stopStartupMuteGuard();
      userIntentUntil = Date.now() + USER_INTENT_GRACE_MS;
    }
    function setSliderFromPlayer(slider, label, video) {
      try {
        const muted = isMutedForDisplay(video);
        const displayValue = getUnderlyingVolume(video);
        slider.value = String(displayValue);
        if (label) {
          label.textContent = muted ? "Muted" : `${displayValue}%`;
        }
        updateSliderBar(slider);
        updateVolumeIndicator(document.getElementById(OVERLAY_ID), displayValue, muted);
      } catch (e) {
      }
    }
    function ensureOptionsStyles() {
      installOptionsStyles({
        document,
        platform: "twitch",
        styleId: OPTIONS_STYLE_ID,
        optionsButtonId: OPTIONS_BUTTON_ID,
        optionsPopupId: OPTIONS_POPUP_ID,
        accentDark: VOLUME_ACCENT_DARK
      });
    }
    function updateOptionsButtonState(btn = document.getElementById(OPTIONS_BUTTON_ID)) {
      if (!btn) return;
      const mode = getVolumeSliderMode();
      const label = "Volume Slider Options";
      if (btn.dataset.tmVolumeMode !== mode) {
        btn.dataset.tmVolumeMode = mode;
      }
      if (btn.getAttribute("aria-label") !== label) {
        btn.setAttribute("aria-label", label);
      }
      if (btn.dataset.tmTooltip !== label) {
        btn.dataset.tmTooltip = label;
      }
      if (btn.hasAttribute("title")) {
        btn.removeAttribute("title");
      }
    }
    function injectVolumeOptionsButton() {
      ensureOptionsStyles();
      const player = getPlayerContainer();
      if (isTwitchPreviewPlayer(player)) {
        removeVolumeOptionsButton();
        return;
      }
      const host = getTwitchRightControlsHost(player || void 0);
      const settingsWrapper = getTwitchSettingsWrapper(host);
      const settingsBtn = getTwitchSettingsButton(host);
      if (!host || !settingsWrapper || !settingsBtn) return;
      ensureNativeSettingsHoldIsolation();
      let wrapper = document.getElementById(`${OPTIONS_BUTTON_ID}-wrapper`);
      if (wrapper && wrapper.parentElement === host && wrapper.nextElementSibling === settingsWrapper) {
        updateOptionsButtonState();
        return;
      }
      if (wrapper && wrapper.querySelector(`#${OPTIONS_BUTTON_ID}`)) {
        host.insertBefore(wrapper, settingsWrapper);
        updateOptionsButtonState();
        return;
      }
      wrapper?.remove();
      wrapper = document.createElement("div");
      wrapper.id = `${OPTIONS_BUTTON_ID}-wrapper`;
      wrapper.className = "InjectLayout-sc-1i43xsx-0 iDMNUO";
      const inner = document.createElement("div");
      inner.className = "Layout-sc-1xcs6mc-0 ScLayoutCssVars-sc-1pn65j5-0 jfyitl kDsKkP";
      const btn = document.createElement("button");
      btn.id = OPTIONS_BUTTON_ID;
      btn.type = "button";
      btn.className = settingsBtn.className || "ScCoreButton-sc-ocjdkq-0 ScButtonIcon-sc-9yap0r-0";
      btn.setAttribute("aria-haspopup", "true");
      btn.setAttribute("aria-expanded", "false");
      const figure = document.createElement("div");
      figure.className = "ButtonIconFigure-sc-1emm8lf-0 lnTwMD";
      const svgWrap = document.createElement("div");
      svgWrap.className = "ScSvgWrapper-sc-wkgzod-0 kccyMt tw-svg";
      svgWrap.appendChild(createOptionsButtonIconSvg(document));
      figure.appendChild(svgWrap);
      btn.appendChild(figure);
      updateOptionsButtonState(btn);
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleVolumeOptionsPopup();
      });
      inner.appendChild(btn);
      wrapper.appendChild(inner);
      host.insertBefore(wrapper, settingsWrapper);
    }
    function isOptionsButtonInPreferredSlot() {
      const host = getTwitchRightControlsHost();
      const settingsWrapper = getTwitchSettingsWrapper(host);
      const wrapper = document.getElementById(`${OPTIONS_BUTTON_ID}-wrapper`);
      return !!(host && settingsWrapper && wrapper && wrapper.parentElement === host && wrapper.nextElementSibling === settingsWrapper);
    }
    function removeVolumeOptionsButton() {
      document.getElementById(`${OPTIONS_BUTTON_ID}-wrapper`)?.remove();
      closeVolumeOptionsPopup();
    }
    let optionsPopupOutsideHandler = null;
    let optionsPopupKeyboardCleanup = null;
    let optionsPopupRepositionHandler = null;
    let optionsPopupOpener = null;
    let optionsPostCloseOutsideHandler = null;
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
      const overlayHost = getVideoOverlayContainer(void 0, player);
      if (!overlayHost) return null;
      let popup = getOptionsPopup();
      if (!popup || !popup.isConnected) {
        closeVolumeOptionsPopup();
        popup?.remove();
        popup = buildOptionsPopup();
        ensurePlayerPositioning(overlayHost);
        overlayHost.appendChild(popup);
      }
      return popup;
    }
    function positionOptionsPopup(popup, resetScroll = false) {
      const btn = document.getElementById(OPTIONS_BUTTON_ID);
      const player = getPlayerContainer();
      const overlayHost = getVideoOverlayContainer(void 0, player);
      if (!btn || !overlayHost || !popup) return;
      const playerRect = overlayHost.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const bottomPx = playerRect.bottom - btnRect.top + 8;
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
    function hideTwitchControls() {
      const controlsRoot = getTwitchPlayerControlsRoot();
      const controlsShell = getTwitchPlayerControlsShell();
      const controls = getTwitchPlayerControlsSection();
      if (controlsShell) {
        controlsShell.setAttribute("aria-hidden", "true");
      }
      if (controlsRoot) {
        controlsRoot.setAttribute("data-a-visible", "false");
        controlsRoot.setAttribute("aria-hidden", "true");
      }
      if (controls) {
        controls.setAttribute("aria-hidden", "true");
      }
    }
    function isPointerOverTwitchPlayerArea() {
      const player = getPlayerContainer();
      const controlsRoot = getTwitchPlayerControlsRoot();
      return !!(player?.matches?.(":hover") || controlsRoot?.matches?.(":hover"));
    }
    function isClickOutsideTwitchPlayerArea(event) {
      const target = event.target;
      if (getPlayerContainer()?.contains?.(target)) return false;
      if (getTwitchPlayerControlsRoot()?.contains?.(target)) return false;
      return true;
    }
    function isTwitchVideoSurfaceClick(event) {
      const target = event.target;
      const player = getPlayerContainer();
      if (!target || !player?.contains?.(target)) return false;
      return !target.closest?.(
        '[data-a-target="player-controls"], button, a, input, select, textarea, [role="button"], [role="slider"], [role="menuitem"]'
      );
    }
    function startKeyboardControlsHold() {
      controlsVisibility.hold("keyboard-volume", KEYBOARD_CONTROLS_HOLD_MS);
    }
    function startOptionsControlsHold() {
      controlsVisibility.hold("options");
    }
    function stopOptionsControlsHold() {
      controlsVisibility.release("options");
    }
    function clearPostCloseControlsHold() {
      controlsVisibility.release("post-close");
      if (optionsPostCloseOutsideHandler) {
        document.removeEventListener("click", optionsPostCloseOutsideHandler, true);
        optionsPostCloseOutsideHandler = null;
      }
    }
    function endPostCloseControlsHold(hideControls) {
      clearPostCloseControlsHold();
      if (hideControls && !isNativeSettingsMenuOpen()) {
        hideTwitchControls();
      }
    }
    function startPostCloseControlsHold() {
      if (isNativeSettingsMenuOpen()) return;
      clearPostCloseControlsHold();
      controlsVisibility.hold("post-close", TWITCH_CONTROLS_OUTSIDE_CLOSE_HOLD_MS, () => {
        endPostCloseControlsHold(!isPointerOverTwitchPlayerArea());
      });
      optionsPostCloseOutsideHandler = (event) => {
        if (isClickOnNativeSettingsUi(event)) return;
        if (!isClickOutsideTwitchPlayerArea(event)) return;
        endPostCloseControlsHold(true);
      };
      document.addEventListener("click", optionsPostCloseOutsideHandler, true);
    }
    function markTwitchVolumeInteraction(overlay) {
      markVolumeChangedWhileExpanded(overlay);
      startPostCloseControlsHold();
    }
    function releaseTwitchVolumeFocusSoon(overlay) {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && overlay?.contains?.(active) && !active.matches(":focus-visible")) {
          active.blur();
        }
      }, 0);
    }
    function openVolumeOptionsPopup() {
      clearPostCloseControlsHold();
      ensureOptionsStyles();
      const popup = ensureOptionsPopup();
      if (!popup) return;
      optionsPopupOpener = document.activeElement;
      refreshOptionsPopupState();
      popup.removeAttribute("hidden");
      positionOptionsPopup(popup, true);
      startOptionsControlsHold();
      document.getElementById(OPTIONS_BUTTON_ID)?.setAttribute("aria-expanded", "true");
      popup.focus({ preventScroll: true });
      if (!optionsPopupOutsideHandler) {
        optionsPopupOutsideHandler = (event) => {
          const btn = document.getElementById(OPTIONS_BUTTON_ID);
          if (popup.contains(event.target) || btn?.contains(event.target)) return;
          if (event.target?.closest?.(TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR)) {
            window.setTimeout(() => closeVolumeOptionsPopup(), 0);
            return;
          }
          const clickedOutsideControls = !getTwitchPlayerControlsRoot()?.contains?.(event.target);
          closeVolumeOptionsPopup();
          if (clickedOutsideControls) startPostCloseControlsHold();
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
    function setupNativeSettingsCloseHandler() {
      if (window.__tmTwitchVolumeNativeSettingsCloseBound) return;
      window.__tmTwitchVolumeNativeSettingsCloseBound = true;
      document.addEventListener("click", (event) => {
        if (event.target?.closest?.(TWITCH_NATIVE_SETTINGS_BUTTON_SELECTOR)) {
          window.setTimeout(() => closeVolumeOptionsPopup(), 0);
        }
      }, false);
      ensureNativeSettingsHoldIsolation();
    }
    function disconnectNativeSettingsObserver() {
      nativeSettingsObserver?.disconnect();
      nativeSettingsObserver = null;
      nativeSettingsObserverTarget = null;
    }
    function ensureNativeSettingsHoldIsolation() {
      const settingsBtn = getTwitchSettingsButton();
      if (!settingsBtn) return;
      if (nativeSettingsObserverTarget === settingsBtn) return;
      disconnectNativeSettingsObserver();
      nativeSettingsObserverTarget = settingsBtn;
      nativeSettingsObserver = new MutationObserver(() => {
        if (isNativeSettingsMenuOpen()) {
          endPostCloseControlsHold(false);
        }
      });
      nativeSettingsObserver.observe(settingsBtn, { attributes: true, attributeFilter: ["aria-expanded"] });
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
      overlay._tmVolumeVideo = video;
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
        releaseTwitchVolumeFocusSoon(overlay);
      });
      overlay.addEventListener("mouseleave", () => {
        overlay.dataset.tmHovering = "false";
        collapseOverlayIfIdle(overlay);
        updateOverlayOpacity(overlay);
      });
      overlay.addEventListener("focusin", () => {
        setOverlayExpanded(overlay, true);
        updateOverlayOpacity(overlay);
      });
      overlay.addEventListener("focusout", () => {
        collapseOverlayIfIdle(overlay);
        updateOverlayOpacity(overlay);
      });
      const collapseHeldSliderOnVideoClick = (event) => {
        if (overlay.dataset.tmKeepExpanded !== "true" || !isTwitchVideoSurfaceClick(event)) return;
        clearExpandedHold(overlay);
        setOverlayExpanded(overlay, false);
      };
      cleanupRegistry.listen(document, "click", collapseHeldSliderOnVideoClick, true);
      const { iconCell, topRow, label, tickOverlay, slider } = createVolumeControlElements({
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
        markUserVolumeIntent();
        toggleMute(video);
        saveMute(isMuted(video));
        setSliderFromPlayer(slider, label, video);
        markTwitchVolumeInteraction(overlay);
        releaseTwitchVolumeFocusSoon(overlay);
      });
      topRow.style.display = "flex";
      topRow.style.alignItems = "center";
      topRow.style.gap = "0";
      topRow.style.flex = "0 0 auto";
      topRow.style.position = "relative";
      topRow.style.width = `${VOLUME_LABEL_ROW_WIDTH_PX}px`;
      topRow.style.height = "40px";
      topRow.style.boxSizing = "border-box";
      Object.assign(label.style, {
        font: '500 14px/40px "YouTube Noto", Roboto, Arial, Helvetica, sans-serif',
        color: "#fff",
        textAlign: "center",
        textShadow: "0 0 2px rgb(0, 0, 0)",
        userSelect: "none",
        letterSpacing: "0",
        position: "absolute",
        left: "0",
        top: "0",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap"
      });
      const syncInitialSliderState = (value, muted = false) => {
        syncVolumeControl({ slider, label, overlay, value, muted, updateSliderBar, updateVolumeIndicator });
      };
      const initVol = getSavedVolume();
      if (readSavedMute() === null) saveMute(isMuted(video));
      if (initVol !== null) {
        syncInitialSliderState(initVol, isMutedForDisplay(video));
      } else {
        syncInitialSliderState(getUnderlyingVolume(video), isMutedForDisplay(video));
      }
      const applySliderValue = (value, { preserveMute = false, markInteraction = true } = {}) => {
        setVolume(video, value, { preserveMute });
        const muted = preserveMute ? isMutedForDisplay(video) : isMuted(video);
        saveMute(muted);
        label.textContent = muted ? "Muted" : `${value}%`;
        updateSliderBar(slider);
        updateVolumeIndicator(overlay, value, muted);
        scheduleSaveVolume(value);
        if (markInteraction) markTwitchVolumeInteraction(overlay);
      };
      const applyKeyboardVolumeStep = (event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        const currentValue = getUnderlyingVolume(video);
        const nextValue = clampVolume(currentValue + direction * KEYBOARD_VOLUME_STEP);
        if (nextValue !== currentValue) {
          markUserVolumeIntent();
          slider.value = String(nextValue);
          applySliderValue(nextValue, { preserveMute: true, markInteraction: false });
          startKeyboardControlsHold();
        }
        keyboardFeedback.show(nextValue, isMutedForDisplay(video));
      };
      slider.addEventListener("keydown", applyKeyboardVolumeStep);
      let playerWasLastPressed = false;
      const trackLastPressedArea = (event) => {
        const activePlayer = getPlayerContainer(video) || player;
        playerWasLastPressed = !!activePlayer?.contains?.(event.target);
      };
      document.addEventListener("pointerdown", trackLastPressedArea, true);
      const applyPlayerKeyboardVolumeStep = (event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (isOptionsPopupOpen()) return;
        const target = event.target;
        if (target instanceof window.Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const activePlayer = getPlayerContainer(video) || player;
        if (!playerWasLastPressed && !activePlayer?.contains?.(document.activeElement)) return;
        applyKeyboardVolumeStep(event);
      };
      document.addEventListener("keydown", applyPlayerKeyboardVolumeStep, true);
      const onExtensionKey = (event) => {
        const key = focusedTwitchExtensionKey(event, getPlayerContainer(video) || player);
        if (!key || isOptionsPopupOpen()) return;
        if (key === " ") {
          keyboardFeedback.clear();
          if (video.paused) {
            video.play().catch(() => {
            });
          } else {
            video.pause();
          }
        } else {
          applyKeyboardVolumeStep({ key, preventDefault() {
          }, stopPropagation() {
          } });
        }
      };
      window.addEventListener("message", onExtensionKey);
      cleanupRegistry.add(() => window.removeEventListener("message", onExtensionKey));
      cleanupRegistry.add(bindWheelVolumeStep({
        target: iconCell,
        slider,
        getVolumeStep,
        beforeApply: () => markUserVolumeIntent(),
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
        collapseIfIdle: () => collapseOverlayIfIdle(overlay),
        onFinish: (event, wasDragging) => {
          if (wasDragging && event?.type !== "blur") releaseTwitchVolumeFocusSoon(overlay);
        },
        finishLayout: () => {
          collapseOverlayIfIdle(overlay);
          updateOverlayOpacity(overlay);
        }
      });
      cleanupRegistry.add(() => rangePointer.dispose());
      slider.addEventListener("input", () => {
        markUserVolumeIntent();
        applySliderValue(rangePointer.readPressAwareValue());
      });
      slider.addEventListener("change", () => {
        markUserVolumeIntent();
        applySliderValue(readSteppedSliderValue(slider));
        cancelScheduledSaveVolume();
        saveVolume(Number(slider.value) || 0);
        releaseTwitchVolumeFocusSoon(overlay);
      });
      const onVideoVolumeChange = () => {
        const now = Date.now();
        if (now <= startupLockUntil) {
          if (now > userIntentUntil && !startupCorrectionApplied) {
            const savedValue = getSavedVolume();
            const muted = isMuted(video);
            if (savedValue !== null && Math.abs(getUnderlyingVolume(video) - savedValue) > 1) {
              setVolume(video, savedValue, { preserveMute: muted });
            }
            startupCorrectionApplied = true;
          }
          setSliderFromPlayer(slider, label, video);
          return;
        }
        try {
          const muted = isMuted(video);
          const playerVolume = getVolume(video);
          const savedValue = getSavedVolume();
          if (isNativeVolumeReplacementEnabled() && now > userIntentUntil && savedValue !== null && Math.abs(playerVolume - savedValue) > 1) {
            cancelScheduledSaveVolume();
            setVolume(video, savedValue, { preserveMute: muted });
            if (!isNormalizationEnabled()) saveMute(muted);
            setSliderFromPlayer(slider, label, video);
            return;
          }
          setSliderFromPlayer(slider, label, video);
          if (!isNormalizationEnabled()) saveMute(muted);
          if (!muted) {
            scheduleSaveVolume(playerVolume);
          }
        } catch (e) {
        }
      };
      video.addEventListener("volumechange", onVideoVolumeChange);
      let sourceMutePending = false;
      const onSourceReset = () => {
        if (!isNormalizationEnabled()) return;
        const savedMute = readSavedMute();
        if (savedMute === null) return;
        sourceMutePending = true;
        startupLockUntil = Math.max(startupLockUntil, Date.now() + 2e3);
        startupCorrectionApplied = false;
      };
      const onSourceReady = (event) => {
        if (!isNormalizationEnabled() || event.type === "playing" && !sourceMutePending) return;
        const savedMute = readSavedMute();
        if (savedMute !== null) setMuted(video, savedMute);
        sourceMutePending = event.type !== "playing";
      };
      for (const type of ["emptied", "loadstart"]) video.addEventListener(type, onSourceReset, true);
      for (const type of ["loadedmetadata", "playing"]) video.addEventListener(type, onSourceReady);
      cleanupRegistry.add(() => {
        for (const type of ["emptied", "loadstart"]) video.removeEventListener(type, onSourceReset, true);
        for (const type of ["loadedmetadata", "playing"]) video.removeEventListener(type, onSourceReady);
      });
      cleanupRegistry.add(bindNativeVolumeInput({
        window,
        video,
        player,
        selector: '[data-a-target="player-volume-slider"]',
        excludeSelector: '[data-a-target="player-mute-unmute-button"]',
        normalizer,
        onChange: () => {
          markUserVolumeIntent();
          saveMute(isMuted(video));
          onVideoVolumeChange();
        }
      }));
      const onNativeMuteInput = (event) => {
        if (isOptionsPopupOpen() || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (!(target instanceof window.Element) || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
        const activePlayer = getPlayerContainer(video) || player;
        const muteButton = event.type === "click" && target.closest('[data-a-target="player-mute-unmute-button"]') && activePlayer.contains(target);
        const muteKey = event.type === "keydown" && event.key.toLowerCase() === "m";
        if (!muteButton && !muteKey) return;
        const before = isMuted(video);
        markUserVolumeIntent();
        window.setTimeout(() => {
          if (!overlayLifecycle.owns(overlay) || !video.isConnected) return;
          saveMute(isMuted(video));
          setSliderFromPlayer(slider, label, video);
          if (muteKey && before !== isMuted(video)) keyboardFeedback.showMute(getUnderlyingVolume(video), isMuted(video));
        }, 0);
      };
      for (const type of ["click", "keydown"]) document.addEventListener(type, onNativeMuteInput, true);
      cleanupRegistry.add(() => {
        for (const type of ["click", "keydown"]) document.removeEventListener(type, onNativeMuteInput, true);
      });
      const onLayoutChange = () => {
        if (!overlay.isConnected) return;
        const activePlayer = getPlayerContainer(video);
        if (areTwitchControlsHidden(activePlayer)) {
          if (isSliderOnVideo()) {
            updateVideoOverlayPosition(overlay, getVideoOverlayContainer(video, activePlayer), activePlayer);
          }
          if (isOverlayInteractionFocused(overlay)) {
            updateOverlayOpacity(overlay);
            return;
          }
          if (!isAlwaysExpandedEnabled()) {
            clearExpandedHold(overlay);
            setOverlayExpanded(overlay, false, true);
          }
          updateOverlayOpacity(overlay);
          return;
        }
        if (isOverlayInteractionFocused(overlay)) return;
        placeOverlay(overlay, activePlayer, getTwitchControlsHost(activePlayer));
      };
      window.addEventListener("resize", onLayoutChange);
      const controlsObserver = new MutationObserver(onLayoutChange);
      const controlsRootForLayout = getTwitchPlayerControlsRoot(player);
      const controlsForLayout = getTwitchPlayerControlsSection(player);
      if (controlsRootForLayout) {
        controlsObserver.observe(controlsRootForLayout, { attributes: true, attributeFilter: ["data-a-visible", "class", "aria-hidden", "style"] });
      }
      if (controlsForLayout) {
        controlsObserver.observe(controlsForLayout, { attributes: true, attributeFilter: ["class", "aria-hidden", "style"] });
      }
      updateOverlayAppearance(overlay);
      placeOverlay(overlay, player, controlsHost);
      setSliderFromPlayer(slider, label, video);
      setOverlayExpanded(overlay, false, true);
      updateSliderThickness(overlay);
      const cleanup = () => {
        video.removeEventListener("volumechange", onVideoVolumeChange);
        window.removeEventListener("resize", onLayoutChange);
        document.removeEventListener("keydown", applyPlayerKeyboardVolumeStep, true);
        document.removeEventListener("pointerdown", trackLastPressedArea, true);
        controlsObserver.disconnect();
        cleanupRegistry.dispose();
        controlsVisibility.dispose();
        controlsVisibility = makeControlsVisibilityManager();
        if (optionsPostCloseOutsideHandler) {
          document.removeEventListener("click", optionsPostCloseOutsideHandler, true);
          optionsPostCloseOutsideHandler = null;
        }
        clearExpandedHold(overlay);
      };
      overlayLifecycle.set(overlay, cleanup);
      return overlay;
    }
    function disposeActiveOverlay() {
      normalizer.bind(null);
      stopOptionsPreview();
      cancelDelayedFirstAttachRestore();
      overlayLifecycle.dispose();
      cachedApi = null;
      cachedApiFromElement = null;
    }
    function removeOverlay() {
      cancelScheduledSaveVolume();
      disposeActiveOverlay();
      document.getElementById(OVERLAY_ID)?.remove();
      applyNativeVolumeVisibility();
    }
    function cancelDelayedFirstAttachRestore() {
      if (!delayedFirstAttachRestoreTimer) return;
      window.clearTimeout(delayedFirstAttachRestoreTimer);
      delayedFirstAttachRestoreTimer = 0;
    }
    function attachSliderIfPossible() {
      resetVideoElement();
      const video = getVideoElement();
      const player = getPlayerContainer(video);
      const controlsHost = getTwitchControlsHost(player);
      if (isTwitchPreviewPlayer(player)) {
        removeOverlay();
        removeVolumeOptionsButton();
        return true;
      }
      if (!isOverlayEnabled()) {
        removeOverlay();
        injectVolumeOptionsButton();
        return !!document.getElementById(OPTIONS_BUTTON_ID);
      }
      if (overlayLifecycle.active && !overlayLifecycle.active.root.isConnected) disposeActiveOverlay();
      let overlay = document.getElementById(OVERLAY_ID);
      if (overlay && overlay._tmVolumeVideo !== video) {
        disposeActiveOverlay();
        overlay = null;
      }
      if (!overlay && video && !normalizer.isBoundTo(video)) {
        restoreSavedVolumeBeforeControls(video);
        if (isNormalizationEnabled()) syncNormalization(video);
      }
      if (!video || !player || !controlsHost) {
        injectVolumeOptionsButton();
        return false;
      }
      if (!overlay) {
        startupLockUntil = Math.max(startupLockUntil, Date.now() + 2e3);
        restoreSavedVolume(video);
        const createdOverlay = createOverlay(video, player, controlsHost);
        createdOverlay._tmVolumeVideo = video;
        cancelDelayedFirstAttachRestore();
        delayedFirstAttachRestoreTimer = window.setTimeout(() => {
          delayedFirstAttachRestoreTimer = 0;
          if (!overlayLifecycle.owns(createdOverlay) || !createdOverlay.isConnected || createdOverlay._tmVolumeVideo !== video || !video.isConnected) return;
          restoreSavedVolume(video);
          updateOverlayOpacity(createdOverlay);
        }, 1500);
      } else if (!isOverlayInteractionFocused(overlay)) {
        placeOverlay(overlay, player, controlsHost);
      } else {
        updateOverlayOpacity(overlay);
      }
      applyNativeVolumeVisibility();
      injectVolumeOptionsButton();
      ensureNativeSettingsHoldIsolation();
      ensureAttachObserver();
      syncNormalization();
      return true;
    }
    function getAttachObserverRoot() {
      return document.body;
    }
    function mutationAddsVideo(mutations) {
      return mutations.some((mutation) => [...mutation.addedNodes].some(
        (node) => node.nodeName === "VIDEO" || !!node.querySelector?.("video")
      ));
    }
    let lastAttach = 0;
    const ATTACH_COOLDOWN_MS = 1e3;
    let attachFrame = 0;
    let trailingAttachTimer = 0;
    function finishPendingAttach() {
      trailingAttachTimer = 0;
      resetVideoElement();
      if (attachSliderIfPossible()) lastAttach = Date.now();
    }
    function handleAttachObserverMutations(mutations) {
      syncTwitchAudioCompatibility(window, getVideoElement(), mutations);
      const playerSelector = '.video-player,[data-a-target="video-player"],[data-a-target="player-overlay-click-handler"]';
      const relevant = mutations.some(({ target, addedNodes, removedNodes }) => {
        if (!addedNodes.length && !removedNodes.length) return false;
        if (target.nodeType === 1 && target.closest("#tm-volume-slider-overlay,#tm-volume-options-popup,[data-tm-volume-feedback]")) return false;
        if (target.nodeType === 1 && target.closest(playerSelector)) return true;
        return [...addedNodes, ...removedNodes].some((node) => node.nodeType === 1 && (node.matches(playerSelector + ",video") || node.querySelector(playerSelector + ",video")));
      });
      if (!relevant) return;
      const videoAdded = mutationAddsVideo(mutations);
      if (videoAdded && isOverlayEnabled() && isNormalizationEnabled()) {
        resetVideoElement();
        const video = getVideoElement();
        if (video && !normalizer.isBoundTo(video) && attachSliderIfPossible()) {
          lastAttach = Date.now();
          return;
        }
      }
      applyNativeVolumeVisibility();
      const overlay = document.getElementById(OVERLAY_ID);
      const button = document.getElementById(OPTIONS_BUTTON_ID);
      const overlayMissing = isOverlayEnabled() && (!overlay || !overlay.isConnected);
      const videoMayHaveChanged = isOverlayEnabled() && !!overlay && videoAdded;
      const buttonMissing = !button || !button.isConnected;
      const buttonMisplaced = !buttonMissing && !isOptionsButtonInPreferredSlot();
      if (buttonMissing || buttonMisplaced) {
        injectVolumeOptionsButton();
      }
      if (!overlayMissing && !videoMayHaveChanged) return;
      if (attachFrame || trailingAttachTimer) return;
      attachFrame = requestAnimationFrame(() => {
        attachFrame = 0;
        const remaining = ATTACH_COOLDOWN_MS - (Date.now() - lastAttach);
        if (remaining > 0) trailingAttachTimer = window.setTimeout(finishPendingAttach, remaining);
        else finishPendingAttach();
      });
    }
    function disconnectAttachObserver() {
      window.cancelAnimationFrame(attachFrame);
      window.clearTimeout(trailingAttachTimer);
      attachFrame = trailingAttachTimer = 0;
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
      const maxAttempts = 20;
      const delayMs = 500;
      const attemptAttach = (attempt) => {
        if (attachSliderIfPossible() || attempt >= maxAttempts) return;
        window.setTimeout(() => attemptAttach(attempt + 1), delayMs);
      };
      attemptAttach(0);
    }
    function setupPlayerBoundaryResizeHandler() {
      window.addEventListener("resize", () => {
        if (playerBoundaryResizeFrame) return;
        playerBoundaryResizeFrame = window.requestAnimationFrame(() => {
          playerBoundaryResizeFrame = 0;
          resetVideoElement();
          attachSliderIfPossible();
          applyNativeVolumeVisibility();
        });
      }, true);
    }
    function setupNavigationHandler() {
      if (window.__tmTwitchVolumeNavPatched) return;
      window.__tmTwitchVolumeNavPatched = true;
      const getPathFromUrlArg = (urlArg) => {
        try {
          if (urlArg === void 0 || urlArg === null || urlArg === "") {
            return window.location.pathname;
          }
          return new URL(String(urlArg), window.location.href).pathname;
        } catch (e) {
          return window.location.pathname;
        }
      };
      const runReattach = () => {
        if (navReattachTimer) {
          clearTimeout(navReattachTimer);
          navReattachTimer = 0;
        }
        if (navLateRestoreTimer) {
          clearTimeout(navLateRestoreTimer);
          navLateRestoreTimer = 0;
        }
        cachedApi = null;
        cachedApiFromElement = null;
        resetVideoElement();
        closeVolumeOptionsPopup();
        controlsVisibility.dispose();
        controlsVisibility = makeControlsVisibilityManager();
        disconnectNativeSettingsObserver();
        disconnectAttachObserver();
        startupLockUntil = Date.now() + 3500;
        startupCorrectionApplied = false;
        navReattachTimer = window.setTimeout(() => {
          removeOverlay();
          removeVolumeOptionsButton();
          attachSliderIfPossible();
          navReattachTimer = 0;
        }, NAV_REATTACH_DELAY_MS);
        navLateRestoreTimer = window.setTimeout(() => {
          navLateRestoreTimer = 0;
          if (Date.now() <= userIntentUntil) return;
          const vid = getVideoElement();
          if (!vid) return;
          if (isTwitchPreviewPlayer(getPlayerContainer(vid))) return;
          const saved = getSavedVolume();
          if (saved !== null && Math.abs(getVolume(vid) - saved) > 1) {
            restoreSavedVolume(vid);
            const sliderEl = document.getElementById(SLIDER_ID);
            const labelEl = document.getElementById(VALUE_LABEL_ID);
            if (sliderEl) setSliderFromPlayer(sliderEl, labelEl, vid);
          }
        }, NAV_LATE_RESTORE_DELAY_MS);
      };
      const scheduleReattachIfPathChanged = (nextPath) => {
        const targetPath = nextPath || window.location.pathname;
        if (targetPath === lastKnownPath) return;
        lastKnownPath = targetPath;
        if (navDebounceTimer) {
          clearTimeout(navDebounceTimer);
          navDebounceTimer = 0;
        }
        navDebounceTimer = window.setTimeout(() => {
          navDebounceTimer = 0;
          runReattach();
        }, NAV_DEBOUNCE_MS);
      };
      const originalPushState = history.pushState;
      history.pushState = function() {
        const result = originalPushState.apply(this, arguments);
        scheduleReattachIfPathChanged(getPathFromUrlArg(arguments[2]));
        return result;
      };
      const originalReplaceState = history.replaceState;
      history.replaceState = function() {
        const result = originalReplaceState.apply(this, arguments);
        scheduleReattachIfPathChanged(getPathFromUrlArg(arguments[2]));
        return result;
      };
      window.addEventListener("popstate", () => {
        scheduleReattachIfPathChanged(window.location.pathname);
      }, true);
    }
    function init() {
      setupInitialAttempts();
      setupAttachObserver();
      setupPlayerBoundaryResizeHandler();
      setupNavigationHandler();
      setupNativeSettingsCloseHandler();
    }
    init();
  }

  // src/entries/twitch.user.js
  if (location.hostname.endsWith(".ext-twitch.tv")) startTwitchExtensionKeys(window);
  else startTwitchVolumeSlider();
})();
