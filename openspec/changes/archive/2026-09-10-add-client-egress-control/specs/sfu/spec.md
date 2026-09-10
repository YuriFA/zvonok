# sfu

## ADDED Requirements

### Requirement: Client-initiated egress control
A connected participant SHALL start an egress session for a project-owned
room via `egress:start` (`{record, hls}`, at least one output) and stop the
room's active session via `egress:stop`, both answered on the requesting
socket with acknowledgements. The record output requires the
`start-recording` capability and the HLS output requires `start-broadcast`;
a request for an output the participant lacks is denied with a coded
authorization error and creates nothing. RTMP endpoints SHALL NOT be
specifiable through this path. Requests for user-owned rooms are denied with
a coded error. The room's active session semantics (one concurrent session)
SHALL match the REST path: starting while active is denied with a
conflict error.

#### Scenario: Host starts a recording from the client
- **WHEN** a participant holding `start-recording` emits `egress:start` with `record: true` for a project room with no active session
- **THEN** a session with the recording output is created and the acknowledgement reports success

#### Scenario: Participant without capability denied
- **WHEN** a participant without `start-broadcast` emits `egress:start` with `hls: true`
- **THEN** the acknowledgement carries a coded authorization error and no session is created

#### Scenario: Second concurrent session refused
- **WHEN** `egress:start` is emitted for a room that already has an active session
- **THEN** the acknowledgement carries a coded conflict error and the existing session is unaffected

#### Scenario: RTMP is not client-specifiable
- **WHEN** an `egress:start` payload carries RTMP endpoint fields
- **THEN** they are ignored or rejected; no RTMP output can be created from the client path

#### Scenario: User-owned room denied
- **WHEN** `egress:start` is emitted in a user-owned room
- **THEN** the acknowledgement carries a coded error and no session is created

#### Scenario: Host stops the session
- **WHEN** a capable participant emits `egress:stop` for the room's active session
- **THEN** the session stops gracefully and the acknowledgement reports success

### Requirement: Egress status broadcast
When a room's egress session changes status (started, live, stopped, ended,
failed), the server SHALL notify the room's connected participants with the
session id, outputs, and new status, so clients can mirror egress state.

#### Scenario: Participants see recording go live
- **WHEN** a client-initiated session transitions to `live`
- **THEN** every connected participant receives the status change carrying the session id and outputs
