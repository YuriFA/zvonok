## Context

Local recording spans `apps/client/src/features/media`: `use-call-recording.ts`
(~186 LOC, program assembly), `use-media-recorder.ts` (MediaRecorder wrapper),
`call-recording-compositor.ts` (322 LOC, canvas grid/spotlight compositor on a
`requestAnimationFrame` loop), `call-audio-mixer.ts` (WebAudio mix), plus
~680 LOC of tests. The room view feeds it: `active-room-view.tsx` derives
`isRecordingEnabled` by scanning every participant's `MediaStreamTrack.readyState`
and reshapes the SDK spotlight into the compositor's `activeScreenShare` input -
both derivations exist only for the recorder.

Server-side recording is a separate, working path: egress state/controls in
the SDK, the `start-recording` capability gate, the embedded room's record
control, and platform storage. The decision (grilling session, 2026-09-17):
no demand for device-local files; delete rather than absorb (ADR-0007).

## Goals / Non-Goals

**Goals:**

- Delete the feature end to end: hooks, compositor, mixer, tests, UI control,
  spec requirement.
- Simplify `active-room-view` by the two recorder-only derivations.

**Non-Goals:**

- Touching egress/server recording.
- Building an SDK replacement for local recording (revisit only if demand
  appears; git history keeps the implementation).

## Decisions

- Delete `use-call-recording.ts`, `use-media-recorder.ts`,
  `call-recording-compositor.ts`, `call-audio-mixer.ts` and their test files
  in one commit - no deprecation shims.
- `room-center-controls` loses the recording props (`recordingState`,
  `elapsedSeconds`, `isRecordingSupported`, `isRecordingEnabled`) and the
  record button with its tests; keyboard shortcut bindings for record (if
  present) go with it.
- The spec delta removes the whole "Call recording" requirement; the sdk
  delta edits the app-domains list. Keyboard-shortcuts requirement is
  checked during implementation - a record binding there gets the same
  treatment.

## Risks / Trade-offs

- A user who relied on a local `.webm` loses the ability (accepted: no
  demand; egress archives exist).
- The `requestAnimationFrame` freeze defect dies with the feature; if local
  recording returns, it returns with a non-rAF render strategy.
