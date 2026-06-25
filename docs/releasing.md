# Releasing

1. Change canonical source and tests under `src/` and `tests/`.
2. Add one release-note source at `release-notes/<version>.md`.
3. Run `pnpm install --frozen-lockfile` and `pnpm check`.
4. Run `pnpm release -- <version>` exactly once (for example, `pnpm release -- 2.4.4`).
5. Run `node scripts/verify-release.mjs <version>`.
6. Commit the source, release notes, archive, and generated `dist` files; tag the commit (for example, `v2.4.4`).
7. Push the tag and let the GitHub Release workflow publish dot-named userscript assets, such as `YouTube.Volume.Slider.<version>.user.js`, with digests verified against `archive/releases/<version>/SHA256.json`.

The release command updates `package.json` and both entry versions together, runs the full check, rejects an existing destination, and writes matching platform artifacts and patch notes to `archive/releases/<version>/`. It snapshots every file it owns and restores the pre-command bytes if packaging fails. Pre-existing worktree changes are preserved, while unexpected new paths abort the transaction. Archives and Git tags are immutable. When Git is unavailable, SHA-256 manifests provide the integrity fallback. Automatic update metadata points at the committed `dist/` files on `main`, and the release workflow verifies uploaded asset digests after publishing.

## Historical releases

Run `pnpm history:generate` after adding or correcting a preserved file under `archive/legacy/`. This regenerates the evidence-based release notes, version history, and historical release manifest. Exact dates must come from trustworthy evidence; use an explicit unknown date rather than estimating one.
