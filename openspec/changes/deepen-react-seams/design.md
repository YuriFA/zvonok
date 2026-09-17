## Context

`useZvonokConnection` returns 15 members; 6 of them
(`produceTrack`/`pauseProducer`/`resumeProducer`/`closeProducer`/`replaceTrack`/`hasProducer`)
are one-line `requireManager().x()` pass-throughs, and a seventh (`manager`)
hands the whole manager to consumers. The provider session exposes
`update(patch)`, so any hook can write any field; the invariants (leave
generation guard, reconnect mirroring, kick/room-ended teardown) live in the
connection hook. `zvonok-context.tsx` constructs the media manager inside a
`useState` initializer, so the only test seam is module mocking - the
embedded-room suite mocks five `@zvonok/client` factories, and the app's
`room.test.tsx` replaces the whole `@zvonok/react` module, re-implementing
roster ordering in its mock.

Dependency categories:

| Concern | Category | Consequence |
|---|---|---|
| producer methods on the connection result | in-process policy | absorb into `usePublishControls` / `useZvonokCall`; delete the pass-throughs |
| hidden-tab video pause | in-process policy (generic, not app-specific) | `pauseVideoWhenHidden` option on the call session; app deletes `use-room-visibility.ts` |
| session state | in-process, one writer | framework-free `SessionStore` with named transitions; `update()` removed |
| manager construction | local-substitutable | factory props on `ZvonokProvider`; `MockSfuManager`/mock media manager already exist in `__tests__/doubles.ts` |
| quality adaptation | in-process | engine + constants + `useViewportQuality` + context hook go internal; provider + stats hook stay public |
| room-status projection | in-process | `useRoomStatus` dies; `StatusCardsPreset` owns the projection from `call` + `connection` |

## Goals / Non-Goals

**Goals:**

- The connection hook's interface is lifecycle-only; ordering constraints
  ("no producers before join") stop being consumer knowledge.
- Session state has exactly one writer and one reading per concern.
- Integration tests inject doubles through the provider's front door.
- The public surface contains no engine internals, duplicate entries, or
  helper modules that duplicate hook behavior.

**Non-Goals:**

- Moving RoomTracker or the quality engine into `@zvonok/client`.
- Changing the `@zvonok/client` exports map further (publishConfig
  reconciliation already landed; deeper cuts are out of scope).
- Changing wire protocol or server behavior.

## Decisions

- **Connection result keeps `status`/`error`/`join`/`leave`/session flags.
  Producer methods move to `usePublishControls`** (already owns the
  pause/reacquire/produce/replace ordering); `useZvonokCall` consumes it
  internally. The manager stays on the session (`useZvonokSession().manager`),
  which is where the spec's escape hatch lives - the connection hook only
  puts it there via the store's transition.
- **SessionStore mirrors RoomTracker's shape** (`getSnapshot`/`subscribe`,
  `useStoreSelector`), lives in `packages/react/src/core/`, and is owned by
  the provider. Transitions: `connecting`, `joined`, `failed(error)`,
  `reconnecting`, `disconnected`, `setManager`, `setLocked`, `roomEnded`,
  `kicked`. `ZvonokSession` (public type) keeps its fields; `update()`
  disappears from the interface.
- **`pauseVideoWhenHidden` rides the call session**, not the provider: it is
  media policy over producers, which the call session owns. Implementation
  mirrors the deleted `use-room-visibility.ts` (visibilitychange +
  camera-toggle awareness) as package code with package tests.
- **`StatusCardsPresetProps` becomes `{ call, connection, onBack?, className? }`**;
  the block derives status internally. `useRoomStatus`, `RoomStatus`,
  `UseRoomStatusOptions`, and `StatusCardsPresetProps.onNotice`-style
  leftovers are deleted with their export block and `block-exports.test.ts`
  pin.
- **Provider factories: `createManager?: (options: { serverUrl: string }) =>
  SfuManager` and `createMediaManager?: () => MediaStreamManager`.** The
  connection hook receives them through the session context instead of
  calling `createSfuManager` directly. Defaults preserve behavior. Existing
  doubles move from `__tests__/doubles.ts` imports into test files as-is.
- **Quality cut:** `Tile` keeps requiring `PeerQualityProvider`;
  `useViewportQuality` stays module-internal to `core/` (Tile is its only
  consumer); `usePeerQualityContext`, `PeerQualityEngine`, and the constants
  become non-exported. The app needs no changes for this cut.
- **App route test:** `vi.mock("@zvonok/react", importOriginal)` overriding
  only `useZvonokConnection`/`useZvonokCall` return values; every
  logic-carrying export (`useParticipantsPanel`, `deriveMediaControlState`
  consumers, device hooks) runs for real, so roster ordering and capability
  gating are exercised, not copied.

## Risks / Trade-offs

- External consumers on the removed surface break at upgrade (0.2.0,
  pre-1.0; migration notes in the README section of the release).
- `session.update` removal touches 10 call sites, all inside
  `use-zvonok-connection.ts` - contained, but the reconnect mirroring tests
  must survive unchanged.
- The nested `zk-media-controls` DOM concern does not apply: the dedup kept
  both presets flat and moved the mapping into the core.
