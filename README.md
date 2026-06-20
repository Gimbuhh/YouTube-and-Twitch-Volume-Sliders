# YouTube and Twitch Volume Sliders

Compact, accessible volume controls for YouTube and Twitch, distributed as standalone userscripts for Tampermonkey and Violentmonkey.

Both scripts replace or complement the sites' native controls with a small indicator that expands into a full slider when needed. They share the same tested core while keeping site-specific behavior isolated.

## Install

- [YouTube Volume Slider 2.4.3](dist/youtube-volume-slider.user.js)
- [Twitch Volume Slider 2.4.3](dist/twitch-volume-slider.user.js)

Install a current userscript manager such as Tampermonkey or Violentmonkey in a modern browser, download the appropriate file above, and open it with the userscript manager. Automatic update URLs are intentionally absent until stable public HTTPS hosting is chosen.

## Features

- Compact control that expands to a full range slider
- Optional native-control replacement and persistent volume settings
- Mute-safe restoration across reloads and single-page navigation
- Keyboard and screen-reader accessible mute and options controls
- Site-specific YouTube and Twitch adapters backed by shared UI and lifecycle code

## Development

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm release -- 2.4.3
```

Edit canonical code under `src/`; never edit `dist/` or archives manually. `dist/` is generated, `archive/legacy/` preserves historical releases, and `archive/releases/` contains immutable packaged releases. See [architecture](docs/architecture.md), [testing](docs/testing.md), [releasing](docs/releasing.md), and [contributing](CONTRIBUTING.md).

`node_modules/` is machine-local and intentionally excluded. Recreate it with the frozen lockfile instead of copying it between Windows and macOS; pnpm installs only native packages for the current machine.

## Releases

Every release contains the standalone `.user.js` files available for that version and matching release notes. The maintained history is recorded in the [changelog](CHANGELOG.md), and the evidence-based [version history](docs/version-history.md) covers original pre-project builds preserved under `archive/legacy/`.

Pull requests and pushes run the full check on Windows. A version tag such as `v2.4.3` runs the checks again and publishes both verified scripts as GitHub Release assets. See [releasing](docs/releasing.md) for the maintainer workflow.

## Contributing

Bug reports and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing source or generated artifacts. Please report security concerns according to [SECURITY.md](SECURITY.md).

## Privacy

The userscripts make no network requests or telemetry calls. Settings remain in each site's `localStorage`.

## Troubleshooting

Reload the video page after installation, confirm the userscript is enabled for the matching domain, and check that its mode is not set to Off. If site markup changes, run `pnpm check` and report the affected site, browser, userscript manager, and page type.
