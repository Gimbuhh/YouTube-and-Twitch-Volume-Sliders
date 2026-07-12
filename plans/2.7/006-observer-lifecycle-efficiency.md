# Reduce whole-document observer work

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P2 performance  
Depends on: plans 002 and 003

## Objective

Detect overlay detachment and player replacement without running redundant body-wide observer callbacks for unrelated SPA mutations, while preserving reliable reattachment.

## Evidence

YouTube and Twitch each observe `document.body` with `{ childList: true, subtree: true }` solely to test `overlay.isConnected` (`youtube.js:1870-1876`, `twitch.js:2279-2285`). Separate attachment observers already exist (`youtube.js:1941-2000`, `twitch.js:2368-2438`). Twitch therefore has two body-wide mutation paths while mounted.

## Scope

In scope: `src/shared/lifecycle.js`, platform observer setup/cleanup, lifecycle unit and platform integration tests, regenerated dist files. Out of scope: selector redesign, visual behavior, replacing MutationObserver with polling, History navigation changes.

## Implementation steps

1. Add tests for overlay removal, host subtree replacement, new active video, mode-off cleanup, and repeated reattachment. Instrument the test MutationObserver wrapper to count callbacks for unrelated body mutations.
2. Add only a small generation-aware RAF coalescer with `schedule()`, `invalidate()`, and `dispose()`. Each platform retains observer targets and relevance predicates; do not move selectors into shared code.
3. YouTube uses its existing attach root when present and a bootstrap root only until that root appears. Twitch keeps one body observer when no narrower parent can detect player replacement and folds detachment into its existing attachment callback.
4. One delivered mutation batch calls `schedule()` at most once. Disposal invalidates the generation so queued RAF work becomes a no-op.
5. Verify cleanup disconnects observers and drops queued work for disposed generations.
6. Regenerate both dist files.

## Verification

- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm check`
- Extend the runtime observer wrapper to record observe target/options, callback deliveries, and disconnect state. For N unrelated body mutations on mounted Twitch, there is one body-observer callback path and at most one queued lifecycle check, with no separate detachment observer.

## Done criteria

- Detachment and replacement tests remain deterministic.
- At most one body-wide observer exists per platform when a narrower root is unavailable.
- Disposed overlay generations cannot enqueue reattachment work.
- No polling or new permanent global listeners are introduced.

## Stop conditions

STOP if narrowing the root misses a reproduced SPA replacement path. Keep one coalesced body observer and document why; do not trade correctness for a theoretical callback reduction.
STOP if folding callbacks breaks options-button reinjection or native-volume maintenance, including mode off.
