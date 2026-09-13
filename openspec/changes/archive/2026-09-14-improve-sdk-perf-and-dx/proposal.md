## Why

Source-level research into GetStream's stream-video-js (docs/research/stream-video-js-codebase-patterns.md) surfaced 12 concrete improvements for our client stack. Three are user/SDK-visible capabilities that need spec coverage before implementation; the remaining nine are internal performance/DX refactors that ride along in the same change so the batch can be verified and archived together.

## What Changes

- SDK (`@zvonok/react` + `@zvonok/client`): viewport-driven simulcast layer selection - participant tile visibility (IntersectionObserver) drives `setPreferredLayers` through the existing `sfu:set-preferred-layers` signalling, so hidden tiles drop to the lowest spatial layer instead of consuming full bandwidth.
- SDK (`@zvonok/client`): device preference persistence - last successfully used camera/microphone (and muted intent) remembered in localStorage and applied as the default capture device on the next session.
- SDK (`@zvonok/react`): reactive device permission state (`useDevicePermissions` over the existing `queryPermission` primitive) so the pre-join screen can explain blocked devices before a join is attempted.
- App (`apps/client`): memoized video tiles, and a shared video-element binding hook that clears `srcObject` on stream loss and retries blocked `play()` (fixes stale-frame decode work and frozen blocked-autoplay tiles).
- SDK internal refactors (no public contract change beyond the additive items above): shared concurrency helpers replacing four ad-hoc mechanisms, a scoped level-gated logger replacing raw `console.log` in the core package, join/leave mutual exclusion, a `recoverable` flag on `ZvonokError` with a centralized retry policy, a rejoin rate limiter, an identity-stable sorted participants array in `RoomTracker`, and an `ensureExhausted` helper for discriminated-union switches.

No breaking changes: all public surface additions are additive; existing consumers keep working unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sdk`: three new requirements - viewport visibility drives per-tile layer selection; device preferences persist across sessions; device permission state is observable by consumers.
- `client`: new requirement - the pre-join screen surfaces camera/microphone permission state (granted/denied/unavailable) before the user joins.

## Impact

- `packages/react/src/` (viewport visibility hook + controller, `useDevicePermissions`, `useVideoStream`, join/leave exclusion, error flags, tracker identity-stable array)
- `packages/client/src/` (`media/device-preferences.ts`, `helpers/concurrency.ts`, `helpers/logger.ts`, `helpers/exhausted.ts`, capture integration, console.log sweep)
- `apps/client/src/` (room video tiles memo + binding hook adoption, prejoin permission surfacing)
- Tests: packages/client, packages/react, apps/client suites
- Server: no changes (existing `sfu:set-preferred-layers` handler already validates ownership and no-ops safely on unknown consumers)
