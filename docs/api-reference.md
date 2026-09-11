# Platform API Reference

Every platform capability is reachable over HTTPS with a JSON API. Two
surfaces share one server:

| Surface | Auth | For |
| --- | --- | --- |
| `/v1` | API key (`Authorization: Bearer zk_live_...`) | Your backend drives rooms, tokens, egress, recordings |
| `/developers` | Dev bearer token (30 min) | Your console/tooling manages projects, keys, webhooks |

The base URL is your deployment (`https://your-zvonok-server.example` in the
examples). All requests and responses are JSON except recording downloads.

- Errors follow the NestJS envelope: `{ "message": "...", "error": "...", "statusCode": 404 }`
- Resources owned by another project respond `404` - the API is intentionally
  indistinguishable between "missing" and "not yours"
- All `/v1` routes are rate-limited per API key: mutating routes (create room, mint token, start egress) are limited to 60 requests per minute; other routes use the platform's default per-key budget

## Authentication

Register a developer account, create a project, issue an API key. The full
key is shown exactly once:

```bash
curl -s -X POST $ZVONOK_URL/developers/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "my-handle", "password": "Password1"}'
# -> { "token": "<dev token>" }

curl -s -X POST $ZVONOK_URL/developers/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "my-handle", "password": "Password1"}'

curl -s -X POST $ZVONOK_URL/developers/projects \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my app"}'

curl -s -X POST $ZVONOK_URL/developers/projects/<projectId>/keys \
  -H "Authorization: Bearer $DEV_TOKEN"
# -> { "id": "...", "key": "zk_live_...", "prefix": "zk_live_...", ... }
```

Signed-in site users skip the manual form entirely: the console at `/console`
offers one-click sign-in via `POST /developers/auth/sso` (app cookie session).

## Rooms

### Create a room

`POST /v1/rooms` (60 req/min)

```json
{ "name": "Standup", "maxParticipants": 10 }
```

Both fields optional. Returns the room row: `id`, generated `slug`, `name`,
`projectId`, `maxParticipants`, `status: "active"`, timestamps.

### List project rooms

`GET /v1/rooms` - newest first, full room rows.

Every list on the platform is cursor-paginated the same way: `?limit=`
(default 50, max 100) caps the page, `?cursor=` continues from a previous
response's `next`, and the response is always the envelope
`{ "items": [...], "next": "<cursor>" | null }` - `next` is `null` when
the list is exhausted. The cursor encodes the last emitted row's sort
tuple, so pages stay stable while rooms are created or deleted mid-walk:

```
GET /v1/rooms?limit=2
{ "items": [roomC, roomB], "next": "eyJvcmRlciI6..." }
GET /v1/rooms?limit=2&cursor=eyJvcmRlciI6...
{ "items": [roomA], "next": null }
```

`limit` outside 1-100 or an unknown cursor answers `400`, never a
partial page.

### End a room

`DELETE /v1/rooms/:id` - `204`. Ends the session for everyone and releases
the slug. Idempotent per project: an already-ended room still answers `204`.

### Mint a participant token

`POST /v1/rooms/:id/tokens` (60 req/min)

```json
{
  "name": "Alice",
  "role": "host",
  "externalId": "user-42",
  "metadata": { "tenant": "acme", "seat": 4 }
}
```

All fields optional. `role` is the token's permission statement -
`host`, `participant` (default), or `viewer` - resolved server-side to
capabilities at join time (`host`: send + moderate + record/broadcast,
`participant`: send audio/video/screen, `viewer`: no send). Unknown roles
answer `400`. `externalId` (1-64 chars) and `metadata` (a JSON object
serialized to at most 2048 bytes) are consumer correlation fields: the
server carries them verbatim through the token into peer events
(`sfu:joined`, `sfu:peer-joined`, `sfu:existing-peers`), the SDK's
participant info, and the `participant.joined` / `participant.left`
webhooks - never reads them for authorization. Oversized or non-object
`metadata`, or an out-of-range `externalId`, answers `400` with no token.
The join acknowledgement delivers the effective capability
list to the client, so UIs gate on `useOwnCapabilities()` instead of
decoding the token. Returns `{ "token": "<jwt>", "expiresAt": "..." }` -
valid for `ROOM_TOKEN_TTL_MINUTES` (default 60). Pass it to
`@zvonok/react` to join, see the [quickstart](/quickstart).

