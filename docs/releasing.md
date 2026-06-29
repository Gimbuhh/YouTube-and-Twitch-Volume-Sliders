# Releasing

1. Change canonical source and tests under `src/` and `tests/`.
   - Keep userscript `// @name` values stable and version-free; put the release number in `// @version` and release artifacts instead.
2. Add one release-note source at `release-notes/<version>.md`. Do not start it with `# Volume Sliders <version>`; the GitHub Release title already supplies that heading.
3. Add a matching `CHANGELOG.md` entry for the same version and date. The changelog and release notes must describe the same release-version-to-release-version user-facing changes using the established `Added`, `Changed`, and `Fixed`-style sections. Test-only notes may stay in a separate `Tests` section, but user-facing items should not appear in only one file.
4. Update the README install links so both platform links point at the current `v<version>` GitHub Release assets.
5. Run `pnpm install --frozen-lockfile` and `pnpm check`.
6. Run `pnpm release -- <version>` exactly once (for example, `pnpm release -- 2.4.4`).
7. Run `node scripts/verify-release.mjs <version>`.
8. Commit the source, release notes, changelog, README, archive, and generated `dist` files; tag the commit (for example, `v2.4.4`).
9. Push the tag and let the GitHub Release workflow publish dot-named userscript assets, such as `YouTube.Volume.Slider.<version>.user.js`, with digests verified against `archive/releases/<version>/SHA256.json`.

The release command updates `package.json` and both entry versions together, runs the full check, rejects an existing destination, and writes matching platform artifacts and patch notes to `archive/releases/<version>/`. It snapshots every file it owns and restores the pre-command bytes if packaging fails. Pre-existing worktree changes are preserved, while unexpected new paths abort the transaction. Archives and Git tags are immutable. When Git is unavailable, SHA-256 manifests provide the integrity fallback. Automatic update metadata points at the committed `dist/` files on `main`, and the release workflow verifies uploaded asset digests after publishing.

## Historical releases

Run `pnpm history:generate` after adding or correcting a preserved file under `archive/legacy/`. This regenerates the evidence-based release notes, version history, and historical release manifest. Exact dates must come from trustworthy evidence; use an explicit unknown date rather than estimating one.
