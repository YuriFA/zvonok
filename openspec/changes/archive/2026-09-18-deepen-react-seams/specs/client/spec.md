# Client deltas: deepen React seams

## Purpose

The app keeps only presentation: hidden-tab video pause moves behind the SDK
call-session option, deleting the app's last producer reach-in.

## MODIFIED Requirements

### Requirement: Framework-agnostic core

Room join, publishing, media toggle policy, host-mute enforcement, hidden-tab
video pause, remote-audio playout, screen share, and guest-request events
SHALL flow through the `@zvonok/react` bindings: the room page renders the SDK
provider, and the room UI consumes SDK hooks instead of owning a parallel
join/publish layer. Room media toggles, host-mute enforcement, kick reactions,
and producer-level visibility policy SHALL come from the SDK call-session
hook; the app SHALL consume outcomes and callbacks to present notifications
and navigate, and SHALL NOT re-implement publish, toggle, or pause
orchestration in app-local hooks. The app SHALL NOT reach into the
connection's producer methods; no app-local hook SHALL hold a manager
reference for producer-level behavior. App-local framework-free logic SHALL be
limited to the API client and app domain services. The SDK session's
underlying manager SHALL remain reachable for app-specific behaviors the
packages do not cover.

#### Scenario: Join flows through the SDK provider

- **WHEN** a user opens a room link and joins
- **THEN** connection and join run through the SDK provider's hooks, and no
  app-local join orchestration exists

#### Scenario: Room media policy flows through the call session hook

- **WHEN** the room UI toggles the camera or microphone, the host mutes the
  local peer, or the local peer is kicked
- **THEN** the room UI reads state and outcomes from the SDK call-session hook
  and only renders its own notifications and navigation

#### Scenario: Hidden-tab video pause crosses the call session

- **WHEN** the vendor app enables `pauseVideoWhenHidden` on the call session
- **THEN** the SDK pauses the video producer while the document hides and
  resumes the user's own camera state on return, with no app-local
  visibilitychange handler touching producers

#### Scenario: Using SFU outside React

- **WHEN** app logic needs manager access outside React state
- **THEN** it consumes the SDK session's underlying manager without
  reintroducing a parallel join or publish path
