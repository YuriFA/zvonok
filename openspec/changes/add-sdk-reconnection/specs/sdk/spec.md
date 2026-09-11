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
list of capability ids delivered by the server. Participant info SHALL carry
the token-provided correlation fields `externalId` and `metadata` as optional
fields when the participant joined with a token that had them. The join
payload SHALL NOT carry trusted identity fields: platform consumers
authenticate with a room token, and app-embedded usage authenticates with the
browser session the server already verifies (handshake cookies). Join-refusal
errors surface as typed errors on every identity path.

After a successful join, the SDK SHALL recover from signalling disconnects
automatically: on disconnect it enters a `reconnecting` status while
retaining local tracks; on transport reconnect it rejoins the room (same
identity), recreates transports, republishes the retained local tracks, and
resubscribes to current producers before returning to `joined`. Reconnect
attempts exhausted SHALL surface `failed` with a typed error. A rejoin
denied as kicked SHALL surface the kicked state and stop reconnecting. Join
options MAY carry `tokenProvider` (an async function returning a fresh room
token); when a rejoin is rejected because the stored token expired, the SDK
SHALL call the provider once, retry the join with the fresh token, and keep
it for later rejoins; without a provider, an expired-token rejoin SHALL
surface a typed error and stop.

#### Scenario: Token-based join from external app
- **WHEN** an external app connects with a server URL, room slug, and a valid room token
- **THEN** the SDK joins and receives participant and track events for other participants, named with the participant vocabulary throughout the public surface

#### Scenario: Own capabilities after join
- **WHEN** a join succeeds
- **THEN** the connection state exposes the server-delivered capability list, and a host-role join shows host capabilities while a viewer-role join shows none

#### Scenario: Correlation fields on participants
- **WHEN** a remote participant joined with a token carrying `externalId` and `metadata`
- **THEN** the participant info exposed to the consumer carries both fields

#### Scenario: Network blip recovers the room
- **WHEN** the signalling connection drops and returns while the participant was joined with published tracks
- **THEN** the status moves joined -> reconnecting -> joined, local tracks are republished, remote producers are resubscribed, and no consumer signalling is required

#### Scenario: Token refresh mid-call
- **WHEN** a rejoin is rejected because the stored token expired and a `tokenProvider` is configured
- **THEN** the provider is called, the join retries with the fresh token, and recovery completes

#### Scenario: Expired token without provider fails typed
- **WHEN** a rejoin is rejected because the stored token expired and no `tokenProvider` is configured
- **THEN** the SDK surfaces a typed expired-token error and does not retry into a dead room

#### Scenario: Kick during reconnect is terminal
- **WHEN** the participant was removed by kick and their automatic rejoin is denied
- **THEN** the kicked state surfaces and no further rejoin is attempted

#### Scenario: Invalid token surfaces typed error
- **WHEN** the connection is attempted with an expired or invalid token
- **THEN** the SDK surfaces a typed join error instead of throwing unexpectedly

#### Scenario: Unauthenticated join surfaces typed error
- **WHEN** a connection is attempted with no verifiable credential
- **THEN** the SDK surfaces a typed authentication join error and does not
  retry into a dead room
