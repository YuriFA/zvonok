## MODIFIED Requirements

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
structure SHALL NOT be a stable contract. The prebuilt experience SHALL
render room media policy through the call-session hook: host-mute enforcement
with once-per-occurrence notification, kick handling that releases capture
and surfaces an ended state, and room-lock state. It SHALL offer, without
consumer wiring: a participants panel with capability-gated host actions
(mute all, room lock, per-participant mute and kick), device switching, and
screen-share spotlight, with guest join-request approval delegated to
consumer-supplied handlers. The package's own quickstart and demo surface
SHALL consume this entry.

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

#### Scenario: Vendor app stays on the public surface
- **WHEN** the vendor app's room UI is built against the package
- **THEN** every capability it needs is importable from public exports alone, with no package-private imports

#### Scenario: Host actions work in the prebuilt room
- **WHEN** a participant holding host capabilities uses the prebuilt participants panel to mute all, lock the room, or mute or kick a participant
- **THEN** the actions run through the package host controls, are gated by server-delivered capabilities, and outcomes surface in the room

#### Scenario: Kicked participant sees an ended state
- **WHEN** the server kicks a participant of the prebuilt room
- **THEN** the room surfaces the kicked state and captured local media is released, matching the call-session hook contract

#### Scenario: Device switching in the prebuilt room
- **WHEN** a participant switches camera, microphone, or speaker in the prebuilt room
- **THEN** selection persists across sessions and capture updates without leaving the room

#### Scenario: Locked room surfaces before join
- **WHEN** the room is locked
- **THEN** the prebuilt room reflects lock state in and before the room instead of surfacing it as an opaque join failure

## ADDED Requirements

### Requirement: Prebuilt room composition blocks
The package SHALL provide prebuilt room composition blocks whose behavior is
single-sourced over the public hooks, with two markup variants: a preset
variant styled by the package stylesheet contract, and a consumer-markup
variant driven by component-typed props. The blocks SHALL cover: media
control bar with derived control states including the host-mute override;
participants panel with roster ordering, connection and quality indication,
and capability-gated host action handlers; device switcher with permission
states and persisted preferences; room status cards for lock, kicked, and
ended states; screen-share spotlight; and grid composition that places tiles
from the layout derivation. Guest join requests SHALL cross the panel as
props so approval policy stays with the consumer. The vendor app and the
prebuilt room SHALL consume the same blocks with no duplicated block
behavior; app-specific domains (chat, whiteboard, local recording, guest
approval policy) SHALL enter only as props or slots.

#### Scenario: App and prebuilt share one behavior source
- **WHEN** a control-state derivation or host-action outcome changes in a block
- **THEN** both the vendor app room and the prebuilt room pick up the change without a second implementation being edited

#### Scenario: App keeps its own markup
- **WHEN** the vendor app renders a block with its own button, list, or panel markup via component props
- **THEN** the block still owns orchestration - toggles, capability gating, ordering, error outcomes - and imports no preset stylesheet

#### Scenario: Preset variant styles from the package contract
- **WHEN** the prebuilt room renders the preset variants
- **THEN** styling resolves through the shipped stylesheet and `--zk-*` tokens, and a consumer can rebrand via tokens without changing markup

#### Scenario: Guest approval policy stays with the consumer
- **WHEN** the participants panel receives pending guest requests as props
- **THEN** approve and deny actions invoke consumer-supplied handlers and the panel encodes no approval policy of its own

#### Scenario: App-only domains enter as slots
- **WHEN** the vendor app adds chat, whiteboard panels, or local recording controls to a block
- **THEN** they are supplied as props or child content and the package gains no dependency on those domains
