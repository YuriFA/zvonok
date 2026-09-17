# Client delta: remove local recording

## Purpose

Drops the device-local recording feature from the app: the room UI keeps no
record control.

## REMOVED Requirements

### Requirement: Call recording

**Reason**: The product no longer needs device-local call recording; server
side (egress) recording covers archiving, and the local compositor's
`requestAnimationFrame` render loop freezes the recorded video while the tab
is hidden. The decision is recorded in this change (ADR-0007 context: feature
removal instead of SDK absorption).

**Migration**: consumers needing a call archive use server-side egress
recording (platform API or the embedded room's capability-gated record
control).
