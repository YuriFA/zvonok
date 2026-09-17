## Purpose

Tightens the framework-agnostic core boundary: room media policy moves out of
app hooks into the SDK call-session hook; the app keeps notifications,
navigation, and presentation.

## MODIFIED Requirements

### Requirement: Framework-agnostic core

Room join, publishing, media toggle policy, host-mute enforcement, remote-audio
playout, screen share, and guest-request events SHALL flow through the
`@zvonok/react` bindings: the room page renders the SDK provider, and the room
UI consumes SDK hooks instead of owning a parallel join/publish layer. Room
media toggles, host-mute enforcement, and kick reactions SHALL come from the
SDK call-session hook; the app SHALL consume outcomes and callbacks to present
notifications and navigate, and SHALL NOT re-implement publish or toggle
orchestration in app-local hooks. App-local framework-free logic SHALL be
limited to the API client and app domain services. The SDK session's underlying
manager SHALL remain reachable for app-specific behaviors the packages do not
cover (today: the auto-quality engine).

#### Scenario: Join flows through the SDK provider

- **WHEN** a user opens a room link and joins
- **THEN** connection and join run through the SDK provider's hooks, and no
  app-local join orchestration exists

#### Scenario: Room media policy flows through the call session hook

- **WHEN** the room UI toggles the camera or microphone, the host mutes the
  local peer, or the local peer is kicked
- **THEN** the room UI reads state and outcomes from the SDK call-session hook
  and only renders its own notifications and navigation

#### Scenario: Using SFU outside React

- **WHEN** app logic needs manager access outside React state (today: the
  auto-quality engine)
- **THEN** it consumes the SDK session's underlying manager without
  reintroducing a parallel join or publish path
