# Architecture

`src/entries/` contains only userscript metadata and a call to its platform initializer. `src/platforms/` owns site selectors, private player APIs, native-control placement, navigation hooks, and the remaining site-specific UI wiring. `src/shared/` owns the settings controller, saved-volume persistence, options builder and state synchronization, overlay state and indicator UI, shared slider and options style templates, active-overlay ownership, and video lookup lifecycle.

Shared UI modules are dependency-injected factories. They receive platform callbacks, theme values, storage keys, and constants instead of branching on a site name. Shared style installers keep the common CSS authoritative while applying small platform variants for colors, compact Twitch controls, and host-specific visibility rules. Lifecycle state owns each overlay generation independently of DOM lookup, so detached host subtrees can be disposed and reattached. Platform modules keep YouTube and Twitch API differences explicit.

The shared overlay factory owns the initial element styles, and the shared options keyboard binding owns Escape and Tab behavior. Options previews register page-level release listeners only while a preview is active. Completing the gesture, closing or replacing the popup, or disposing the overlay releases the listeners and ends the preview.

The platform files remain substantial because each contains its site-specific DOM placement, player integration, controls behavior, and navigation timing. Shared code is imported by both production entry graphs; there is no parallel scaffold implementation.

Twitch leaves compact players on home, directory, following, and search pages native. The preview-width rule does not apply to watch pages: channel, video, and clip players retain the selected slider mode at narrow widths and high page zoom.

`scripts/build.mjs` bundles each entry with pinned esbuild settings into deterministic, unminified, single-file IIFEs under `dist/`. Distribution files and archives are generated artifacts.

The opt-in loudness controller in `src/shared/normalization.js` measures a local captured copy of media audio. Platform adapters keep raw output separate from preferred slider/storage volume. Meter notifications update only the normalization status and output detail in Options; settings changes still synchronize the full popup. The static waveform in `src/shared/normalization-ui.js` follows the enabled option when settings or the overlay change, independently of meter notifications. It adds no timer or font measurement. Capture does not replace the original playback path, and the overlay lifecycle releases its analysis resources. See [normalization](normalization.md) for bounds, fallback behavior, and verification.
