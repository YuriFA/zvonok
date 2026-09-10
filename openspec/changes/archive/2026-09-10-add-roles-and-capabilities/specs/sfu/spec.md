# sfu

## ADDED Requirements

### Requirement: Join acknowledgement capabilities
Every successful `sfu:join` acknowledgement SHALL carry the joining
participant's effective capabilities as a list of capability ids from the
fixed vocabulary: `send-audio`, `send-video`, `send-screenshare`,
`mute-users`, `remove-participants`, `lock-room`, `start-recording`,
`start-broadcast`. Capabilities SHALL be computed by the server from the
verified credential path (room owner, registered user, approved guest, or
verified room-token role) and SHALL NOT be read from client-supplied payload
fields.

#### Scenario: Room owner joins
- **WHEN** the owner of a user-owned room joins with a verified access JWT
- **THEN** the join acknowledgement carries the full capability bundle including `mute-users`, `remove-participants`, and `lock-room`

#### Scenario: Registered participant joins
- **WHEN** a registered non-owner user joins a user-owned room
- **THEN** the join acknowledgement carries the send capabilities and none of the host capabilities

#### Scenario: Viewer token join
- **WHEN** a participant joins with a verified `viewer`-role room token
- **THEN** the join acknowledgement carries no send capabilities

## MODIFIED Requirements

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

### Requirement: Room-token join path
The `/sfu` join SHALL accept an ephemeral room token as one of its verified
credential paths. When a join presents a valid room token, the server SHALL
derive participant identity and the participant's role solely from the
verified token, resolve the role to capabilities, and SHALL ignore
client-supplied identity fields for that participant. Credentials that
identify a user or guest through the connection handshake (a valid access JWT
cookie or an approved guest JWT) SHALL be accepted only from app origins in
the configured allowlist; the room-token path SHALL remain acceptable from
any origin so third-party SDK embeds keep working.

#### Scenario: Valid token join
- **WHEN** a client joins with a non-expired token minted for that room
- **THEN** the participant joins under the token's participant id and display name, and other peers see that identity in peer events

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
