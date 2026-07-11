# Preserve YouTube loading-state volume intent

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P0 correctness

## Objective

When a user changes volume while YouTube shows a black/loading video, that value must remain visible, be persisted, and survive the player's later initialization events. Player-originated changes outside the startup/user-intent window must continue to synchronize normally.

## Evidence and current behavior

`src/platforms/youtube.js:1750-1757` applies slider input and schedules persistence. `src/platforms/youtube.js:1837-1843` then treats every `volumechange` as authoritative:

```js
const onVideoVolumeChange = () => {
    if (!document.getElementById(OVERLAY_ID)) return;
    setSliderFromPlayer(slider, label, video);
    const muted = isMuted(video);
    saveMute(muted);
    if (!muted) scheduleSaveVolume(getVolume(video));
};
```

During YouTube initialization, a transient player value can therefore overwrite both the slider and the user's pending storage write. Twitch's established convention is the closest exemplar: `src/platforms/twitch.js:99`, `1040-1043`, and `2196-2229` distinguish recent user intent from startup corrections.

## Hypotheses the test must distinguish

1. Slider input sets the requested value, then YouTube emits a transient `volumechange` whose API getter returns the old/default value.
2. A navigation reattach restores an older persisted value after the user input.
3. The API ignores `setVolume` while loading and accepts it only after a readiness event.

Do not implement a readiness-event retry unless the new fixture proves hypothesis 3. The minimum expected fix is intent ownership around `volumechange`, following Twitch's model without copying Twitch-specific mute guards.

## Scope

In scope: `src/platforms/youtube.js`, `tests/integration/platforms.test.js`, regenerated `dist/youtube-volume-slider.user.js`. Shared helpers may be changed only if a focused unit test proves both platforms need the change.

Out of scope: Twitch behavior, visual styling, storage-key migration, release archives, telemetry, privileged userscript grants.

## Implementation steps

1. Extend `youtubeFixture` with a controllable API value: `setVolume` records calls and can optionally leave `getVolume()` unchanged until the test calls `commitVolume(value)`. Do not infer loading from CSS, network state, or jsdom's media readiness implementation.
2. Before production changes, add two failing cases: (a) saved volume 60 remains displayed immediately after overlay creation even while the API reports 50; (b) after slider input/change to 60, an API value of 50 plus `volumechange` cannot change slider, label, or `tm-yt-volume`. Advance the 150 ms persistence debounce explicitly or dispatch `change` before storage assertions.
3. Add explicit recent-user-intent state near the existing YouTube navigation state: latest requested value plus an expiry timestamp using `Date.now()`. Mark intent once in the common user-volume application path so input/change/wheel cannot create inconsistent ownership.
4. In `onVideoVolumeChange`, suppress only a conflicting unmuted volume value during the intent window; process mute state independently. Clear intent when the player reports the requested value within a named tolerance, when the window expires, or when the owning overlay is disposed. Reapply the requested value only if the failing fixture proves ignoring the transient event is insufficient.
5. Cover synchronous overlay initialization, stale volumechange inside the window, native volume after expiry, native mute/unmute during the window, wheel input, and disposal/recreation during intent. Confirm slider intent unmutes and saved mute restores.
6. Regenerate distribution output using the repository build command.

## Verification

- `pnpm test:integration` — all integration tests pass, including the new loading-state sequence.
- `pnpm test:unit` — all shared persistence tests pass.
- `pnpm check` — deterministic build, metadata, syntax, tests, artifact parity, archive check, and security scan all pass.
- Confirm `git diff --name-only` contains only the scoped source/test and generated YouTube dist file.

## Done criteria

- A deterministic test fails on the baseline and passes after the change.
- Changing to 60 while loading never displays or stores the simulated older value afterward.
- A native volume change after the grace period still updates the UI and storage.
- Timestamp state creates no cleanup timer; disposal clears requested-value ownership.

## Stop conditions

STOP and report back if reproduction requires changing the userscript grants, contacting YouTube from CI, or persisting a second competing “desired volume” key. STOP if the fixture shows the snapback is caused only by plan 002's stale-video identity problem; update the dependency instead of adding overlapping guards.
