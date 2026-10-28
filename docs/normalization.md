# Audio normalization

Auto-normalize volume is an opt-in feature under Volume Slider Options → General → Audio. It starts disabled and saves separately on YouTube and Twitch. The selected percentage remains the user's listening preference; Output is the equivalent adjusted linear level, not a percentage of that selection. For example, Output 13% · Selected 25% means an adjusted level equivalent to a normal 13% setting.

The status card shows Active, the adjustment, and Output versus Selected. It does not expose renderer names or development labels. The static waveform remains visible during normal pause, mute, silence and startup; it hides when the feature is off or unavailable.

## One production implementation

The standard build imports src/shared/normalization.js on both platforms. There is no separate development build or older runtime controller. Native nodes process the player's own audio through delay and gain. Separate control branches measure K-weighted short energy and linked stereo sample peaks to generate a smooth attenuation envelope. Page JavaScript controls slower LUFS programme matching; it does not render or schedule audible PCM packets.

| Responsibility | Source |
| --- | --- |
| Selected volume, status, source transitions, retries and failure restoration | normalization.js and platform APIs |
| Analysis inputs, programme updates, mute/pause gating and disposable nodes | normalization-playback.js |
| One document context and one source per media element | normalization-output.js |
| Native short-energy and peak envelope, audible delay/gain | normalization-graph.js |
| LUFS programme policy and settings | normalization-gain.js |
| Sample-clocked K-weighted metering | lufs-meter.js |

The profile targets -18 LUFS before the selected listening-level adjustment, with 3 LU short-energy headroom, approximately 20 ms lookahead, 1 ms attack, 20 ms hold, 180 ms release and a 24 dB/s upward bound. Native windows use powers of two: actual lookahead is 23.22 ms at 44.1 kHz and 21.33 ms at 48/96 kHz. The sample ceiling is 10 dB below the selected linear level. This is a listening-oriented sample limiter, not a reconstructed true-peak guarantee or broadcast loudness specification.

Programme matching keeps three seconds of active loudness history, cautious startup, silence gating, a held reference and a maximum 6 dB boost. A lower history reference must remain at least 1 LU below the held reference for three active seconds before attenuation recovery accelerates. The held reference then falls at up to 3 LU/s toward the target, with a 1.2-second gain recovery constant. Boost retains the slower 0.5 LU/s reference decay and three-second gain recovery. Silence and pause do not advance this confirmation. Native mono/stereo analysis reuses decoded planes. Short-window startup callbacks and attack-energy calculations stop after the first meaningful programme frame; steady-state worklet messages contain programme frames only. Gain settings and the native envelope remain identical across both input adapters.

Detector curves accommodate programme boost and stereo speaker downmix up to an internal magnitude of eight. This prevents control-signal clipping on boosted surround peaks; it does not increase audible gain or the configured ceiling.

Gain changes use `setTargetAtTime` to continue smoothly from the current exponential value. No future gain ramps are queued, so these changes do not require `cancelAndHoldAtTime`, which Firefox does not implement. Both sites use the same scheduling path.

## Analysis compatibility and privacy

### Other audio processors

Enabled normalization reserves control when it binds to the video, before waiting for samples or an active audio context. This gives it priority over Twitch's 7TV compressor during startup. If normalization is off when a fresh player loads, 7TV can attach normally.

Only one processor can control a video element's audio. Chrome rejects a second media-element source, while Firefox can play parallel sources that bypass the normalizer's volume and mute gain. A document-owned guard observes both source-creation APIs, rejects external sources for reserved or already-managed elements, and leaves unrelated media alone. An already-active 7TV controller is also recognized when the Twitch script initializes late.

An existing audio-source attachment cannot safely be taken over. If 7TV or another observed processor is already attached when normalization is enabled, normalization stays unavailable and the slider controls the selected native volume. This conflict does not trigger capture retries or repeated context creation.

Twitch's 7TV compressor button is disabled with an accurate explanation while Volume Slider has reserved or attached to its player. That choice stays fixed for the element until reload or replacement, including after normalization is switched off: native source attachments cannot be undone, and 7TV may cache failed attachment attempts even before our source is created. 7TV's settings are unchanged.

To switch to 7TV, turn Auto-normalize volume off and reload. To switch to normalization, turn 7TV's compressor and its automatic activation off, then reload. A replacement video element gets fresh ownership; same-element source restarts retain their existing owner.

### Audio input and privacy

The protected playback graph is attached and the native player volume initialized before capturing the analysis stream. This keeps capture attached to the stable media route, including after an outgoing graph finishes its fade. Native frames and worklet analysis begin only after this setup; audio remains at zero programme gain until measured.

Captured native AudioData is preferred for analysis. Browsers without audio-capable MediaStreamTrackProcessor support use an analysis-only AudioWorklet instead. These are compatible inputs to the same policy, not different normalization methods. AudioData closes after processing; capture readers and worklet ports are released on reset or disable. Temporary Blob module URLs are revoked.

All analysis stays on the device. There is no microphone permission, recording, audio upload or remote processing dependency. Worklet permission is unnecessary for audible playback, and no site security policy is changed. A compact diagnostic state is available in the document's data-tm-audio-normalization attribute; it contains status, levels and timing, never audio samples. Updates share the settings card's 500 ms cadence, with immediate status/selection changes and no repeated writes of identical values.

## Source ownership and recovery

A MediaElementAudioSourceNode attachment cannot be recreated for the same element. A document-owned context therefore retains one source per element. Turning normalization off or encountering a failure disposes analysis and the normalization graph, then reconnects that source to ordinary output at the selected native volume. A short output gate fades ordinary audio back in after that volume command reaches the renderer. It disconnects when a new normalization graph takes over. Disconnected elements have no output connection. Same-element resets and replacement elements reuse the context.

