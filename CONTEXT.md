# Domain Glossary

Living vocabulary for the zvonok domain. Specs in `openspec/specs/` are the
behavior source of truth; this file pins the names. Architecture decisions:
`docs/adr/`.

## Terms

- **Participant** - a room member, uniformly named across the SFU, the SDK
  packages, and the app (never "user", "peer", or "member" on public
  surfaces). Joins with a **room token** (platform consumers) or through the
  verified browser session / approved **guest join request** (app-embedded).
- **Tap (RTP-tap)** - a server-side unpaused mediasoup consumer pointed at
  one producer's RTP, delivered to a consumer-side UDP listener. Plain data
  plus lifecycle controls only; media objects never cross the seam.
- **RoomMediaSource** - the port the SFU module exposes for tapping room
  media (`apps/server/src/sfu/room-media-source.port.ts`). Producer adapter:
  `SfuService`. Egress (RTMP/HLS/recording) consumes it to build pipelines.
- **Room Presence** - the named deep module for participants and room
  lifetime: admission through the verified identity paths, membership,
  kick terminality, disconnect grace, room lock, and the
  participant/room webhooks. Port: `ROOM_PRESENCE`
  (`apps/server/src/sfu/room-presence.port.ts`), adapter:
  `RoomPresenceService`. Media-blind by design; the media layer
  (`SfuService`) subscribes to it (ADR-0004).
