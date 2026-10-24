# Audio-processing prototype

This is development work, separate from the 2.9 userscripts. Nothing in the userscript entry points imports `scripts/normalization-prototype.mjs`. The installed feature still uses the existing reactive LUFS controller and original playback path. This prototype is not a fallback or a second normalization mode.

## Design

The prototype reuses the shared K-weighted meter. A programme-only controller tracks typical active loudness; one continuous, stereo-linked envelope combines that command with short-energy and sample-peak constraints. It buffers 20 ms so attenuation can begin before a loud onset reaches the output. The old temporary player-volume cuts are not stacked with the new envelope.

The selected profile has a 1 ms attack, 20 ms hold, 180 ms release, and a 24 dB/s upward bound. Its sample ceiling follows the selected listening level. These are listening-oriented settings, not a guaranteed reconstructed true-peak limit or broadcast loudness specification.

`programmeCommands()` builds causal commands from interleaved stereo Float32 audio. `createLookaheadGain()` is the bounded-memory streaming gain kernel; `push()` returns a reused stereo pair after its initial delay. `renderRefined()` is an offline wrapper that flushes the delay and aligns the result with its input. The command builder and renderer retain their input/output arrays for analysis and are not a complete live browser processor.

```js
import { programmeCommands, renderRefined } from '../scripts/normalization-prototype.mjs';

// Supply decoded interleaved stereo Float32 samples at the stated rate.
const { commands } = programmeCommands(input, 48000, 0.3);
const { output, stats } = renderRefined(input, commands, {
  rate: 48000,
  selected: 0.3
});
```

No audio files, local machine paths, recordings, uploads or external audio dependencies are included. Decoding and playback belong to the caller.

## Evidence

Local analysis used an original two-hour stream download. Three difficult onsets were used during refinement, then the same settings were checked on five additional onsets from that broadcast. Each scored interval had 120 seconds of warmup and 60 seconds of measurement. FFmpeg independently measured integrated loudness and reconstructed true peak.

Comparisons matched average loudness within 0.1 LU using a small offline offset to the programme command, with no post-limiter boost. This matching uses the full scored interval for evaluation; a live implementation does not know future integrated loudness. Onset energy below means unweighted mean stereo sample power, not LUFS or sound pressure at the speakers.

For the most troublesome return after quiet audio, relative to the earlier compressor prototype:

- Maximum peak in the first 50 ms decreased by **9.2 dB**.
- Energy over the first 100 ms decreased by **5.8 dB**.

Relative to the current userscript replay, all eight tested onsets had lower first-50-ms peaks and energy. The five additional cases reduced those peaks by 6.2–7.4 dB and first-100-ms energy by 1.7–4.3 dB. These are file/DSP measurements from one broadcast, not live browser or independent listening-test results.

The revised envelope preserves more overall loud/quiet variation than the earlier compressor prototype. Softer words can remain quieter. The user preferred the refined listening samples, but broader speech, music and effects remain to be evaluated.

## Regressions and remaining work

Run the portable synthetic checks with:

```sh
node --test tests/unit/normalization-prototype.test.js
```

They also run in `npm run check`. Coverage includes 21 impulse positions across 44.1/48/96 kHz, sample-ceiling containment, stereo linking, silence, decoded near-silence, opening into speech, default settings, zero-volume diagnostics, an unchanged steady tone, and recovery after a brief loud event. The synthetic recovery case returns within 0.3 dB of its established level after one second. A boundary assertion keeps the development prototype out of both standalone userscripts.

Before integration, validate a live streaming wrapper, capture/output ownership, mute and zero/maximum volume, pause/resume, context suspension, source changes, Twitch ad restarts, full browser performance, and end-to-end audio/video synchronization. Actual latency includes capture/output delay in addition to the 20 ms buffer. The existing audio-input compatibility paths and startup failure policy still need deliberate integration; these offline results do not establish universal browser support.
