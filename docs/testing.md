# Testing

`npm run check` runs deterministic builds, parsed metadata validation, JavaScript syntax parsing, Node unit tests, isolated jsdom integration tests, and generated-artifact consistency checks.

Unit tests cover shared settings, storage failure and recovery, volume functions, custom adjustment steps, smooth wheel accumulation, zoom-gesture pass-through, and major-tick press behavior. Integration tests execute the generated `dist/*.user.js` files in explicit YouTube and Twitch fixtures. They verify standalone startup, mute-safe restoration, slider and wheel step selection, fixed keyboard steps, adaptive ticks, direct slider intent, accessible controls, options-dialog focus, options and resets with blocked storage, mode off, external detachment, and reattachment. This prevents source-only scaffolding from passing while production artifacts are broken.

Tests do not contact either service. A frozen install is the only step that may access a package registry.

Options lifecycle regressions verify that popup replacement does not accumulate page-level release listeners and that previews end on release, cancellation, close, and replacement. Browser checks also exercise releasing an options drag outside the slider and closing the popup with Escape during a drag.

## Real-browser smoke checks

Run the opt-in Chrome smoke suite when changing input defaults, focus modality, rendered geometry, overflow, or Twitch controls-visibility timing:

```sh
npm run test:browser
```

The suite uses deterministic local YouTube and Twitch player contracts while routing pages onto their real origins. It checks adjustment-step layout, direct major-tick presses, keyboard ownership, options-label alignment from 50% through 200% browser zoom, mouse and smooth wheel input, Ctrl+wheel pass-through, and platform-specific player behavior. It uses an installed Chrome or Edge executable without downloading a browser and prints a clear skip when neither is available. Set `VOLUME_SLIDER_CHROME` to choose a specific executable. Set `VOLUME_SLIDER_SMOKE_DIST` to exercise a preserved pair of `youtube-volume-slider.user.js` and `twitch-volume-slider.user.js` artifacts, including preserved known-bad regression artifacts.

The regular `npm run check` remains browser-independent and deterministic.

YouTube popup-positioning regressions cover a hidden duplicate progress bar, no rendered progress bar, and an unrelated progress bar outside the current player. At two viewport widths, the suite opens and closes Options and checks that the popup stays inside the player, uses the rendered bar or button fallback, and receives pointer input.

Twitch regressions distinguish narrow channel, video, and clip players from compact browsing previews. Browser checks cross the old 720-pixel boundary at zoom levels from 100% through 200% and back, with Options open and page mutations between resizes. They verify that replacement mode keeps native controls hidden, retains the custom slider and Options button, and leaves the popup visible and interactive.

The browser suite also checks the static normalization icon in both themes and icon styles, at enlarged on-video sizes, and through output changes, mute, unavailable capture, and disabled states. It verifies the original circular layout, inset upper-right placement with overlap limited to the outer ring, unclipped center and perimeter at ten zoom levels from 50% through 200%, unobscured selected values through 100%, and thumb clearance at zero volume. It preserves the slider's preferred volume, accessible descriptions, and existing mute interaction. The waveform stays unchanged while enabled. These UI checks use a controlled capture fixture; the separate normalization suite below covers real audio capture.

For normalization changes, also run `npm run test:normalization-browser`. It exercises real Web Audio capture with synthetic local WAV sources for both platform adapters, including loud/quiet transitions, mute and preferred-volume preservation, and cross-origin fallback. A same-source quiet-to-loud transition checks attenuation of an existing boost within 250 ms, with the custom slider and saved preference unchanged. Unit tests also cover the first louder measurement and short quiet introductions. See [normalization](normalization.md) for its scope and limitations.

## Documentation screenshots

Run `npm run docs:screenshots` to build the scripts, run the icon browser checks, and refresh the eight PNG previews in `docs/images/`. It uses the same local player fixtures and installed Chrome/Edge selection as the browser suite, captures both icon styles, the complete Options menu, and the Audio section for each platform, and fails if no browser is available. Normalization is enabled at a selected 30% with a controlled loud source producing 17% output; no live service is contacted. The small options-button placement illustrations remain SVGs.
