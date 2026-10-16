# Loudness normalization (2.9)

The feature is disabled by default. Each platform stores its own boolean under `tm-yt-volume-slider-normalization` or `tm-twitch-volume-slider-normalization`. The settings controller keeps an unsaved session choice when storage is blocked. The main slider mode must also be enabled. This feature adds no userscript grants or runtime dependencies.

## Audio path and intent

`src/shared/normalization.js` reads `video.captureStream()` (or `mozCaptureStream`) into a `MediaStreamAudioSourceNode`, a six-channel splitter, and one unconnected analyser per channel. It stops the captured video tracks immediately. Analysis never connects to the audio destination and never creates a `MediaElementAudioSourceNode`. The site's original playback path remains intact if capture fails, including cross-origin restrictions or protected content. Capture follows the [W3C media capture contract](https://www.w3.org/TR/mediacapture-fromelement/): captured audio is independent of the element's volume and mute, so native volume adjustments do not form a feedback loop.

The controller uses the loudest channel's energy instead of averaging channel waveforms. This avoids stereo phase cancellation and includes center-channel dialogue when present in the captured stream. An analyser alone downmixes time-domain data to mono, as described in the [Web Audio specification](https://www.w3.org/TR/webaudio-1.1/#time-domain-down-mixing).

The platform adapter exposes raw volume setters/getters to the normalizer. Its existing slider, persistence, startup restoration, and mute logic use the preferred volume instead. The controller recognizes its own rounded output and maps it back to preferred intent. Native volume changes that differ from the last applied output become new intent. Synchronous notifications between an API's unmute and volume update are guarded so they cannot overwrite that intent.

Because adjustment uses native player volume, the site's own volume indicator can move while the custom slider stays at the preferred level. Output is never amplified beyond the native player's range. No normalization setting can make a player at 100% louder than its original source.

While active, Options shows the adjusted output alongside the selected percentage and whether the controller is raising quiet audio or reducing loud audio. This detail refreshes at most twice per second and is excluded from live announcements; status changes remain accessible. It exposes corrections without moving the custom slider.

A small, static SVG waveform icon tucked into the volume ring's upper-right edge indicates that normalization is enabled. It slightly overlaps the outer band of the arc, keeping the volume number and most of the ring unobscured. It represents the saved option, including during mute or when analysis is waiting or unavailable; Audio settings show the actual status and adjusted output. The 12×12 CSS-pixel icon leaves the original layout and circular background unchanged and adds no text, animation, font measurement, timer, or meter updates. A tooltip and accessible description explain its meaning without adding a tab stop or live announcements. The icon uses each platform's accent, works in New and Classic appearances and at on-video sizes, and hides when normalization is off.

Active status follows capture readiness, not measured signal energy. Continuous quiet audio crossing the noise floor, speech gaps, and silence keep the capture Active while gain holds as needed. Only playback, context, or capture availability changes produce waiting or unavailable statuses. The loudness tracker has no separate public audibility state for the UI to synchronize.

## Leveling policy

- Poll all six channels every 100 ms with overlapping analysis windows of at least 150 ms (8192 samples at 48 kHz). Use a maximum 250 ms elapsed step to prevent large jumps after timer throttling.
- Estimate duration-weighted RMS energy over the last three seconds of active audio. Exclude frames more than 10 dB below that window's average to prevent quiet word endings from continually lowering the estimate.
- Target a source RMS of 0.1 (-20 dBFS before the user's volume), leaving more headroom for quiet sources. The target is an approximation rather than a LUFS measurement.
- Allow up to 20 dB of attenuation and as much increase as the native player's remaining 0–100% range permits. A positive preference never rounds into an automatic mute.
- Use the louder of the current measurement and the gated window for prompt reduction when a loud passage begins. Smooth gain in decibels with a 120 ms attenuation time constant, 900 ms initial increase time constant, and 1.8-second increase time constant after acquisition. Require 400 ms of measurable audio before raising volume.
- Freeze below RMS 0.01 (about -40 dBFS), through pause, and during mute/zero volume. This does not lift silence or steady very low noise.

This is an RMS approximation. It does not measure perceptual LUFS, normalize an entire recording in advance, or catch all short peaks. Speakers, music, and effects may still differ perceptually. It cannot anticipate the first loud moment on a new channel.

## Lifecycle and fallback

One enabled player owns one polling timer, capture stream, and audio context. Repeated binding to the same video is idempotent. Source load events discard the old capture, restore preferred volume, and restart measurement; new audio tracks replace the analysis source. Switching off or disposing the overlay removes listeners, stops captured tracks, disconnects the splitter and analysers, closes the context, and restores preferred volume with mute preserved. A detached video's API is not used for restoration because it may already point at an incoming player.

Missing capture APIs, encrypted content, capture exceptions, suspended contexts, and muted/unavailable capture tracks have visible status messages. Exceptions and inaccessible tracks restore ordinary volume. A suspended context can resume on a pointer or keyboard gesture. Capture exceptions retry on playback or metadata events, rather than on every polling tick.

## Verification

`npm run check` covers the leveling policy and both generated userscripts, including opt-in persistence, blocked storage, user intent, synchronous player events, mode Off, mute, source changes, failure fallback, and cleanup. Leveling regressions compare quiet and very loud sources at 30% and 40%, speech gaps, sudden loud passages, opposite-phase stereo, and center-only audio. Status regressions keep a single capture connected through continuous low-level audio and silence without repeated Active/waiting transitions.

`npm run test:browser` also checks the static icon with a controlled analysis fixture: original control dimensions, both appearances, on-video scaling, mute, unavailable capture, accessible descriptions, and removal when disabled. It verifies placement at ten page zoom levels from 50% to 200%, unobscured selected values through 100%, and slider thumb clearance at zero volume. The artwork stays unchanged through output, mute, and waiting states. Set `VOLUME_SLIDER_SCREENSHOTS` to save icon and zoom screenshots.

`npm run test:normalization-browser` uses installed Chrome or Edge with synthetic WAV audio and local routes on the platform origins. It compares actual captured quiet/loud sources at both 30% and 40%, checks that correction uses available native volume headroom, and verifies opposite-phase stereo, the output detail, source replacement, stable slider/storage preference, mute preservation, and continued ordinary playback for a cross-origin source without CORS access. It never contacts YouTube or Twitch. Set `VOLUME_SLIDER_CHROME` to choose a browser and optionally `VOLUME_SLIDER_SCREENSHOTS` to save options screenshots.

These fixtures do not establish compatibility with every live player version, Twitch stream type, ad transition, or browser. Live listening remains necessary to tune the mode.
