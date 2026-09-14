## ADDED Requirements

### Requirement: Media reset recovery

The SDK SHALL handle the `sfu:room-media-reset` server event by rebuilding its
media session without a new join: retain live local tracks, close local
producers, consumers and transports, reload the device from the event's
`routerRtpCapabilities`, re-create both transports, re-publish the retained
tracks, and re-consume producers announced on the rebuilt receive transport.
Presence, chat, room lifetime, and the participant list SHALL be unaffected;
no `joinRoom` round-trip SHALL be emitted.

#### Scenario: Media rebuilds after a server-side worker crash

- **WHEN** the SDK receives `sfu:room-media-reset` while joined
- **THEN** the device and both transports are rebuilt and previously published
  live local tracks are re-published without a new join

#### Scenario: Reset before join is a no-op

- **WHEN** `sfu:room-media-reset` arrives before a session is established
- **THEN** the SDK ignores it and the subsequent join flow proceeds normally

#### Scenario: Screen share survives a reset by re-publishing

- **WHEN** a screen-share producer is live when the reset arrives and the
  track is still live
- **THEN** the track is re-published with its `screen` source so the
  server-side screen-share lock is re-acquired
