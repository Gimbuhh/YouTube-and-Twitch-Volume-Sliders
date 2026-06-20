# Plan 007: Package and document version 2.4

## Objective

Publish a reproducible 2.4 release from canonical source, clearly distinguish source from generated artifacts, and make the current installable files obvious.

## Scope

Create/update `README.md`, `docs/testing.md`, `docs/releasing.md`, `CHANGELOG.md`, release automation, metadata, and `dist/`. Create immutable 2.4 release snapshots under `archive/releases/2.4/`. Do not publish externally, create GitHub issues/releases, or invent update URLs without confirmed hosting.

Use the user-requested version string `2.4` in both `@version` fields and release folder names. Preserve existing `@name`, `@match`, `@run-at`, icons, descriptions, and `@grant none` unless a prior plan explicitly changed accessible labels inside runtime UI.

## Steps

1. Replace the temporary plan 001 build script with the completed deterministic plan 002 build and make `pnpm check` run build, metadata validation, syntax checks, unit tests, integration tests, and a clean-tree/generated-artifact consistency check.
2. Add `scripts/release.mjs` that accepts an explicit version, rejects dirty or mismatched generated output when Git is available, updates both entry metadata together, builds, validates, and copies artifacts plus release notes to `archive/releases/<version>/`.
3. The release script must reject an existing archive destination, mismatched YouTube/Twitch versions, non-numeric userscript versions, missing patch notes, and any attempt to modify `archive/legacy/`.
4. Write a root README with project purpose, supported sites, installation links to both `dist` files, feature summary, browser/userscript-manager prerequisites, development commands, directory map, privacy statement (no network/telemetry, settings in localStorage), and troubleshooting guidance.
5. Document testing layers and release steps. State that source changes happen under `src/`, `dist/` is generated, and archives are immutable.
6. Add a `CHANGELOG.md` 2.4 entry covering the modular source migration, verification harness, mute-preserving restoration, lifecycle cleanup, semantic mute button, and dialog focus management.
7. Generate `PATCH_NOTES_2.4.txt` in each 2.4 archive platform folder from the same release-note source so wording cannot drift.
8. Only add `@downloadURL`/`@updateURL` after a maintainer supplies stable HTTPS raw-file URLs. Otherwise document manual installation and leave these keys absent.
9. Run the release command once for `2.4`, then verify archived artifacts exactly match `dist` by SHA-256.

## Verification

From a clean dependency install, run `pnpm install --frozen-lockfile`, `pnpm check`, and the documented release verification command. Expected: exit code 0, no todo tests remain, both metadata versions equal `2.4`, builds are deterministic, and archive/dist hashes match by platform.

Run a secret-pattern scan that reports filenames only. Expected: no matches. Confirm generated artifacts contain no external requests, `@require`, elevated grants, local paths, or source maps.

## Done criteria

- Root documentation identifies the two current installable 2.4 files unambiguously.
- A fresh environment can build and test from documented commands.
- Both sites ship the same version and release-note source.
- Legacy and 2.4 archives are immutable; `dist` is reproducible.
- No automatic update metadata is fabricated without real hosting.

## Maintenance and escape hatches

Future changes update canonical source and tests, then regenerate distribution files; they never edit `dist` or archives directly. If the workspace remains outside Git, the release script should warn and rely on hash manifests, not pretend clean-tree verification succeeded. If stable hosting is later chosen, add update URLs in a separate reviewed release because they create a supply-chain trust boundary.
