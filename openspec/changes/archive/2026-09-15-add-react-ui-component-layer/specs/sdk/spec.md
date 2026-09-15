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

## ADDED Requirements

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
