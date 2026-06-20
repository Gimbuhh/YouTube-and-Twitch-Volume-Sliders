# Plan 004: Make overlay lifecycle cleanup ownership-safe

## Objective

Ensure every overlay generation releases its video/window listeners, timers, and mutation observers even when the host site removes its DOM subtree before the script calls `removeOverlay`.

## Evidence

YouTube registers window listeners and an observer at lines 2191-2239, stores cleanup on the element, then only calls it when `document.getElementById` returns an element with a parent at lines 2246-2257. Twitch repeats the pattern at lines 2468-2544 and 2550-2561. A detached overlay is no longer discoverable by document ID, while its window listeners retain its closure.

## Scope

Modify `src/shared/lifecycle.js`, `src/shared/overlay.js`, and adapter reattach hooks as required. Do not change attach cooldowns, navigation delays, selectors, volume behavior, or visual styling.

## Steps

1. Make lifecycle state own the active overlay generation independently of DOM lookup. Store its root, cleanup function or `AbortController`, bound video/player identities, timers, and observers.
2. Implement idempotent `disposeActiveOverlay(reason)`. It must clean resources whether the root is connected, detached, already removed, or partially constructed.
3. Call disposal before every new generation, when mode becomes off, at the start of platform navigation reattach, and when an observer detects that the owned root is disconnected.
4. Prefer an `AbortController` signal for event listeners where supported; explicitly disconnect mutation observers and clear timers because abort does not handle them.
5. Remove element-owned private cleanup properties such as `_volumeCleanup`; lifecycle ownership must not depend on querying the document.
6. Ensure delayed callbacks capture a generation token and no-op after disposal so an old generation cannot restore volume or mutate a new overlay.
7. Convert the lifecycle todo into repeated-navigation tests. Simulate at least 25 host subtree replacements and assert one active overlay, one effective handler per global event, no live observers for old roots, and no old-video writes.

## Verification

Run `pnpm test -- --test-name-pattern="lifecycle|navigation|detach"`; expected all pass. Run `pnpm check`; expected exit 0. The listener/observer tracker from plan 001 must return to the same baseline after every disposal cycle.

## Done criteria

- Cleanup is callable and effective after external DOM detachment.
- Cleanup is idempotent and does not remove a newer generation.
- Repeated SPA navigation does not increase active global listener or observer counts.
- Mode off leaves no overlay-owned resources.

## Escape hatch

If jsdom cannot report native listener counts, keep the instrumented registration wrapper confined to tests and assert observable callback counts. Do not expose debug counters in production artifacts.
