# sdk

## Purpose

The externally consumable SDK surface: npm-published `@zvonok/client` and `@zvonok/react` packages with a stable public contract and a quickstart path that works from a clean project against a deployed server.

## Requirements

### Requirement: Packages installable from npm
`@zvonok/client` and `@zvonok/react` SHALL be installable from the public npm
registry into a clean external project with no access to the monorepo.
Published artifacts contain built JavaScript with type declarations and
complete package metadata (name, version, license, repository). The workspace
itself keeps consuming package sources directly; publishing is a manual
versioned release per package.

#### Scenario: Clean-project install
- **WHEN** a developer outside the monorepo runs `npm i @zvonok/client` (or `@zvonok/react`)
- **THEN** the package installs with its dependencies and type declarations, and imports resolve without monorepo paths

#### Scenario: Workspace stays source-based
- **WHEN** the zvonok app imports `@zvonok/client/*` during development
- **THEN** it consumes package sources directly, without requiring a build of the package first

### Requirement: Connection and join contract
`@zvonok/client` SHALL expose a connection entry point that takes a server URL,
a room identifier, and an identity (room token for platform consumers), joins
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
errors surface as typed errors on every identity path.

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
- **THEN** the SDK surfaces a typed authentication join error and does not
  retry into a dead room

### Requirement: React binding
`@zvonok/react` SHALL provide a provider carrying SDK configuration and hooks
covering the join lifecycle, participants-and-tracks state, device controls,
and the consumer's own capabilities, implemented as a thin layer over
`@zvonok/client`. It declares `react` >= 18 as a peer dependency. The
headless hook layer adds no UI; the package MAY additionally ship the
prebuilt room component below.

#### Scenario: React consumer joins declaratively
- **WHEN** a React app renders the provider with config and uses the join hook with a token
- **THEN** the hook exposes connection state, participants, and remote tracks as React state without manual signalling wiring

#### Scenario: Component gates UI on own capabilities
- **WHEN** a component renders host controls behind `useOwnCapabilities()`
- **THEN** the controls render exactly for capabilities the server granted, without the consumer encoding role logic

### Requirement: Prebuilt room component
`@zvonok/react` SHALL ship a `ZvonokRoom` drop-in component that renders a
complete meeting room from minimal props (`roomSlug`, `token`, optional
display name, and lifecycle callbacks): a pre-join stage for name and device
confirmation (skippable), a video grid of local and remote participants with
name and audio-off badges, and a controls bar with microphone, camera, screen
share, leave, and - when the participant's own capabilities include
`start-recording` - a recording control reflecting the room's recording
state. The component SHALL be styled by package-owned CSS with a namespaced
class prefix and SHALL NOT require the consumer to run any signalling,
track-attachment, or capture code. The stylesheet SHALL consume a documented
set of `--zvonok-`-prefixed CSS custom properties defined on the widget root
- accent, background, and text colors, corner radius, and font family - each
defaulting to the package's built-in value when the host sets none.

#### Scenario: Drop-in integration
- **WHEN** an external React app renders `ZvonokRoom` with a server URL, room slug, and valid room token
- **THEN** the participant joins and sees remote participants' video with working mic, camera, screen share, and leave controls - without wiring any signalling or track code

#### Scenario: Record button appears only for capable participants
- **WHEN** `ZvonokRoom` renders for a participant whose capabilities include `start-recording`
- **THEN** the controls bar offers a recording control that starts and stops recording via the SDK's egress actions and reflects the recording state

#### Scenario: Record button hidden without capability
- **WHEN** `ZvonokRoom` renders for a participant without `start-recording`
- **THEN** no recording control is rendered and no egress action is callable through the component

#### Scenario: Styles do not leak
- **WHEN** the component renders inside a host app with its own CSS
- **THEN** all widget styling is scoped under the package's class namespace and no host styles are required

#### Scenario: Default appearance without overrides
- **WHEN** `ZvonokRoom` renders with no custom properties set by the host
- **THEN** the widget's appearance is identical to the built-in default styling

#### Scenario: Host brands the widget
- **WHEN** the host page defines the documented `--zvonok-` custom properties on or above the widget root
- **THEN** the widget picks up the overridden accent, background, text, radius, and font values without any JavaScript or component prop, and the values do not leak outside the widget

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
