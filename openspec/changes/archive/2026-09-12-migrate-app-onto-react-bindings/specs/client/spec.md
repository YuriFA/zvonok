## MODIFIED Requirements

### Requirement: Framework-agnostic core
Room join, publishing, remote-audio playout, screen share, and guest-request
events SHALL flow through the `@zvonok/react` bindings: the room page renders
the SDK provider, and the room UI consumes SDK hooks instead of owning a
parallel join/publish layer. App-local framework-free logic SHALL be limited
to the API client and app domain services. The SDK session's underlying
manager SHALL remain reachable for app-specific behaviors the packages do not
cover (today: the auto-quality engine).

#### Scenario: Join flows through the SDK provider
- **WHEN** a user opens a room link and joins
- **THEN** connection and join run through the SDK provider's hooks, and no app-local join orchestration exists

#### Scenario: Using SFU outside React
- **WHEN** app logic needs manager access outside React state (today: the auto-quality engine)
- **THEN** it consumes the SDK session's underlying manager without reintroducing a parallel join or publish path

### Requirement: Device management
Device enumeration, permission queries, capture toggling, and device
switching SHALL flow through the SDK's shared media manager exposed by the
SDK provider and its device controls hook; the app's device settings UI
consumes it and SHALL NOT construct a second media manager. Switching an
active device replaces the producer's track without leaving the call;
permission denial shows a fallback UI.

#### Scenario: Switching microphone mid-call
- **WHEN** the user picks another input device in device settings
- **THEN** the active producer is replaced without leaving the call

#### Scenario: Single shared media manager
- **WHEN** the room UI and the device settings UI both touch capture state
- **THEN** they read and control the same provider-owned media manager, not separate instances
