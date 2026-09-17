# Remove local recording

## Why

The product no longer needs device-local call recording: server-side (egress)
recording covers the archive use case, and the local implementation has a
structural defect - its canvas render loop runs on `requestAnimationFrame`,
so the recorded video freezes while the tab is hidden. Deleting the feature
removes ~1400 LOC (implementation plus tests) and two policy derivations from
the room view that exist only to feed the compositor.

## What Changes

- **BREAKING**: the room UI loses the local record control; the
  `useCallRecording` hook, `useMediaRecorder` hook, `CallRecordingCompositor`,
  and `CallAudioMixer` are deleted with their tests.
- `active-room-view` loses the recorder wiring, the `isRecordingEnabled`
  track-scan, and the compositor-only `activeScreenShare` reshaping.
- The client spec's "Call recording" requirement is removed.
- The sdk spec's app-domains list drops "local recording" (chat, whiteboard,
  and guest approval policy stay app domains).
- Server-side recording is untouched: egress state/controls, the
  `start-recording` capability gate, and the embedded room's record control
  keep working.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `client`: the local-recording requirement is removed; the room UI keeps no
  record control.
- `sdk`: the composition-blocks app-domains list no longer names local
  recording.
