# Contributing

Thank you for helping improve the YouTube and Twitch Volume Sliders.

## Before opening a change

- Use an existing issue or open a focused bug report for behavior changes.
- Keep YouTube- and Twitch-specific behavior under `src/platforms/` and reusable behavior under `src/shared/`.
- Edit canonical source and tests, not `dist/` or files under `archive/`.
- Do not add telemetry, runtime network requests, privileged userscript grants, or runtime dependencies without prior discussion.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
```

Include focused tests for changed behavior. When source changes, include the deterministically regenerated `dist/*.user.js` files. Release archives are created only by the maintainer release workflow.

## Pull requests

Describe the user-visible problem, the chosen behavior, and verification performed. Keep unrelated formatting and refactoring out of the same pull request.
