# Plan 002: Introduce canonical modular source

## Objective

Make 2.4 the first release built from maintainable source instead of editing copied userscript snapshots. Preserve single-file distribution artifacts while removing duplicated behavior from the YouTube and Twitch implementations.

## Context

The current YouTube script has 107 named top-level functions and Twitch has 126; 94 names overlap. Shared examples include `normalizeBooleanSetting`, `getSavedVolume`, `snapTo5`, `createOptionsRadio`, `setOverlayExpanded`, and `removeOverlay`. Platform-specific examples are YouTube's `getYouTubePlayer` (around line 849) and Twitch's `getTwitchPlayerApi` (around line 939).

## Scope and boundaries

Create the target layout in `plans/README.md`. Move the two existing top-level version directories, without changing their contents, under `archive/legacy/`. Add canonical modules under `src/`, build scripts under `scripts/`, architecture documentation, and generated artifacts under `dist/`.

Use `esbuild` as a pinned development dependency to bundle two entry points into IIFEs. Do not add runtime dependencies, source maps containing local absolute paths, minification, transpilation below syntax already used by 2.3.2, or site behavior changes.

## Module responsibilities

- `src/entries/youtube.user.js` and `twitch.user.js`: metadata plus composition only.
- `src/platforms/youtube.js` and `twitch.js`: selectors, player API, native controls, controls visibility, and SPA navigation.
- `src/shared/settings.js`: normalization and storage access using injected key maps.
- `src/shared/volume.js`: clamping, snapping, persistence scheduling, and platform volume interface.
- `src/shared/overlay.js`: overlay DOM, expansion, slider interaction, indicator, and cleanup contract.
- `src/shared/options.js`: options button/dialog DOM and state.
- `src/shared/lifecycle.js`: attach, detach, observer ownership, and reattach scheduling.
- `src/shared/styles.js`: shared CSS plus injected platform theme values.

Prefer dependency injection through a small `platform` object over branching on a site name inside shared modules. Keep platform selectors and React/YouTube private API access out of shared files.

## Steps

1. Copy 2.3.2 behavior into the two entry builds and prove generated output passes all plan 001 characterization tests before extracting code.
2. Move one coherent function family at a time into the modules above. After every family, run `pnpm check` and compare normalized generated behavior with the pre-extraction build.
3. Preserve all storage keys, DOM IDs, defaults, metadata matches, colors, timings, labels, and CSS declarations. Preserve intentional platform differences such as Twitch mute persistence and startup correction.
4. Configure esbuild deterministically: two fixed entry points, browser platform, IIFE format, no minification, banner metadata, stable output names `dist/youtube-volume-slider.user.js` and `dist/twitch-volume-slider.user.js`.
5. Add a build-time assertion that each artifact has exactly one userscript header, one strict-mode entry IIFE, no unresolved `import`/`export`, no `@require`, and no source path outside the repository.
6. Update tests to import pure shared modules directly and execute built artifacts for integration coverage. Remove duplicated tests that only restate shared behavior; retain adapter-specific cases.
7. Write `docs/architecture.md` describing ownership boundaries and the rule that `dist/` is generated.

## Verification

Run `pnpm build` twice and hash `dist/`; expected hashes are identical across runs. Run `pnpm check`; expected exit 0 with the same four todo tests from plan 001. Install both outputs in isolated jsdom fixtures; expected one overlay and options button per platform.

Verify every file under `archive/legacy/` against a before-move hash manifest. Expected: no content changes.

## Done criteria

- There is one canonical implementation of shared settings, overlay, options, and lifecycle behavior.
- Platform modules contain site-specific selectors/APIs and no copied generic UI implementation.
- Both generated files remain independently installable single-file userscripts.
- Archive snapshots are immutable and the full suite passes.

## Escape hatches

If extraction requires a platform conditional in more than two shared modules, STOP and reconsider the platform interface. If built behavior cannot be characterized without changing 2.3.2 semantics, preserve the duplication temporarily and report the specific function family rather than improvising a redesign.
