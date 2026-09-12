## MODIFIED Requirements

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

## ADDED Requirements

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
