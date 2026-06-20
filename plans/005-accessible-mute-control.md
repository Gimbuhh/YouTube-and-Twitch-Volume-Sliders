# Plan 005: Replace the click-only mute element with an accessible control

## Objective

The custom control must retain the native mute button's keyboard and screen-reader operability, especially in `replace-native` mode.

## Evidence

YouTube hides `.ytp-volume-area` at lines 278-285 but creates `iconCell` as a `div` with only a click listener at lines 2067-2079. Twitch hides its native volume group at lines 481-488 and repeats the click-only `div` at lines 2319-2333. The surrounding overlay has `tabIndex = 0`, producing a generic tab stop without a control role.

## Scope

Modify shared overlay markup/styles and adapter-provided labels. Update DOM/accessibility tests. Do not change icon artwork, mute behavior, dimensions, color, or pointer interaction.

## Steps

1. Create the icon cell as a native `button type="button"`; avoid recreating button behavior with ARIA on a `div`.
2. Give it an accessible name that reflects the action: `Mute` when audible and `Unmute` when muted. Update `aria-label` and `title` on every external or custom volume change.
3. Remove the generic overlay tab stop unless it performs an independent action. Focus entering the slider should still trigger expansion through `focusin`.
4. Ensure button reset styles preserve the existing 40px hit area and icon geometry, with a visible `:focus-visible` indicator meeting contrast expectations.
5. Let native Space/Enter activation produce exactly one toggle; keep pointer click behavior and propagation isolation.
6. Associate the percentage display with the range using `aria-describedby` or an explicit live-value strategy. Do not make every `input` event an intrusive live-region announcement.
7. Convert the plan 001 keyboard todo into tests for tab order, role/name, Space, Enter, click, label changes, focus visibility class/style, and replace-native mode.

## Verification

Run `pnpm test -- --test-name-pattern="accessib|keyboard|mute control"`; expected all pass. Run `pnpm check`; expected exit 0. Inspect both built artifacts to confirm the mute control is a button and no generic overlay `tabindex="0"` remains.

## Done criteria

- Keyboard users can mute and unmute when native controls are hidden.
- Screen readers receive the correct action label and range name/value.
- Pointer behavior and visual layout remain unchanged.
- There is no redundant generic tab stop.

## Escape hatch

If native button styling changes layout, fix the shared reset CSS rather than reverting to a non-semantic element. Do not use positive tabindex values.
