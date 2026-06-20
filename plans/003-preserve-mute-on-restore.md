# Plan 003: Preserve mute state while restoring volume

## Objective

Applying a persisted volume during initialization or SPA navigation must not unmute media unless the user actively changes the custom slider.

## Evidence

In YouTube 2.3.2, `restoreSavedVolume` calls `setVolume` (lines 938-942), while `setVolume` calls `unMute` or clears `video.muted` (lines 909-920). Twitch has the same coupling at lines 996-1007 and 1041-1051, although it may subsequently reapply a custom saved mute value.

## Scope

Modify canonical `src/shared/volume.js` and only the adapter methods needed to distinguish restoration from user intent. Update unit and integration tests. Do not change storage keys, saved volume semantics, the behavior of an actual slider input, or Twitch's explicit mute persistence.

## Steps

1. Replace the ambiguous platform `setVolume` contract with either separate `restoreVolume`/`setVolumeFromUser` operations or an explicit, typed intent argument. Prefer separate names if they make call sites harder to misuse.
2. Restoration records the current mute state, applies the numeric volume without deliberately unmuting, and restores mute if the platform API implicitly changed it.
3. User slider input continues to unmute, matching 2.3.2 behavior.
4. Twitch restoration first applies volume without changing the current mute state, then applies a stored mute value only when `MUTE_STORAGE_KEY` explicitly contains `true` or `false`. Absence of that key means preserve the platform state.
5. Convert the plan 001 mute todo into tests for muted/unmuted initial load, SPA reattach, saved volume 0, no saved volume, Twitch saved mute true/false/absent, and direct slider input.

## Verification

Run `pnpm test -- --test-name-pattern="mute|restore"`; expected all cases pass. Run `pnpm check`; expected exit 0. Inspect built artifacts to confirm restore call sites cannot invoke the user-intent setter.

## Done criteria

- A muted player remains muted after initial attach and navigation restore.
- An unmuted player remains unmuted unless an explicit saved Twitch mute value says otherwise.
- Moving the custom slider still unmutes and applies the selected value.
- Numeric saved-volume behavior is unchanged.

## Escape hatch

If a platform API cannot set numeric volume without unmuting, preserve and reapply the pre-call mute state in the adapter. Do not remove volume restoration or add timing delays as a workaround.
