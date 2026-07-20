# Harden GitHub Actions release trust boundaries

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P1 security  
Depends on: plan 004 recommended

## Objective

Run dependency installation, builds, and tests without a write-capable token; grant `contents: write` only to the minimal publisher job. Pin reusable actions to reviewed immutable commits.

## Evidence

`.github/workflows/release.yml:8-40` grants workflow-wide write permission before checkout, install, and the full check. Both workflows use mutable major tags for checkout, Node setup, and package-manager setup actions (`verify.yml:14-18`, `release.yml:15,28-32`).

## Scope

In scope: `.github/workflows/verify.yml`, `.github/workflows/release.yml`, optional Dependabot/Renovate configuration for action SHA updates, release documentation. Out of scope: application code, package upgrades, changing GitHub repository settings.

## Implementation steps

1. Split release verification/build from publication. `verify` has only `contents: read`; it checks out the trusted event source, installs, runs checks/preflight, stages exactly two public scripts plus canonical notes and a machine-readable manifest of expected names/hashes, then uploads one artifact.
2. Make `publish` depend on `verify`, with only job-level `contents: write`. It uses pinned `actions/download-artifact` and `gh`, downloads exactly that artifact from the required job/run, rejects unexpected entries, hashes both scripts against the staged manifest, and publishes without checkout, Node/package-manager setup, or repository/package scripts.
3. Pin every third-party action to a full commit SHA. Keep a trailing comment with the human-readable release version.
4. Action update automation is optional and outside done criteria; if added, use Dependabot and keep SHA updates reviewable.
5. Set concurrency to the release tag or manual input with `cancel-in-progress: false`.

## Verification

- `npm run check`
- Static workflow validation.
- Review effective `permissions` for each job: verifier read-only, publisher write-only where needed.
- Confirm publisher consumes only verifier-produced assets and verifies both SHA-256 values.

## Done criteria

- No dependency install or repository script runs with `contents: write`.
- All `uses:` references are immutable full SHAs.
- Release assets are byte-identical to verified archive assets.
- Current and historical paths from plan 004 remain supported.
- Artifact-service metadata is not trusted as the release digest; the publisher recomputes SHA-256 from downloaded bytes.

## Stop conditions

STOP if artifact handoff changes bytes or GitHub does not expose the expected digest format. Preserve the single-job workflow temporarily and reduce permission scope as far as possible rather than weakening digest checks.
