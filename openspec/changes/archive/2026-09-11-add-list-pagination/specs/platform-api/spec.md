# platform-api

## MODIFIED Requirements

### Requirement: List rooms
`GET /v1/rooms` SHALL return the project's rooms with status metadata, scoped
to the authenticated key's project only, newest first, as a cursor-paginated
envelope: `limit` (default 50, max 100) caps the page size, `cursor` (opaque
string from a previous response's `next`) continues after that page, and the
response carries `{ items, next }` where `next` is the continuation cursor
or `null` when no older rooms remain. `limit` outside 1-100 or a malformed
cursor SHALL be rejected with 400.

#### Scenario: List shows only own project
- **WHEN** a key lists rooms and other projects have rooms too
- **THEN** only rooms of the key's project are returned

#### Scenario: Pagination walks the rooms
- **WHEN** a project has more rooms than the requested limit and the consumer follows `next`
- **THEN** every room appears exactly once in newest-first order until `next` is null

#### Scenario: Insertion during pagination
- **WHEN** a new room is created between two pages of a walk
- **THEN** the walk continues from the cursor's position and neither skips older rooms nor repeats any

#### Scenario: Invalid paging parameters
- **WHEN** a list request carries `limit=500` or an unknown cursor
- **THEN** the server responds 400 and no items are returned

### Requirement: Egress endpoints
The `/v1` surface SHALL expose egress management under API-key auth and the
existing per-key rate limits: `POST /v1/rooms/:id/egress` starts a session
for a project room with validated outputs (one to three `rtmp(s)://`
endpoints and/or local HLS), `GET /v1/rooms/:id/egress` lists the room's
sessions (newest first, same cursor envelope and limits as room listing),
`GET /v1/egress/:id` inspects one session, and
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
authentication: list recordings (filterable by room, newest first, same
cursor envelope and limits as room listing), download a session's finalized
recording (HTTP Range supported), and delete a recording.
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
