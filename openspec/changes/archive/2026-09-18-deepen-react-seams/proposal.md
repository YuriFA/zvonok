# Deepen React SDK seams

## Why

The `@zvonok/react` state seam leaks: the connection hook re-exposes the
manager's producer vocabulary through six shallow pass-throughs, session state
is writable by any hook through a public `update(patch)`, lock/kick/ended
state is readable three ways, and the provider constructs its managers
imperatively so integration tests must `vi.mock` five `@zvonok/client`
modules. Several public exports are implementation details (engine class,
tuning constants, a duplicate host-controls entry), which the quality
adaptation requirement ("one public hook") already forbids.

## What Changes

- **BREAKING**: `UseZvonokConnectionResult` drops `produceTrack`,
  `pauseProducer`, `resumeProducer`, `closeProducer`, `replaceTrack`,
  `hasProducer`, and `manager`. Publish/pause vocabulary lives behind the
  call session (`useZvonokCall` + `usePublishControls`). The manager stays
  reachable as the documented escape hatch via `useZvonokSession().manager`.
- `useZvonokCall` gains `pauseVideoWhenHidden` (default `false`): while set,
  the SDK pauses the local video producer when the document hides and resumes
  what the user's own toggle state wants on return. `apps/client` deletes
  `use-room-visibility.ts`, its last producer reach-in.
- **BREAKING**: `ZvonokSession` drops `update(patch)`. Session state moves
  into a framework-free `SessionStore` (`getSnapshot`/`subscribe`, named
  transitions) driven by the connection hook - the store's owner, not any
  hook, writes state.
- **BREAKING**: `useRoomStatus` and its export are removed.
  `StatusCardsPreset` takes `call` + `connection` and owns the room-status
  projection; the embedded room renders it without a middle projection.
- **BREAKING**: the quality adaptation surface collapses to
  `PeerQualityProvider` + `usePeerQualityStats`. `useViewportQuality`,
  `usePeerQualityContext`, `PeerQualityEngine`, `STATS_INTERVAL_MS`, and
  `LAYER_SWITCH_DEBOUNCE_MS` leave the public surface; viewport tracking
  already lives inside `Tile`, which keeps requiring the provider.
- **BREAKING**: root exports trimmed: `createHostControls` becomes internal
  (`useHostControls` stays), `loadDeviceSelection`, `deriveMediaControlState`
  and `PeerQualityProvider`-engine internals leave the root.
  `mapScreenShareError` stays public (consumer-facing presentation mapping).
- **BREAKING**: `MediaControlsPreset` drops the dead `onNotice` prop;
  replace-failure notices surface through `useMediaControls({ onNotice })`
  (core-owned mapping; landed with the control-bar dedup batch).
- `ZvonokProvider` gains optional `createManager` / `createMediaManager`
  factory props (defaults preserve current behavior). Package integration
  tests inject the existing `MockSfuManager` / mock media manager through
  the front door instead of mocking five `@zvonok/client` module factories.
- `apps/client`'s `room.test.tsx` mocks only the data seams
  (`useZvonokConnection`, `useZvonokCall` return values) via
  `importOriginal`; the real `useParticipantsPanel` and control logic runs
  under the route test instead of a re-implemented copy.
- `publishConfig.exports` reconciliation and the `packages/client` packaging
  cleanup already landed directly (no contract change); recorded here for
  the spec trail.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sdk`: connection/call-session state seam (producer vocabulary behind the
  call session, `pauseVideoWhenHidden`), session store ownership, quality
  adaptation surface as one public hook, status-cards block projection,
  provider manager factories, minimal public surface for `@zvonok/react`.
- `client`: framework-agnostic core boundary - hidden-tab video pause moves
  behind the call-session option; the app keeps notifications only.
