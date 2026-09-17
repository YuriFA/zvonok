## Purpose

Adds a single call-session orchestration hook to the `@zvonok/react` surface so
that room media policy (publish-on-join, toggle semantics, host-mute and kick
reactions, participant projection) is SDK behavior, not consumer code.

## ADDED Requirements

### Requirement: Call session orchestration hook

`@zvonok/react` SHALL provide a call-session hook that owns the room media
lifecycle over an established connection: publishing captured local tracks once
joined, camera and microphone toggles, host-mute enforcement, and surfacing
kick, room-lock, and connection state. Toggle results SHALL be named outcomes
published, paused, no-track, produce-failed, replace-failed; the hook SHALL keep
control state truthful by rolling an optimistic enable back on any failure
outcome, and consumers SHALL render their own notifications from outcomes. A
server-enforced host mute SHALL force the microphone control off and SHALL
notify via a callback exactly once per occurrence, re-arming after the peer
unmutes. A server kick SHALL surface as state and a one-shot callback, and the
hook SHALL release captured local media through the capture seam. The hook SHALL
project remote participants plus a local projection (identity, camera and
microphone state) into one reference-stable participants list. Media capture
SHALL cross the hook as an injectable port (current track, reacquire, release
per kind); when omitted, the hook SHALL default to the provider's shared media
manager. Existing lower-level hooks (join lifecycle, publish controls, tracker,
host controls) SHALL remain available for consumers that need them.

#### Scenario: Captured tracks publish after join

- **WHEN** a consumer renders the call-session hook with live captured tracks
  and the join completes
- **THEN** the tracks are published without consumer-side publish wiring, and
  tracks captured later while joined are published the same way

#### Scenario: Toggle failure rolls the control back

- **WHEN** enabling the camera fails at track reacquisition, producer
  creation, or track replacement
- **THEN** the hook returns the matching failure outcome and the control reads
  disabled, with no stale optimistic on-state

#### Scenario: Toggle outcome names the failure point

- **WHEN** a consumer toggles the microphone
- **THEN** the returned outcome distinguishes success from each failure point
  so the consumer can present the right message

#### Scenario: Host mute enforces once per occurrence

- **WHEN** the server mutes the local microphone, the consumer is notified
  once, and the peer later unmutes and is muted again
- **THEN** the microphone control reads off during each mute and the
  notification fires once per occurrence, not once per render

#### Scenario: Kick surfaces and releases capture

- **WHEN** the server kicks the local peer
- **THEN** kicked state becomes observable, the one-shot callback fires once,
  and captured local media is released through the capture seam

#### Scenario: Participants include the local projection

- **WHEN** the room state updates
- **THEN** the participants list contains the local participant built from the
  supplied local identity and current camera and microphone state, and each
  participant object keeps its reference identity across unrelated updates

#### Scenario: Capture defaults to the shared media manager

- **WHEN** a consumer supplies no capture port
- **THEN** capture flows through the provider's shared media manager with no
  second manager constructed
