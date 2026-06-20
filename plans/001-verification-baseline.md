# Plan 001: Establish the verification baseline

## Objective

Create a dependency-light test and validation harness around the untouched 2.3.2 scripts before restructuring them. This is the safety net for every later 2.4 plan.

## Baseline and drift check

Inputs:

- `YouTube Volume Slider Versions/YouTube Volume Slider 2.3.2/YouTube Volume Slider 2.3.2.txt`
- `Twitch Volume Slider Versions/Twitch Volume Slider 2.3.2/Twitch Volume Slider 2.3.2.txt`

Before editing, calculate SHA-256. They must match the hashes in `plans/README.md`. If either differs, STOP and report drift; do not update the expected hashes.

Current convention to preserve: both files are strict-mode IIFEs with a userscript metadata block, `@run-at document-idle`, and `@grant none`. YouTube lines 1-14 and Twitch lines 1-14 are the exemplars.

## Scope

Create `package.json`, `pnpm-lock.yaml`, `scripts/check-syntax.mjs`, `scripts/validate-metadata.mjs`, `tests/helpers/`, `tests/unit/`, and `tests/integration/`. Do not move or modify either version archive yet.

Use Node's built-in test runner for pure functions. Add `jsdom` as the only initial development dependency for DOM/lifecycle tests. Pin exact versions; set the `packageManager` field to the pnpm version used to create the lockfile.

## Steps

1. Add scripts: `build` (temporary no-op with a clear message until plan 002), `test`, `test:unit`, `test:integration`, `check:syntax`, `check:metadata`, and `check`.
2. Make `check:syntax` feed both `.txt` files to Node's parser without executing them. Expected: both report valid JavaScript.
3. Make `validate-metadata` parse, rather than substring-match, the metadata block. Require one `@name`, `@version`, `@match`, `@run-at document-idle`, and `@grant none`; reject `@require` and duplicate keys that must be singular.
4. Add a test helper that loads a userscript in an isolated jsdom window with fake timers and captures registered window/document listeners plus live `MutationObserver` instances. Do not contact YouTube or Twitch.
5. Add characterization tests for saved-volume parsing/clamping, settings defaults, snap-to-five behavior, script initialization with no player, one overlay per player, mode-off behavior, and existing metadata.
6. Add fixture builders for the minimum DOM selectors used by each 2.3.2 script. Keep fixture markup explicit and small.
7. Document known failing behavior as tests marked `todo`: restore preserves mute, detached overlay cleanup, keyboard mute activation, and dialog focus. These become passing tests in plans 003-006.

## Verification

Run `pnpm install --frozen-lockfile`, then `pnpm check`. Expected: exit code 0, no network activity during tests, all characterization tests pass, and exactly the four future-behavior tests are reported as todo.

Run SHA-256 again on both archive inputs. Expected: both original hashes are unchanged.

## Done criteria

- A clean checkout can install pinned dev dependencies and run one documented `pnpm check` command.
- Syntax and metadata checks exercise both current scripts.
- Tests do not depend on live websites, user accounts, browser extensions, or wall-clock sleeps.
- No production or historical userscript content changed.

## Maintenance and escape hatches

Fixture selectors should represent only contracts the script consumes. If jsdom cannot expose a required browser behavior, inject a narrow test double; do not introduce Playwright in this plan. If executing the IIFEs requires source modification, STOP and report the obstacle.
