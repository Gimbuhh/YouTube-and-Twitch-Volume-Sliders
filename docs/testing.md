# Testing

`npm run check` runs deterministic builds, parsed metadata validation, JavaScript syntax parsing, Node unit tests, isolated jsdom integration tests, and generated-artifact consistency checks.

Unit tests cover shared settings, storage failure and recovery, volume functions, custom adjustment steps, smooth wheel accumulation, zoom-gesture pass-through, and major-tick press behavior. Integration tests execute the generated `dist/*.user.js` files in explicit YouTube and Twitch fixtures. They verify standalone startup, mute-safe restoration, slider and wheel step selection, fixed keyboard steps, adaptive ticks, direct slider intent, accessible controls, options-dialog focus, tab keyboard navigation and preview cleanup on tab switches, options and resets with blocked storage, mode off, external detachment, and reattachment. This prevents source-only scaffolding from passing while production artifacts are broken.

Tests do not contact either service. A frozen install may access a package registry; optional reference audio for the comparison is acquired separately.

Release preflight tests exercise real temporary archives, checking both platform hashes, historical backfills, package-version mismatches, missing files, and directory substitutions. The runtime helper also verifies that restarted mutation observers cannot deliver callbacks after teardown.

Options lifecycle regressions verify that popup replacement does not accumulate page-level release listeners and that previews end on release, cancellation, tab switches, close, and replacement. Browser checks also exercise releasing an options drag outside the slider and closing the popup with Escape during a drag. On both sites, scrolling regressions require the menu to retain its normal height and stay directly above its controls through document and nested-container scrolling. The menu stays inside its player and can scroll partly off-screen with it. Browser checks also cover tabs, fullscreen, short viewport height limits, Escape focus restoration, and removal with its player.

## Real-browser smoke checks

Run the opt-in Chrome smoke suite when changing input defaults, focus modality, rendered geometry, overflow, or Twitch controls-visibility timing:

```sh
npm run test:browser
```

The suite uses deterministic local YouTube and Twitch player contracts while routing pages onto their real origins. It checks adjustment-step layout, direct major-tick presses, keyboard ownership, options-label alignment on both tabs from 50% through 200% browser zoom, mouse and smooth wheel input, Ctrl+wheel pass-through, and platform-specific player behavior. Mode regressions verify a borderless control, visible keyboard focus through its background, and readable option text against a light native-menu backdrop. They open the native picker with mouse and keyboard, then verify that its arrow returns down after Escape, selection, or an outside click. It uses an installed Chrome or Edge executable without downloading a browser and prints a clear skip when neither is available. Set `VOLUME_SLIDER_CHROME` to choose a specific executable. Set `VOLUME_SLIDER_SMOKE_DIST` to exercise a preserved pair of `youtube-volume-slider.user.js` and `twitch-volume-slider.user.js` artifacts, including preserved known-bad regression artifacts.

The regular `npm run check` remains browser-independent and deterministic.

Every smoke scenario rejects uncaught page errors before reporting success. This gate was verified by injecting an asynchronous exception into a temporary built artifact: the ordinary suite passed, while the altered artifact failed with the injected error.

YouTube popup-positioning regressions cover a hidden duplicate progress bar, no rendered progress bar, and an unrelated progress bar outside the current player. At two viewport widths, the suite opens and closes Options and checks that the popup stays inside the player, uses the rendered bar or button fallback, and receives pointer input.

Twitch regressions distinguish narrow channel, video, and clip players from compact browsing previews. Browser checks cross the old 720-pixel boundary at zoom levels from 100% through 200% and back, with Options open and page mutations between resizes. They verify that replacement mode keeps native controls hidden, retains the custom slider and Options button, and leaves the popup visible and interactive.

Volume-intent regressions simulate passive player writes and source reloads with normalization enabled in both On and Replace native modes. They keep the selected and saved level unchanged, verify five-point player arrow steps, and restore the selection on disable. A browser test checks native volume input after the site's setter runs. Another uses nested, cross-origin Twitch extension frames, including Twitch's own message forwarding, to verify one action per Space/volume key and no page scrolling. Text input, buttons, and keys consumed by the extension remain untouched. Unit tests reject messages from unrelated origins, sources, and unfocused frames, and ignore duplicate or delayed copies of an accepted command. All extension pages are local fixtures; these checks never load a real Twitch extension.

