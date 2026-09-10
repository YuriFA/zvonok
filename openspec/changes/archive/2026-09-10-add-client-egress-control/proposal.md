# Proposal: add-client-egress-control

## Why

Egress today is reachable only through `/v1` with a server-side API key, so
an in-call host cannot start or stop a recording or an HLS stream - both
reference platforms let the client SDK do it (`meeting.startRecording()`,
`call.startHLS()`), and our own prebuilt `ZvonokRoom` cannot offer a record
button without routing through the integrator's backend. Recording readiness
is also invisible: `egress.stopped` fires before the MP4 is finalized, so
consumers poll `GET /v1/egress/:id` to learn when the file exists. Stream
solves this with `call.recording_ready`.

This is change **C** of the coordinated 0.3.0 wave; it consumes the
capability vocabulary (`start-recording`, `start-broadcast`) and the
acknowledgement pattern shipped by change A (add-roles-and-capabilities).

## What Changes

1. **Client-initiated egress over signalling**: `egress:start`
   (`{record, hls}`) and `egress:stop` on the `/sfu` socket, answered with
   acknowledgements, gated by capabilities from change A - `start-recording`
   for the record output, `start-broadcast` for HLS. Applies to project-owned
   rooms; user-owned rooms receive a coded denial. RTMP endpoints remain
   server-only via `/v1` (an SSRF boundary: the browser never supplies
   push URLs).
2. **Egress state in room state**: the server broadcasts session status to
   the room; the SDK exposes `isRecording` / `isLive` and the session status
   (`useEgressState()`), with `useEgressControls()` providing `start` /
   `stop` actions that settle on server acknowledgements.
3. **Prebuilt record button**: `ZvonokRoom` renders a recording control only
   when the participant's own capabilities include `start-recording`, and
   reflects the recording state.
4. **`egress.recording_ready` webhook**: a new project-room event carrying
   the egress session id, room identity, `recordingUrl`, and
   `recordingSizeBytes`, emitted when a session's recording finalizes after
   end. Same signing and retry contract as existing events. `egress.stopped`
   keeps its meaning (stopped, file may still be finalizing).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sfu`: egress start/stop join the acknowledged, capability-guarded event
  set; egress session status changes are broadcast to the room.
- `egress`: sessions can be started by in-room participants within the
  record/HLS output subset; lifecycle and single-session semantics unchanged.
- `sdk`: egress actions and state become part of the headless surface; the
  prebuilt component gains the capability-gated record control.
- `webhooks`: the `egress.recording_ready` event with recording metadata.

## Impact

- **apps/server**: `egress:start`/`egress:stop` ack handlers in the sfu
  gateway delegating to the existing egress service (capability guards,
  project-room check, 409-equivalent single-session denial), room broadcast
  of session status, `egress.recording_ready` emission at finalization.
- **packages/client**: egress control actions (ack-settled) and egress state
  mirroring on the manager.
- **packages/react**: `useEgressState`, `useEgressControls`; `ZvonokRoom`
  record button.
- **apps/client**: no egress UI for user-owned rooms (egress stays
  project-scoped; unchanged).
- **Docs**: `docs/egress.md` (client-initiated path), webhooks event list.
- No new REST endpoints; no schema changes.
