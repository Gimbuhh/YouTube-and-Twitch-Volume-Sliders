# Preserve exact keyboard volume steps on YouTube and Twitch

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P1 accessibility/correctness

## Objective

With snap-to-five disabled, keyboard Arrow adjustments on either range input must retain the browser's exact one-percent step and must not be mistaken for direct pointer clicks.

## Evidence

Pointer state initializes to zero at `src/platforms/twitch.js:2109-2113` and resets only on `pointerdown` at `2174-2183`. `readPressAwareSliderValue()` at `2148-2158` snaps the first changed value whenever no pointer movement is recorded, including keyboard-generated `input`. Thus ArrowUp at 52 becomes 55; ArrowUp at 50 can snap back to 50.

YouTube has the same state machine at `src/platforms/youtube.js:1744-1829`, so the executor must prove and correct the behavior symmetrically rather than leave two divergent interaction contracts.

## Scope

In scope: pointer-vs-keyboard interaction classification in both adapters, platform integration tests, regenerated YouTube and Twitch dist. Out of scope: changing direct pointer-click snapping or the explicit snap-to-five setting.

## Implementation steps

1. Add keyboard-only tests without preceding `pointerdown`: 50→51 and 52→53 using the real range `input` path, with snapping disabled. Assert UI, player API, and persisted value after debounce/change.
2. Add pointer direct-click tests proving existing nearest-five behavior remains, plus explicit snap-enabled keyboard tests following the documented snap policy.
3. Make direct-click snapping conditional on an active pointer interaction rather than default-initialized pointer variables. Reset pointer state on up/cancel/blur and disposal.
4. Apply the same proven interaction-state contract to both adapters; avoid platform-specific fixes for identical behavior.

## Verification

- `pnpm test:integration`
- `pnpm check`

## Done criteria

- Keyboard one-percent changes remain exact when snap is disabled.
- Direct pointer clicks retain intentional nearest-five behavior.
- Snap-enabled behavior remains consistent across input modalities and platforms.

## Stop conditions

STOP if product intent says keyboard input should always snap even when the setting is disabled; document that accessibility decision explicitly before encoding it.
