# Testing

`npm run check` runs deterministic builds, parsed metadata validation, JavaScript syntax parsing, Node unit tests, isolated jsdom integration tests, and generated-artifact consistency checks.

Unit tests cover shared settings, volume functions, custom adjustment steps, and major-tick press behavior. Integration tests execute the generated `dist/*.user.js` files in explicit YouTube and Twitch fixtures. They verify standalone startup, mute-safe restoration, slider and wheel step selection, fixed keyboard steps, adaptive ticks, direct slider intent, accessible controls, options-dialog focus, mode off, external detachment, and reattachment. This prevents source-only scaffolding from passing while production artifacts are broken.

Tests do not contact either service. A frozen install is the only step that may access a package registry.

## Real-browser smoke checks

Run the opt-in Chrome smoke suite when changing input defaults, focus modality, rendered geometry, overflow, or Twitch controls-visibility timing:

```sh
npm run test:browser
```

The suite uses deterministic local YouTube and Twitch player contracts while routing pages onto their real origins. It checks adjustment-step layout, direct major-tick presses, keyboard ownership, options-label alignment from 50% through 200% browser zoom, and platform-specific player behavior. It uses an installed Chrome or Edge executable without downloading a browser and prints a clear skip when neither is available. Set `VOLUME_SLIDER_CHROME` to choose a specific executable. Set `VOLUME_SLIDER_SMOKE_DIST` to exercise a preserved pair of `youtube-volume-slider.user.js` and `twitch-volume-slider.user.js` artifacts, including preserved known-bad regression artifacts.

The regular `npm run check` remains browser-independent and deterministic.
