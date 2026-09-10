# sdk

## MODIFIED Requirements

### Requirement: Connection and join contract
`@zvonok/client` SHALL expose a connection entry point that takes a server URL,
a room identifier, and an identity (room token for platform consumers), joins
the room over signalling, and exposes typed events for peer and track
lifecycle and join errors. A consumer following only this contract joins a
working room with remote media. After a successful join the connection state
SHALL expose the participant's own capabilities as a typed list of capability
ids delivered by the server. The join payload SHALL NOT carry trusted
identity fields: platform consumers authenticate with a room token, and
app-embedded usage authenticates with the browser session the server already
verifies (handshake cookies). Join-refusal errors surface as typed errors on
every identity path.

#### Scenario: Token-based join from external app
- **WHEN** an external app connects with a server URL, room slug, and a valid room token
- **THEN** the SDK joins and receives remote peer and track events for other participants

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

### Requirement: React binding
`@zvonok/react` SHALL provide a provider carrying SDK configuration and hooks
covering the join lifecycle, participants-and-tracks state, device controls,
and the consumer's own capabilities, implemented as a thin layer over
`@zvonok/client`. It declares `react` >= 18 as a peer dependency. The
headless hook layer adds no UI; the package MAY additionally ship the
prebuilt room component below.

#### Scenario: React consumer joins declaratively
- **WHEN** a React app renders the provider with config and uses the join hook with a token
- **THEN** the hook exposes connection state, participants, and remote tracks as React state without manual signalling wiring

#### Scenario: Component gates UI on own capabilities
- **WHEN** a component renders host controls behind `useOwnCapabilities()`
- **THEN** the controls render exactly for capabilities the server granted, without the consumer encoding role logic

### Requirement: Host control actions
The SDK SHALL expose host-control actions - kick a peer, mute a peer, mute
all, lock and unlock the room - that emit the corresponding signalling
events. Every action, kick included, resolves with the server's
acknowledgement: success settles the promise, authorization denials surface
as typed errors carrying the server's coded error. Actions are available to
any consumer whose capabilities the server accepts.

#### Scenario: Authorized host mutes a peer
- **WHEN** a participant holding `mute-users` invokes the mute action for another peer
- **THEN** the server mutes that peer and the action resolves successfully on the acknowledgement

#### Scenario: Host kicks a participant
- **WHEN** an authorized participant invokes the kick action for another participant
- **THEN** the kicked participant is disconnected from the room, the departure is reported as participant-left with reason kick, and the action resolves once the server confirms the removal

#### Scenario: Non-host action denied
- **WHEN** a participant without the required capability invokes a host-control action
- **THEN** the SDK surfaces the server's authorization denial as a typed error as soon as the acknowledgement arrives
