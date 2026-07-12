# Unify Twitch controls visibility holds

Status: PROPOSED for 2.8  
Priority: P2 maintainability  
Depends on: plan 012 recommended first

## Objective

Replace overlapping options-menu, post-close, and keyboard timers with one ownership-aware controls-visibility manager while preserving every current timeout and hide rule.

## Current concern

Several independent reasons share `keepTwitchControlsVisible()` and an options-named observer. Each caller owns separate timers and must avoid releasing styles while another reason remains active. It works today, but another hold reason would increase coupling.

## Required contract

- Holds have named owners such as `options`, `post-close`, and `keyboard-volume`.
- Refreshing or releasing one owner cannot cancel another.
- Releasing the final owner removes only userscript-owned classes and styles.
- Keyboard volume refreshes a three-second deadline without expanding the slider.
- Overlay disposal cancels all timers and observers exactly once.

## Implementation steps

1. Add characterization tests for overlapping owners, refresh, release ordering, rerender reapplication, and disposal.
2. Introduce a local manager with `hold`, `release`, `refresh`, `has`, and `dispose` operations.
3. Move mutation-observer reapplication behind the manager.
4. Convert one owner at a time and remove old handles only after parity is proven.

## Verification

- Existing Twitch integration and browser smoke cases remain green.
- Expiry of one hold never hides controls owned by another.
- No global listener, timer, observer, class, or inline style survives disposal.

## Stop conditions

Stop if Twitch player variants require materially different mechanisms. Preserve explicit adapters instead of forcing unlike behavior through one abstraction.
