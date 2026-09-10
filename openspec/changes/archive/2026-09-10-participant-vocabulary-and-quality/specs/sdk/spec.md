# sdk

## MODIFIED Requirements

### Requirement: Connection and join contract
`@zvonok/client` SHALL expose a connection entry point that takes a server URL,
a room identifier, and an identity (room token for platform consumers), joins
the room over signalling, and exposes typed events for participant and track
lifecycle and join errors. The public vocabulary of the packages SHALL name
the room member a participant uniformly: participant state, participant
lifecycle callbacks, and participant collections (`remoteParticipants`)
across `@zvonok/client` and `@zvonok/react`. A consumer following only this
contract joins a working room with remote media. After a successful join the
connection state SHALL expose the participant's own capabilities as a typed
list of capability ids delivered by the server. The join payload SHALL NOT
carry trusted identity fields: platform consumers authenticate with a room
token, and app-embedded usage authenticates with the browser session the
server already verifies (handshake cookies). Join-refusal errors surface as
typed errors on every identity path.

#### Scenario: Token-based join from external app
- **WHEN** an external app connects with a server URL, room slug, and a valid room token
- **THEN** the SDK joins and receives participant and track events for other participants, named with the participant vocabulary throughout the public surface

#### Scenario: Own capabilities after join
- **WHEN** a join succeeds
- **THEN** the connection state exposes the server-delivered capability list, and a host-role join shows host capabilities while a viewer-role join shows none

#### Scenario: Invalid token surfaces typed error
- **WHEN** the connection is attempted with an expired or invalid token
- **THEN** the SDK surfaces a typed join error instead of throwing unexpectedly

#### Scenario: Unauthenticated join surfaces typed error
- **WHEN** a connection is attempted with no verifiable credential
- **THEN** the SDK surfaces a typed authentication join error and does not
  retry into a dead room

## ADDED Requirements

### Requirement: Manual quality selection
`@zvonok/react` SHALL expose a quality control hook providing
`setParticipantQuality(userId, level)` with levels `low`, `medium`, and
`high`, requesting the corresponding simulcast preference for the remote
participant's subscribed video. The selection SHALL affect only the caller's
subscription, SHALL NOT affect audio, and SHALL NOT affect what other
participants receive. An unknown participant id, or one with no subscribed
video, SHALL surface a typed error; the level vocabulary SHALL be part of
the package's public types.

#### Scenario: Consumer lowers a remote video's quality
- **WHEN** a consumer calls the quality action with a remote participant's id and `low`
- **THEN** the caller's subscription for that participant switches to the low simulcast preference without affecting other subscribers

#### Scenario: Quality does not touch audio
- **WHEN** a quality level is set for a participant
- **THEN** the participant's audio subscription is unaffected

#### Scenario: Unknown participant rejected
- **WHEN** the quality action is called with an id that has no subscribed video
- **THEN** the action surfaces a typed error and no subscription changes
