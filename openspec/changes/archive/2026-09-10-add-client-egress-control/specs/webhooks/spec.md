# webhooks

## ADDED Requirements

### Requirement: Recording readiness event
When a project room's egress session that carried the recording output is
finalized after the session ended, the project's endpoint SHALL receive
`egress.recording_ready` identifying the room (id, slug) and the egress
session (id, outputs) and carrying the finalized recording's URL and byte
size. The event SHALL be signed and retried by the same delivery contract as
the other egress events. Sessions that fail without finalization SHALL NOT
emit this event; their material stays reachable through the recordings API.

#### Scenario: Finalized recording notifies the consumer
- **WHEN** a recording session ends and its parts finalize into the single seekable recording
- **THEN** the project's endpoint receives `egress.recording_ready` with the recording URL and size

#### Scenario: No readiness for failed sessions
- **WHEN** a session reconciles to `failed` after a server crash
- **THEN** no `egress.recording_ready` event is delivered for it
