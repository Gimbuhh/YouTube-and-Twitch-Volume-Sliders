# Architecture

`src/entries/` contains only userscript metadata and a call to its platform initializer. `src/platforms/` owns site selectors, private player APIs, native-control placement, navigation hooks, and the remaining site-specific UI wiring. `src/shared/` owns the settings controller, saved-volume persistence, options builder and state synchronization, overlay state and indicator UI, shared slider and options style templates, active-overlay ownership, and video lookup lifecycle.

Shared control factories receive platform callbacks, theme values, storage keys, and constants explicitly. Shared style installers keep the common CSS authoritative while applying small platform variants for colors, compact Twitch controls, and host-specific visibility rules. Lifecycle state owns each overlay generation independently of DOM lookup, so detached host subtrees can be disposed and reattached. Platform modules keep YouTube and Twitch API differences explicit.

The shared overlay factory owns the initial element styles, and the shared options keyboard binding owns Escape and Tab behavior. The options builder owns the General/Appearance tablist, arrow-key navigation, and hidden panels; the shared focus helper excludes inactive panels from the focus loop. The dialog receives initial focus without highlighting a setting; Tab/Shift+Tab enter the first/last visible control. Mode and tab controls remain outside the scrolling body.

The shared tooltip controller owns one visible tooltip and its hover timer. Existing labels and normalization descriptions provide accessibility independently of the visual tooltip. YouTube tooltips use player coordinates and coordinate with native labels; Twitch tooltips use a viewport overlay above native menu layers, hosted inside the fullscreen element when necessary. Observers run only while a tooltip is visible and are limited to its player and ancestor chain.

The native Mode selector uses CSS `:open` to switch its arrow, without JavaScript state or listeners for tracking the picker. Keyboard focus uses a brighter background instead of a border. Tab selection belongs to the popup instance and is not saved in storage.

Options previews register page-level release listeners only while a preview is active. Completing the gesture, changing tabs, closing or replacing the popup, or disposing the overlay releases the listeners and ends the preview.

The platform files remain substantial because each contains its site-specific DOM placement, player integration, controls behavior, and navigation timing. Shared code is imported by both production entry graphs; there is no parallel scaffold implementation.

Twitch leaves compact players on home, directory, following, and search pages native. The preview-width rule does not apply to watch pages: channel, video, and clip players retain the selected slider mode at narrow widths and high page zoom.

`scripts/build.mjs` bundles each entry with pinned esbuild settings into deterministic, unminified, single-file IIFEs under `dist/`. Distribution files and archives are generated artifacts.

The opt-in normalizer in `src/shared/normalization.js` owns selected-volume intent, source transitions and recovery. `normalization-playback.js` combines the LUFS programme policy from `normalization-gain.js` with the native gain envelope in `normalization-graph.js`. Audible samples travel through native delay/gain nodes, without page-thread PCM scheduling. `normalization-output.js` owns one context per document and one media-source attachment per element; disabling processing restores an ordinary route through the retained source.

Native AudioData and an analysis-only AudioWorklet provide compatible inputs to the same K-weighted meter in `lufs-meter.js`. Neither input selects an older normalization method. The published bundles contain one controller; offline reference implementations stay under `scripts/` and are excluded from both entry graphs. Standard metadata and UI contain no development labels.

Platform adapters keep selected slider/storage volume separate from processed output. Meter notifications update only the status and output detail; settings changes synchronize the full popup. The static waveform in `normalization-ui.js` follows healthy enabled states and hides on errors. Disposal releases captured tracks, readers, ports, temporary nodes and the polling timer, retaining only the document's ordinary media route. See [normalization](normalization.md) for bounds, source restrictions and verification.

The shared overlay controller owns the expansion deadline and idle-collapse decision for both sites. Size updates align ticks immediately and share one pending animation frame for their final geometry. Twitch's attachment observer ignores unrelated chat and custom UI mutations, retains a cancellable trailing attachment during its cooldown, and binds normalization to replacement videos immediately. Native player API failures keep readback with the media element until a successful API write restores ownership.
