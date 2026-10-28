import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLufsMeter } from '../src/shared/lufs-meter.js';
import { createLufsGainController } from './lib/legacy-normalization.mjs';

// Historical reactive-controller comparison, not production playback: FFmpeg is the independent meter, never a
// runtime dependency. Downloaded audio and rendered results stay outside Git.
const directory = process.env.VOLUME_SLIDER_COMPARISON || join(tmpdir(), 'volume-slider-lufs-comparison');
const corpus = process.env.VOLUME_SLIDER_AUDIO_CORPUS;
const ffmpeg = process.env.VOLUME_SLIDER_FFMPEG || 'ffmpeg';
const rate = 48000;
await mkdir(directory, { recursive: true });
execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' });

// FFmpeg's meter reads the rendered output independently of our K filters.
function meterReference(interleaved, sampleRate = rate) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '2', '-i', 'pipe:0', '-af', 'ebur128=framelog=info', '-f', 'null', '-'],
    { input: Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength), maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`FFmpeg reference failed: ${result.error || result.stderr.toString().slice(-1000)}`);
  const log = result.stderr.toString();
  const integrated = [...log.matchAll(/Integrated loudness:\s+I:\s+([-\d.]+)/g)].at(-1);
  assert.ok(integrated, 'FFmpeg returns integrated loudness');
  const windows = [...log.matchAll(/t:\s*([\d.]+).*?M:\s*([-\d.]+)\s+S:\s*([-\d.]+)/g)]
    .map(match => ({ time: Number(match[1]), momentary: Number(match[2]), shortTerm: Number(match[3]) }));
  return { integrated: Number(integrated[1]), windows };
}

function interleave(channels) {
  const result = new Float32Array(channels[0].length * 2);
  for (let i = 0; i < channels[0].length; i++) { result[2 * i] = channels[0][i]; result[2 * i + 1] = channels[1][i]; }
  return result;
}

