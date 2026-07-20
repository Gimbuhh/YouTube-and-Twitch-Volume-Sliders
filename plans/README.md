# Advisor implementation plans

Plans are organized by their implemented version: `2.7/` and `2.7.1/` preserve completed implementation records. Plan numbers remain continuous across version folders so references stay unambiguous.

Audit baseline: `b454d8a` (2026-07-11). These plans were selected after the standard-depth audit and the reported YouTube loading-state volume regression.

| Order | Plan | Status | Depends on |
|---|---|---|---|
| 1 | [001 — Preserve YouTube loading-state volume intent](2.7/001-youtube-loading-volume-intent.md) | DONE in 2.7 | — |
| 2 | [002 — Rebind YouTube when the active video changes](2.7/002-youtube-active-video-rebinding.md) | DONE in 2.7 | —; coordinate tests with 001 |
| 3 | [003 — Cancel Twitch delayed restores](2.7/003-twitch-delayed-restore-lifecycle.md) | DONE in 2.7 | — |
| 4 | [004 — Make historical-tag releases real or explicitly fail](2.7/004-historical-tag-release-path.md) | DONE in 2.7 | — |
| 5 | [005 — Harden GitHub Actions release trust boundaries](2.7/005-ci-release-hardening.md) | DONE in 2.7 | 004 recommended first |
| 6 | [006 — Reduce whole-document observer work](2.7/006-observer-lifecycle-efficiency.md) | DONE in 2.7 | 002, 003 |
| 7 | [007 — Gate YouTube attachment by supported page](2.7/007-youtube-supported-page-gate.md) | DONE in 2.7 | 002 recommended first |
| 8 | [008 — Preserve YouTube native-control inline state](2.7/008-youtube-native-visibility-state.md) | DONE in 2.7 | — |
| 9 | [009 — Preserve exact keyboard volume steps on both platforms](2.7/009-twitch-keyboard-volume-steps.md) | DONE in 2.7 | — |
| 10 | [010 — Persist native Twitch mute changes safely](2.7/010-twitch-native-mute-persistence.md) | DONE in 2.7 | 003 recommended first |
| 11 | [011 — Support partial Twitch player APIs](2.7/011-twitch-partial-api-compatibility.md) | DONE in 2.7 | — |

## Execution order

Plans 001 and 002 may be implemented independently but their fixtures must distinguish startup event ordering from video-identity replacement. Both deliberately land before the observer refactor. Plan 003 is independent runtime work. Plans 004 and 005 are CI-only; plan 004 must first define the current-ref manual backfill contract that plan 005 isolates. Plans 007–011 are focused follow-ups; 009 and 011 are small, high-leverage compatibility fixes.

Every executor must run `npm ci` if dependencies are absent, then `npm run check`. The audit machine did not have `node_modules`, so the complete baseline could not be executed without a prohibited audit-time install.

## Completed 2.7.1 plans

| Order | Plan | Status | Depends on |
| --- | --- | --- | --- |
| 1 | [012 — Add real-browser smoke coverage](2.7.1/012-real-browser-smoke-coverage.md) | DONE in 2.7.1 | — |
| 2 | [013 — Unify Twitch controls visibility holds](2.7.1/013-twitch-controls-visibility-holds.md) | DONE in 2.7.1 | 012 completed first |
| 3 | [014 — Extract shared platform interaction modules](2.7.1/014-shared-platform-interaction-extraction.md) | DONE in 2.7.1 | 012 and 013 completed first |

The 2.7.1 work landed in order from regression protection to refactoring. Plan 012 established real-browser evidence before plans 013 and 014 changed ownership and module boundaries.

## Considered but not selected

- Permissive persisted-volume parsing: real but low user impact.
- Build byte/function-count heuristics: maintainability concern, not urgent while deterministic artifact and integration checks remain healthy.
- Broader secret-pattern scanner: worthwhile, but lower leverage than reducing the release token trust boundary.
- Release documentation drift: fold into plan 004 if that workflow changes documentation.
- Dependency vulnerability audit: policy and exception handling need maintainer input before making it a blocking gate.
