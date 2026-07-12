# Support partial Twitch player APIs

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P1 compatibility

## Objective

A discovered Twitch API with working `getVolume`/`setVolume` but no `setMuted` must still receive volume changes; optional mute methods must degrade independently.

## Evidence

`src/platforms/twitch.js:854-863` accepts APIs based only on `getVolume` and `setVolume`. `setVolume()` at `899-908` calls `api.setMuted(false)` when `api.isMuted()` is true without verifying `setMuted`. The caught TypeError falls back to `video.volume`, while `getVolume()` continues using the API, so UI can snap back and the actual player remains unchanged.

## Scope

In scope: Twitch API capability checks/fallback semantics, integration fixture/test, generated Twitch dist. Out of scope: React API discovery redesign, cached-API invalidation, YouTube.

## Implementation steps

1. Add a Twitch fixture API with `getVolume`, `setVolume`, and `isMuted`, but no `setMuted`. Direct slider input must call API `setVolume` and the displayed value must remain.
2. Separate optional unmute capability from required volume capability. Never abandon a valid `setVolume` call because optional `setMuted` is absent or throws.
3. Define mute fallback: if API unmute is unavailable, update native video mute state when safe, then still call API volume. Preserve `preserveMute` behavior during restore.
4. Add variants where `isMuted` is absent and where `setMuted` throws; assert volume still reaches the API exactly once.

## Verification

- `pnpm test:integration`
- `pnpm check`

## Done criteria

- Optional mute API failures cannot prevent API volume changes.
- Full APIs retain current behavior.
- Restore with `preserveMute` never unmutes accidentally.

## Stop conditions

STOP if a real partial API requires a different order to avoid Twitch immediately overwriting volume. Record the call/event trace and specify that adapter contract before adding retries.
