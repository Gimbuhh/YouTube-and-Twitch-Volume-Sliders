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

Options-button motion checks verify all three slider handles move with the menu state, return after Escape and outside dismissal, reverse during rapid toggles, preserve button geometry, and switch instantly under reduced motion on both sites.

Every smoke scenario rejects uncaught page errors before reporting success. This gate was verified by injecting an asynchronous exception into a temporary built artifact: the ordinary suite passed, while the altered artifact failed with the injected error.

YouTube popup-positioning regressions cover a hidden duplicate progress bar, no rendered progress bar, and an unrelated progress bar outside the current player. At two viewport widths, the suite opens and closes Options and checks that the popup stays inside the player, uses the rendered bar or button fallback, and receives pointer input.

Twitch regressions distinguish narrow channel, video, and clip players from compact browsing previews. Browser checks cross the old 720-pixel boundary at zoom levels from 100% through 200% and back, with Options open and page mutations between resizes. They verify that replacement mode keeps native controls hidden, retains the custom slider and Options button, and leaves the popup visible and interactive.

Volume-intent regressions simulate passive player writes and source reloads with normalization enabled in both On and Replace native modes. They keep the selected and saved level unchanged, verify five-point player arrow steps, and restore the selection on disable. A browser test checks native volume input after the site's setter runs. Another uses nested, cross-origin Twitch extension frames, including Twitch's own message forwarding, to verify one action per Space/volume key and no page scrolling. Text input, buttons, and keys consumed by the extension remain untouched. Unit tests reject messages from unrelated origins, sources, and unfocused frames, and ignore duplicate or delayed copies of an accepted command. All extension pages are local fixtures; these checks never load a real Twitch extension.

The browser suite also checks the static normalization icon in both themes and icon styles, at enlarged on-video sizes, and through output changes, pause, mute, unavailable capture, and disabled states. It verifies the original circular layout, inset upper-right placement with overlap limited to the outer ring, unclipped center and perimeter at ten zoom levels from 50% through 200%, unobscured selected values through 100%, and thumb clearance at zero volume. It preserves the slider's preferred volume, accessible descriptions, and existing mute interaction. Normal pause, mute, and zero volume keep the waveform visible; blocked/unavailable analysis and Off hide it. Its artwork stays unchanged through hiding and recovery. Audio feedback checks verify two separate detail lines, containment inside the status card, and no text overlap at six zoom levels from 50% through 200%. These UI checks use a controlled capture fixture; the separate normalization suite below covers real audio capture.

## Audio normalization

Run `npm run test:normalization-browser` after changing audio processing or lifecycle. It builds the standard userscripts, runs ten routed real-browser cases, records four synthetic startup/refresh cases with main-thread stalls, and runs 36 native gain-graph checks at 44.1/48/96 kHz. Chrome is required; set VOLUME_SLIDER_CHROME to select the executable. The startup waveform checks also require FFmpeg. Set VOLUME_SLIDER_NORMALIZATION_RESULTS to an output directory outside the repository; results otherwise use the OS temporary directory. No live browser audio is recorded.

The browser cases check native frames, worklet analysis, CSP-blocked worklets, unavailable input, blocked activation, stereo linking, mono input, sample ceilings, controls, selected-volume persistence, source restarts/replacement and enable/disable. A worklet message regression rejects startup-only notifications after meaningful programme measurement. The frozen packet-renderer waveform regression and earlier live results remain in the local analysis evidence, not in shipped code.

Node tests use controlled routing/analysis stubs for lifecycle contracts. Native waveform checks use real Web Audio; passing stubs are not evidence of DSP fidelity. The offline reference tests use scripts/normalization-reference.mjs, and historical reactive-controller comparisons use scripts/lib/legacy-normalization.mjs. Both are deliberately absent from the userscripts. `npm run test:normalization-compare` remains a historical comparator with optional FFmpeg/corpus inputs, not a renderer for the current native graph.

See [normalization](normalization.md) for current behavior, ownership, limits and live verification. Broader listening, Twitch ad recovery, browser suspension and end-to-end audio/video synchronization remain distinct release checks.

## Documentation screenshots

Run `npm run docs:screenshots` to build the standard scripts, check indicator geometry/zoom and refresh the PNG previews in docs/images/. The fixtures enable normalization at a selected 30% with a controlled source producing 17% output. They use no live service and show the real production settings markup, without development labels. The existing browser smoke suite remains available through `npm run test:browser`.
