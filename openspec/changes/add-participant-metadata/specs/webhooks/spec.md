# webhooks

## MODIFIED Requirements

### Requirement: Room lifecycle events
Project-owned rooms SHALL emit `room.started` when the first participant joins,
`participant.joined` and `participant.left` on every participant arrival and
departure, and `room.ended` when the room ends. Events SHALL identify the room
(id, slug) and the participant (id, display name) where applicable; when the
participant joined with a token carrying correlation fields, the joined and
left events SHALL also carry that `externalId` and `metadata` verbatim. A left
event SHALL include the departure reason (leave, kick, disconnect, room end).
User-owned rooms SHALL NOT emit webhook events.

#### Scenario: First participant opens a room
- **WHEN** the first participant joins a project-owned room
- **THEN** the project's endpoint receives `room.started` followed by `participant.joined` for that participant

#### Scenario: Correlation fields reach the consumer
- **WHEN** a participant who joined with a token carrying `externalId` and `metadata` leaves
- **THEN** the `participant.left` event carries the same `externalId` and `metadata` as the joined event did

#### Scenario: Participant departs
- **WHEN** a participant leaves, is kicked, or disconnects
- **THEN** the endpoint receives `participant.left` carrying the departure reason

#### Scenario: Room ends
- **WHEN** a project room is ended via the public API
- **THEN** the endpoint receives `room.ended` after the participants are torn down

#### Scenario: User-owned rooms stay silent
- **WHEN** participants join and leave a user-owned room
- **THEN** no webhook events are emitted for it
