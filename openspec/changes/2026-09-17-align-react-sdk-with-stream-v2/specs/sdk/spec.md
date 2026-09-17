## ADDED Requirements

### Requirement: Package layering and core seams
`@zvonok/react` SHALL organize its public surface in layers a consumer can rely
on: a hook layer that is the state seam and adds no markup; a media-plumbing
component layer (participant video tiles, video element binding, track
synchronization, viewport-driven quality) that SHALL own that plumbing
end-to-end and SHALL expose its visual presentation as component-typed props;
a composition-block layer built only over the hook layer; and the prebuilt
room entry built only over the block and hook layers. A consumer MAY replace
block markup via component-typed props and MAY assemble a fully custom room UI
from the hook layer plus the plumbing layer; a consumer SHALL NOT need to
re-implement or bypass the plumbing to render remote media. The vendor app
SHALL consume only this public surface (dogfooding rule).

#### Scenario: Core plumbing is used, not re-implemented
- **WHEN** the vendor app or an external consumer renders a remote participant's video
- **THEN** track binding, visibility, and layer selection come from the package plumbing layer, and the consumer customizes only visual presentation via component props

#### Scenario: Blocks ride the hook seam only
- **WHEN** a composition block derives control state or host-action outcomes
- **THEN** it derives them from the public hook surface and imports no package-private transport state

#### Scenario: Custom UI from the public surface
- **WHEN** a consumer builds a fully custom room UI without any preset component
- **THEN** the hook layer plus the plumbing layer suffice, with no package-private imports

## MODIFIED Requirements

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
props so approval policy stays with the consumer. The blocks SHALL publish
their projections - the participant projection and roster ordering among
them - as the single vocabulary for both markup variants; the vendor app SHALL
NOT maintain a parallel participant projection or its own roster ordering, and
SHALL render its custom markup from the block's projection. The vendor app and
the prebuilt room SHALL consume the same blocks with no duplicated block
behavior; app-specific domains (chat, whiteboard, local recording, guest
approval policy) SHALL enter only as props or slots.

#### Scenario: App and prebuilt share one behavior source
- **WHEN** a control-state derivation or host-action outcome changes in a block
- **THEN** both the vendor app room and the prebuilt room pick up the change without a second implementation being edited

#### Scenario: App keeps its own markup
- **WHEN** the vendor app renders a block with its own button, list, or panel markup via component props
- **THEN** the block still owns orchestration - toggles, capability gating, ordering, error outcomes - and imports no preset stylesheet

#### Scenario: No parallel projection in the app
- **WHEN** the vendor app renders its own participants list markup
- **THEN** it consumes the block's participant projection and roster ordering, and defines no duplicate participant type or sort of its own

#### Scenario: Preset variant styles from the package contract
- **WHEN** the prebuilt room renders the preset variants
- **THEN** styling resolves through the shipped stylesheet and `--zk-*` tokens, and a consumer can rebrand via tokens without changing markup

#### Scenario: Guest approval policy stays with the consumer
- **WHEN** the participants panel receives pending guest requests as props
- **THEN** approve and deny actions invoke consumer-supplied handlers and the panel encodes no approval policy of its own

#### Scenario: App-only domains enter as slots
- **WHEN** the vendor app adds chat, whiteboard panels, or local recording controls to a block
- **THEN** they are supplied as props or child content and the package gains no dependency on those domains
