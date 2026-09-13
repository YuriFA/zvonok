## Purpose

Covers the SDK surface additions for viewport-driven simulcast layer selection,
persistent device preferences, and observable device permission state.

## ADDED Requirements

### Requirement: Viewport visibility drives layer selection

The SDK SHALL expose a mechanism that tracks whether each remote participant's
video tile is visible in the viewport, and SHALL request the lowest simulcast
spatial layer for participants whose tile is not visible while requesting full
quality for visible tiles. Requests SHALL flow through the existing
set-preferred-layers signalling and SHALL be safe to repeat (idempotent): a
request for an unknown or closed consumer SHALL be a silent no-op, never an
error surfaced to the consumer. Participants whose tile is not observed by any
viewport tracker SHALL keep full quality (unobserved defaults to visible), so
attaching or detaching the tracker never drops quality for consumers that do
not use it.

#### Scenario: Off-screen tile drops to the lowest layer

- **WHEN** a participant's tile scrolls or leaves the viewport
- **THEN** the SDK requests the lowest spatial layer for that participant's
  video consumer

#### Scenario: Tile returning to the viewport restores quality

- **WHEN** a participant's tile becomes visible again
- **THEN** the SDK requests the full spatial layer for that participant's
  video consumer

#### Scenario: Untracked consumers keep full quality

- **WHEN** a consumer renders participant video without attaching the
  viewport tracker
- **THEN** no layer downgrade is requested for those participants

### Requirement: Device preferences persist across sessions

The SDK SHALL remember the last successfully used camera and microphone device
ids (and the muted intent for each) in browser storage, and SHALL apply the
remembered device as the default capture device when a later session starts
capture without an explicit device id. When the remembered device is no longer
available, capture SHALL fall back to the browser default instead of failing.
When storage is unavailable (private mode, embedded webviews), the SDK SHALL
behave exactly as today: no persistence, no errors.

#### Scenario: Second session uses the remembered camera

- **WHEN** a user picks a camera, joins successfully, and later starts a new
  session without choosing a device
- **THEN** capture uses the remembered camera

#### Scenario: Remembered device disappears

- **WHEN** the remembered device id is no longer present at capture time
- **THEN** capture falls back to the browser default device and succeeds

### Requirement: Device permission state is observable

The SDK SHALL expose the browser permission state (granted, denied, or
prompting) for camera and microphone as an observable value that updates when
the underlying permission changes. Consumers SHALL be able to read the state
before attempting capture. Environments where the permissions API or a
permission name is unavailable SHALL surface an unknown state rather than
throwing.

#### Scenario: Blocked microphone is visible before joining

- **WHEN** the user has previously denied microphone permission and opens the
  pre-join screen
- **THEN** the permission state reads denied before any capture is attempted

#### Scenario: Permission changes propagate

- **WHEN** the user grants camera permission in the browser UI while the
  consumer observes the state
- **THEN** the observed state updates to granted
