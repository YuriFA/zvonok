# SDK deltas: deepen React seams

## Purpose

Narrows the `@zvonok/react` state seam: producer vocabulary hides behind the
call session, session state gets one owner, the quality surface collapses to
one public hook, and the provider accepts manager factories for test
injection.

## MODIFIED Requirements

### Requirement: React binding

`@zvonok/react` SHALL provide a provider carrying SDK configuration and hooks
covering the join lifecycle, participants-and-tracks state, device controls,
and the consumer's own capabilities, implemented as a thin layer over
`@zvonok/client`. It declares `react` >= 18 as a peer dependency. The headless
hook layer adds no UI; the package MAY additionally ship the prebuilt room
component below. Device control hooks SHALL form one public surface covering
enumeration, switching, persisted per-user device selection, device
connection/removal events, and permission state; consumers SHALL NOT need
private device bookkeeping alongside it. The package's public surface SHALL be
sufficient to build the vendor's own room UI without importing package
internals (dogfooding rule). The provider SHALL accept optional
`createManager` and `createMediaManager` factory props; omitted, it composes
the standard manager and shared media manager. Consumers test against these
factories by injecting doubles instead of mocking package module factories.

#### Scenario: React consumer joins declaratively

- **WHEN** a React app renders the provider with config and uses the join hook with a token
- **THEN** the hook exposes connection state, participants, and remote tracks as React state without manual signalling wiring

#### Scenario: Component gates UI on own capabilities

- **WHEN** a component renders host controls behind `useOwnCapabilities()`
- **THEN** the controls render exactly for capabilities the server granted, without the consumer encoding role logic

#### Scenario: Device selection persists and follows device changes

- **WHEN** a consumer selects camera/microphone/speaker, restarts, or devices connect and disappear
- **THEN** the single public device surface restores the persisted selection and reflects connection changes without consumer-owned device state

#### Scenario: Vendor app stays on the public surface

- **WHEN** the vendor app's room UI is built against the package
- **THEN** every capability it needs is importable from public exports alone, with no package-private imports

#### Scenario: Integration tests inject doubles through the provider

- **WHEN** a test renders a tree with `createManager` returning a fake manager
- **THEN** the real hooks run against the fake without mocking `@zvonok/client` module factories

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
manager. The hook SHALL accept `pauseVideoWhenHidden` (default `false`): while
set, the SDK pauses the local video producer when the document hides and, on
return, resumes only what the consumer's own toggle state wants. Existing
lower-level hooks (join lifecycle, publish controls, tracker, host controls)
SHALL remain available for consumers that need them.

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

#### Scenario: Hidden tab pauses the camera only while opted in

- **WHEN** a consumer sets `pauseVideoWhenHidden` and the document hides with
  the camera enabled, then returns
- **THEN** the video producer is paused while hidden and resumed on return,
  and a camera the consumer had disabled before hiding stays disabled

#### Scenario: Default leaves hidden-tab media untouched

- **WHEN** a consumer omits `pauseVideoWhenHidden` and the document hides
- **THEN** producer state is unchanged from today's behavior

### Requirement: Package layering and core seams

`@zvonok/react` SHALL organize its public surface in layers a consumer can
rely on: a hook layer that is the state seam and adds no markup; a media-plumbing
component layer (participant video tiles, video element binding, track
synchronization, viewport-driven quality) that SHALL own that plumbing
end-to-end and SHALL expose its visual presentation as component-typed props;
a composition-block layer built only over the hook layer; and the prebuilt
room entry built only over the block and hook layers. A consumer MAY replace
block markup via component-typed props and MAY assemble a fully custom room UI
from the hook layer plus the plumbing layer; a consumer SHALL NOT need to
re-implement or bypass the plumbing to render remote media. The vendor app
SHALL consume only this public surface (dogfooding rule).

The join state seam SHALL be lifecycle-only: the connection hook exposes
status, errors, join/leave, and the session flags the server announces. The
producer vocabulary (produce, pause, resume, close, replace) SHALL sit behind
the call session and its publish controls, not on the connection hook. The
underlying manager SHALL remain reachable as the escape hatch through the
provider session. Session state SHALL have one owner - a framework-free store
with named transitions and `getSnapshot`/`subscribe` access - written by the
connection hook's transitions; hooks and blocks read it and SHALL NOT patch
it.

#### Scenario: Core plumbing is used, not re-implemented

- **WHEN** the vendor app or an external consumer renders a remote participant's video
- **THEN** track binding, visibility, and layer selection come from the package plumbing layer, and the consumer customizes only visual presentation via component props

#### Scenario: Blocks ride the hook seam only

- **WHEN** a composition block derives control state or host-action outcomes
- **THEN** it derives them from the public hook surface and imports no package-private transport state

#### Scenario: Custom UI from the public surface

- **WHEN** a consumer builds a fully custom room UI without any preset component
- **THEN** the hook layer plus the plumbing layer suffice, with no package-private imports

#### Scenario: Producer control crosses the call session, not the connection

- **WHEN** a consumer publishes or pauses a track
- **THEN** it does so through the call session (or its publish controls), and
  the connection hook exposes no producer methods to call at the wrong time

#### Scenario: One writer for session state

