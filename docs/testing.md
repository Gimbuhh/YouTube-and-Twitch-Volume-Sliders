# Testing

`npm run check` runs deterministic builds, parsed metadata validation, JavaScript syntax parsing, Node unit tests, isolated jsdom integration tests, and generated-artifact consistency checks.

Unit tests cover shared settings, storage failure and recovery, volume functions, custom adjustment steps, smooth wheel accumulation, zoom-gesture pass-through, and major-tick press behavior. Integration tests execute the generated `dist/*.user.js` files in explicit YouTube and Twitch fixtures. They verify standalone startup, mute-safe restoration, slider and wheel step selection, fixed keyboard steps, adaptive ticks, direct slider intent, accessible controls, options-dialog focus, tab keyboard navigation and preview cleanup on tab switches, options and resets with blocked storage, mode off, external detachment, and reattachment. This prevents source-only scaffolding from passing while production artifacts are broken.

Tests do not contact either service. A frozen install may access a package registry; optional reference audio for the comparison is acquired separately.

Options lifecycle regressions verify that popup replacement does not accumulate page-level release listeners and that previews end on release, cancellation, tab switches, close, and replacement. Browser checks also exercise releasing an options drag outside the slider and closing the popup with Escape during a drag.

## Real-browser smoke checks

Run the opt-in Chrome smoke suite when changing input defaults, focus modality, rendered geometry, overflow, or Twitch controls-visibility timing:

```sh
npm run test:browser
```

The suite uses deterministic local YouTube and Twitch player contracts while routing pages onto their real origins. It checks adjustment-step layout, direct major-tick presses, keyboard ownership, options-label alignment on both tabs from 50% through 200% browser zoom, mouse and smooth wheel input, Ctrl+wheel pass-through, and platform-specific player behavior. Mode regressions verify a borderless control, visible keyboard focus through its background, and readable option text against a light native-menu backdrop. They open the native picker with mouse and keyboard, then verify that its arrow returns down after Escape, selection, or an outside click. It uses an installed Chrome or Edge executable without downloading a browser and prints a clear skip when neither is available. Set `VOLUME_SLIDER_CHROME` to choose a specific executable. Set `VOLUME_SLIDER_SMOKE_DIST` to exercise a preserved pair of `youtube-volume-slider.user.js` and `twitch-volume-slider.user.js` artifacts, including preserved known-bad regression artifacts.

The regular `npm run check` remains browser-independent and deterministic.

YouTube popup-positioning regressions cover a hidden duplicate progress bar, no rendered progress bar, and an unrelated progress bar outside the current player. At two viewport widths, the suite opens and closes Options and checks that the popup stays inside the player, uses the rendered bar or button fallback, and receives pointer input.

Twitch regressions distinguish narrow channel, video, and clip players from compact browsing previews. Browser checks cross the old 720-pixel boundary at zoom levels from 100% through 200% and back, with Options open and page mutations between resizes. They verify that replacement mode keeps native controls hidden, retains the custom slider and Options button, and leaves the popup visible and interactive.

The browser suite also checks the static normalization icon in both themes and icon styles, at enlarged on-video sizes, and through output changes, mute, unavailable capture, and disabled states. It verifies the original circular layout, inset upper-right placement with overlap limited to the outer ring, unclipped center and perimeter at ten zoom levels from 50% through 200%, unobscured selected values through 100%, and thumb clearance at zero volume. It preserves the slider's preferred volume, accessible descriptions, and existing mute interaction. The waveform stays unchanged while enabled. Audio feedback checks verify two separate detail lines, containment inside the status card, and no text overlap at six zoom levels from 50% through 200%. These UI checks use a controlled capture fixture; the separate normalization suite below covers real audio capture.

For normalization changes, also run `npm run test:normalization-browser`. It exercises real Web Audio capture with synthetic local WAV sources for both platform adapters, including loud/quiet transitions, mute and preferred-volume preservation, and cross-origin fallback. A same-source quiet-to-loud transition checks attenuation of an existing boost within 250 ms, with the custom slider and saved preference unchanged. Unit tests also cover the first louder measurement and short quiet introductions. See [normalization](normalization.md) for its scope and limitations.

