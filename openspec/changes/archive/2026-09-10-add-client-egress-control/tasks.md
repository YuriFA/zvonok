# Tasks: add-client-egress-control

## 1. Server: signalling front door

- [x] 1.1 `egress:start` / `egress:stop` ack handlers in the sfu gateway delegating to the egress service; guards: project-room check, per-output capability (`start-recording`/`start-broadcast`), single-session conflict, outputs limited to `{record, hls}` (RTMP fields ignored/rejected); unit tests per guard and success path
- [x] 1.2 `egress:status` room broadcast on every session transition; unit tests for started/live/ended/failed emission

## 2. Server: recording readiness

- [x] 2.1 `egress.recording_ready` webhook emission at the finalization point (room id/slug, session id, outputs, `recordingUrl`, `recordingSizeBytes`); silence for failed sessions; dispatcher tests

## 3. packages/client

- [x] 3.1 Egress state on the manager: mirror `egress:status` into state, derived `isRecording`/`isLive`; unit tests for transition mirroring
- [x] 3.2 Egress actions: ack-settled `start({record, hls})` / `stop()` with typed egress errors (authorization, conflict, ack timeout); unit tests

## 4. packages/react

- [x] 4.1 `useEgressState()` and `useEgressControls()` hooks; unit tests (state follows lifecycle, actions settle/reject)
- [x] 4.2 `ZvonokRoom`: record control rendered iff `start-recording` in own capabilities, wired to egress actions and state; component tests (hidden for viewer-role token, toggles for host)

## 5. Docs and verification

- [x] 5.1 `docs/egress.md`: client-initiated start/stop section (capabilities, outputs subset, RTMP stays server-side); webhook event list gains `egress.recording_ready`
- [x] 5.2 E2E: socket-driven record start/stop against a project room asserting session lifecycle + `egress.recording_ready` delivery to a local receiver
- [x] 5.3 Full verification: server suite, packages suites, app lint/tsc/e2e
