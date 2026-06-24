# Changelog

All notable changes to the maintained userscripts are documented here. Historical release notes from before the source project was established are preserved under `archive/legacy/`.

## 2.4.6 - 2026-06-24

- Fixed Twitch's on-video slider so deliberate hover expands it even while Twitch keeps the native player controls hidden.
- Tracked overlay hover state explicitly to make interaction checks more reliable during player layout updates.
- Preserved YouTube's stationary-pointer guard while sharing the stronger hover-focus behavior.

## 2.4.5 - 2026-06-21

- Made a video-surface play/pause click collapse YouTube's temporarily held-open volume slider, matching the native volume control without blocking playback.

## 2.4.4 - 2026-06-21

- Made the custom YouTube settings menu dismiss video-surface clicks without also toggling playback, matching YouTube's native settings behavior.
- Collapsed Twitch's volume slider when player controls hide, clearing temporary interaction expansion when Always expanded is disabled.

## 2.4.3 - 2026-06-20

- Prevented unrelated pointer releases from being treated as volume-slider interactions.
- Preserved mute state and the collapsed overlay when clicks begin outside the slider.

## 2.4.2 - 2026-06-20

- Kept keyboard focus inside the options dialog when conditional opacity controls are hidden.
- Added selected-option focus, one Tab stop per radio group, and arrow/Home/End navigation for options radios.
- Made release packaging transactional, synchronized package and userscript versions, and added rollback coverage.
- Added public contribution and security-reporting guidance.

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

## Historical Releases

Exact release dates were not retained for versions `1.0` through `2.3.2`. Repository evidence establishes only that these builds had been archived by 2026-03-29. Their original patch notes are preserved without invented dates:

| Version | Available scripts | Original notes |
| --- | --- | --- |
| 2.3.2 | YouTube, Twitch | [2.3.2](release-notes/2.3.2.md) |
| 2.3.1 | YouTube, Twitch | [2.3.1](release-notes/2.3.1.md) |
| 2.3 | YouTube, Twitch | [2.3](release-notes/2.3.md) |
| 2.2.3 | YouTube, Twitch | [2.2.3](release-notes/2.2.3.md) |
| 2.2.2 | YouTube, Twitch | [2.2.2](release-notes/2.2.2.md) |
| 2.2.1 | YouTube, Twitch | [2.2.1](release-notes/2.2.1.md) |
| 2.2 | YouTube, Twitch | [2.2](release-notes/2.2.md) |
| 2.1 | YouTube, Twitch | [2.1](release-notes/2.1.md) |
| 2.0 | YouTube, Twitch | [2.0](release-notes/2.0.md) |
| 1.5.1 | YouTube, Twitch | [1.5.1](release-notes/1.5.1.md) |
| 1.5 | YouTube, Twitch | [1.5](release-notes/1.5.md) |
| 1.4.2 | Twitch | [1.4.2](release-notes/1.4.2.md) |
| 1.4.1 | YouTube, Twitch | [1.4.1](release-notes/1.4.1.md) |
| 1.4 | YouTube, Twitch | [1.4](release-notes/1.4.md) |
| 1.3.2 | YouTube, Twitch | [1.3.2](release-notes/1.3.2.md) |
| 1.3.1 | YouTube, Twitch | [1.3.1](release-notes/1.3.1.md) |
| 1.3 | YouTube, Twitch | [1.3](release-notes/1.3.md) |
| 1.2.2 | YouTube | [1.2.2](release-notes/1.2.2.md) |
| 1.2.1 | YouTube, Twitch | [1.2.1](release-notes/1.2.1.md) |
| 1.2 | YouTube, Twitch | [1.2](release-notes/1.2.md) |
| 1.1.5 | YouTube | [1.1.5](release-notes/1.1.5.md) |
| 1.1 | YouTube, Twitch | [1.1](release-notes/1.1.md) |
| 1.0 | YouTube, Twitch | [1.0](release-notes/1.0.md) |
