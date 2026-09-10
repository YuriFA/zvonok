# platform-api

## MODIFIED Requirements

### Requirement: Mint room token
`POST /v1/rooms/:id/tokens` SHALL mint a short-lived single-room token
carrying participant identity (opaque participant id and display name) and a
role - `host`, `participant`, or `viewer`, defaulting to `participant`. The
role is the token's permission statement; the server resolves it to concrete
capabilities at join time. The response returns the token and its expiry.

#### Scenario: Mint token for own room
- **WHEN** a valid key mints a token for its project's active room
- **THEN** a token bound to that room, with the requested identity and role, is returned with an expiry in the near future

#### Scenario: Mint token for ended room
- **WHEN** a token is requested for a room whose status is ended
- **THEN** the server responds 400 and no token is issued

#### Scenario: Unknown role rejected
- **WHEN** a token is minted with a role outside `host`, `participant`, `viewer`
- **THEN** the server responds 400 and no token is issued

#### Scenario: Role defaults to participant
- **WHEN** a token is minted without a role field
- **THEN** the issued token carries the `participant` role
