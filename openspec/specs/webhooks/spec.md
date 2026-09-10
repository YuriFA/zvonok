# webhooks

## Purpose

Per-project server-to-server event delivery: project-owned room lifecycle reaches the consumer's endpoint as signed HTTP POSTs with retries.

## Requirements

### Requirement: Webhook configuration
A project SHALL have at most one webhook endpoint: a URL and a signing
secret configured through the developer module's webhook configuration
routes; the routes, https-only validation, and secret handling are
specified by the developer capability. Removing the endpoint SHALL stop
all deliveries for the project immediately.

#### Scenario: Configure endpoint
- **WHEN** an authenticated developer sets or replaces the webhook URL for their project
- **THEN** the project has exactly one configured endpoint and event deliveries target it

#### Scenario: Remove endpoint
- **WHEN** the developer removes the webhook configuration
- **THEN** subsequent room events for that project are not delivered anywhere

### Requirement: Signed event delivery
Every webhook delivery SHALL be an HTTP `POST` with a JSON body containing at
least `type`, `timestamp`, and `data`, and with `X-Zvonok-Timestamp` and
`X-Zvonok-Signature` headers where the signature is
`sha256=HMAC-SHA256(secret, "{timestamp}.{rawBody}")`. A receiver following
only this contract can verify authenticity and freshness of every event.

#### Scenario: Receiver verifies a genuine event
- **WHEN** the consumer recomputes HMAC-SHA256 over `"{timestamp}.{rawBody}"` with their secret
- **THEN** the computed digest matches `X-Zvonok-Signature`

#### Scenario: Forged event rejected
- **WHEN** an attacker POSTs a fabricated event without knowing the secret
- **THEN** the recomputed digest does not match the claimed signature and the receiver rejects it

### Requirement: Room lifecycle events
Project-owned rooms SHALL emit `room.started` when the first participant joins,
`participant.joined` and `participant.left` on every participant arrival and
departure, and `room.ended` when the room ends. Events SHALL identify the room
(id, slug) and the participant (id, display name) where applicable; a left
event SHALL include the departure reason (leave, kick, disconnect, room end).
User-owned rooms SHALL NOT emit webhook events.

#### Scenario: First participant opens a room
- **WHEN** the first participant joins a project-owned room
- **THEN** the project's endpoint receives `room.started` followed by `participant.joined` for that participant

#### Scenario: Participant departs
- **WHEN** a participant leaves, is kicked, or disconnects
- **THEN** the endpoint receives `participant.left` carrying the departure reason

#### Scenario: Room ends
- **WHEN** a project room is ended via the public API
- **THEN** the endpoint receives `room.ended` after the participants are torn down

#### Scenario: User-owned rooms stay silent
- **WHEN** participants join and leave a user-owned room
- **THEN** no webhook events are emitted for it

### Requirement: Delivery retries
A delivery that fails (network error, timeout, or non-2xx response) SHALL be
retried up to 5 times with exponentially increasing delays, and then dropped.
Each attempt SHALL carry a fresh timestamp and signature. Deliveries are
best-effort: events are not persisted for redelivery across server restarts.

#### Scenario: Temporary endpoint outage
- **WHEN** the endpoint returns 500 for the initial attempt
- **THEN** the delivery is retried with growing delays until it succeeds or the attempts are exhausted

#### Scenario: Endpoint down for good
- **WHEN** every attempt fails
- **THEN** the event is dropped and delivery of later events continues independently

### Requirement: Egress events
Project-owned rooms SHALL emit `egress.started` when a session goes live,
`egress.stopped` when it ends (carrying the end reason `stopped` or
`room-ended`), and `egress.failed` when it fails (carrying an error reason).
Events SHALL identify the room (id, slug) and the egress session (id,
outputs) and SHALL be signed and retried by the same delivery contract as
room lifecycle events. User-owned rooms SHALL NOT emit egress events.

#### Scenario: Egress lifecycle reaches the consumer
- **WHEN** a project room's egress session goes live and is later stopped via the API
- **THEN** the project's endpoint receives `egress.started` followed by `egress.stopped` with reason `stopped`

#### Scenario: Failed egress notifies the consumer
- **WHEN** a session exhausts its retry budget and fails
- **THEN** the endpoint receives `egress.failed` with the error reason

#### Scenario: User-owned rooms stay silent for egress
- **WHEN** an egress session runs on a user-owned room
- **THEN** no egress webhook events are emitted for it

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
