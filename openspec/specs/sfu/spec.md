# SFU Specification

## Purpose

mediasoup Selective Forwarding Unit for group calls: Socket.io signalling on
the `/sfu` namespace, transport/producer/consumer lifecycle, peer and room
management, screen-share exclusivity, and TURN credential delivery. This
module is also the WebRTC signalling gateway; no separate P2P gateway exists.

## Requirements

### Requirement: SFU join and leave
A client SHALL join a room via `sfu:join` with `{roomId}` plus a verifiable
credential, and leave via `sfu:leave` or disconnect. The server SHALL derive
the participant's identity and permissions exclusively from a verified
credential - a room token in the join payload, a registered-user access JWT
presented by the handshake, or an approved-guest JWT bound to the room - and
SHALL NOT trust client-supplied identity fields (`userId`, `username`,
`roomOwnerId`) for any authorization decision. The server tracks peers per
room and notifies the room on membership changes. A join that presents no
verifiable credential SHALL be refused with a coded error and no peer created.

#### Scenario: Peer joins a group call
- **WHEN** a client emits `sfu:join` for an active room with a verifiable
  credential
- **THEN** the peer is registered and existing peers are notified of the new
  participant

#### Scenario: Registered user joins from the app
- **WHEN** the app UI joins a user-owned room carrying a valid access JWT in
  the handshake
- **THEN** the participant identity (id, display name) is taken from the
  verified JWT and the user record, not from the payload

#### Scenario: Approved guest joins
- **WHEN** a guest presents the guest JWT issued at approval for that room
- **THEN** the participant joins under the token's guest identity and display
  name, scoped to that room only

#### Scenario: Unauthenticated join refused
- **WHEN** a client emits `sfu:join` with no token, no valid access JWT, and
  no guest JWT for the room
- **THEN** the join is refused with a coded authentication error and no peer
  is created

#### Scenario: Spoofed payload identity ignored
- **WHEN** a join presents a valid credential and additional payload fields
  claiming a different `userId` or `username`
- **THEN** the claimed fields have no effect on the created peer or on any
  authorization decision

### Requirement: Transport lifecycle
The server SHALL create send and receive WebRTC transports per peer
(`sfu:create-send-transport`, `sfu:create-recv-transport`), connect them via
`sfu:connect-transport` (`{transportId, dtlsParameters}`), and deliver ICE
server configuration (STUN/TURN) in the transport-created payload. When a
TURN auth secret is configured, the TURN entry SHALL carry ephemeral
credentials: a username encoding an expiry timestamp (at least 6 hours ahead)
and a password computed as `base64(HMAC-SHA1(secret, username))`, verifiable
by coturn's `use-auth-secret` mechanism. Static shared TURN
username/password credentials SHALL NOT be used.

#### Scenario: Transport created with ICE credentials
- **WHEN** a peer creates a send transport
- **THEN** the response contains the transport parameters plus STUN/TURN
  configuration for ICE gathering, with freshly minted ephemeral TURN
  credentials when the auth secret is configured

#### Scenario: Credentials expire safely
- **WHEN** the server mints TURN credentials twice for different transports
- **THEN** each credential carries an expiry at least 6 hours in the future
  and a password that only holders of the shared secret could produce

#### Scenario: Missing TURN auth secret
- **WHEN** `TURN_AUTH_SECRET` is absent, even if a TURN URL is configured
- **THEN** no TURN entry is advertised and clients fall back to STUN-only

### Requirement: Producer lifecycle
A peer SHALL publish media via `sfu:produce`
(`{requestId, transportId, kind, rtpParameters, appData?}`), pause and resume
via `sfu:pause-producer` / `sfu:resume-producer` (`{producerId}`), and stop
via `sfu:close-producer` (`{producerId}`). Video supports simulcast layers.

#### Scenario: Camera mute via pause
- **WHEN** a peer pauses their video producer
- **THEN** consumers stop receiving frames without the producer being closed

### Requirement: Consumer lifecycle
A peer SHALL subscribe via `sfu:consume` (`{producerId, rtpCapabilities}`),
resume the consumer via `sfu:resume-consumer` (`{consumerId}`), and select a
simulcast layer via `sfu:set-preferred-layers` (`{consumerId, spatialLayer}`).

#### Scenario: New producer in the room
- **WHEN** a peer produces a video track
- **THEN** other room peers are offered a consumer for that producer and
    resume it after their transport is ready

### Requirement: Owner powers
The room owner SHALL kick a peer via `sfu:kick-peer` (`{userId}`); the kicked
peer's transports and producers are torn down. A participant holding the
respective capability SHALL mute a single peer (`sfu:mute-peer`), mute all
currently publishing peers at once (`sfu:mute-all`), and lock or unlock the
room (`sfu:lock-room`). Authorization SHALL be determined only from
server-verified state - the `room.ownerId` column matched against a verified
user identity, or the role of a verified room token - resolved to
capabilities (`mute-users` for the mute actions, `remove-participants` for
kick, `lock-room` for locking). Every host-control event SHALL be answered on
the requesting socket with an acknowledgement carrying either success or a
coded error; denied attempts change nothing and the `sfu:host-error`
broadcast event SHALL NOT be used. A locked room refuses new joins on every
identity path until unlocked; the lock is cleared when the room ends. A
forcibly muted peer's audio and video producers are paused by the server and
the peer is notified.

