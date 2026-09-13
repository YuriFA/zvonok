## Purpose

Covers the SFU signalling contract additions for participant media lifecycle.

## ADDED Requirements

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