The browser suite also checks the static normalization icon in both themes and icon styles, at enlarged on-video sizes, and through output changes, pause, mute, unavailable capture, and disabled states. It verifies the original circular layout, inset upper-right placement with overlap limited to the outer ring, unclipped center and perimeter at ten zoom levels from 50% through 200%, unobscured selected values through 100%, and thumb clearance at zero volume. It preserves the slider's preferred volume, accessible descriptions, and existing mute interaction. Normal pause, mute, and zero volume keep the waveform visible; blocked/unavailable analysis and Off hide it. Its artwork stays unchanged through hiding and recovery. Audio feedback checks verify two separate detail lines, containment inside the status card, and no text overlap at six zoom levels from 50% through 200%. These UI checks use a controlled capture fixture; the separate normalization suite below covers real audio capture.

For normalization changes, also run `npm run test:normalization-browser`. It exercises real Web Audio capture with synthetic local WAV sources for both platform adapters, including loud/quiet transitions, mute and preferred-volume preservation, and cross-origin fallback. A same-source quiet-to-loud transition checks attenuation of an existing boost within 250 ms, with the custom slider and saved preference unchanged. Unit tests also cover the first louder measurement and short quiet introductions. See [normalization](normalization.md) for its scope and limitations.

LUFS regressions require real AudioWorklet frames from the bundled scripts and verify that the analysis node has no outputs. Equal-RMS bass and treble receive different native-volume correction, demonstrating that the frequency-weighted path is active. The same behavior runs under a real CSP that excludes Blob modules, and with AudioWorklet removed, using native `MediaStreamTrackProcessor` frames. A case with both APIs absent checks unavailable status, continued ordinary playback, preferred-volume restoration, closed contexts, and stopped capture tracks. Pure tests verify reference levels at 44.1/48/96 kHz, chunk independence, channel energy, 400 ms/3 s windows, transient recovery, port cleanup, startup/stalled-frame timeouts, and ignored gain updates during pause/mute. Native-reader tests cover stereo speaker mixing at 48/96 kHz, frame closure, cancellation, read/construction failures, and disposal during module loading. Artifact tests reject the former RMS controller and analyser graph in production bundles.

Activation regressions keep real audio contexts suspended: native frames must normalize before any trusted input on both sites, while worklet analysis must wait for activation and then recover. Explicit CDP evaluations avoid Playwright's implicit user gesture during the pre-activation check. The native cases also replace the source, preserve preferred volume/mute, and stop every track consumed by analysis on disable. Retained capture containers can receive new, unconsumed tracks after source replacement, so cleanup checks track actual analysis ownership. Unit regressions cover missing/stalled native frames, pause, zero volume and reader cancellation with an unused suspended context.

Recovery cases start with saved normalization enabled and a temporary capture exception, then allow real worklet/native capture without a toggle, trusted input, or playback event. They verify automatic reconnection, error-based icon visibility, preference preservation, and capture cleanup. Unit tests cover native startup/stalled-frame recovery, exponential retry backoff capped at 30 seconds, paused/disabled sessions, immediate gesture retries, and backoff reset after stable analysis. Artifact integration tests cover icon visibility through startup, pause, mute, zero volume, activation requirements, inaccessible audio, unavailable analysis, and automatic recovery on both sites. Pausing after a capture failure must not conceal the failed status or bring the icon back.

Early-start regressions hold document parsing with a pending local script and withhold player controls while real audio plays. Both input paths on both sites must begin playback with zero output and permit only the controller's minimum output before full 50 ms measurements, without trusted input, then retain one capture when controls arrive. The first two full frames must also stay below the loud-fixture ceiling. The player-clock test ceiling is 500 ms; it is not a speaker-latency guarantee. Artifact regressions also start before the body exists, preserve selected volume, reuse capture on mount, and release outgoing capture when replacing the player. Unit cases cover delayed frames, protected short measurements, first-frame capture ramps, source/track replacement, paused preparation, input and passive site writes during startup, mute preservation, disable cleanup, and ordinary-volume restoration with a warning when startup fails. Adapter tests verify reuse of a prepared module or CSP rejection and no late processor creation after a context closes.

