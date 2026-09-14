## REMOVED Requirements

### Requirement: Single worker with router per room

**Reason**: A single Worker caps media forwarding at one CPU core and leaves the
whole media plane as one crash domain. Replaced by a worker pool that keeps the
same per-room Router model.

**Original text**:

The server SHALL run a mediasoup Worker (recovered on crash) hosting one
Router per room, torn down when the room ends or empties.

#### Scenario: Worker crash

- **WHEN** the mediasoup Worker process dies
- **THEN** a new Worker is started and rooms recover their routers

## ADDED Requirements

### Requirement: Worker pool with router per room

The server SHALL run a pool of mediasoup Workers (one per CPU core by default,
never fewer than one) and SHALL assign each room's Router to exactly one
Worker, choosing the least-loaded Worker at Router creation. Routers SHALL be
torn down when the room ends or empties, as before.

#### Scenario: Router placement across the pool

- **WHEN** rooms are created on a multi-core host
- **THEN** their Routers are distributed across the pool so no single Worker
  hosts every room while another is idle

#### Scenario: Worker crash recovers rooms

- **WHEN** a mediasoup Worker process dies
- **THEN** a replacement Worker is started, every room that Worker hosted
  receives a new Router, and each affected participant is notified with
  `sfu:room-media-reset` carrying the room's router RTP capabilities

#### Scenario: Rooms not on the dead Worker are unaffected

- **WHEN** a mediasoup Worker process dies
- **THEN** rooms whose Router lived on a different Worker keep their media and
  receive no reset event

### Requirement: Participant media reset notification

The server SHALL emit `sfu:room-media-reset` with `{roomId,
routerRtpCapabilities}` to every participant of a room whose media plane was
lost with a crashed Worker, after the room's Router has been recreated.

#### Scenario: Reset payload carries rebuilt capabilities

- **WHEN** the replacement Worker recreates a room's Router
- **THEN** each room participant receives `sfu:room-media-reset` whose
  `routerRtpCapabilities` match the new Router's capabilities
