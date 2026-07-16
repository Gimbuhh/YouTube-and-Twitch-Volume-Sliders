# Gate YouTube attachment by supported page

Status: DONE in 2.7  
Written against: `b454d8a`  
Priority: P1 correctness  
Depends on: plan 002 recommended

## Objective

Prevent the userscript from restoring volume or mounting controls onto unrelated preview/miniplayer videos on unsupported YouTube routes, while defining an explicit policy for watch pages, Shorts, and miniplayer behavior.

## Evidence

`src/platforms/youtube.js:1906-1938` attaches without checking the route; initial retries and navigation reattach call it at `2019-2024` and `2031-2049`. Only attach-observer selection/mutations check `/watch` (`1941-1953`). The shared locator selects the largest video anywhere in the document.

## Required policy

Default recommendation: full overlay/restore support only on `/watch`; no restore, overlay, native hiding, or player-bound listeners on home/search previews. Preserve the options button only when a stable supported controls host exists. Treat Shorts as unsupported until a dedicated fixture proves selectors/layout/player semantics; document this rather than accidentally attaching.

## Scope

In scope: YouTube route predicate, init/navigation/attach cleanup, integration fixtures/tests, generated YouTube dist. Out of scope: implementing Shorts UI, miniplayer feature work, Twitch.

## Implementation steps

1. Add fixtures for `/watch`, home/search with a preview video, and `/shorts/<id>`. Baseline must demonstrate unintended attachment on at least one unsupported fixture before production changes.
2. Add one named route-support predicate and use it at every entry to attachment/restoration, not only observer setup.
3. On supported-to-unsupported navigation, cancel pending reattach/save work, dispose overlay/listeners/observers, remove native replacement state, and avoid changing preview volume or persistence.
4. On return to `/watch`, rediscover video/player and attach normally.
5. Ensure options-button behavior matches the policy and cannot be injected into an unrelated preview controls host.

## Verification

- `npm run test:integration`
- `npm run check`

## Done criteria

- Unsupported routes never call player `setVolume`, hide native volume, or mount the overlay.
- `/watch` behavior and SPA return navigation remain intact.
- Shorts behavior is explicit in code tests and docs, not an accidental selector side effect.

## Stop conditions

STOP if current product intent includes Shorts or miniplayer support. Record the intended route matrix and create dedicated adapter fixtures before broadening selectors.
