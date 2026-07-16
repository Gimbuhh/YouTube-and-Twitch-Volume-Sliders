# Preserve YouTube native-control inline state

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P2 correctness

## Objective

Toggling native replacement must not destroy inline visibility state owned by YouTube or another integration.

## Evidence

`src/platforms/youtube.js:140-152` already hides native volume reversibly through a root class and stylesheet. `155-163` additionally overwrites each `.ytp-volume-area` inline `display` with `none`, then resets it to an empty string, losing any prior value.

## Scope

In scope: YouTube native visibility logic, integration tests, generated YouTube dist. Out of scope: selector changes, Twitch native controls, visual redesign.

## Implementation steps

1. Add tests where the native area begins with `display: none`, another nonempty display value, and no inline value. Toggle replace-native on/off and assert the exact original inline value remains.
2. Prefer the existing root-class stylesheet as the single hiding mechanism. Remove redundant inline writes if tests prove the stylesheet covers current placement/navigation behavior.
3. If inline writes are demonstrably required, store ownership and original value per element and restore only values written by this script; handle newly inserted controls without overwriting host state.
4. Verify mode-off, placement changes, and navigation cleanup.

## Verification

- `npm run test:integration`
- `npm run check`

## Done criteria

- Exact pre-existing inline display values survive every replacement toggle.
- Script-owned hiding remains effective while enabled.
- Newly inserted native controls follow the same reversible contract.

## Stop conditions

STOP if removing inline writes exposes a browser/userscript-manager specificity bug not represented by the stylesheet fixture. Document the concrete case and implement ownership-tracked restoration rather than unconditional blanking.
