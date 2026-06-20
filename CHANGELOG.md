# Changelog

All notable changes to the maintained userscripts are documented here. Historical release notes from before the source project was established are preserved under `archive/legacy/`.

## 2.4.1 - 2026-06-20

- Prevented the YouTube volume slider from expanding when it first appears beneath a stationary pointer during page load.

## 2.4 - 2026-06-19

- Split complete YouTube and Twitch implementations into thin entries, platform modules, and production-used shared settings, volume, options, overlay, lifecycle, and style modules.
- Added deterministic builds and an offline syntax, metadata, unit, DOM, and artifact verification harness.
- Added source-size, named-function, and standalone artifact-startup gates to prevent truncated releases.
- Preserved mute state during saved-volume restoration.
- Made overlay lifecycle cleanup ownership-safe across detached SPA subtrees.
- Replaced click-only mute markup with an accessible native button.
- Added complete options-dialog focus entry, containment, dismissal, and restoration behavior.
