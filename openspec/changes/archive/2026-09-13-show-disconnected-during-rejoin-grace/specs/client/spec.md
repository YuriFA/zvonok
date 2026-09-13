## Purpose

Covers the client-side room experience for participant presence indication.

## ADDED Requirements

### Requirement: Disconnected participant indication

The participant list SHALL distinguish a participant whose media has detached
from a fully live participant: a media-detached participant is shown with a
disconnected indication and without active-looking microphone/camera state,
while remaining in the list until the server announces their departure. When
the same participant's media reattaches (rejoin inside the rejoin grace
window), the indication SHALL clear. When the server announces the
participant's departure, the participant is removed from the list.

#### Scenario: Hard disconnect shows disconnected during grace

- **WHEN** a participant hard-disconnects (for example closes the tab) and the
  server holds their seat in the rejoin grace window
- **THEN** the remaining participants see that row marked as disconnected
  instead of a fully live participant

#### Scenario: Rejoin inside the grace window restores the row

- **WHEN** the disconnected participant rejoins before the grace window
  expires
- **THEN** the disconnected indication clears and the row renders as a live
  participant again

#### Scenario: Grace expiry removes the row

- **WHEN** the grace window expires without a rejoin
- **THEN** the participant is removed from the list entirely