LUFS regressions require real AudioWorklet frames from the bundled scripts and verify that the analysis node has no outputs. Equal-RMS bass and treble receive different native-volume correction, demonstrating that the frequency-weighted path is active. The same behavior runs under a real CSP that excludes Blob modules, and with AudioWorklet removed, using native `MediaStreamTrackProcessor` frames. A case with both APIs absent checks unavailable status, continued ordinary playback, preferred-volume restoration, closed contexts, and stopped capture tracks. Pure tests verify reference levels at 44.1/48/96 kHz, chunk independence, channel energy, 400 ms/3 s windows, transient recovery, port cleanup, startup/stalled-frame timeouts, and ignored gain updates during pause/mute. Native-reader tests cover stereo speaker mixing at 48/96 kHz, frame closure, cancellation, read/construction failures, and disposal during module loading. Artifact tests reject the former RMS controller and analyser graph in production bundles.

## Loudness comparison

Install FFmpeg with the `ebur128` filter, then run:

```sh
npm run test:normalization-compare
```

FFmpeg is a developer reference tool; it adds no package or userscript runtime dependency. The script performs no downloads and writes `comparison.json` under the OS temporary directory by default. Configure it with these optional environment variables:

- `VOLUME_SLIDER_COMPARISON`: output directory for the JSON report.
- `VOLUME_SLIDER_FFMPEG`: FFmpeg executable path.
- `VOLUME_SLIDER_AUDIO_CORPUS`: directory containing the reference recordings, attribution files, and registry below.

Without an external corpus, the script compares three synthetic tones at 80 Hz, 1 kHz, and 4 kHz. The full corpus adds six recordings and a constructed speech/music/effects mix. Each input runs at two source levels (1 and 0.45), selected volumes of 30% and 40%, and both RMS and LUFS controllers, producing 80 renders. Recordings are decoded to stereo at 48 kHz, repeated where necessary to make 30 seconds, and rescaled toward RMS 0.12 with a peak ceiling of 0.85.

The historical RMS controller is frozen under `tests/fixtures/normalization-rms.js` solely for this comparison. Production userscripts contain only LUFS normalization. Controlled UI fixtures emit synthetic worklet energy frames; the separate audio browser suite tests native capture and metering.

The renderer models 1% native-volume rounding and a 50 ms correction delay. FFmpeg measures output after the first five seconds. Summary statistics exclude the same input/volume cases from both engines when either applies 100% volume for at least 1% of its frames; all cases remain in the report. This compares the combined meters and gain policies. Browser capture/message delays and subjective loudness require separate evaluation.

For the full corpus, acquire the following files from the [librosa example collection](https://librosa.org/doc/main/recordings.html). Download each `<basename>.hq.ogg` and its `<basename>.txt` attribution file from `https://librosa.org/data/audio/`, and save the [registry.txt](https://raw.githubusercontent.com/librosa/librosa/main/librosa/util/example_data/registry.txt) alongside them in a directory outside the repository.

| Input | Basename | Attribution |
| --- | --- | --- |
| Speech 1 | `5703-47212-0000` | LibriSpeech, Garth Comira |
| Speech 2 | `3436-172162-0000` | LibriSpeech, Anders Lankford |
| Speech 3 | `198-209-0000` | LibriSpeech, Heather Barnett |
| Jazz | `Kevin_MacLeod_-_Vibe_Ace` | Kevin MacLeod |
| Orchestral | `Kevin_MacLeod_-_P_I_Tchaikovsky_Dance_of_the_Sugar_Plum_Fairy` | Kevin MacLeod |
| Trumpet | `sorohanro_-_solo-trumpet-06` | Mihai Sorohan |

The script verifies recording SHA-256 hashes against the registry and includes the supplied Creative Commons attribution text in its JSON report. Keep the attribution files with the recordings and follow their supplied license terms. Audio remains outside the repository; the harness retains measurements rather than output recordings.

A 30-minute simulated audio soak at 96 kHz also checks the sample-clocked path. It runs faster than real time and is separate from live-browser testing. These fixtures do not establish compatibility with every live stream, player version, or ad transition. See [normalization](normalization.md) for feature behavior and limitations.

## Documentation screenshots

Run `npm run docs:screenshots` to build the scripts, run the icon browser checks, and refresh the ten PNG previews in `docs/images/`. It uses the same local player fixtures and installed Chrome/Edge selection as the browser suite, captures both icon styles, the General and Appearance tabs, and the Audio section for each platform, and fails if no browser is available. Normalization is enabled at a selected 30% with a controlled loud source producing 17% output; no live service is contacted. The small options-button placement illustrations remain SVGs.
