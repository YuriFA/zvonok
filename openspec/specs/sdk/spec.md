# sdk

## Purpose

The externally consumable SDK surface: npm-published `@zvonok/client` and `@zvonok/react` packages with a stable public contract and a quickstart path that works from a clean project against a deployed server.

## Requirements

### Requirement: Packages installable from npm
`@zvonok/client` and `@zvonok/react` SHALL be installable from the public npm
registry into a clean external project with no access to the monorepo.
Published artifacts contain built JavaScript with type declarations and
complete package metadata (name, version, license, repository). The packages'
public surface SHALL be exactly what their `exports` map enumerates: modules
outside the map are implementation details and external consumers SHALL NOT
import them. The workspace itself keeps consuming package sources through the
same map; publishing is a manual versioned release per package.

#### Scenario: Clean-project install
- **WHEN** a developer outside the monorepo runs `npm i @zvonok/client` (or `@zvonok/react`)
- **THEN** the package installs with its dependencies and type declarations, and imports resolve without monorepo paths

#### Scenario: Workspace stays source-based
- **WHEN** the zvonok app or the react package imports a public `@zvonok/client` subpath during development
- **THEN** it consumes package sources directly, without requiring a build of the package first

#### Scenario: Internal modules stay package-private
- **WHEN** a consumer imports a subpath that the exports map does not list (for example `@zvonok/client/sfu/connection` or a mock path)
- **THEN** the import fails to resolve instead of silently coupling the consumer to package internals

### Requirement: Connection and join contract
`@zvonok/client` SHALL expose a connection entry point that takes a server
URL, a room identifier (a room slug, a room id, or both), and an optional
identity - platform consumers pass a room token, app-embedded consumers pass
none and rely on the browser session the server verifies at handshake - joins
the room over signalling, and exposes typed events for participant and track
lifecycle and join errors. The public vocabulary of the packages SHALL name
the room member a participant uniformly: participant state, participant
lifecycle callbacks, and participant collections (`remoteParticipants`)
across `@zvonok/client` and `@zvonok/react`. A consumer following only this
contract joins a working room with remote media. After a successful join the
connection state SHALL expose the participant's own capabilities as a typed
list of capability ids delivered by the server. Participant info SHALL carry
the token-provided correlation fields `externalId` and `metadata` as optional
fields when the participant joined with a token that had them. The join
payload SHALL NOT carry trusted identity fields: platform consumers
authenticate with a room token, and app-embedded usage authenticates with the
browser session the server already verifies (handshake cookies). Join-refusal
errors surface as typed errors on every identity path. When the server ends
the room, the session SHALL surface a room-ended state, release the
connection, and stop recovery. Publish options MAY carry a mobile-sender
hint that adapts the producer's simulcast encodings for mobile devices.

After a successful join, the SDK SHALL recover from signalling disconnects
automatically: on disconnect it enters a `reconnecting` status while
retaining local tracks; on transport reconnect it rejoins the room (same
identity), recreates transports, republishes the retained local tracks, and
resubscribes to current producers before returning to `joined`. Reconnect
attempts exhausted SHALL surface `failed` with a typed error. A rejoin
denied as kicked SHALL surface the kicked state and stop reconnecting. Join
options MAY carry `tokenProvider` (an async function returning a fresh room
token); when a rejoin is rejected because the stored token expired, the SDK
SHALL call the provider once, retry the join with the fresh token, and keep
it for later rejoins; without a provider, an expired-token rejoin SHALL
surface a typed error and stop.

#### Scenario: Token-based join from external app
- **WHEN** an external app connects with a server URL, room slug, and a valid room token
- **THEN** the SDK joins and receives participant and track events for other participants, named with the participant vocabulary throughout the public surface

#### Scenario: App joins on its browser session
- **WHEN** the zvonok app joins a room without passing a token, relying on its verified session cookie from the handshake
- **THEN** the join succeeds with server-derived identity exactly as a token join does, and join refusals surface as typed errors

#### Scenario: Join accepts room id or slug
- **WHEN** a consumer passes a room id, a room slug, or both to the join entry point
- **THEN** the join reaches the same room in every case

