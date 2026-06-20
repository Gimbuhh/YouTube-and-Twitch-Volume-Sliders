# Releasing

1. Change canonical source and tests under `src/` and `tests/`.
2. Add one release-note source at `release-notes/<version>.md`.
3. Run `pnpm install --frozen-lockfile` and `pnpm check`.
4. Run `pnpm release -- <version>` exactly once (for example, `pnpm release -- 2.4`).
5. Run `node scripts/verify-release.mjs <version>`.
6. Commit the source, release notes, archive, and generated `dist` files; tag the commit (for example, `v2.4.1`).
7. Create a GitHub Release from that tag and attach both `dist/*.user.js` files.

The release command updates both entry versions together, builds and validates both artifacts, verifies `archive/legacy/`, rejects an existing destination, and writes matching platform artifacts and patch notes to `archive/releases/<version>/`. Archives and Git tags are immutable. When Git is unavailable, SHA-256 manifests provide the integrity fallback. Publishing and automatic update metadata are separate, reviewed operations.