- **WHEN** the join lifecycle advances (connecting, joined, error,
  reconnecting, disconnected) or the room announces lock or end
- **THEN** the session store transitions through named states, and no hook
  patches arbitrary fields of the session

#### Scenario: Manager stays reachable as the escape hatch

- **WHEN** app logic needs the manager for a behavior the packages do not cover
- **THEN** it reaches it through the provider session without reintroducing a
  parallel join or publish path

### Requirement: Quality adaptation

The package SHALL provide quality adaptation as one public surface:
`PeerQualityProvider` (the mounting and lifecycle gate) and
`usePeerQualityStats` (per-participant readings). The adaptation engine, its
tuning constants, viewport tracking, and the element-visibility model SHALL
stay internal - tiles feed visibility through the plumbing layer, and no
consumer-visible class or constant is part of the contract. The surface SHALL
maintain a per-participant element-visibility model, poll connection stats,
and request simulcast layer preferences with debouncing; it SHALL suspend
adaptation and stats polling while the document is hidden and resume on
visibility. The vendor app and the prebuilt experience SHALL consume the same
surface with no package-private quality logic. The surface SHALL NOT alter the
manual quality selection contract.

#### Scenario: Offscreen participant downgrades

- **WHEN** a participant's tile leaves the viewport
- **THEN** the surface requests a lower simulcast preference for that participant without consumer-written logic

#### Scenario: Hidden tab suspends adaptation

- **WHEN** the document becomes hidden
- **THEN** adaptation pauses and stats polling stops, resuming when the document is visible again

#### Scenario: One surface for both consumers

- **WHEN** the vendor app and the prebuilt experience render rooms
- **THEN** both run the same public adaptation surface, and neither carries its own quality engine

#### Scenario: Engine internals are not importable

- **WHEN** a consumer tries to import the quality engine class or its tuning constants
- **THEN** the import fails to resolve: they are implementation details

### Requirement: UI component layer

The package SHALL expose UI-logic components that own media plumbing and room
orchestration while leaving markup and styling to the consumer:

- a tile component that binds participant video/audio to elements and tracks
  element visibility, whose visual presentation is supplied as component-typed
  props with replaceable default visuals, and whose data is reachable by
  replacement components through a context hook;
- layout derivation that computes participant arrangement, including a
  spotlight arrangement for an active screen share, from the shared layout
  engine;
- a capability gate rendering its children only when the participant holds the
  required capabilities.

Components carrying media plumbing SHALL NOT require consumers to reimplement
subscription, visibility, or bandwidth-signaling logic, and SHALL NOT depend
on any preset stylesheet. The status-cards block SHALL own the room-status
projection (connecting, join error, reconnecting, room locked, kicked, ended)
from the call and connection inputs; no separate public projection hook SHALL
mirror it.

#### Scenario: Custom visuals over shared plumbing

- **WHEN** a consumer supplies its own presentation component to the tile
- **THEN** the participant's media still renders, element visibility keeps driving subscription quality, and the custom component receives participant data via the context hook

#### Scenario: Spotlight derivation without consumer geometry

- **WHEN** a screen share becomes active in a room rendered on the layer
- **THEN** the layout derivation reports a spotlight arrangement and its area, and the consumer places tiles without computing geometry itself

#### Scenario: Capability gate mirrors the server

- **WHEN** a gated section is rendered for a participant lacking the required capability
- **THEN** nothing renders, without the consumer encoding role logic

#### Scenario: Vendor app composes the layer with its own styles

- **WHEN** the vendor app renders its room UI from the layer with its own markup and stylesheet approach
- **THEN** it consumes only public components and hooks and imports no preset stylesheet

#### Scenario: Status projection lives in the block

- **WHEN** a consumer renders the status-cards block with call and connection inputs
- **THEN** lock, kicked, ended, join-error, and reconnecting states derive
  inside the block, and no public hook re-exposes the same fields as a second
  vocabulary

## ADDED Requirements

### Requirement: React root surface

The `@zvonok/react` root SHALL keep its surface to the coherent spine a room
UI needs: the provider and session, the join and call-session hooks,
participant and tracker hooks, the plumbing layer (tile, layout, capability
gate, viewport registration through the tile), the composition blocks and
their cores, the device, audio, screen-share, egress, guest, and host
surfaces, and `mapScreenShareError`. Single-implementation wrappers
(`createHostControls`), localStorage helpers (`loadDeviceSelection`), pure
derivation helpers (`deriveMediaControlState`), the quality engine and its
tuning constants, and test doubles SHALL NOT be published; consumers reaching
for them SHALL use the hook or block that owns the behavior.

#### Scenario: No duplicate entry for one behavior

- **WHEN** a consumer looks for host controls
- **THEN** exactly one public entry exists (`useHostControls`), and the
  factory behind it is implementation detail

#### Scenario: Helpers hide behind their owner

- **WHEN** a consumer wants derived media control state or persisted device
  selection
- **THEN** it gets them through the hooks that own those behaviors, and the
  helper modules fail to resolve from the package root

#### Scenario: Engine internals are not importable

- **WHEN** a consumer tries to import the quality engine class or its tuning
  constants from the package root
- **THEN** the import fails to resolve: they are implementation details
