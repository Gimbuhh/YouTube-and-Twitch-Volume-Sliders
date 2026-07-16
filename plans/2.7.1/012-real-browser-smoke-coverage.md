# Add real-browser smoke coverage

Status: DONE in 2.7.1
Priority: P1 regression prevention

## Objective

Add a small Chrome-based smoke suite for behaviors that jsdom cannot faithfully model: native keyboard defaults, focus-visible modality, rendered control dimensions, overflow clipping, and player-controls visibility timers.

## Scope

Cover four stable, high-value journeys:

1. YouTube drag followed immediately by Arrow Up/Down updates the slider, arc, label, and player volume.
2. Mouse-clicking the YouTube mute icon does not create a focus-visible ring; Tab focus still does.
3. Twitch in-controls mode keeps the 40px visual while leaving the native control row at its baseline height.
4. Twitch Up/Down works only after the player is pressed, preserves mute, shows controls for three seconds, and returns to page scrolling after an outside press.

## Implementation approach

- Add an opt-in browser smoke command; keep `pnpm check` offline and deterministic.
- Prefer a deterministic local player fixture for CI and a documented live-site mode for final release checks.
- Assert bounding boxes, active element, event prevention, volume state, and visibility state rather than relying only on screenshots.
- Use stable userscript IDs/classes and the smallest possible native-player contracts.
- Store no cookies, credentials, browsing history, or captured stream content.

## Verification

- Known-bad intermediate 2.7 artifacts fail their corresponding smoke cases.
- Current behavior passes in Chrome.
- Missing browser/session prerequisites produce a clear skip reason.

## Done criteria

- Each browser-only regression above has one focused assertion.
- Failures report compact focus, event, dimension, and volume evidence.
- Documentation distinguishes offline logic tests from browser integration tests.

## Stop conditions

Stop if reliable automation requires weakened browser security, stored authentication, or unstable page scraping. Keep those cases as a short manual release checklist instead.
