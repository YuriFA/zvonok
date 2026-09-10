# Platform API Specification

## Purpose

The versioned public REST surface (`/v1`) that third-party backends use with an API key to create rooms, end them, and mint short-lived participant tokens.

## Requirements

### Requirement: API key authentication
Every `/v1` endpoint SHALL require `Authorization: Bearer <apiKey>` where the
key resolves to an active (non-revoked) API key. Missing, malformed, unknown, or
revoked keys are rejected with 401 before any business logic runs.

#### Scenario: Missing Authorization header
- **WHEN** a `/v1` request arrives without an Authorization header
- **THEN** the server responds 401

#### Scenario: Unknown key
- **WHEN** a `/v1` request arrives with a well-formed but unknown key
- **THEN** the server responds 401 and the response does not leak whether the key never existed or was revoked

### Requirement: Per-key rate limiting
The server SHALL rate-limit `/v1` requests per API key independently of the
global user-facing throttles. Exceeding the limit returns 429 with a Retry-After
hint.
Room creation, token minting, and egress start carry a tighter
60-requests-per-minute per-key budget; the remaining `/v1` traffic uses the
platform's default per-key budgets.

#### Scenario: Burst over limit
- **WHEN** a key exceeds its request budget within the window
- **THEN** the server responds 429 and other keys' budgets are unaffected

### Requirement: Create room
`POST /v1/rooms` SHALL create a room owned by the key's project, with a unique
slug, participant limits validated in the same 2-50 range as user-created
rooms, and return the room identifier and slug.

#### Scenario: Create room
- **WHEN** a valid key creates a room with default limits
- **THEN** the room exists, belongs to the key's project, has a unique slug, and the response returns its identifier

#### Scenario: Invalid participant limit
- **WHEN** a room is created with maxParticipants outside 2-50
- **THEN** the server responds 400 and no room is created

### Requirement: List rooms
`GET /v1/rooms` SHALL return the project's rooms with status metadata, scoped
to the authenticated key's project only.

#### Scenario: List shows only own project
- **WHEN** a key lists rooms and other projects have rooms too
- **THEN** only rooms of the key's project are returned

### Requirement: End room
`DELETE /v1/rooms/:id` SHALL end a project-owned room: status becomes ended,
connected participants are disconnected with a room-ended signal, and SFU
resources are torn down, mirroring the user-facing end flow.

#### Scenario: End active room
- **WHEN** a key ends one of its project's active rooms with connected participants
- **THEN** participants receive the room-ended signal, the room status becomes ended, and further joins are refused

#### Scenario: End another project's room
- **WHEN** a key ends a room belonging to a different project
- **THEN** the server responds 404

### Requirement: Mint room token
`POST /v1/rooms/:id/tokens` SHALL mint a short-lived single-room token
carrying participant identity (opaque participant id and display name) and a
role - `host`, `participant`, or `viewer`, defaulting to `participant`. The
role is the token's permission statement; the server resolves it to concrete
capabilities at join time. The response returns the token and its expiry.

#### Scenario: Mint token for own room
- **WHEN** a valid key mints a token for its project's active room
- **THEN** a token bound to that room, with the requested identity and role, is returned with an expiry in the near future

#### Scenario: Mint token for ended room
- **WHEN** a token is requested for a room whose status is ended
- **THEN** the server responds 400 and no token is issued

#### Scenario: Unknown role rejected
- **WHEN** a token is minted with a role outside `host`, `participant`, `viewer`
- **THEN** the server responds 400 and no token is issued

#### Scenario: Role defaults to participant
- **WHEN** a token is minted without a role field
- **THEN** the issued token carries the `participant` role

### Requirement: Token scope
A room token SHALL be valid only for the room it was minted for, only while the
API key that minted it remains active, and only before its expiry.

#### Scenario: Token replay on another room
- **WHEN** a token minted for room X is presented when joining room Y
- **THEN** the join is rejected

#### Scenario: Token after key revocation
- **WHEN** a token is used after the minting API key was revoked
- **THEN** the join is rejected

### Requirement: Egress endpoints
The `/v1` surface SHALL expose egress management under API-key auth and the
existing per-key rate limits: `POST /v1/rooms/:id/egress` starts a session
for a project room with validated outputs (one to three `rtmp(s)://`
endpoints and/or local HLS), `GET /v1/rooms/:id/egress` lists the room's
sessions, `GET /v1/egress/:id` inspects one session, and
`POST /v1/egress/:id/stop` stops an active session. All four SHALL be scoped
to the authenticated key's project exactly like the room endpoints.

#### Scenario: Start egress with API key
- **WHEN** a valid key posts a outputs payload with one RTMP endpoint and HLS enabled to its project's active room
- **THEN** the server responds 201 with the session id, outputs, and initial status

#### Scenario: Egress requires both outputs and valid URLs
- **WHEN** egress is started with an empty outputs payload or a non-RTMP URL
- **THEN** the server responds 400 and no session is created

#### Scenario: Rate limit applies to egress calls
- **WHEN** a key hammers the egress endpoints past its per-key budget
- **THEN** responses are 429 with a Retry-After hint, as with other `/v1` endpoints

### Requirement: Recordings endpoints
The platform API SHALL expose a project-scoped recordings surface with API-key
authentication: list recordings (filterable by room, newest first), download a
session's finalized recording (HTTP Range supported), and delete a recording.
Access SHALL be limited to the key's own project: another project's recording
SHALL respond 404. Downloads SHALL be served after finalization for ended
sessions and SHALL serve the raw parts for sessions reconciled as `failed`
after a server crash. Deletion SHALL remove the stored files.

#### Scenario: List and download own recordings
- **WHEN** a valid key lists recordings for its project and downloads one by egress id
- **THEN** the list contains the session and the download returns the recording bytes with `Content-Type: video/mp4`

#### Scenario: Another project's recording is invisible
- **WHEN** a key requests a recording belonging to a different project
- **THEN** the server responds 404 for the download and the recording is absent from the list

#### Scenario: Range request seeks into the file
- **WHEN** a download request carries a `Range: bytes=N-` header
- **THEN** the server responds `206 Partial Content` with the requested byte range

#### Scenario: Deleting removes the file
- **WHEN** a valid key deletes a recording
- **THEN** the files are removed from disk and a subsequent download responds 404
