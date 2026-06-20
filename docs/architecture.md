# Architecture

`src/entries/` contains only userscript metadata and a call to its platform initializer. `src/platforms/` owns site selectors, private player APIs, native-control placement, navigation hooks, and the remaining site-specific UI wiring. `src/shared/` owns the settings controller, saved-volume persistence, options builder, overlay state and indicator UI, style creation, active-overlay ownership, and video lookup lifecycle.

Shared UI modules are dependency-injected factories. They receive platform callbacks, theme values, storage keys, and constants instead of branching on a site name. Lifecycle state owns each overlay generation independently of DOM lookup, so detached host subtrees can be disposed and reattached. Platform modules keep YouTube and Twitch API differences explicit.

The platform files remain substantial because each contains its site-specific CSS, DOM placement, player integration, and navigation behavior. Shared code is imported by both production entry graphs; there is no parallel scaffold implementation.

`scripts/build.mjs` bundles each entry with pinned esbuild settings into deterministic, unminified, single-file IIFEs under `dist/`. Distribution files and archives are generated artifacts.
