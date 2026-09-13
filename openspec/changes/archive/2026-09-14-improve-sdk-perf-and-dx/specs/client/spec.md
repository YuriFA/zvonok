## Purpose

Covers the pre-join screen surfacing of device permission state.

## ADDED Requirements

### Requirement: Pre-join permission surfacing

The pre-join screen SHALL display the camera and microphone permission state
(granted, denied, prompting, or unknown) before the user attempts to join, and
SHALL show an actionable explanation when a required device is denied or
unavailable instead of failing silently after the join is attempted. The state
SHALL update when the user changes permissions without requiring a page
reload.

#### Scenario: Denied camera explains itself

- **WHEN** the user opens pre-join with camera permission denied
- **THEN** the pre-join screen marks the camera as blocked and explains how to
  unblock it, before any join attempt

#### Scenario: Granting permission updates the screen

- **WHEN** the user grants the camera from the browser's page controls while
  pre-join is open
- **THEN** the pre-join screen updates to show the camera as available without
  a reload