#### Scenario: Owner kicks an abusive participant
- **WHEN** the room owner emits `sfu:kick-peer` with a peer's userId
- **THEN** that peer's media is torn down, they are removed from the room, and the kicker's acknowledgement reports success

#### Scenario: Host mutes a speaking peer
- **WHEN** a participant holding `mute-users` emits `sfu:mute-peer` for a publishing peer
- **THEN** that peer's producers are paused server-side, the peer receives a muted-by-host notice, the room is informed, and the emitter's acknowledgement reports success

#### Scenario: Mute-all silences every publisher
- **WHEN** a participant holding `mute-users` emits `sfu:mute-all`
- **THEN** every publishing peer except the emitter is muted with notices and the acknowledgement reports success

#### Scenario: Locked room refuses new joiners
- **WHEN** a new participant attempts to join a locked room on any identity path
- **THEN** the join is refused with a room-locked error and no peer is created

#### Scenario: Lock ends with the room
- **WHEN** a locked room ends
- **THEN** the lock state is discarded with the room

#### Scenario: Non-host denied
- **WHEN** a participant without `mute-users` emits `sfu:mute-peer`
- **THEN** the acknowledgement on their socket carries a coded authorization error and no state changes

#### Scenario: Forged ownership claim denied
- **WHEN** a non-owner joins with a payload or credential claiming ownership
  of a room they do not own
- **THEN** the participant joins without host capabilities and every host-control
  attempt is refused with a coded authorization error in the acknowledgement

### Requirement: Single worker with router per room
The server SHALL run a mediasoup Worker (recovered on crash) hosting one
Router per room, torn down when the room ends or empties.

#### Scenario: Worker crash
- **WHEN** the mediasoup Worker process dies
- **THEN** a new Worker is started and rooms recover their routers

### Requirement: Screen share exclusivity
Screen share SHALL hold an exclusive room-level lock: one active screen
producer per room; a second share attempt is rejected until the first closes.

#### Scenario: Second sharer is rejected
- **WHEN** a peer starts a screen share while another room peer holds the lock
- **THEN** the attempt fails and the existing share is unaffected

### Requirement: Quality monitoring
The server SHALL collect producer/consumer stats and report quality
indicators to clients for bandwidth adaptation and layer switching.

#### Scenario: Bandwidth drop
- **WHEN** a consumer's stats show sustained packet loss
- **THEN** the client adapts by requesting a lower spatial layer via
  `sfu:set-preferred-layers`

### Requirement: Room-token join path
The `/sfu` join SHALL accept an ephemeral room token as one of its verified
credential paths. When a join presents a valid room token, the server SHALL
derive participant identity and the participant's role solely from the
verified token, resolve the role to capabilities, and SHALL ignore
client-supplied identity fields for that participant. Token-carried
correlation fields (`externalId`, `metadata`) SHALL be surfaced with the
participant in peer identity events - the join acknowledgement's
participant, the peer-joined broadcast, and the existing-participants
snapshot - verbatim from the verified token; cookie and guest identity
paths carry neither field. Correlation fields SHALL NOT be read by any
authorization decision. Credentials that identify a user or guest through
the connection handshake (a valid access JWT cookie or an approved guest
JWT) SHALL be accepted only from app origins in the configured allowlist;
the room-token path SHALL remain acceptable from any origin so third-party
SDK embeds keep working.

#### Scenario: Valid token join
- **WHEN** a client joins with a non-expired token minted for that room
- **THEN** the participant joins under the token's participant id and display name, and other peers see that identity in peer events

#### Scenario: Correlation fields surface in peer events
- **WHEN** a token minted with `externalId` and `metadata` is used to join
- **THEN** the join acknowledgement, the peer-joined broadcast, and the existing-participants snapshot all carry that `externalId` and `metadata` verbatim

#### Scenario: Expired or malformed token
- **WHEN** a client joins with an expired, malformed, or wrong-room token
- **THEN** the join is refused with a coded error and no peer is created

#### Scenario: Publish denial by permission
- **WHEN** a participant whose capabilities include no `send-audio` or `send-video` attempts to produce media
- **THEN** the produce request is refused with a permission error

#### Scenario: Screen share denial by capability
- **WHEN** a participant without `send-screenshare` attempts to produce a screen share track
- **THEN** the produce request is refused with a permission error

#### Scenario: Admin rights from token
- **WHEN** a token minted with the `host` role is used in a project-owned room
- **THEN** that participant's capabilities include the host actions (kick, mute, lock)

#### Scenario: Cookie identity only from app origins
- **WHEN** a join relies on handshake cookie identity and originates from
  an origin outside the configured app-origin allowlist
- **THEN** the cookie identity is not accepted and the join is refused unless
  a room token is presented

#### Scenario: Existing paths unchanged
- **WHEN** a user joins with cookie-JWT or a guest joins with the guest flow,
  without a room token