## Egress

### Start an egress session

`POST /v1/rooms/:id/egress` (60 req/min)

```json
{ "rtmpEndpoints": ["rtmp://a.rtmp.youtube.com/live2"], "hls": true, "record": true }
```

All outputs optional and combinable: up to three `rtmp(s)://` push endpoints,
HLS playback, and server-side recording. One active session per room.

### Inspect and stop

- `GET /v1/rooms/:id/egress` - the room's sessions, newest first, in the
  same `{ items, next }` cursor envelope as the room list
- `GET /v1/egress/:id` - one session (carries `recordingUrl` when finalized)
- `POST /v1/egress/:id/stop` - graceful stop

Sessions move through `starting`, `live`, `stopping` and a terminal
`ended`/`failed`. A pipeline restart writes numbered part files, so recorded
material is never truncated; the restart gap (a couple of seconds) is the
only loss. Details in [egress](/egress).

## Recordings

- `GET /v1/recordings?roomId=<id>` - recorded sessions of the project,
  newest first (optionally filtered by room), in the same
  `{ items, next }` cursor envelope as the room list, with
  `recordingUrl`, `recordingSizeBytes`, `recordingFinalizedAt`
- `GET /v1/recordings/:egressId/file` - stream the material: the finalized
  MP4 (`video/mp4`) with `Range`/`206` support, or raw MPEG-TS parts
  (`video/mp2t`) for sessions that never finalized; `?part=N` picks a part
- `DELETE /v1/recordings/:egressId` - `204`; deletes the files and clears the
  metadata

## Developer API

Authenticated with the dev bearer token (`Authorization: Bearer <token>`),
valid for 30 minutes - re-login or SSO when it expires.

### Projects

- `POST /developers/projects` - `{ "name": "my app" }`
- `GET /developers/projects` - own projects, newest first, each with
  `roomCount`, in the same `{ items, next }` cursor envelope as `/v1`
  lists. The webhook signing secret is never included

### API keys

- `POST /developers/projects/:id/keys` - returns the full key exactly once
- `GET /developers/projects/:id/keys` - metadata only (`id`, `prefix`,
  `createdAt`, `revokedAt`)

### Webhooks

- `PUT /developers/projects/:id/webhooks` - `{ "url": "https://..." }`
  (https only); returns `{ "url", "secret" }` - the secret is shown once
- `DELETE /developers/projects/:id/webhooks`

Deliveries are POSTs signed with
`X-Zvonok-Signature: sha256=HMAC-SHA256(secret, "{timestamp}.{rawBody}")`
(timestamp in unix seconds; always verify against the raw body). Failed
deliveries retry with backoff. Events: `room.started`, `participant.joined`,
`participant.left`, `room.ended`, `egress.started`, `egress.stopped`,
`egress.failed`, `egress.recording_ready` (carries `recordingUrl` and
`recordingSizeBytes` when a recording finalizes). Participant events carry
`participant: { id, displayName }`, plus the token-minted `externalId` and
`metadata` verbatim when the join used a token that had them:

```json
{
  "type": "participant.joined",
  "timestamp": "2026-09-11T10:00:00.000Z",
  "data": {
    "roomId": "room-id",
    "roomSlug": "room-slug",
    "participant": {
      "id": "participant-id",
      "displayName": "Alice",
      "externalId": "user-42",
      "metadata": { "tenant": "acme", "seat": 4 }
    }
  }
}
```

Foreign projects answer `404` on every route, like `/v1`.

## Next steps

Join a room from a browser with [`@zvonok/react`](/quickstart), wire live
outputs in [egress](/egress), or deploy your own server following
[deployment](/deployment).