#### Scenario: Own capabilities after join
- **WHEN** a join succeeds
- **THEN** the connection state exposes the server-delivered capability list, and a host-role join shows host capabilities while a viewer-role join shows none

#### Scenario: Correlation fields on participants
- **WHEN** a remote participant joined with a token carrying `externalId` and `metadata`
- **THEN** the participant info exposed to the consumer carries both fields

#### Scenario: Network blip recovers the room
- **WHEN** the signalling connection drops and returns while the participant was joined with published tracks
- **THEN** the status moves joined -> reconnecting -> joined, local tracks are republished, remote producers are resubscribed, and no consumer signalling is required

#### Scenario: Token refresh mid-call
- **WHEN** a rejoin is rejected because the stored token expired and a `tokenProvider` is configured
- **THEN** the provider is called, the join retries with the fresh token, and recovery completes

#### Scenario: Expired token without provider fails typed
- **WHEN** a rejoin is rejected because the stored token expired and no `tokenProvider` is configured
- **THEN** the SDK surfaces a typed expired-token error and does not retry into a dead room

#### Scenario: Kick during reconnect is terminal
- **WHEN** the participant was removed by kick and their automatic rejoin is denied
- **THEN** the kicked state surfaces and no further rejoin is attempted

#### Scenario: Invalid token surfaces typed error
- **WHEN** the connection is attempted with an expired or invalid token
- **THEN** the SDK surfaces a typed join error instead of throwing unexpectedly

#### Scenario: Unauthenticated join surfaces typed error
- **WHEN** a connection is attempted with no verifiable credential
- **THEN** the SDK surfaces a typed authentication join error and does not retry into a dead room

#### Scenario: Room ended surfaces and cleans up
- **WHEN** the server ends the room while the participant is joined
- **THEN** the session surfaces a room-ended state, releases the connection, and performs no further reconnection attempts

#### Scenario: Mobile hint adapts encodings
- **WHEN** a track is published with the mobile-sender hint set
- **THEN** the producer's simulcast encodings are the mobile-adapted set, and publishing without the hint is unchanged

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
internals (dogfooding rule).

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

### Requirement: Prebuilt room component
The package SHALL ship a prebuilt room experience at a dedicated subpath entry
(`@zvonok/react/embedded`), composed from the same public components a custom
UI would use. From minimal props (server URL, room slug, token, optional
display name, lifecycle callbacks) it SHALL own the join lifecycle: a
skippable pre-join stage for name and device confirmation, join error states,
reconnecting status, and leave. It SHALL expose string-typed layout options,
render consumer content alongside via `children`, and - when the participant's
own capabilities include `start-recording` - offer a recording control
reflecting the room's recording state. Styling SHALL come from a preset
stylesheet delivered through a package CSS subpath export and be customizable
through `--zk-*` CSS custom properties (accent, background, text colors,
corner radius, font family) set on or above the widget root, each defaulting
to the built-in value when the host sets none. Preset class names and DOM
structure SHALL NOT be a stable contract.

#### Scenario: Drop-in integration
- **WHEN** an external React app renders the embedded entry with a server URL, room slug, and valid room token
- **THEN** the participant joins and sees remote participants' video with working mic, camera, screen share, and leave controls - without wiring any signalling or track code

#### Scenario: Record button appears only for capable participants
- **WHEN** the embedded room renders for a participant whose capabilities include `start-recording`
- **THEN** the controls offer a recording control that starts and stops recording via the SDK's egress actions and reflects the recording state

#### Scenario: Record button hidden without capability
- **WHEN** the embedded room renders for a participant without `start-recording`
- **THEN** no recording control is rendered and no egress action is callable through the component

#### Scenario: Styles do not leak
- **WHEN** the embedded room renders inside a host app with its own CSS
- **THEN** all preset styling is scoped under the package's class namespace and no host styles are required

#### Scenario: Default appearance without overrides
- **WHEN** the embedded room renders with no custom properties set by the host
- **THEN** its appearance is identical to the built-in default styling

#### Scenario: Host brands the widget
- **WHEN** the host page defines the documented `--zk-*` custom properties on or above the widget root
- **THEN** the preset picks up the overridden accent, background, text, radius, and font values without JavaScript or component props, and the values do not leak outside the widget

