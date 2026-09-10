# Egress: HLS & RTMP Live Streaming

Broadcast a live room's media out of the platform: push it to RTMP endpoints
(YouTube, Twitch, a custom mediamtx/nginx-rtmp), serve it as an HLS live
playlist for large audiences, and/or record it to server disk for later
download.

Egress runs server-side: one supervised FFmpeg pipeline per session mixes all
participant audio and composites published video (screen share in the primary
tile) into a single program. Membership changes are picked up with a short
debounced restart of the pipeline (a brief output interruption is expected).

## Requirements

- `ffmpeg` on the server host (>= 5, with libx264 and aac)
- UDP ports `42000-42100` for FFmpeg's RTP ingest (configurable; must not
  overlap the mediasoup `RTC_MIN_PORT`/`RTC_MAX_PORT` range)
- Disk space for HLS segments when the HLS output is enabled

## API

All endpoints require the platform API key (`Authorization: Bearer <key>`)
and operate on the key's own project, like the rest of `/v1`.

### Start an egress session

```bash
curl -X POST https://api.example.com/v1/rooms/$ROOM_ID/egress \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "rtmpEndpoints": ["rtmps://a.rtmp.youtube.com/live2/$KEY"],
    "hls": true
  }'
```

Response `201`:

```json
{
  "id": "egress-id",
  "roomId": "room-id",
  "outputs": { "rtmpEndpoints": ["rtmps://a.rtmp.youtube.com/live2/$KEY"], "hls": true, "record": false },
  "hlsUrl": "/egress/hls/egress-id/index.m3u8",
  "recordingUrl": null,
  "recordingSizeBytes": null,
  "startedAt": "...",
  "endedAt": null
}
```

Validation: one to three `rtmp(s)://` endpoints, `hls: true`, and/or
`record: true`; at least one output is required. A second active session for
the same room responds `409`. Endpoint hosts on private/loopback addresses
are rejected unless `EGRESS_ALLOW_PRIVATE_TARGETS=true` (development only -
use it with a local mediamtx target).

### Client-initiated start/stop

In-call participants can start and stop egress over the room socket -
no API key in the browser. The SDK surface:

```tsx
const controls = useEgressControls();
await controls.start({ record: true, hls: true });
await controls.stop();
```

Rules:

- Outputs are limited to `record` and `hls`; RTMP endpoints stay
  server-side via `/v1` (push URLs from a browser are an SSRF boundary)
- The `record` output requires the `start-recording` capability and `hls`
  requires `start-broadcast` (delivered with the join acknowledgement; the
  `host` role carries both)
- Only project rooms support egress; user-owned rooms are refused
- One active session per room, exactly like the REST path: a second start
  answers a coded `ALREADY_ACTIVE` denial
- Every room participant receives `egress:status` broadcasts on session
  transitions; `useEgressState()` mirrors them (`isRecording`, `isLive`)

### Inspect, list, stop

```bash
curl -H "Authorization: Bearer $API_KEY" https://api.example.com/v1/egress/$EGRESS_ID
curl -H "Authorization: Bearer $API_KEY" https://api.example.com/v1/rooms/$ROOM_ID/egress
curl -X POST -H "Authorization: Bearer $API_KEY" https://api.example.com/v1/egress/$EGRESS_ID/stop
```

A session moves through `starting`, `live`, `stopping`, and a terminal
`ended` (reason `stopped` or `room-ended`) or `failed` (with an error
reason). Ending the room always stops its egress. Webhook consumers receive
`egress.started`, `egress.stopped`, and `egress.failed` alongside the room
lifecycle events.

## Watching the HLS output

While the session is live (and until the files are cleaned up afterwards),
the playlist is served by the server:

```text
https://api.example.com/egress/hls/$EGRESS_ID/index.m3u8
```

Open it in VLC, Safari, or any HLS-capable player. The playlist keeps a
sliding window of recent 4-second segments; the final window remains
available after the session ends.

## Recording to server disk

Start a session with `record: true` (alone or alongside RTMP/HLS) and the
composited program is written to server disk:

```bash
curl -X POST https://api.example.com/v1/rooms/$ROOM_ID/egress \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"record": true}'
```

Files land under `EGRESS_RECORDINGS_DIR/<egress-id>/`. Each supervised
pipeline restart writes a new numbered part file, so already-written material
is never truncated; the restart gap (a couple of seconds) is the only loss
window. When the session ends, the parts are losslessly remuxed (stream copy,
no re-encode) into a single seekable `recording.mp4` and the raw parts are
removed. If the server crashes mid-session, the raw MPEG-TS parts remain on
disk and stay downloadable.

### Recordings API

All endpoints require the platform API key and are scoped to the key's
project. Recordings grow at roughly the program bitrate (~1.1 GB/hour at the
default 2.6 Mbps program); delete what you no longer need.

```bash
# List recordings (newest first, optional ?roomId= filter)
curl -H "Authorization: Bearer $API_KEY" https://api.example.com/v1/recordings

# Download (HTTP Range supported; 206 Partial Content for byte ranges)
curl -H "Authorization: Bearer $API_KEY" -o recording.mp4 \
  https://api.example.com/v1/recordings/$EGRESS_ID/file

# Delete (removes the stored files)
curl -X DELETE -H "Authorization: Bearer $API_KEY" \
  https://api.example.com/v1/recordings/$EGRESS_ID
```

The session view (`GET /v1/egress/$EGRESS_ID`) carries `recordingUrl` and
`recordingSizeBytes` for record sessions. When the finalized MP4 is ready
(shortly after `egress.stopped`), the project's webhook endpoint receives
`egress.recording_ready` with the download URL and byte size - no polling.
Sessions that fail without finalization never emit it; their raw parts stay
downloadable.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `EGRESS_FFMPEG_PATH` | `ffmpeg` | Binary used for egress pipelines |
| `EGRESS_MEDIA_PORT_MIN` / `EGRESS_MEDIA_PORT_MAX` | `42000` / `42100` | UDP range FFmpeg binds for RTP ingest |
| `EGRESS_HLS_DIR` | system temp dir | Root directory for HLS segment trees |
| `EGRESS_RECORDINGS_DIR` | `<server cwd>/data/egress-recordings` | Root directory for session recordings |
| `EGRESS_ALLOW_PRIVATE_TARGETS` | `false` | Development escape hatch for local RTMP targets |

## Local development with an RTMP target

Run [mediamtx](https://github.com/bluenviron/mediamtx) next to the stack and
start egress against it with `EGRESS_ALLOW_PRIVATE_TARGETS=true`:

```bash
docker run --rm -p 1935:1935 bluenviron/mediamtx:latest
# then start egress with "rtmpEndpoints": ["rtmp://127.0.0.1:1935/stream"]
# and watch with: ffplay rtmp://127.0.0.1:1935/stream
```
