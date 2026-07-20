# Add a truthful historical release backfill path

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P0 release correctness

## Objective

Keep tag-push publishing limited to the version represented by that tagged tree, and provide an explicit idempotent historical backfill from the trusted current default-branch workflow. Never claim that an old tag push is using today's archive: GitHub executes the workflow and repository tree at the tag's commit.

## Current defect

`.github/workflows/release.yml:22-26` labels a package/tag mismatch “historical” and prints that archived assets are published, then guards every remaining step with `publish == 'true'`. More fundamentally, editing today's tag-push workflow cannot repair old tags whose commits contain older workflow logic or no current archive layout.

## Policy and scope

- `push.tags`: publish only when tag version exactly equals that checked-out tree's `package.json` version; mismatch or malformed tag fails explicitly.
- `workflow_dispatch`: run from the current default branch with required `tag` input for an existing immutable tag. Read archived assets and canonical `release-notes/<version>.md` from the trusted current tree; do not checkout or execute scripts from the historical tag.
- Historical assets are the two `.user.js` files under `archive/releases/<version>/`; validate them against `SHA256.json` `youtube.archive` and `twitch.archive`. Current releases retain current-dist-to-archive parity verification.

In scope: workflow, a pure preflight module with unit tests, and `docs/releasing.md`. Out of scope: changing tag targets, archive bytes, or publishing during implementation.

## Implementation steps

1. Create a pure preflight module returning `{ mode, version, tag, youtubeAsset, twitchAsset, notesFile, manifestFile, expectedHashes }`. Validate `v` plus a repository-supported two- or three-component numeric version, tag/input agreement, canonical notes existence, manifest schema/hex hashes, and archive file hashes. It has no publication side effects.
2. For tag push, reject package mismatch; use current verification including `scripts/verify-release.mjs`.
3. Add `workflow_dispatch` with required tag. Verify the tag exists via GitHub/git metadata but keep checkout on the trusted current ref. Reject path separators or derived paths outside the version archive.
4. Define idempotency: if a Release exists, update notes and upload the two exact named assets with `--clobber`; verify resulting remote digests. If absent, create it against the existing verified tag.
5. Update docs, including backfill invocation and the evergreen README install link policy.

## Required tests

Current version; valid historical two-component and three-component versions; malformed tag; absent target tag (workflow test/mock); missing notes; malformed/missing manifest fields; invalid hex; archive mismatch; ref/tag mismatch; existing versus absent Release command selection; unexpected extra paths. Assert preflight performs no writes/publication.

## Verification

- `npm run test:unit`
- `npm run check`
- Parse workflow YAML with an installed project tool if present; otherwise use GitHub's workflow validation on a non-publishing branch/PR, never a tag.

## Done criteria

- Tag push cannot silently no-op.
- Historical backfill is explicit, current-ref, hash-verified, path-safe, and idempotent.
- No historical repository code executes with the current release token.
- Current publishing remains byte-identical to its verified archive.

## Stop conditions

STOP if maintainers do not want historical GitHub Releases. Replace the misleading mismatch branch with an explicit unsupported error and document that policy; do not build backfill automation.