#### Scenario: Consumer content renders alongside
- **WHEN** a consumer passes `children` to the embedded room
- **THEN** the children render inside the room experience without interfering with its join and recording lifecycle

#### Scenario: Typed failure surfaces in the UI
- **WHEN** the join fails (invalid or expired token)
- **THEN** the component renders the typed join error state and never silently shows an empty room

### Requirement: Host control actions
The SDK SHALL expose host-control actions - kick a peer, mute a peer, mute
all, lock and unlock the room - that emit the corresponding signalling
events. Every action, kick included, resolves with the server's
acknowledgement: success settles the promise, authorization denials surface
as typed errors carrying the server's coded error. Actions are available to
any consumer whose capabilities the server accepts.

#### Scenario: Authorized host mutes a peer
- **WHEN** a participant holding `mute-users` invokes the mute action for another peer
- **THEN** the server mutes that peer and the action resolves successfully on the acknowledgement

#### Scenario: Host kicks a participant
- **WHEN** an authorized participant invokes the kick action for another participant
- **THEN** the kicked participant is disconnected from the room, the departure is reported as participant-left with reason kick, and the action resolves once the server confirms the removal

#### Scenario: Non-host action denied
- **WHEN** a participant without the required capability invokes a host-control action
- **THEN** the SDK surfaces the server's authorization denial as a typed error as soon as the acknowledgement arrives

### Requirement: Quickstart reproducibility
The repository SHALL contain a quickstart document such that a developer with a
deployed server and an API key reaches a joined video room from a clean
external project by following only that document.

#### Scenario: Quickstart walkthrough
- **WHEN** a developer follows only the quickstart from an empty project: install the SDK, mint a room token via the public API with their key, and run the documented code against the deployed server
- **THEN** they join a working video room on the deployed server

### Requirement: Egress control and state
The SDK SHALL expose egress actions and egress state over the room
connection: start (`record` and/or `hls`) and stop actions that settle on
server acknowledgements, denials surfacing as typed errors carrying the
server's coded error; and mirrored room egress state exposing whether the
room is being recorded, whether it is live on HLS, and the session's status.
The React layer SHALL expose both as hooks.

#### Scenario: Consumer starts a recording from a hook
- **WHEN** a React consumer calls the egress start action with `record: true` and the server accepts
- **THEN** the action resolves and the egress state hook subsequently reports recording active

#### Scenario: Denial surfaces as typed error
- **WHEN** a consumer without the required capability starts egress
- **THEN** the action rejects with a typed egress error carrying the server's coded authorization error

#### Scenario: State follows the session lifecycle
- **WHEN** a session in the consumer's room goes live and later stops
- **THEN** the egress state hook reflects live-ness and then the stopped status without the consumer subscribing to signalling events

### Requirement: Manual quality selection
`@zvonok/react` SHALL expose a quality control hook providing
`setParticipantQuality(userId, level)` with levels `low`, `medium`, and
`high`, requesting the corresponding simulcast preference for the remote
participant's subscribed video. The selection SHALL affect only the caller's
subscription, SHALL NOT affect audio, and SHALL NOT affect what other
participants receive. An unknown participant id, or one with no subscribed
video, SHALL surface a typed error; the level vocabulary SHALL be part of
the package's public types.

#### Scenario: Consumer lowers a remote video's quality
- **WHEN** a consumer calls the quality action with a remote participant's id and `low`
- **THEN** the caller's subscription for that participant switches to the low simulcast preference without affecting other subscribers

#### Scenario: Quality does not touch audio
- **WHEN** a quality level is set for a participant
- **THEN** the participant's audio subscription is unaffected

#### Scenario: Unknown participant rejected
- **WHEN** the quality action is called with an id that has no subscribed video
- **THEN** the action surfaces a typed error and no subscription changes

