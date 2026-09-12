## Why

`@zvonok/client` exports 24 subpaths, and the seam is wider than the behavior
it guards: nine single-implementation sub-interfaces (`sfu/interfaces.ts`),
an unimplemented trio of role interfaces (`media/interfaces.ts`), 450 lines
of published mock doubles (`sfu/__mocks__`, `screen-share/__mocks__`), the
connection/router/collector internals, and transport flags
(`isSendTransportCreated`, ...) leaking through `SfuState`. This is candidate
B of the 2026-09-12 architecture review: the published interface should
name the manager and its data types, not the package's organ diagram.

## What Changes

- Exports map pruned to the public set: `sfu/{manager,types,quality-score}`,
  `media/{capture-state,manager-factory,interfaces}`,
  `audio/{remote-audio-mixer,active-speaker-detector,audio-level-sampler}`,
  `screen-share/{service,types}`. Internal (removed from exports):
  `sfu/{connection,event-router,stats-collector}`,
  `media/{capture,device-service,error-classifier}`, `config/media`.
- Deleted: `sfu/interfaces.ts` (nine single-implementation sub-interfaces),
  both `__mocks__` trees, and the unimplemented role interfaces
  `ICaptureStateReader`/`ICaptureController`/`ICaptureTrackProvider`.
- New `createSfuManager(...)` factory: `SfuManager` composes its own
  `SfuConnection`; consumers stop assembling the manager from parts.
- All `ISfuManager` consumers (7 imports in `@zvonok/react`) migrate to the
  `SfuManager` class type.
- `SfuState` shrinks to the consumer shape: `connectionState`, `capabilities`,
  `egress`, `lastBroadcast`, `{audio,video,screen}ProducerId`,
  `isScreenShareBlocked`; the four transport/device flags move into the
  implementation.
- The peer-quality context test replaces `createMockSfuManager` with the
  socket-level fake used by `@zvonok/react` tests.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sdk`: public surface contract (exports map enumerates public modules only,
  manager construction via factory, no published test doubles) and the
  source-based workspace consumption wording.

## Impact

- `packages/client`: `package.json` exports, new `sfu/manager` factory export,
  `sfu/types.ts` state shape, deletions above.
- `packages/react`: 7 `ISfuManager` imports re-pointed to the class type;
  `use-zvonok-connection` switches to the factory.
- `apps/client`: `peer-quality.context.test.tsx` test double swap; no runtime
  changes (depends on `migrate-app-onto-react-bindings` having landed).
