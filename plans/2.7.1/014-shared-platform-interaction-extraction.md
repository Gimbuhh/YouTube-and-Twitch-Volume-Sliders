# Extract shared platform interaction modules

Status: DONE in 2.7.1
Priority: P2 code quality  
Depends on: plan 012; plan 013 should land first

## Objective

Reduce duplication between the large YouTube and Twitch modules without merging platform-specific discovery, navigation, mute semantics, or controls visibility.

## Candidate boundaries

Extract only behavior with the same contract on both platforms:

- range pointer state, click snapping, and wheel stepping;
- common overlay markup and base slider styles;
- volume label and arc synchronization;
- overlay-owned listener cleanup registration.

Keep player adapters, startup restoration, route/navigation logic, native placement, Twitch focus/visibility behavior, and YouTube loading intent platform-owned.

## Implementation steps

1. Record tests, browser smoke results, artifact sizes, and hashes as the behavior baseline.
2. Inventory exact duplicate blocks and reject candidates with different timing, focus, or mute contracts.
3. Extract the smallest identical unit first with explicit callbacks for platform side effects.
4. Regenerate both artifacts after every extraction and remove old paths only after both platforms execute the shared path.
5. Stop when remaining duplication represents legitimate platform policy.

## Verification

- `pnpm check` and browser smoke coverage pass after every extraction.
- Standalone metadata and startup remain valid.
- No new runtime dependency or userscript permission is introduced.
- Listener order, cleanup, focus, and mute behavior remain unchanged.

## Stop conditions

Stop when an extraction needs platform flags for most branches, changes event order, or makes debugging less direct. Prefer clear duplication over a fragile universal abstraction.