- **THEN** the join UX and room events are as before; only the identity
  source changes - verified handshake credentials instead of payload fields

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

### Requirement: Client-initiated egress control
A connected participant SHALL start an egress session for a project-owned
room via `egress:start` (`{record, hls}`, at least one output) and stop the
room's active session via `egress:stop`, both answered on the requesting
socket with acknowledgements. The record output requires the
`start-recording` capability and the HLS output requires `start-broadcast`;
a request for an output the participant lacks is denied with a coded
authorization error and creates nothing. RTMP endpoints SHALL NOT be
specifiable through this path. Requests for user-owned rooms are denied with
a coded error. The room's active session semantics (one concurrent session)
SHALL match the REST path: starting while active is denied with a
conflict error.

#### Scenario: Host starts a recording from the client
- **WHEN** a participant holding `start-recording` emits `egress:start` with `record: true` for a project room with no active session
- **THEN** a session with the recording output is created and the acknowledgement reports success

#### Scenario: Participant without capability denied
- **WHEN** a participant without `start-broadcast` emits `egress:start` with `hls: true`
- **THEN** the acknowledgement carries a coded authorization error and no session is created

#### Scenario: Second concurrent session refused
- **WHEN** `egress:start` is emitted for a room that already has an active session
- **THEN** the acknowledgement carries a coded conflict error and the existing session is unaffected

#### Scenario: RTMP is not client-specifiable
- **WHEN** an `egress:start` payload carries RTMP endpoint fields
- **THEN** they are ignored or rejected; no RTMP output can be created from the client path

#### Scenario: User-owned room denied
- **WHEN** `egress:start` is emitted in a user-owned room
- **THEN** the acknowledgement carries a coded error and no session is created

#### Scenario: Host stops the session
- **WHEN** a capable participant emits `egress:stop` for the room's active session
- **THEN** the session stops gracefully and the acknowledgement reports success

### Requirement: Egress status broadcast
When a room's egress session changes status (started, live, stopped, ended,
failed), the server SHALL notify the room's connected participants with the
session id, outputs, and new status, so clients can mirror egress state.

#### Scenario: Participants see recording go live
- **WHEN** a client-initiated session transitions to `live`
- **THEN** every connected participant receives the status change carrying the session id and outputs

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

### Requirement: Rejoin grace period
When a joined peer's socket disconnects without an explicit leave, the
server SHALL hold the peer's seat and participant identity for a grace
window (default 30 seconds) before running the disconnect leave flow. A
`sfu:join` arriving within the window from the same participant id SHALL
restore the seat silently: the room receives no participant-left or
participant-joined events and no webhook `participant.left`/`participant.joined`
is emitted for the blip; the rejoining peer receives the normal join
acknowledgement and existing-participants state. When the window expires
without a rejoin, the normal disconnect leave flow runs with departure
reason `disconnect`. A peer removed by kick SHALL NOT be restorable: their
rejoin is refused with the kick denial regardless of the grace window, and
the kick's teardown is not delayed by grace.

#### Scenario: Blip restores silently
- **WHEN** a peer's socket reconnects and rejoins with the same participant id inside the grace window
- **THEN** the peer is restored to the room, the other participants saw no departure events, and no join/left webhooks fire for the blip

#### Scenario: Grace expiry runs the leave flow
- **WHEN** a disconnected peer does not return before the grace window expires
- **THEN** the room is notified of the departure with reason disconnect and the `participant.left` webhook fires

#### Scenario: Kicked peer cannot rejoin through grace
- **WHEN** a kicked participant reconnects and rejoins with the same token inside what would have been their grace window
- **THEN** the rejoin is refused with a coded kick denial and no peer is created

#### Scenario: Explicit leave is immediate
- **WHEN** a peer leaves via `sfu:leave`
- **THEN** the departure runs immediately with reason leave; no grace window is held

### Requirement: Media detach broadcast
When a joined peer's media detaches - because their socket dropped and the
server holds their seat for the rejoin grace window, because they depart
explicitly, are kicked, or the room ends - the server SHALL broadcast a
`sfu:peer-media-detached` event carrying the peer's `userId` to the room
before (or together with) any departure announcement for that peer. Presence
membership SHALL NOT change because of this event: a peer held in the grace
window remains a participant until the normal disconnect leave flow runs, and
a peer restored by a same-id rejoin inside the window SHALL have their media
reattached with the room's normal new-producer flow without a
`sfu:peer-media-detached` recurrence.

#### Scenario: Grace hold announces media detach
- **WHEN** a joined peer's socket disconnects without an explicit leave
- **THEN** the room receives `sfu:peer-media-detached` with that peer's id
  immediately, while the seat is still held

#### Scenario: Restored peer clears the detached state
- **WHEN** the held peer rejoins with the same id inside the grace window
- **THEN** the room receives no departure events, and the peer's producers
  reappear through the normal new-producer flow

#### Scenario: Departure removes the participant
- **WHEN** a detached peer's grace window expires without a rejoin
- **THEN** the normal `sfu:peer-left` departure event fires as specified by
  the rejoin grace period requirement
