# sfu

## ADDED Requirements

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
