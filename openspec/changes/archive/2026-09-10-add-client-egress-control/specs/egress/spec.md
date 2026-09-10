# egress

## ADDED Requirements

### Requirement: Client-initiated sessions
An egress session SHALL be startable by a connected in-room participant for
a project-owned room through the signalling path with the record and/or HLS
outputs, gated by the participant's capabilities (`start-recording` for
record, `start-broadcast` for HLS). Sessions started this way are the same
sessions as the REST path: identical lifecycle, identical single-session-per-
room rule, identical media program, and inspectable via `/v1`. RTMP outputs
remain creatable only through the REST path by a project API key.

#### Scenario: Client-started session is a first-class session
- **WHEN** a participant starts a record-only session from the client and the project's key lists the room's sessions
- **THEN** the session appears with the same fields and lifecycle as a REST-started one

#### Scenario: Client session followed by REST stop
- **WHEN** a client-started live session is stopped via `POST /v1/egress/:id/stop`
- **THEN** the session ends with reason `stopped` exactly as a REST-started session would
