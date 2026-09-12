## MODIFIED Requirements

### Requirement: Connection and join contract
`@zvonok/client` SHALL expose a connection entry point that takes a server
URL, a room identifier (a room slug, a room id, or both), and an optional
identity - platform consumers pass a room token, app-embedded consumers pass
none and rely on the browser session the server verifies at handshake - joins
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
errors surface as typed errors on every identity path. When the server ends
the room, the session SHALL surface a room-ended state, release the
connection, and stop recovery. Publish options MAY carry a mobile-sender
hint that adapts the producer's simulcast encodings for mobile devices.

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

#### Scenario: App joins on its browser session
- **WHEN** the zvonok app joins a room without passing a token, relying on its verified session cookie from the handshake
- **THEN** the join succeeds with server-derived identity exactly as a token join does, and join refusals surface as typed errors

#### Scenario: Join accepts room id or slug
- **WHEN** a consumer passes a room id, a room slug, or both to the join entry point
- **THEN** the join reaches the same room in every case

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
- **THEN** the SDK surfaces a typed authentication join error and does not retry into a dead room

#### Scenario: Room ended surfaces and cleans up
- **WHEN** the server ends the room while the participant is joined
- **THEN** the session surfaces a room-ended state, releases the connection, and performs no further reconnection attempts

#### Scenario: Mobile hint adapts encodings
- **WHEN** a track is published with the mobile-sender hint set
- **THEN** the producer's simulcast encodings are the mobile-adapted set, and publishing without the hint is unchanged

## ADDED Requirements

### Requirement: Remote audio playout
`@zvonok/react` SHALL expose remote-audio playout as a single hook backed by
the SDK's audio mixer: it SHALL play every remote participant's audio without
consumer-managed audio elements, SHALL support per-participant volume and
output-device routing, and SHALL feed audio-activity readings (per-participant
levels and the active speaker) from the same playout graph. Releasing the hook
on room leave SHALL stop all playback and sampling resources.

#### Scenario: Remote audio plays without manual wiring
- **WHEN** a participant joins a room where others publish microphone audio
- **THEN** remote audio is audible with no consumer-created audio elements or stream attachment

#### Scenario: Per-participant volume
- **WHEN** the consumer sets a participant's volume to zero
- **THEN** that participant becomes inaudible while other participants remain audible at their volumes

#### Scenario: Output device routing
- **WHEN** the consumer selects an output device id
- **THEN** all remote playout routes to that device

#### Scenario: Levels share the playout graph
- **WHEN** audio-activity readings are consumed alongside playout
- **THEN** levels and the active speaker reflect the played audio without a second sampling pipeline

#### Scenario: Leave releases resources
- **WHEN** the room is left
- **THEN** playback elements, gain nodes, and sampling timers are released

### Requirement: Screen share control
`@zvonok/react` SHALL expose screen share as a hook over the SDK's screen
share service: start captures the display and publishes it as a separate
screen producer honoring the server's room-level exclusive lock, stop
unpublishes it, and the hook SHALL expose sharing state including the
blocked-by-another-participant condition, with typed failures surfaced to the
consumer.

#### Scenario: Start publishes a screen producer
- **WHEN** a capable participant starts screen share
- **THEN** a screen track is published and the hook reports sharing active

#### Scenario: Exclusive lock surfaces as blocked
- **WHEN** screen share is requested while another participant holds the room's share
- **THEN** the request fails without disrupting the call and the hook reports the blocked state

#### Scenario: Stop unpublishes
- **WHEN** the sharing participant stops screen share
- **THEN** the screen producer is closed and the hook reports sharing inactive

### Requirement: Guest join requests (owner side)
`@zvonok/react` SHALL expose the room's guest join-request stream as a hook:
it SHALL deliver each new request (request id, display name) and expose the
pending queue state for the room owner's UI. Approval and denial actions SHALL
remain with the consumer; the hook SHALL NOT perform authorization actions.

#### Scenario: Owner sees a pending request
- **WHEN** a guest requests to join an approval-required room the owner is in
- **THEN** the hook's queue gains the request with its request id and display name

#### Scenario: Queue is state only
- **WHEN** the owner's client approves or denies a request through its own actions
- **THEN** the hook reflects the removal from the pending queue without itself having called any approval endpoint
