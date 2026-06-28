# Changelog

All notable changes to the maintained userscripts are documented here. Historical release notes from before the source project was established are preserved under `archive/legacy/`.

## 2.6.3 - 2026-06-28

### Fixed

- Stabilized the New icon style's in-arc volume number so it no longer repaints from a fallback thickness to the page font thickness during load.
- Retuned the New icon style's volume arc to use pixel-aligned 3px ring geometry, improving its smoothness on 1440p displays.
- Mounted the options button as soon as native player controls appear, before the full custom slider is ready, reducing startup delay next to the native control buttons.
- Rebuilt the slider's 5% tick marks as evenly positioned 1px marks from 5% through 95%, avoiding uneven spacing and edge rendering artifacts.

### Notes

- The Classic icon style is unchanged.

## 2.6.2 - 2026-06-28

### Fixed

- Hid YouTube's native volume button immediately when replace-native mode is active, avoiding the brief native-icon flash during page load.
- Mounted the custom YouTube slider earlier during page load so replace-native mode does not leave a visible gap before the custom control appears.
- Synced the volume arc before the custom slider is inserted and removed the arc fill transition, avoiding the brief low-volume red ring flash.
- Closing the YouTube Slider Options menu outside the player now visually hides the controls without forcing YouTube's sticky hidden-controls state, so hover reveal remains responsive.

### Notes

- Twitch received the shared arc rendering cleanup only; its timing and controls behavior are unchanged.

## 2.6.1 - 2026-06-28

### Added

- Added an Icon style option for choosing between the 2.6 volume number arc and the classic 2.5.3 speaker icon with side percentage text.

### Fixed

- Kept the 5% step markers visible as part of the slider bar throughout expansion instead of fading them in after the pill finishes opening.
- Smoothed collapse timing so the slider visuals do not disappear before the pill has finished shrinking.

### Notes

- New remains the default icon style, so existing 2.6 behavior is preserved unless users choose Classic.

## 2.6 - 2026-06-27

### Added

- Scroll on the circular volume control to raise or lower volume in 5-point steps.

### Changed

- The circular mute control now shows the current volume number instead of a speaker icon, with `M` shown while muted.
- The expanded slider is more compact and sits closer to the circle, returning to the shorter 2.5.3-style length now that the number lives inside the control.
- The number-in-circle design is polished for native-size text, cleaner ring edges, and better centering from 0 to 100.

## 2.5.3 - 2026-06-26

- Matched the custom volume label to YouTube's native control text size, line height, font stack, weight, and text shadow.
- Reduced empty spacing around the custom volume label while keeping short values, long values, and the muted state visually balanced.
- Kept the muted state readable as "Muted".
- Removed redundant hover tooltips from the custom volume slider controls while preserving accessible labels.
- Kept native player settings clicks responsive while the volume options popup is open.

## 2.5.2 - 2026-06-26

- Changed the default Bar thickness setting from 50% to 75%.
- Scaled the volume slider grabber with the selected Bar thickness so it stays visually balanced at thinner and thicker settings.
- Expanded the volume slider while the Bar thickness setting is being dragged when Always expanded is off, then restored the normal collapsed state on release.
- Added on-video opacity previews while dragging: Idle shows the collapsed slider and Active shows the expanded slider.

## 2.5.1 - 2026-06-26

- Fixed Twitch's on-video slider so clicking the video after a slider interaction keeps Twitch's native controls open long enough for the click to behave normally.
- Made the visible slider bar thinner while keeping the larger click and drag target.
- Added a Bar thickness preference from 25% to 125%, where 100% matches the version 2.5 bar thickness and the default is 50%.

## 2.5 - 2026-06-25

- Added an on-video size control for YouTube and Twitch, allowing the floating slider to scale from 100% to 200%.
- Kept the size control scoped to Show on video mode, returning the overlay to normal size in the controls area.
- Kept the expanded slider internals at a stable width during reveal/collapse so the track and grabber do not re-layout with the pill animation.

## 2.4.7 - 2026-06-25

- Refined the expanded volume slider into a smooth rounded pill track with thumb-aligned fill at low and high values.
- Removed the slider and percentage fade-in during expansion so the control reveals cleanly without blinking.

## 2.4.6 - 2026-06-24

- Fixed Twitch's on-video slider so deliberate hover expands it even while Twitch keeps the native player controls hidden.
- Tracked overlay hover state explicitly to make interaction checks more reliable during player layout updates.
- Preserved YouTube's stationary-pointer guard while sharing the stronger hover-focus behavior.
- Added userscript auto-update metadata pointing at the public `main` branch distribution files.

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
