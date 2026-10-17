# Test and legacy-code audit — 2026-10-17

The audit covered maintained source, unit and artifact integration tests, browser harnesses, test helpers, build/release scripts, dependency consumers, and CI entry points. Three subagents independently examined runtime/UI, audio normalization, and browser coverage. The initial worktree was clean, and the baseline `npm run check` passed all 195 tests.

## Removals and retained candidates

| Candidate | Evidence and decision |
| --- | --- |
| `scripts/lib.mjs` exported `ROOT` | No imports or references in maintained source, tests, scripts, configuration, or documentation; scripts resolve their own roots. Removed the unused export. |
| Twitch browser fixture `lastArrowPrevented` | Written by an extra keydown listener, never read. Current assertions consume `__smokeKeyEvents`, which records prevention after dispatch. Removed the obsolete state and listener. |
| Slider target `pointerup`/`pointercancel` listeners | The same completion function already runs through window capture for connected sliders, including releases outside the slider. A real DOM propagation regression demonstrates one completion per active press after removing the duplicate listeners. |
| Historical RMS implementation | Retained: `scripts/compare-normalization.mjs` directly imports the frozen fixture as a comparison oracle. Production bundles retain checks excluding the old engine. |
| Legacy snap-to-five preference migration | Retained: both platform integration tests exercise existing saved preferences migrating to adjustment steps. Existing users can still hold this storage format. |
| LUFS windows, channel-energy checks, and audio fixtures | Retained: they verify weighting, timing, cleanup, and independent FFmpeg comparisons beyond the controller's current field usage. |
| Browser scenarios and focused unit tests | Retained: rendering, native picker behavior, real capture, boundary cases, and cleanup protect distinct behavior. No existing test was removed or skipped. |
| Archive/history tooling and files | Retained: package scripts, release documentation, CI, and archive manifests consume them. Historical duplication is intentional. |
| Build size/function guards | Retained: passing behavior tests alone does not prove these artifact truncation checks obsolete. |

All three development dependencies have active consumers: esbuild for bundling, jsdom for runtime/integration tests, and playwright-core for browser checks.

## Bugs reproduced and corrected

- **Slider completion:** unrelated page releases/blur invoked completion and layout, and a slider release invoked completion twice through capture and target listeners. The new DOM test failed before the ownership guard and listener removal; it checks owned/outside release, cancellation, blur, and disposal.
- **Normalization teardown:** throwing volume getters/setters interrupted disable/rebind or source-reset cleanup, leaving capture resources alive. Regressions failed before the fix. Cleanup now proceeds; failed writes roll back output bookkeeping so a recovered source preserves the selected volume.
- **YouTube API fallback:** missing optional methods or throwing private APIs could prevent initialization, mute control, or volume adjustment. A working getter with a failed setter could also overwrite native fallback readback after the five-second intent guard expired. Built-artifact tests exercise these boundaries and recovery.
- **Test runtime teardown:** a MutationObserver restarted after `disconnect()` was no longer registered for cleanup. The regression received a second callback after closing the runtime before the fix; it now receives only the intended pre-close callback.
- **Browser smoke false green:** active-player scenarios collected uncaught page errors without checking them. Injecting `setTimeout(() => { throw new Error('AUDIT_ASYNC_ERROR'); }, 0)` into a temporary YouTube bundle passed the original smoke suite. The fixed suite rejects the same artifact with the error stack, and the ordinary artifacts pass.

Release preflight coverage now exercises temporary archives, both platform hashes, uppercase valid hashes, tampering, malformed hashes, missing files, directory substitutions, historical backfills, package mismatches, and invalid modes. Previously only tag/path helper functions were tested.

## Verification scope and limits

The normal check includes archive integrity, canonical builds, metadata, JavaScript parsing, unit/artifact integration tests, deterministic rebuilds, and the existing secret-pattern scan. Browser checks use installed Chrome with local fixtures routed onto platform origins; they do not contact live YouTube or Twitch.

Final `npm run check`: **217 tests passed, zero failures or skips**. The increase from 195 includes regressions and release-preflight subtests; it does not reflect deleting or disabling any original tests. Browser smoke and normalization-icon checks also pass against the final bundles. The standalone userscript validator confirms leading metadata, synchronized numeric versions, valid syntax, and absence of unresolved modules, local filesystem paths, source maps, and `@require`.

`node tests/browser/normalization.mjs` passed all seven final-artifact cases: both platforms at selected 30%/40%, YouTube with Blob worklet loading blocked by CSP, Twitch using native audio frames, and Twitch with both analysis APIs unavailable. The cases cover mute/preference preservation, loud-return timing, CORS fallback, resource release, and continued ordinary playback.

Both generated scripts remain version 2.9. Exact UTF-8 artifact bytes (including newlines), compared with the clean baseline:

| Artifact | Before | After | Final SHA-256 |
| --- | ---: | ---: | --- |
| `dist/youtube-volume-slider.user.js` | 177,876 | 178,317 | `D4EFD442DA3A271D019285BA6C94AD03661085CEBD28824B293CA152F60EBA86` |
| `dist/twitch-volume-slider.user.js` | 199,425 | 199,442 | `B3ACD51848CD6870A9206AA6FEC8A870E578ED6B3DC948DCC46B35D9111F0452` |

The independent FFmpeg comparison passed for three synthetic tones and 24 renders, with the largest meter difference below 0.04 LU. The simulated 30-minute audio soak at 96 kHz processed all 36,000 expected frames. The optional external recording corpus was not supplied.

An instrumented Node run also passed the original 195 tests. Its source coverage excludes platform/UI code evaluated from bundled artifacts, so uncovered source lines were not treated as evidence of dead code or missing behavior coverage.

Live-service changes, protected streams, and every userscript manager/browser combination remain outside this fixture audit. Existing release archives are intentionally unchanged; local updated distribution files are validated against current source, rather than against an older immutable release's hashes.

No required verification is blocked. Temporary mutation artifacts and audit logs were removed after verification; dependencies were retained. Changes remain local and uncommitted.
