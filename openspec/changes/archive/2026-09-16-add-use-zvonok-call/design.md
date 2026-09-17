## Context

`apps/client/src/features/room/hooks/use-room-sfu.ts` is the de-facto call-session module. Its mechanisms already live in `@zvonok/react` (`useZvonokConnection`, `usePublishControls`, `RoomTracker`, `createHostControls`, `useSfuTrackSync`), but the orchestration stayed in the app because its dependencies cross no seam into the package:

- identity comes from `useAuth()` (app context),
- capture streams come from `MediaStreamProvider` (app context over `session.mediaManager`),
- reactions are `toast` calls (app presentation).

`usePublishControls` already injects capture per toggle via `PublishToggleHooks` (`getTrack` / `ensureTrack` / `release`), and `RoomTracker` already accepts `localUserId` - the seams exist in miniature but nobody composed them into the missing deep module. Each past "migrate like stream-video-js" pass therefore moved one mechanism and left the policy behind.

Dependency categories of the app hook, per dependency:

| Dependency | Category | Consequence |
|---|---|---|
| publish / tracker / host controls | in-process | compose directly inside the new module |
| capture (`mediaManager`) | in-process, substitutable | inject as a port; default adapter over the provider's manager; test doubles already exist in `use-room-sfu.test.tsx` |
| identity (`user.id`) | data | plain parameter |
| toasts, navigation | app presentation | callbacks out (`onHostMuted`, `onKicked`); consumer renders |

## Goals / Non-Goals

**Goals:**

- One deep module `useZvonokCall` in `packages/react`: small interface, all room-media policy inside, testable through its interface.
- App room feature shrinks to: identity, notification rendering, navigation, presentation mapping.
- Kill the app's parallel state layers (`use-media-controls` optimistic setters, `RemotePeerMedia`, `toRemotePeer`, `use-room-participants`).

**Non-Goals:**

- Moving `RoomTracker` into `@zvonok/client` (state-in-client like stream-video's `CallState`); the react placement works and is not required for this seam.
- Rewriting `useZvonokConnection`, `usePublishControls`, or `RoomTracker` internals; the new module composes them.
- Call recording (`use-call-recording`), prejoin flow, embedded room migration; embedded room MAY adopt the hook later.
- Server-side changes of any kind.

## Decisions

### D1: One deep hook, not more mechanism exports

`useZvonokCall` composes the existing pieces and owns the policy that today lives app-side: publish-on-join, optimistic toggle state + rollback, host-mute enforcement with once-per-occurrence bookkeeping (`announcedHostMuteRef` moves inside), kick surfacing, connection-state mirroring, local participant projection.

Alternatives considered:

- *Keep policy in app, move only more mechanisms*: this is the status quo that produced the recurring failure; any second consumer re-implements policy.
- *Move policy to a framework-free class in `@zvonok/client`* (stream-video's `Call` shape): deeper in one sense, but it would relocate `usePublishControls`/`RoomTracker` logic wholesale and force a React binding layer on top in the same change. Rejected for scope; the react hook keeps the policy behind the same interface and can descend into the client package later without interface change.

### D2: `CapturePort` formalizes the capture seam

```ts
export interface CapturePort {
  getTrack(kind: PublishKind): MediaStreamTrack | null | undefined;
  ensureTrack(kind: PublishKind): Promise<MediaStream | null>;
  release(kind: PublishKind): unknown;
}
```

`PublishToggleHooks` folds into it (same vocabulary, now per-kind keyed). A default adapter reads `useZvonokSession().mediaManager`, so consumers pass nothing; `MediaStreamProvider` stops being a room dependency (device-selector and prejoin read the same manager through SDK hooks). Two real adapters justify the seam: the media-manager adapter and the test doubles the suite already uses. Capture release on kick goes through the port, so the app's `onKicked -> stopMedia()` glue disappears; the app callback is navigation only.

### D3: Toggle semantics return outcomes, callbacks carry events

```ts
export interface ToggleControl {
  readonly isEnabled: boolean;
  toggle(): Promise<PublishToggleResult>; // "published" | "paused" | "no-track" | "produce-failed" | "replace-failed"
}
```

The hook owns optimistic enable + rollback; the consumer maps outcomes to toasts. `onHostMuted()` fires once per mute occurrence (re-armed on unmute), `onKicked()` fires once; both are optional. Rationale: React state stays the single source for rendering; callbacks exist only for one-shot side effects that state cannot express (toast, navigate). Alternatives: an event emitter (heavier interface, second subscription model) or pure state polling in the consumer (re-implements the once-per-occurrence bookkeeping every time) - both rejected.

### D4: Interface

```ts
export interface UseZvonokCallOptions {
  connection: UseZvonokConnectionResult;
  localUserId?: string;          // stable guest id generated inside when omitted
  autoPublish?: boolean;         // default true
  capture?: CapturePort;         // default: provider media manager adapter
  onHostMuted?(): void;
  onKicked?(): void;
}

export interface UseZvonokCallResult {
  connectionState: ZvonokStatus;
  capabilities: string[];
  isRoomLocked: boolean;
  mutedByHost: boolean;
  wasKicked: boolean;
  participants: ZvonokParticipant[]; // remote + local projection, reference-stable
  localUserId: string;
  camera: ToggleControl;
  microphone: ToggleControl;
  hostControls: HostControls;
  kickPeer(userId: string): Promise<void>;
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
}
```

Result fields keep the exact vocabulary the app already consumes (`connectionState`, `capabilities`, `isRoomLocked`, `mutedByHost`, `wasKicked`, `hostControls`, `kickPeer`) so the cutover is a substitution, not a redesign of the room UI. Depth check: 6 options (4 with defaults) vs the app hook's 9 required options; every mechanism the room UI needs is reachable without importing package internals.

### D5: App cutover and deletions

`room-session.context.tsx` becomes the only consumer: it maps `useAuth().user.id` to `localUserId` and wires `onHostMuted` / `onKicked` to toasts / navigation. Deleted: `use-room-sfu.ts` (incl. its test), `use-room-participants.ts`, `RemotePeerMedia` + `toRemotePeer`, optimistic setters in `use-media-controls.ts` (capture-state projection reads from the port surface), `MediaStreamProvider` usage in the room route. The `Participant` presentation type stays app-side; the participants panel maps from `ZvonokParticipant`.

### D6: Testing - replace, don't layer

New tests target `useZvonokCall`'s interface in `packages/react/src/__tests__/` with a fake `SfuManager` + fake `CapturePort` (patterns exist: `use-publish-controls.test.tsx`, `doubles.ts`): publish-on-join, each toggle outcome and rollback, host-mute once-per-occurrence, kick releases capture, local projection stability, default capture adapter. `use-room-sfu.test.tsx` is deleted with its module - assertions that survived it describe behavior now covered at the package interface. App suite keeps route/context tests with the hook mocked.

## Risks / Trade-offs

- **Cutover breadth**: room route, device-selector, prejoin, and the visual harness all touch `MediaStreamProvider`; the port default must be live before any consumer flips. Mitigation: ship the hook + default adapter first within the same change, then cut consumers over one commit each.
- **Behavior drift in toggle rollback**: the app hook encodes edge cases (resume-after-swap ordering, produce buffering before transport exists). The package's `usePublishControls` already owns the ordering; the hook must not duplicate it - regression risk concentrates in wiring, covered by the interface tests.
- **Two capture vocabularies coexist** (`useDeviceControls` vs `CapturePort`) until device-selector migrates; acceptable inside one change, both read the same manager so no state can diverge.
