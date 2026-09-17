## 1. Feature deletion

- [x] 1.1 Delete `use-call-recording.ts`, `use-media-recorder.ts`, `call-recording-compositor.ts`, `call-audio-mixer.ts` and their tests under `apps/client/src/features/media/`
- [x] 1.2 Remove the record control from `room-center-controls.tsx` (props, button, copy) and its test assertions
- [x] 1.3 Remove recorder wiring from `active-room-view.tsx`: `useCallRecording` call, `handleToggleRecord`, `isRecordingEnabled` track-scan, compositor-only `activeScreenShare` reshaping; keep the SDK spotlight path used by rendering
- [x] 1.4 Sweep `apps/client` for remaining references (keyboard shortcuts, room.test.tsx mocks, type imports)

## 2. Spec and docs

- [x] 2.1 Land the spec deltas: client "Call recording" requirement removed; sdk app-domains list drops local recording (via archive)
- [x] 2.2 Check `docs/` for local-recording mentions; update where the room UI is described

## 3. Verification

- [x] 3.1 Run `apps/client` test suite, typecheck, lint, and format; fix fallout
