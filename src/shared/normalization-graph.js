import { NORMALIZATION_PROFILE } from './normalization-gain.js';

const GAIN_DB_RANGE = 60;
let curves;

function controlCurves() {
  if (curves) return curves;
  const sample = (count, fn) => Float32Array.from({ length: count }, (_, i) => fn(i / (count - 1) * 2 - 1));
  const peak = 10 ** (NORMALIZATION_PROFILE.peakDb / 20);
  const energy = 10 ** ((NORMALIZATION_PROFILE.targetLufs + .691 + NORMALIZATION_PROFILE.energyHeadroomLu) / 10);
  curves = {
    absolute: new Float32Array([1, 0, 1]),
    square: sample(4097, x => x * x),
    peak: sample(65537, x => x > peak / 4 ? Math.min(1, 20 * Math.log10(x * 4 / peak) / GAIN_DB_RANGE) : 0),
    energy: sample(131073, x => x > energy / 16 ? Math.min(1, 10 * Math.log10(x * 16 / energy) / GAIN_DB_RANGE) : 0),
    gain: sample(4097, x => 10 ** (-Math.max(0, x) * GAIN_DB_RANGE / 20))
  };
  return curves;
}

// Audible PCM passes only through delay and gain. All nonlinear nodes operate on
// control signals, so no worklet or page-thread packet scheduling is required.
export function createNativeGainGraph(context, { selected = .3 } = {}) {
  const rate = context.sampleRate, nodes = [], tables = controlCurves();
  const own = node => { nodes.push(node); return node; };
  function gain(value, mono = true) {
    const node = own(context.createGain()); node.gain.value = value;
    if (mono) { node.channelCount = 1; node.channelCountMode = 'explicit'; }
    return node;
  }
  function shape(curve, mono = true) {
    const node = own(context.createWaveShaper()); node.curve = curve;
    if (mono) { node.channelCount = 1; node.channelCountMode = 'explicit'; }
    return node;
  }
  // max(a,b) = (a + b + abs(a - b)) / 2, evaluated by the audio renderer.
  function maximum(a, b) {
    const negative = gain(-1), absolute = shape(tables.absolute), out = gain(.5);
    b.connect(negative); negative.connect(absolute); a.connect(absolute);
    a.connect(out); b.connect(out); absolute.connect(out);
    return out;
  }
  function delay(input, samples) {
    const node = own(context.createDelay(.1)); node.delayTime.value = samples / rate; input.connect(node); return node;
  }
  const programme = gain(0, false);
  programme.channelCount = 2; programme.channelCountMode = 'explicit'; programme.channelInterpretation = 'speakers';

  // BS.1770 K weighting matches the shared meter. It does not EQ audible PCM.
  const k = Math.tan(Math.PI * 1681.974450955533 / rate), q = .7071752369554196;
  const high = 10 ** (3.999843853973347 / 20), middle = high ** .4996667741545416, denominator = 1 + k / q + k * k;
  const shelf = own(context.createIIRFilter([
    (high + middle * k / q + k * k) / denominator, 2 * (k * k - high) / denominator,
    (high - middle * k / q + k * k) / denominator
  ], [1, 2 * (k * k - 1) / denominator, (1 - k / q + k * k) / denominator]));
  const h = Math.tan(Math.PI * 38.13547087602444 / rate), highPassDenominator = 1 + h / .5003270373238773 + h * h;
  const highPass = own(context.createIIRFilter([1, -2, 1], [1, 2 * (h * h - 1) / highPassDenominator,
    (1 - h / .5003270373238773 + h * h) / highPassDenominator]));
  programme.connect(shelf); shelf.connect(highPass);
  const scale = gain(.25, false), square = shape(tables.square, false), sum = gain(2);
  highPass.connect(scale); scale.connect(square); square.connect(sum);
  const energy = own(context.createConvolver()), count = Math.round(rate * .005), impulse = context.createBuffer(1, count, rate);
  impulse.getChannelData(0).fill(1 / count); energy.normalize = false; energy.buffer = impulse; sum.connect(energy);
  const energyAttenuation = shape(tables.energy); energy.connect(energyAttenuation);

  const peakScale = gain(.25, false), absolute = shape(tables.absolute, false), split = own(context.createChannelSplitter(2));
  programme.connect(peakScale); peakScale.connect(absolute); absolute.connect(split);
  const left = gain(1), right = gain(1); split.connect(left, 0); split.connect(right, 1);
  const peak = maximum(left, right), peakAttenuation = shape(tables.peak); peak.connect(peakAttenuation);
  let held = maximum(energyAttenuation, peakAttenuation);
  const lookahead = 2 ** Math.ceil(Math.log2(rate * NORMALIZATION_PROFILE.lookaheadMs / 1000));
  const window = 2 ** Math.ceil(Math.log2(lookahead + Math.round(rate * NORMALIZATION_PROFILE.holdMs / 1000)));
  for (let span = 1; span < window; span *= 2) held = maximum(held, delay(held, span));

  // The feedback cycle supplies one render quantum itself. Adding an explicit
  // quantum here would double that delay and make recovery too slow.
  const memory = own(context.createDelay(.1)); memory.delayTime.value = 0;
  const attack = Math.exp(-1 / (rate * NORMALIZATION_PROFILE.attackMs / 1000));
  const release = Math.exp(-1 / (rate * NORMALIZATION_PROFILE.releaseMs / 1000));
  const decay = gain((release - attack) * release ** 127 / (1 - attack)), linear = gain(1);
  memory.connect(decay); memory.connect(linear);
  const offset = own(context.createConstantSource());
  offset.offset.value = -NORMALIZATION_PROFILE.riseDbPerSecond * (128 + attack / (1 - attack)) / rate / GAIN_DB_RANGE;
  offset.start(); offset.connect(linear);
  const requested = maximum(held, maximum(decay, linear));
  const envelope = own(context.createIIRFilter([1 - attack], [1, -attack])); requested.connect(envelope); envelope.connect(memory);
  const multiplier = shape(tables.gain); envelope.connect(multiplier);
  const monitor = own(context.createAnalyser()); monitor.fftSize = 32; multiplier.connect(monitor);
  const gainSamples = new Float32Array(32);
  const audio = delay(programme, lookahead), attenuated = gain(0, false), level = gain(selected, false);
  audio.connect(attenuated); multiplier.connect(attenuated.gain); attenuated.connect(level);
  let targetGain = 0;
  return {
    input: programme, output: level, lookaheadMs: lookahead / rate * 1000, nodeCount: nodes.length,
    setGain(value, at = context.currentTime) {
      if (value === targetGain) return;
      targetGain = value;
      programme.gain.cancelAndHoldAtTime(at);
      programme.gain.setTargetAtTime(value, at, .003);
    },
    setSelected(value, at = context.currentTime) {
      level.gain.cancelAndHoldAtTime(at);
      level.gain.setTargetAtTime(value, at, .005);
    },
    readGain() {
      monitor.getFloatTimeDomainData(gainSamples);
      return programme.gain.value * level.gain.value * Math.max(0, gainSamples[gainSamples.length - 1]);
    },
    dispose() {
      try { offset.stop(); } catch { /* context already ended */ }
      for (const node of nodes) node.disconnect();
    }
  };
}