Output gates open and source transitions fade out over 5 ms, scheduled ahead of the renderer's pending batch using its reported latency. This prevents a stale control-thread clock from placing an entire fade in the past, including on Firefox devices that report zero base latency. It can add the reported latency to opening or retiring a route; the sample-clocked limiter and its lookahead are unchanged. Cleanup follows the audio render clock, including the native volume command's render latency. A replacement waits for that handoff and connects directly to its protected graph, without an intermediate ordinary route. Selected volume restoration waits for cleanup so a delayed teardown cannot overwrite it. Capture tracks stop after the fade.

When all managed routes are paused or ended, the context suspends without discarding its graph or programme history. Play events resume it without requiring a new gesture; a pending suspension finishes before resumption. A completed resume checks the latest playback and attachment state, so a racing pause or removal returns to idle even after normalization is disabled. A pause during successful initial activation can retain the protected route while suspended; a context that has never activated cannot divert ordinary audio. An ordinary playing route keeps the shared context running even when another route pauses.

A new element is attached only after context activation and only for an accessible same-origin source, same-origin blob, media stream or CORS-enabled source. Protected or inaccessible sources restore ordinary playback with a warning. Blocked activation cannot divert a previously unattached element. Once attached, changing that element to an unsupported cross-origin source cannot undo Web Audio's access rules without a page reload.

Source loads and YouTube navigation hold audio quiet until a fresh measurement permits protected output. Outgoing callbacks cannot release the incoming hold. Selected volume and mute intent are preserved independently of native initialization writes. Pause, mute and zero volume retain the programme reference; silence does not cause source-search loops.

The site's player API owns native volume readback. YouTube can report 100% while applying its own loudness compensation to the underlying video element. The normalizer accepts that difference instead of repeatedly writing 100% on each volume event; those repeated writes can flood the player and stall analysis. Direct element readback remains the fallback when the site API is unavailable.

Twitch restores the saved mute choice at metadata readiness and when restarted playback begins. During startup, the control displays that choice instead of Twitch's temporary initialization mute; explicit mute and unmute actions update it immediately. Persistence locks still allow the indicators to refresh after volume corrections without overwriting saved settings.

One adaptive lifecycle timer owns source checks and bounded recovery: 50 ms during startup, source transitions or inaccessible tracks; 250 ms during healthy playback; 500 ms during pause or failure backoff. Media events trigger immediate checks and coalesce within the same task. Audio rendering and metering use their own sample clocks, independent of this watchdog.

Initial activation, source transitions, and waiting for the first measurement each have a three-second bound. The first-measurement allowance begins when the protected route and captured track are ready, rather than when the player first appears. These are failure deadlines, not fixed waits: available audio is analyzed immediately. Missing established measurements still time out after 1.5 seconds. Inaccessible tracks have a 1.5-second grace, and a retry never attaches a track already known to be inaccessible.

Failures retry after 1, 2, 4, 8, 16, then at most 30 seconds while playback is ready. Incoming measurements reset the backoff once analysis has been started for three seconds. Watchdog scheduling can add up to one polling interval before a timeout is detected. User gestures can retry immediately. Ordinary playback remains available on failure, with the user's mute choice preserved.

## Verification

The Node suite covers selected/output separation, storage, controls, early attachment, source changes, mute preservation, error recovery, blocked activation, retained-source routing, teardown and both standalone artifacts. Fake audio nodes verify ownership and lifecycle only; they do not simulate native DSP quality.

The real-browser normalization suite executes the standard dist files on routed local YouTube/Twitch fixtures. Sixteen Chrome cases cover stable source-before-capture ordering, protected first-frame priming, native/worklet/CSP analysis, site loudness compensation, unavailable input and blocked activation, with mono and stereo audio, peak protection, pause/mute, zero volume, source replacement and disable/re-enable. Four Firefox cases cover early and late activation, requiring uninterrupted rendered PCM and synchronized wheel feedback through player lifecycle changes. A deliberate mute verifies that the continuity monitor detects real interruptions instead of treating ordinary gain reduction as a cutout. Both browsers require a suspended context and frozen render clock while paused, followed by gesture-free resumption, including ordinary playback after disabling normalization. Four recorded synthetic-tone Chrome load/refresh cases replay 55–290 ms page-thread stalls and require no output gaps or waveform breaks. Forty-five native graph cases cover impulse phases, boosted stereo and surround peaks, an unchanged quiet tone, opposite-phase stereo, silence, zero, recovery and continuous gain changes at 44.1/48/96 kHz on both browsers. Brief-event recovery returns within 0.13 dB after one second in that fixture. Real browser audio is never recorded by these tests.

The user confirmed clean YouTube startup in Brave. The new graph was observed active after YouTube and Twitch refreshes and on two Twitch channels, retaining the selected levels. Eleven difficult transitions from two original downloads were compared with the refined offline reference. Nine matched average loudness within 0.1 LU using offline programme offsets; two remained 0.5–0.6 LU quieter after the bounded matching pass. Those comparisons establish neither bit-identical behavior nor universal subjective quality.

The offline reference in scripts/normalization-reference.mjs and frozen reactive comparator in scripts/lib/legacy-normalization.mjs are developer comparison tools only. Neither is imported into the userscripts. The old input adapter, streaming renderer, packet scheduler and startup quiet-time workaround are removed from production source.

Twitch ad restarts, tab suspension, broader listening/performance and end-to-end A/V synchronization still need additional real-world checks. Browser restrictions, output-device latency and operating-system processing remain outside the script's control.
