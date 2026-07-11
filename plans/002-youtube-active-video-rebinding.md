# Rebind YouTube when the active video changes

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P1 correctness  
Depends on: none; coordinate fixtures with plan 001

## Objective

Ensure the YouTube overlay, player callbacks, and `volumechange` listener follow the current primary playback video when a new/larger video is inserted while the previously cached video remains connected.

## Evidence

`src/shared/lifecycle.js:30-42` returns any connected cached video without reconsidering candidates. `src/platforms/youtube.js:1927-1933` reuses an existing overlay without recording/checking its video owner, and `1952-1966` ignores added nodes whenever the overlay is present. Twitch provides the intended ownership pattern at `src/platforms/twitch.js:2318-2335` using reset plus `overlay._tmVolumeVideo`.

## Scope

In scope: `src/shared/lifecycle.js` only if its selection contract must change; `src/platforms/youtube.js`; `tests/unit/lifecycle.test.js`; `tests/integration/platforms.test.js`; regenerated YouTube dist.

Out of scope: changing what “primary video” means beyond the existing largest-area rule, platform CSS, Twitch navigation, release archives.

## Implementation steps

1. Add a unit or integration test with an initially selected connected video, then insert a larger video without detaching the first. Prove the baseline remains bound to the first element.
2. Keep the shared locator cached by default. For mutations that add a `video` or a subtree containing one, queue one RAF recheck that calls `resetVideoElement()` before `attachSliderIfPossible()`.
3. Record the owning video as `overlay._tmVolumeVideo` before lifecycle registration. Compare the recomputed video with that owner; if a different candidate has a valid player and controls, dispose the old generation before creating its replacement.
4. Candidate-change checks must not be dropped by `ATTACH_COOLDOWN_MS`. If inside cooldown, schedule one trailing check for the remaining interval. Equal-area candidates retain the existing owner.
5. Test B inserted during cooldown, B under a different player/controls host, an equal-area B, observer-root retargeting, and a post-rebind `volumechange` on A. Assert cleanup runs once.
6. Regenerate YouTube dist.

## Verification

- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm check`
- Inspect the diff to confirm lifecycle cleanup remains paired with every new ownership path.

## Done criteria

- Connected cached video A is replaced by larger video B as active owner.
- Exactly one overlay exists and its owner is B.
- A has no effective volume listener after rebinding.
- Existing detachment and SPA navigation tests remain green.

## Stop conditions

STOP if real YouTube pages expose multiple equally sized legitimate videos and the existing largest-area rule cannot choose safely. Report candidate attributes and propose an explicit selection contract rather than adding site-specific heuristics to the shared locator.
STOP if the larger B has no attachable player/controls; retain A until B becomes attachable rather than leaving the page without an overlay.
