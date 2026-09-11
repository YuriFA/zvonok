# developer

## MODIFIED Requirements

### Requirement: Projects listing
A developer account SHALL list its own projects with their id, name, and
project-owned room count, newest first, using the platform's cursor-paginated
envelope (`{ items, next }` with the same limit bounds as `/v1` lists). The
listing SHALL be scoped to the authenticated account; other accounts'
projects SHALL respond 404 on any project-scoped developer endpoint.

#### Scenario: Listing own projects
- **WHEN** a developer requests their projects with a valid dev token
- **THEN** the response envelope contains only their projects, each with its room count, and a `next` cursor or null

#### Scenario: Foreign project is invisible
- **WHEN** a developer requests rooms, recordings, or a download under another account's project id
- **THEN** the server responds 404 and no data leaks

### Requirement: Developer media views
A developer SHALL inspect a project's platform state with dev-token auth: the
project's rooms (id, name, slug, status, created/ended timestamps) and the
project's recordings (id, room, size, finalized timestamp, newest first),
both newest first through the same cursor-paginated envelope and limit
bounds as the `/v1` lists. A developer SHALL download one of the project's
finalized recordings under the same auth. Recordings of project rooms that
were not recorded SHALL return an empty list; unknown recordings SHALL
respond 404.

#### Scenario: Viewing project rooms
- **WHEN** a developer lists the rooms of their project
- **THEN** the response envelope contains the project's rooms with status and lifecycle timestamps

#### Scenario: Playing a project recording
- **WHEN** a developer requests the download URL of their project's finalized recording
- **THEN** the bytes stream with Range support, as under the `/v1` API-key surface

#### Scenario: Unrecorded project has no recordings
- **WHEN** a developer lists recordings for a project without recorded egress sessions
- **THEN** the list is empty
