# Persist native Twitch mute changes safely

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P1 correctness  
Depends on: plan 003 recommended

## Objective

Native Twitch mute/unmute actions must update the saved mute preference after startup protection ends, without persisting transient initialization state.

## Evidence

`saveMute` exists at `src/platforms/twitch.js:1034-1037`, but is called only from custom control paths. The external/native `volumechange` handler at `2209-2229` synchronizes UI and volume but never persists `isMuted(video)`. Reload/navigation can therefore restore a stale mute preference.

## Scope

In scope: Twitch volumechange ownership/startup guard, integration tests, generated Twitch dist. Out of scope: changing saved-volume semantics, YouTube, redesigning startup lock durations without evidence.

## Implementation steps

1. Add tests for native API mute and unmute followed by `volumechange`; after the startup/user-intent windows, assert `tm-twitch-muted` follows native state and recreation restores it.
2. Add startup-lock tests where transient initialization mute changes must not overwrite saved preference.
3. Persist mute in the authoritative external-change branch only. Do not write it in early-return/correction branches whose purpose is rejecting Twitch initialization overrides.
4. Test interaction with custom slider unmute, custom mute button, delayed restore cancellation, and user-intent grace.

## Verification

- `pnpm test:integration`
- `pnpm check`

## Done criteria

- Genuine native mute/unmute persists after startup.
- Transient initialization changes cannot corrupt saved mute.
- Custom control behavior remains unchanged.

## Stop conditions

STOP if Twitch emits indistinguishable late initialization events after the current lock. Capture a deterministic event sequence and revise the ownership state machine instead of extending timeouts blindly.
