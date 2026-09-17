## Why

Call-session orchestration still lives in app hooks: `apps/client/src/features/room/hooks/use-room-sfu.ts` owns publish-on-join, camera/mic toggle rollback policy, host-mute enforcement, kick reaction, and the local participant projection. The mechanisms exist in `@zvonok/react` (join lifecycle, publish controls, tracker, host controls), but every past migration moved only a mechanism and left the orchestrating hook in the app, because its dependencies (auth identity, capture streams, toasts) cross no seam. Any other consumer of the SDK - the embedded room, future vendor apps - must re-implement the whole orchestration, which violates the dogfooding rule that the public surface suffices to build a room UI.

## What Changes

- Add `useZvonokCall` to `@zvonok/react`: a single call-session hook owning publish-on-join, camera/microphone toggle orchestration (optimistic state plus rollback inside the hook, outcome returned for presentation), host-mute enforcement with once-per-occurrence `onHostMuted` notification, `onKicked` surfacing, connection-state mirroring, and participants including the local projection.
- Formalize the capture seam as `CapturePort` (`getTrack` / `ensureTrack` / `release` per kind), folding today's `PublishToggleHooks` into it, with a default adapter backed by the provider's shared media manager so consumers pass nothing in the common case.
- Add a `ToggleControl` surface (`isEnabled` + `toggle()` returning a named outcome) so consumers render state and map outcomes to their own notifications.
- App cutover: `room-session.context.tsx` consumes `useZvonokCall`; delete `use-room-sfu.ts`, `use-room-participants.ts`, `RemotePeerMedia`/`toRemotePeer`, the optimistic setters in `use-media-controls.ts`, and `MediaStreamProvider` as a room dependency (device-selector and prejoin move to the SDK device surface).
- The app keeps only app concerns: identity (`useAuth` to `localUserId`), toast copy, navigation on kick, and the `Participant` presentation type for the participants panel.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sdk`: new requirement for the call-session orchestration hook (publish-on-join, toggle semantics, host-mute and kick notifications, local participant projection) on top of the existing React binding requirement.
- `client`: "Framework-agnostic core" tightened - media toggle policy, host-mute enforcement, and kick reactions flow through the SDK call-session hook; the app retains only notifications, navigation, and presentation mapping.