### Requirement: Audio activity hooks
`@zvonok/react` SHALL expose audio-activity state over the room's audio
participants, computed client-side from local and remote audio tracks with
no new signalling: an active-speaker hook reporting the currently speaking
participant's id or `null` in silence (including the local participant while
they publish audio), and an audio-levels hook reporting a smoothed level in
0..1 per audio-active participant id. When no audio tracks exist the hooks
SHALL report `null` and an empty collection respectively, and they SHALL
clean up their sampling resources when the room is left.

#### Scenario: Active speaker switches
- **WHEN** participant B becomes and stays louder than the current speaker A
- **THEN** the active-speaker hook reports B's id after the detector's switch window, without the consumer wiring any audio analysis

#### Scenario: Silence reports null
- **WHEN** no participant produces audio above the speaking threshold
- **THEN** the active-speaker hook reports `null` after the detector's hold time

#### Scenario: Local participant included
- **WHEN** the local participant is publishing microphone audio and speaks
- **THEN** the active-speaker hook can report the local participant's id

#### Scenario: Levels track every audio participant
- **WHEN** remote participants publish audio alongside the local microphone
- **THEN** the audio-levels hook reports a level for each audio-active participant id, local included

### Requirement: Data channel
The SDK SHALL expose the room's ephemeral data channel: a send action
`sendBroadcast(topic, payload)` that settles on the server's acknowledgement
with authorization, size, and topic denials surfacing as typed broadcast
errors carrying the server's coded error, and an incoming-broadcast
subscription delivering `{senderId, topic, payload, timestamp}` messages for
other participants' broadcasts without polling. The React layer SHALL expose
both as hooks: a send hook returning the ack-settled action, and a
topic-filtered receive hook delivering only messages of its topic.

#### Scenario: Consumer sends and settles
- **WHEN** a capable consumer calls the send action with a topic and payload and the server accepts
- **THEN** the action resolves and other participants' receive surfaces deliver the message

#### Scenario: Denial surfaces as typed error
- **WHEN** a consumer without `send-data-message` calls the send action
- **THEN** the action rejects with a typed broadcast error carrying the server's coded authorization error

#### Scenario: Receive hook filters by topic
- **WHEN** a consumer subscribes to topic `reactions` and broadcasts arrive on `reactions` and `chat`
- **THEN** only the `reactions` messages reach that consumer's receive hook

#### Scenario: Sender does not receive their own message
- **WHEN** a consumer sends a broadcast
- **THEN** their own receive surfaces do not deliver that message back

### Requirement: Remote audio playout
`@zvonok/react` SHALL expose remote-audio playout as a single hook backed by
the SDK's audio mixer: it SHALL play every remote participant's audio without
consumer-managed audio elements, SHALL support per-participant volume and
output-device routing, and SHALL feed audio-activity readings (per-participant
levels and the active speaker) from the same playout graph. Releasing the hook
on room leave SHALL stop all playback and sampling resources.

#### Scenario: Remote audio plays without manual wiring
- **WHEN** a participant joins a room where others publish microphone audio
- **THEN** remote audio is audible with no consumer-created audio elements or stream attachment

#### Scenario: Per-participant volume
- **WHEN** the consumer sets a participant's volume to zero
- **THEN** that participant becomes inaudible while other participants remain audible at their volumes

#### Scenario: Output device routing
- **WHEN** the consumer selects an output device id
- **THEN** all remote playout routes to that device

#### Scenario: Levels share the playout graph
- **WHEN** audio-activity readings are consumed alongside playout
- **THEN** levels and the active speaker reflect the played audio without a second sampling pipeline

#### Scenario: Leave releases resources
- **WHEN** the room is left
- **THEN** playback elements, gain nodes, and sampling timers are released

### Requirement: Screen share control
`@zvonok/react` SHALL expose screen share as a hook over the SDK's screen
share service: start captures the display and publishes it as a separate
screen producer honoring the server's room-level exclusive lock, stop
unpublishes it, and the hook SHALL expose sharing state including the
blocked-by-another-participant condition, with typed failures surfaced to the
consumer.

#### Scenario: Start publishes a screen producer
- **WHEN** a capable participant starts screen share
- **THEN** a screen track is published and the hook reports sharing active

#### Scenario: Exclusive lock surfaces as blocked
- **WHEN** screen share is requested while another participant holds the room's share
- **THEN** the request fails without disrupting the call and the hook reports the blocked state

