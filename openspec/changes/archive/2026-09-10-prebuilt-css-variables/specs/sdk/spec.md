# sdk

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
