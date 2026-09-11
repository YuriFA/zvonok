# sfu

## MODIFIED Requirements

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
