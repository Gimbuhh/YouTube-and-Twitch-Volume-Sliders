# Releasing

1. Change canonical source and tests under `src/` and `tests/`.
   - Keep userscript `// @name` values stable and version-free; put the release number in `// @version` and release artifacts instead.
2. Add one release-note source at `release-notes/<version>.md`. Do not start it with `# Volume Sliders <version>`; the GitHub Release title already supplies that heading.
3. Add a matching `CHANGELOG.md` entry for the same version and date. The changelog and release notes must cover the same release-version-to-release-version userscript changes using the established `Added`, `Changed`, and `Fixed`-style sections, but they should not be verbatim copies: keep the changelog concise and historical, and make release notes explanatory and benefit-focused. When platform labels are useful, group them in the order `Both`, `YouTube`, then `Twitch`. Do not include repository maintenance, README link updates, or test-only notes in user-facing release notes or the changelog.
4. Update the README install links so both platform links point at the current `v<version>` GitHub Release assets.
5. Run `npm ci` and `npm run check`.
6. Run `npm run release -- <version>` exactly once (for example, `npm run release -- 2.4.4`).
7. Run `node scripts/verify-release.mjs <version>`.
8. Commit the source, release notes, changelog, README, archive, and generated `dist` files; tag the commit (for example, `v2.4.4`).
9. Push the tag and let the GitHub Release workflow publish dot-named userscript assets, such as `YouTube.Volume.Slider.<version>.user.js`, with digests verified against `archive/releases/<version>/SHA256.json`.

To backfill an existing historical tag, run the Release workflow manually from the current default branch and provide the immutable `v<version>` tag. The workflow validates the current tree's canonical notes, archived scripts, manifest, hashes, and target tag without checking out or executing code from the historical tag. Existing Releases are updated idempotently and assets are replaced only after digest verification.

README install links should remain pinned to the latest supported release assets; historical backfills do not change them.

The release command updates `package.json` and both entry versions together, runs the full check, rejects an existing destination, and writes matching platform artifacts and patch notes to `archive/releases/<version>/`. It snapshots every file it owns and restores the pre-command bytes if packaging fails. Pre-existing worktree changes are preserved, while unexpected new paths abort the transaction. Archives and Git tags are immutable. When Git is unavailable, SHA-256 manifests provide the integrity fallback. Automatic update metadata points at the committed `dist/` files on `main`, and the release workflow verifies uploaded asset digests after publishing.

## Historical releases

Run `npm run history:generate` after adding or correcting a preserved file under `archive/legacy/`. This regenerates the evidence-based release notes, version history, and historical release manifest. Exact dates must come from trustworthy evidence; use an explicit unknown date rather than estimating one.
