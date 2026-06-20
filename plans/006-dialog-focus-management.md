# Plan 006: Add options-dialog focus management

## Objective

Opening options should move focus into the dialog; Escape or dismissal should close it and return focus to the opener without trapping users in hidden content.

## Evidence

YouTube `openVolumeOptionsPopup` exposes the dialog at lines 1900-1935 and close hides it at lines 1938-1958, but neither moves nor restores focus. Twitch repeats this at lines 2129-2184. Both dialogs already have `role="dialog"` and an accessible label.

## Scope

Modify `src/shared/options.js` and shared options CSS/tests. Preserve outside-click behavior and platform-specific controls-visibility handling.

## Steps

1. Record the actual opener before showing the dialog. After positioning, focus the currently selected mode radio or first enabled control.
2. On Escape, prevent default/propagation only when this dialog is open, close it, and restore focus to the recorded opener if still connected; otherwise use the current options button.
3. On outside click, close without stealing focus from the clicked destination. On programmatic close caused by navigation or mode changes, restore focus only when the old player/opener is still connected.
4. While the non-modal popup is open, implement contained Tab/Shift+Tab cycling because it is presented as a dialog. Do not use `aria-modal="true"` unless background content is also made inert.
5. Ensure hidden dialogs contain no focused element. Reopening must recompute the selected/enabled target rather than reuse a stale node.
6. Add integration tests for open focus, forward/backward cycling, disabled placement radios, Escape restoration, outside click, disconnected opener, and navigation disposal.

## Verification

Run `pnpm test -- --test-name-pattern="dialog|focus|Escape"`; expected all pass. Run `pnpm check`; expected exit 0. Confirm both artifacts have identical shared focus behavior.

## Done criteria

- Focus enters the dialog on open and never remains in hidden content.
- Keyboard traversal is contained while open.
- Escape restores focus to a connected opener.
- Pointer dismissal preserves the user's clicked focus destination.

## Escape hatch

If product behavior should remain a non-modal popover without focus containment, STOP and change both markup and plan consistently to an accessible popover/menu pattern. Do not leave `role="dialog"` with unmanaged focus.
