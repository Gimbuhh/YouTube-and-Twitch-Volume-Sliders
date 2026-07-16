# Cancel Twitch delayed restores with overlay disposal

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P1 correctness

## Objective

Prevent the 1.5-second first-attach restore from modifying a stale Twitch video or current overlay after navigation, mode-off, or player replacement.

## Evidence

`src/platforms/twitch.js:2343-2354` creates an untracked timeout capturing `video`. Cleanup at `2286-2299` does not cancel it, and `disposeActiveOverlay` at `2305-2309` cannot invalidate its callback.

## Scope

In scope: `src/platforms/twitch.js`, `tests/integration/platforms.test.js`, regenerated Twitch dist. Out of scope: redesigning all Twitch startup locks, History patching, YouTube.

## Implementation steps

1. Add a fake-timer-compatible integration test that attaches video A, replaces/disposes it before 1.5 seconds, attaches B, then advances the callback. Assert A is untouched and B/current UI is not updated by A's callback.
2. Add `let delayedFirstAttachRestoreTimer = 0` plus `cancelDelayedFirstAttachRestore()`. Use `window.setTimeout`; cancel from `disposeActiveOverlay()` and immediately before any replacement schedule.
3. Capture both the `video` and the exact overlay returned by `createOverlay`. The callback first zeros the handle, then requires `overlayLifecycle.owns(capturedOverlay)`, `capturedOverlay.isConnected`, `capturedOverlay._tmVolumeVideo === video`, and `video.isConnected`.
4. Preserve exactly one delayed restore for a still-current first attachment. Repeated attachment with the same overlay must not restart or duplicate it.
5. Regenerate Twitch dist.

## Verification

- `npm run test:integration`
- `npm run check`
- Confirm the new test demonstrates failure on baseline before accepting the fix.

## Done criteria

- Disposal cancels the delayed restore.
- A queued stale callback is harmless.
- A current overlay still receives its intended delayed restore once.
- Mode-off, replacement (even with A connected), or disposal zeroes the timer handle; a same-tick queued callback is harmless.

## Stop conditions

STOP if jsdom cannot deterministically control the timeout without globally altering existing test timing; extract only the scheduling/ownership predicate into a focused helper instead of adding sleeps.
