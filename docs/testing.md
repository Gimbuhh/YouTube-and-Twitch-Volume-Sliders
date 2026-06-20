# Testing

`pnpm check` runs deterministic builds, parsed metadata validation, JavaScript syntax parsing, Node unit tests, isolated jsdom integration tests, and generated-artifact consistency checks.

Unit tests cover shared settings and volume functions. Integration tests execute the generated `dist/*.user.js` files in explicit YouTube and Twitch fixtures. They verify standalone startup, mute-safe restoration, direct slider intent, accessible controls, options-dialog focus, mode off, external detachment, and reattachment. This prevents source-only scaffolding from passing while production artifacts are broken.

Tests do not contact either service. A frozen install is the only step that may access a package registry.
