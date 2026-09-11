# platform-api

## MODIFIED Requirements

### Requirement: Mint room token
`POST /v1/rooms/:id/tokens` SHALL mint a short-lived single-room token
carrying participant identity (opaque participant id and display name) and a
role - `host`, `participant`, or `viewer`, defaulting to `participant`. The
mint request MAY carry consumer correlation fields: `externalId` (string of
1-64 characters) and `metadata` (a JSON object whose serialized size is at
most 2048 bytes); invalid sizes or non-object metadata are rejected with 400
and no token is issued. Correlation fields are carried verbatim in the token
and are never used for authorization. The role is the token's permission
statement; the server resolves it to concrete capabilities at join time. The
response returns the token and its expiry.

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

#### Scenario: Correlation fields round-trip
- **WHEN** a token is minted with an `externalId` and a `metadata` object within the size limits
- **THEN** the issued token carries both verbatim and they surface with the participant at join time

#### Scenario: Oversized metadata rejected
- **WHEN** a token is minted with `metadata` whose serialized size exceeds 2048 bytes, an `externalId` longer than 64 characters, or a non-object `metadata`
- **THEN** the server responds 400 and no token is issued