For repeated startup comparisons, filter startup cases with `VOLUME_SLIDER_NORMALIZATION_CASES`, set `VOLUME_SLIDER_STARTUP_REPEATS` (1–20), and write a JSON report with `VOLUME_SLIDER_STARTUP_REPORT`. The report distinguishes first audible protected output from the transition above minimum gain. `VOLUME_SLIDER_STARTUP_LEAD_MS` (0–1000) lets the fixture model a video attached before playback; it adds no runtime delay to either userscript. Use the same value and browser for before/after comparisons. The tests retain the original 50 ms measurement requirement for gain above the minimum, including when native frames arrive in larger packets.

Spike-response tests preserve the regular LUFS programme frames while checking adaptive 5 ms K-weighted protection. Steady audio retains 20 ms short-energy reports. Unit tests sweep 50 onset phases with a 15 ms sample-time correction ceiling, verify immediate downward writes without a polling tick, and keep volume increases on the regular timer. They also cover multichannel chunk independence, disposed native-frame callbacks, stable-track scan suppression, and skipped player API reads for benign fast observations. Browser traces report when native volume stays within 2 dB of the synthetic loud-return target; these player-clock timings are not speaker-output latency guarantees. Set `VOLUME_SLIDER_NORMALIZATION_DIST` to a preserved pair of userscripts for before/after testing, and `VOLUME_SLIDER_ATTACK_REPORT` to a JSON output path for the measured timings.

Speech-return regressions inspect the gain already in place before the next word, rather than only how fast a cut follows it. Unit cases cover 1/5/10-second measurable backgrounds at 20/30/40% selected volume, silence before background audio, cautious boost recovery after a peak, smooth recovery around unity, and a brief startup event before a quiet source. The routed browser fixture plays an established voice-level tone, five seconds of background, then the same voice level. It samples output before the return and requires less than 2 dB excess over the established level, covering both platforms and both analysis backends. Synthetic tones and numeric tests do not establish subjective listening quality or actual speaker latency.

## Loudness comparison

Install FFmpeg with the `ebur128` filter, then run:

```sh
npm run test:normalization-compare
```

FFmpeg is a developer reference tool; it adds no package or userscript runtime dependency. The script performs no downloads and writes `comparison.json` under the OS temporary directory by default. Configure it with these optional environment variables:

- `VOLUME_SLIDER_COMPARISON`: output directory for the JSON report.
- `VOLUME_SLIDER_FFMPEG`: FFmpeg executable path.
- `VOLUME_SLIDER_AUDIO_CORPUS`: directory containing the reference recordings, attribution files, and registry below.

Without an external corpus, the script checks three synthetic tones at 80 Hz, 1 kHz, and 4 kHz. The full corpus adds six recordings and a constructed speech/music/effects mix. Each input runs through the current LUFS controller at two source levels (1 and 0.45) and selected volumes of 30% and 40%, producing 40 renders. Recordings are decoded to stereo at 48 kHz, repeated where necessary to make 30 seconds, and rescaled toward RMS 0.12 with a peak ceiling of 0.85.

The harness uses only the same current LUFS meter and gain controller as the userscripts; no older normalization implementation is retained. Controlled UI fixtures emit synthetic worklet energy frames; the separate audio browser suite tests native capture and metering through both supported input adapters.

The gain regressions also cover speech returning after a background only 5 LU quieter: across all 50 meter phases, the existing gain must keep the returning speech less than 3 dB above target before a reactive cut. Repeated brief effects guard against multi-decibel boost pumping between events, and a sustained quiet passage must eventually regain useful boost. The browser audio suite exercises a moderate 5 LU background through both audio-input paths. These constructed effects are stress cases, not a recorded gameplay corpus or a subjective listening assessment.

The renderer models 1% native-volume rounding, 50 ms programme measurements and output ticks, small-increase coalescing (0.5 dB / 150 ms), and immediate cuts from adaptive short K-weighted measurements. Its 5 ms render grid represents the fast and ordinary intervals. FFmpeg measures output after the first five seconds. Summary statistics exclude cases that apply 100% volume for at least 1% of their frames; all cases remain in the report. Meter validation and output measurements use the current LUFS policy. Browser capture/message delays and subjective loudness require separate evaluation.

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
