# sfu

## MODIFIED Requirements

### Requirement: Join acknowledgement capabilities
Every successful `sfu:join` acknowledgement SHALL carry the joining
participant's effective capabilities as a list of capability ids from the
fixed vocabulary: `send-audio`, `send-video`, `send-screenshare`,
`mute-users`, `remove-participants`, `lock-room`, `start-recording`,
`start-broadcast`, `send-data-message`. Capabilities SHALL be computed by the
server from the verified credential path (room owner, registered user,
approved guest, or verified room-token role) and SHALL NOT be read from
client-supplied payload fields. The `send-data-message` capability SHALL be
granted by the `host` and `participant` role bundles and withheld from
`viewer`.

#### Scenario: Room owner joins
- **WHEN** the owner of a user-owned room joins with a verified access JWT
- **THEN** the join acknowledgement carries the full capability bundle including `mute-users`, `remove-participants`, and `lock-room`

#### Scenario: Registered participant joins
- **WHEN** a registered non-owner user joins a user-owned room
- **THEN** the join acknowledgement carries the send capabilities and none of the host capabilities

#### Scenario: Viewer token join
- **WHEN** a participant joins with a verified `viewer`-role room token
- **THEN** the join acknowledgement carries no send capabilities

## ADDED Requirements

### Requirement: Data channel broadcast
A connected participant holding `send-data-message` SHALL broadcast an
ephemeral message by emitting `sfu:broadcast` `{topic, payload}`; the server
SHALL answer on the requesting socket with an acknowledgement - success, or
a coded error: `MISSING_CAPABILITY` without the capability,
`PAYLOAD_TOO_LARGE` when the serialized payload exceeds 8192 bytes, or
`INVALID_TOPIC` when the topic is not 1-64 characters of `[A-Za-z0-9._-]`.
On success the server SHALL relay the message to every other participant in
the room as `sfu:broadcast` `{senderId, topic, payload, timestamp}` and to
nobody else. Messages SHALL NOT be persisted or replayed; ordering per
sender follows their socket. A denial SHALL change nothing and relay
nothing.

#### Scenario: Participant broadcasts on a topic
- **WHEN** a participant holding `send-data-message` emits `sfu:broadcast` with topic `reactions` and a small JSON payload
- **THEN** every other participant in the room receives the relayed message with the sender's id and the same topic and payload, and the sender's acknowledgement reports success

#### Scenario: Viewer denied
- **WHEN** a participant without `send-data-message` emits `sfu:broadcast`
- **THEN** the acknowledgement carries `MISSING_CAPABILITY` and no participant receives anything

#### Scenario: Oversized payload rejected
- **WHEN** a broadcast carries a payload serializing to more than 8192 bytes
- **THEN** the acknowledgement carries `PAYLOAD_TOO_LARGE` and nothing is relayed

#### Scenario: Malformed topic rejected
- **WHEN** a broadcast carries an empty topic or characters outside `[A-Za-z0-9._-]`
- **THEN** the acknowledgement carries `INVALID_TOPIC` and nothing is relayed

#### Scenario: Sender does not echo
- **WHEN** a broadcast is relayed to the room
- **THEN** the sender themselves does not receive their own message back
