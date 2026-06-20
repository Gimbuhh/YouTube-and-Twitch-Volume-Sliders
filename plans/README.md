# Volume Sliders 2.4 implementation plans

These plans were prepared from the unversioned workspace on 2026-06-19. Git is not available, so drift checks use the SHA-256 hashes of the current 2.3.2 scripts:

- YouTube: `69BEAF33156F917614CEC2293856F2795389697CE4B6CA01E7006D74C1F19969`
- Twitch: `61268B76C6DCEDDDDA7FBBC072F7D1FBC2C1E9208CB2814D4C95F4E08BF7FAA1`

The historical files are inputs and must remain byte-for-byte unchanged. Version 2.4 is built from canonical source and emitted as installable single-file userscripts in `dist/`.

## Execution order

| Order | Plan | Status | Depends on | Purpose |
|---|---|---|---|---|
| 1 | [001-verification-baseline.md](001-verification-baseline.md) | DONE | - | Add repeatable syntax, unit, DOM, and metadata checks around 2.3.2 |
| 2 | [002-canonical-source-layout.md](002-canonical-source-layout.md) | DONE | 001 | Introduce `src/`, `dist/`, shared modules, platform adapters, and archive layout |
| 3 | [003-preserve-mute-on-restore.md](003-preserve-mute-on-restore.md) | DONE | 002 | Stop saved-volume restoration from unmuting playback |
| 4 | [004-overlay-lifecycle-cleanup.md](004-overlay-lifecycle-cleanup.md) | DONE | 002 | Prevent listener and observer leaks during SPA replacement |
| 5 | [005-accessible-mute-control.md](005-accessible-mute-control.md) | DONE | 002 | Make the replacement mute control keyboard and screen-reader accessible |
| 6 | [006-dialog-focus-management.md](006-dialog-focus-management.md) | DONE | 002 | Implement correct options-dialog focus behavior |
| 7 | [007-release-2.4.md](007-release-2.4.md) | DONE | 003, 004, 005, 006 | Document, build, archive, and verify the 2.4 release |

Plans 003-006 may be implemented independently after plan 002. Plan 007 is the release gate and must be last.

## Target layout

```text
archive/legacy/                 # unchanged 1.x-2.3.2 snapshots and patch notes
docs/                           # architecture, testing, and release documentation
src/
  entries/                      # YouTube and Twitch userscript entry points/metadata
  platforms/                    # site selectors, player APIs, and SPA navigation adapters
  shared/                       # settings, overlay, options UI, lifecycle, and volume logic
scripts/                        # deterministic build and metadata validation
tests/
  fixtures/                     # minimal YouTube/Twitch player DOMs
  unit/
  integration/
dist/                           # generated installable .user.js files
package.json
pnpm-lock.yaml
README.md
```

## Global boundaries

- Never edit a file under `archive/legacy/` after it is moved there.
- Do not add network calls, telemetry, privileged userscript grants, or runtime dependencies.
- Keep `@grant none`, the existing storage keys, control IDs, defaults, and visible behavior unless a plan explicitly changes them.
- Generated `dist/*.user.js` files remain single-file Tampermonkey/Violentmonkey artifacts.
- Use pinned development dependencies and commit `pnpm-lock.yaml`.
- Every plan finishes with `pnpm check`; expected result: exit code 0 and all tests passing.

## Considered and rejected

- `localStorage` is appropriate for same-origin settings and is not a security finding here.
- The guarded Twitch `history.pushState`/`replaceState` wrappers preserve `this`, arguments, and return values; replacing them is not part of 2.4.
- The broad bootstrap observers disconnect after locating a player. Their existence alone is not a finding.
- No credential patterns, dangerous HTML/eval sinks, external requests, runtime dependencies, or elevated userscript grants were found.