#### Scenario: Stop unpublishes
- **WHEN** the sharing participant stops screen share
- **THEN** the screen producer is closed and the hook reports sharing inactive

### Requirement: Guest join requests (owner side)
`@zvonok/react` SHALL expose the room's guest join-request stream as a hook:
it SHALL deliver each new request (request id, display name) and expose the
pending queue state for the room owner's UI. Approval and denial actions SHALL
remain with the consumer; the hook SHALL NOT perform authorization actions.

#### Scenario: Owner sees a pending request
- **WHEN** a guest requests to join an approval-required room the owner is in
- **THEN** the hook's queue gains the request with its request id and display name

#### Scenario: Queue is state only
- **WHEN** the owner's client approves or denies a request through its own actions
- **THEN** the hook reflects the removal from the pending queue without itself having called any approval endpoint

### Requirement: Minimal public surface
`@zvonok/client` SHALL expose one manager construction entry point
(`createSfuManager`) that returns a connected `SfuManager`; consumers SHALL
NOT assemble the manager from a separate connection object. The published
set SHALL be limited to the manager, its public types, the quality-score
helper, the media manager factory and its state types, the remote-audio and
audio-activity modules, and the screen share service and types. Test doubles,
the signalling connection, the event router, the stats collector, and
single-implementation role interfaces SHALL NOT be published.

#### Scenario: Manager from one factory call
- **WHEN** a consumer builds a manager to join a room
- **THEN** a single `createSfuManager` call yields a manager with its connection already composed, and no separate connection class is exported

#### Scenario: No published test doubles
- **WHEN** a consumer looks for a mock manager or mock screen share service in the package exports
- **THEN** none exist, and consumers test against the real modules with fake transports instead

#### Scenario: State hides transport internals
- **WHEN** a consumer reads the manager's state
- **THEN** it sees connection status, capabilities, egress, broadcast, producer identifiers, and share-blocking state - not per-transport creation flags

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
on any preset stylesheet.

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

### Requirement: Quality adaptation
The package SHALL provide a quality adaptation surface as one public hook:
maintaining a per-participant element-visibility model, polling connection
stats, and requesting simulcast layer preferences with debouncing; the surface
SHALL suspend adaptation and stats polling while the document is hidden and
resume on visibility. The vendor app and the prebuilt experience SHALL consume
the same surface with no package-private quality logic. The surface SHALL NOT
alter the manual quality selection contract.

#### Scenario: Offscreen participant downgrades
- **WHEN** a participant's tile leaves the viewport
- **THEN** the surface requests a lower simulcast preference for that participant without consumer-written logic

#### Scenario: Hidden tab suspends adaptation
- **WHEN** the document becomes hidden
- **THEN** adaptation pauses and stats polling stops, resuming when the document is visible again

#### Scenario: One surface for both consumers
- **WHEN** the vendor app and the prebuilt experience render rooms
- **THEN** both run the same public adaptation hook, and neither carries its own quality engine

### Requirement: Styling and theming contract
The package SHALL ship preset stylesheets and design tokens as package subpath
exports (`./css/*`), expressing preset colors and key visual parameters as
`--zk-*` CSS custom properties scoped under a namespace class. The stable
public styling contract SHALL be: the exports map, component props, public
hooks, and the `--zk-*` token names. Preset class names and DOM structure
SHALL NOT be stable and MAY change in any release; consumers customizing
appearance SHALL use tokens, their own styles, or component props.

#### Scenario: Consumer rebrands via tokens
- **WHEN** a consumer overrides the documented `--zk-*` variables on or above the preset root
- **THEN** the preset restyles without JavaScript changes and the overridden values do not leak outside the preset tree

#### Scenario: Headless consumer imports no CSS
- **WHEN** the vendor app builds its UI from hooks and core components with its own styles
- **THEN** it imports no package stylesheet and no preset styles apply

#### Scenario: Preset internals change without breaking the contract
- **WHEN** a release changes preset class names or DOM structure
- **THEN** the public contract remains intact provided the exports map, props, hooks, and token names are unchanged
