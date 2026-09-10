# sdk

## ADDED Requirements

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

## MODIFIED Requirements

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
track-attachment, or capture code.

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

#### Scenario: Typed failure surfaces in the UI
- **WHEN** the join fails (invalid or expired token)
- **THEN** the component renders the typed join error state and never silently shows an empty room
