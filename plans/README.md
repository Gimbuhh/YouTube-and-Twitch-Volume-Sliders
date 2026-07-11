# Advisor implementation plans

Audit baseline: `b454d8a` (2026-07-11). These plans were selected after the standard-depth audit and the reported YouTube loading-state volume regression.

| Order | Plan | Status | Depends on |
|---|---|---|---|
| 1 | [001 — Preserve YouTube loading-state volume intent](001-youtube-loading-volume-intent.md) | TODO | — |
| 2 | [002 — Rebind YouTube when the active video changes](002-youtube-active-video-rebinding.md) | TODO | —; coordinate tests with 001 |
| 3 | [003 — Cancel Twitch delayed restores](003-twitch-delayed-restore-lifecycle.md) | TODO | — |
| 4 | [004 — Make historical-tag releases real or explicitly fail](004-historical-tag-release-path.md) | TODO | — |
| 5 | [005 — Harden GitHub Actions release trust boundaries](005-ci-release-hardening.md) | TODO | 004 recommended first |
| 6 | [006 — Reduce whole-document observer work](006-observer-lifecycle-efficiency.md) | TODO | 002, 003 |
| 7 | [007 — Gate YouTube attachment by supported page](007-youtube-supported-page-gate.md) | TODO | 002 recommended first |
| 8 | [008 — Preserve YouTube native-control inline state](008-youtube-native-visibility-state.md) | TODO | — |
| 9 | [009 — Preserve exact keyboard volume steps on both platforms](009-twitch-keyboard-volume-steps.md) | TODO | — |
| 10 | [010 — Persist native Twitch mute changes safely](010-twitch-native-mute-persistence.md) | TODO | 003 recommended first |
| 11 | [011 — Support partial Twitch player APIs](011-twitch-partial-api-compatibility.md) | TODO | — |

## Execution order

Plans 001 and 002 may be implemented independently but their fixtures must distinguish startup event ordering from video-identity replacement. Both deliberately land before the observer refactor. Plan 003 is independent runtime work. Plans 004 and 005 are CI-only; plan 004 must first define the current-ref manual backfill contract that plan 005 isolates. Plans 007–011 are focused follow-ups; 009 and 011 are small, high-leverage compatibility fixes.

Every executor must run `pnpm install --frozen-lockfile` if dependencies are absent, then `pnpm check`. The audit machine did not have `node_modules`, so the complete baseline could not be executed without a prohibited audit-time install.

## Considered but not selected

- Permissive persisted-volume parsing: real but low user impact.
- Build byte/function-count heuristics: maintainability concern, not urgent while deterministic artifact and integration checks remain healthy.
- Broader secret-pattern scanner: worthwhile, but lower leverage than reducing the release token trust boundary.
- Release documentation drift: fold into plan 004 if that workflow changes documentation.
- Dependency vulnerability audit: policy and exception handling need maintainer input before making it a blocking gate.