function tone(frequency, seconds = 12, amplitude = 0.12) {
  const signal = Float32Array.from({ length: rate * seconds }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
  return [signal, signal];
}

function normalizeInput(channels) {
  let energy = 0, peak = 0;
  for (const channel of channels) for (const value of channel) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
  const rms = Math.sqrt(energy / (2 * channels[0].length));
  const scale = Math.min(0.12 / Math.max(rms, 1e-9), 0.85 / Math.max(peak, 1e-9));
  return channels.map(channel => channel.map(value => value * scale));
}

function decode(file) {
  const bytes = execFileSync(ffmpeg, ['-v', 'error', '-stream_loop', '-1', '-i', file, '-t', '30', '-ar', String(rate), '-ac', '2', '-f', 'f32le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return [Float32Array.from({ length: values.length / 2 }, (_, i) => values[2 * i]), Float32Array.from({ length: values.length / 2 }, (_, i) => values[2 * i + 1])];
}

function render(channels, preferred) {
  // A 5 ms render grid represents fast spike decisions and 50 ms programme
  // frames/output ticks exactly.
  const frameLength = rate / 200;
  const output = new Float32Array(channels[0].length * 2);
  const meter = createLufsMeter(rate), controller = createLufsGainController();
  let applied = preferred, gain = 1, limited = 0, frames = 0, lastWrite = -Infinity;
  const start = performance.now();
  for (let offset = 0; offset < channels[0].length; offset += frameLength) {
    const end = Math.min(offset + frameLength, channels[0].length);
    for (let i = offset; i < end; i++) { output[2 * i] = channels[0][i] * applied / 100; output[2 * i + 1] = channels[1][i] * applied / 100; }
    meter.process(channels.map(channel => channel.subarray(offset, end)),
      frame => { gain = controller.update(frame, 100 / preferred); },
      attackPower => { gain = controller.update({ attackPower }, 100 / preferred); });
    const desired = preferred * gain;
    const next = Math.max(1, Math.round(Math.min(100, desired)));
    // Match the native writer: increases use 50 ms ticks and coalesce small
    // recovery steps for at most 150 ms, with a small rounding margin to avoid
    // repeated neighboring steps. Every cut still bypasses these guards.
    const outputTick = Math.floor(end / (rate * .05)) > Math.floor(offset / (rate * .05));
    const increaseReady = next / applied >= 10 ** (.5 / 20) || end - lastWrite >= rate * .15;
    if (next < applied || (next > applied && desired >= applied + .6 && outputTick && increaseReady)) {
      applied = next;
      lastWrite = end;
    }
    if (applied === 100) limited++;
    frames++;
  }
  return { output, limitedFraction: limited / frames, processingMs: performance.now() - start };
}

const validation = [];
for (const frequency of [80, 1000, 4000]) {
  const channels = tone(frequency, 5), meter = createLufsMeter(rate), frames = [];
  meter.process(channels, frame => frames.push(frame));
  const reference = meterReference(interleave(channels));
  let worst = 0;
  for (const window of reference.windows.filter(window => window.time >= 3.1)) {
    const frame = frames[Math.round(window.time * 20) - 1];
    worst = Math.max(worst, Math.abs(frame.momentaryLufs - window.momentary), Math.abs(frame.shortTermLufs - window.shortTerm));
  }
  assert.ok(worst < 0.1, `meter agrees with FFmpeg within 0.1 LU at ${frequency} Hz: ${worst}`);
  validation.push({ frequency, maximumMeterDifferenceLU: worst });
}

const sources = new Map([['bass-80hz', tone(80)], ['mid-1khz', tone(1000)], ['high-4khz', tone(4000)]]);
const assets = [];
if (corpus) {
  const registry = new Map((await readFile(join(corpus, 'registry.txt'), 'utf8')).trim().split(/\r?\n/).map(line => line.split(/\s+/)));
  const entries = [
    ['speech-1', '5703-47212-0000'], ['speech-2', '3436-172162-0000'], ['speech-3', '198-209-0000'],
    ['jazz', 'Kevin_MacLeod_-_Vibe_Ace'], ['orchestral', 'Kevin_MacLeod_-_P_I_Tchaikovsky_Dance_of_the_Sugar_Plum_Fairy'],
    ['trumpet', 'sorohanro_-_solo-trumpet-06']
  ];
  for (const [name, file] of entries) {
    const filename = `${file}.hq.ogg`, path = join(corpus, filename);
    const hash = createHash('sha256').update(await readFile(path)).digest('hex');
    assert.equal(hash, registry.get(filename), `reference audio matches the published librosa registry: ${filename}`);
    assets.push({ name, filename, sha256: hash, attribution: await readFile(join(corpus, `${file}.txt`), 'utf8') });
    sources.set(name, normalizeInput(decode(path)));
  }
  const speech = sources.get('speech-1'), music = sources.get('jazz');
  const mix = speech.map((channel, side) => channel.map((value, i) => {
    const burst = i % (rate * 3) < rate * 0.12 ? 0.22 * Math.sin(2 * Math.PI * 100 * i / rate) * Math.exp(-35 * (i % (rate * 3)) / rate) : 0;
    return value + 0.35 * music[side][i % music[side].length] + burst;
  }));
  sources.set('speech-music-effects', normalizeInput(mix));
}

const rows = [];
for (const [name, channels] of sources) {
  for (const preferred of [30, 40]) for (const level of [1, 0.45]) {
    const input = channels.map(channel => channel.map(value => value * level));
    const result = render(input, preferred);
    const measured = meterReference(result.output.subarray(5 * rate * 2));
    rows.push({ name, preferred, level, engine: 'lufs', integratedLufs: measured.integrated, limitedFraction: result.limitedFraction,
      processingMs: result.processingMs, audioSeconds: input[0].length / rate });
  }
}

const summaries = [30, 40].map(preferred => {
  const selected = rows.filter(row => row.preferred === preferred && row.limitedFraction < 0.01);
  const values = selected.map(row => row.integratedLufs), mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { preferred, lufs: { count: values.length, mean, spreadLU: Math.max(...values) - Math.min(...values),
    deviationLU: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) } };
});
// Exercise the sample-clocked path for 30 minutes without retaining audio or
// frames. The processing ratio is diagnostic, not a machine-dependent test gate.
const soakRate = 96000, soakSeconds = 1800, soakMeter = createLufsMeter(soakRate), soakController = createLufsGainController();
const soakSignal = Float32Array.from({ length: 128 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * i / 128));
const soakChannels = [soakSignal, soakSignal];
let soakFrames = 0, soakGain;
const onSoakFrame = frame => { soakFrames++; soakGain = soakController.update(frame, 100 / 30); assert.ok(Number.isFinite(soakGain)); };
const soakStart = performance.now();
for (let index = 0; index < soakRate * soakSeconds / 128; index++) soakMeter.process(soakChannels, onSoakFrame,
  attackPower => { soakGain = soakController.update({ attackPower }, 100 / 30); assert.ok(Number.isFinite(soakGain)); });
const soak = { sampleRate: soakRate, audioSeconds: soakSeconds, frames: soakFrames, processingMs: performance.now() - soakStart, finalGain: soakGain };
assert.equal(soakFrames, soakSeconds * 20);
const implementation = 'historical reactive controller; not the production native graph';
const report = { implementation, reference: 'FFmpeg ebur128, output after the first five seconds; 1% native-volume quantization; headroom-limited cases excluded from summaries', corpus: corpus ? 'six attributed speech/music recordings, a speech/music/effects mix, and three tones' : 'three synthetic tones only', assets, validation, summaries, soak, rows };
await writeFile(join(directory, 'comparison.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ implementation, validation, summaries, soak, rows: rows.length, report: join(directory, 'comparison.json') }, null, 2));
