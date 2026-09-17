# Client Specification

## Purpose

React 19 SPA: routing, auth state, typed API access, SFU/media management,
pre-join and guest flows, chat UI, the per-user call-history page, and
design-system conventions.

## Requirements

### Requirement: Routes
The app SHALL expose `/` (home), `/login`, and `/register` (eager), and
`/room/:slug`, `/history` (per-user call history), and the `/console`
section - `/console` (project list), `/console/projects/:id` (project
detail), `/console/login` - lazy-loaded with Suspense.

#### Scenario: Opening an invite link
- **WHEN** a visitor navigates to `/room/abc123`
- **THEN** the room bundle is loaded lazily and pre-join renders inside a
  Suspense boundary

### Requirement: Auth context
`AuthContext` SHALL expose `login(email, password)`,
`register(username, email, password)`, `logout()`, `refreshUser()`, and state
`{user, isLoading, isAuthenticated}`. A failed token refresh logs the user
out and redirects to login.

#### Scenario: Refresh failure on reopen
- **WHEN** the app loads with an expired session and refresh fails
- **THEN** the user is logged out and routed to `/login`

### Requirement: Typed API errors
API failures SHALL surface as typed errors from `lib/api/api.errors.ts`:
`ApiError` with `AuthError`, `ValidationError`, `NetworkError`. The client
SHALL retry once on 401 after refreshing the access token.

#### Scenario: Validation error on register
- **WHEN** the server rejects registration with field errors
- **THEN** the client raises `ValidationError` and the form shows field-level
  messages

### Requirement: Framework-agnostic core

Room join, publishing, media toggle policy, host-mute enforcement, hidden-tab
video pause, remote-audio playout, screen share, and guest-request events
SHALL flow through the `@zvonok/react` bindings: the room page renders the SDK
provider, and the room UI consumes SDK hooks instead of owning a parallel
join/publish layer. Room media toggles, host-mute enforcement, kick reactions,
and producer-level visibility policy SHALL come from the SDK call-session
hook; the app SHALL consume outcomes and callbacks to present notifications
and navigate, and SHALL NOT re-implement publish, toggle, or pause
orchestration in app-local hooks. The app SHALL NOT reach into the
connection's producer methods; no app-local hook SHALL hold a manager
reference for producer-level behavior. App-local framework-free logic SHALL be
limited to the API client and app domain services. The SDK session's
underlying manager SHALL remain reachable for app-specific behaviors the
packages do not cover.

#### Scenario: Join flows through the SDK provider

- **WHEN** a user opens a room link and joins
- **THEN** connection and join run through the SDK provider's hooks, and no
  app-local join orchestration exists

#### Scenario: Room media policy flows through the call session hook

- **WHEN** the room UI toggles the camera or microphone, the host mutes the
  local peer, or the local peer is kicked
- **THEN** the room UI reads state and outcomes from the SDK call-session hook
  and only renders its own notifications and navigation

#### Scenario: Hidden-tab video pause crosses the call session

- **WHEN** the vendor app enables `pauseVideoWhenHidden` on the call session
- **THEN** the SDK pauses the video producer while the document hides and
  resumes the user's own camera state on return, with no app-local
  visibilitychange handler touching producers

#### Scenario: Using SFU outside React

- **WHEN** app logic needs manager access outside React state
- **THEN** it consumes the SDK session's underlying manager without
  reintroducing a parallel join or publish path

### Requirement: SFU connection
The client SHALL connect a Socket.io client to the `/sfu` namespace with
automatic reconnection, managing send/recv transports, producers (with
simulcast), consumers, and quality monitoring.

#### Scenario: Network blip during a call
- **WHEN** the socket disconnects mid-call
- **THEN** reconnection is automatic and media resumes without page reload

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

### Requirement: Screen share
The client SHALL publish screen share as a separate producer track, honoring
the server's room-level exclusive lock.

#### Scenario: Lock held by another peer
- **WHEN** the user clicks share while someone else is sharing
- **THEN** the client surfaces the rejection without disrupting the call

### Requirement: Pre-join flow
Pre-join SHALL offer device selection and display name entry (authenticated
users pre-filled), and room states: loading, error, ended.

#### Scenario: Room already ended
- **WHEN** pre-join loads a room with status `ended`
- **THEN** the ended state is shown instead of join controls

### Requirement: Guest flow
Guests SHALL join by display name: pre-approval check via HTTP-only cookie,
join request, status polling with states `idle -> waiting ->
approved | denied | error`, and persistent message identity after approval.
Room owners see and handle guest requests in the participants list.

#### Scenario: Guest waits for approval
- **WHEN** a guest submits their name for an approval-required room
- **THEN** the UI shows `waiting` until the owner approves, then the guest
  enters with a persistent identity

### Requirement: Chat UI
The room page SHALL embed the chat (message list + input) backed by the
`/chat` namespace and the messages REST API, rendering guest and user
messages distinctly.

#### Scenario: Live message arrives
- **WHEN** a `chat:message` event arrives for the joined room
- **THEN** the message list appends it, visually distinguishing guest authors

### Requirement: Room panel registry
The room page SHALL assemble its side panels from a panel registry: each
panel registers an id, title, icon, and lazy-loaded component, and the host
injects the room context (room slug, participant identity, permissions) when
mounting it. The whiteboard SHALL be a registry consumer, and the room page
SHALL NOT import registered panels' internals directly. Authentication and
room identity SHALL be owned by the host, never by a panel.

#### Scenario: Whiteboard opens through the registry
- **WHEN** a participant opens the whiteboard panel
- **THEN** the panel component is lazy-loaded through its registry entry and mounted with the injected room context

#### Scenario: Adding a panel leaves the room view generic
- **WHEN** a new panel registers itself with the room panel registry
- **THEN** it becomes available in the room UI without the room view gaining knowledge of the panel's internals

### Requirement: Server-state management
Data fetching SHALL use TanStack React Query with centralized query keys
(`lib/react-query/query-keys.ts`), staleTime 0, 3 retries for queries, 1
retry for mutations, 5-minute cache.

#### Scenario: Room data refetch on focus
- **WHEN** the user returns to the tab
- **THEN** React Query refetches stale room queries using the shared keys

### Requirement: Design system
UI SHALL use Base UI primitives in `components/ui/` styled with Tailwind CSS
v4 and `class-variance-authority` variants; feature code lives in
`features/<feature>/` (kebab-case); no barrel files.

#### Scenario: Adding a button variant
- **WHEN** a new visual variant is needed
- **THEN** it is added as a `class-variance-authority` variant on the shared
  `components/ui/button.tsx`

### Requirement: Keyboard control of room media
The room page SHALL support keyboard control of the media actions exposed by
its control bar: microphone toggle, camera toggle, and screen-share toggle,
with the guards defined in the keyboard-shortcuts capability.

#### Scenario: Camera toggle via keyboard
- **WHEN** the user presses `v` during a call
- **THEN** the camera toggles exactly as if the control-bar button was
  clicked, and the button state reflects it

### Requirement: Host controls UI
When the local participant is the host - the owner of a user-owned room or a
room-admin token holder in a project room - the app SHALL expose host controls:
mute for each remote participant, mute-all, and a room lock toggle, calling the
SDK host-control actions and surfacing server denials as errors. Every
participant SHALL see an indication when the server forcibly mutes them, and
the room SHALL show a locked state to everyone while locked.

#### Scenario: Owner mutes a participant from the participant list
- **WHEN** the owner activates the mute control on a publishing participant
- **THEN** that participant's media stops and the mute is reflected in the owner's UI

#### Scenario: Muted by host indication
- **WHEN** the server forcibly mutes the local participant
- **THEN** the app shows a muted-by-host indication and the participant's own mic control reflects the server state

#### Scenario: Locked state visible
- **WHEN** the host locks the room
- **THEN** all participants see the locked indication and new join attempts fail with the room-locked error

### Requirement: Developer console
The app SHALL expose a `/console` section (lazy-loaded) for developer
accounts. It SHALL offer registration and login against the developer auth
surface and keep the returned dev token in `sessionStorage` (console-only,
cleared on tab close and logout). While authenticated, the console SHALL list
the developer's projects and let them create a project; selecting a project
SHALL show its API keys (create with the full key shown exactly once, revoke
with confirmation), webhook endpoint configuration, room list, and recordings
with in-browser playback and download. Console fetches SHALL attach the dev
token as a bearer header and surface failures through the typed API errors;
unauthenticated visitors SHALL be redirected to the console login. A visitor
already signed in on the main site SHALL additionally be offered a one-click
continue action that signs them into the console through the app-session
sign-in endpoint without typing credentials.

#### Scenario: Developer signs in
- **WHEN** a developer logs in on the console with valid credentials
- **THEN** the token is stored for the session and the project list renders

#### Scenario: Creating an API key
- **WHEN** the developer creates a key from the console
- **THEN** the full key value is displayed once with a copy action and only its metadata appears afterwards

#### Scenario: Configuring a webhook
- **WHEN** the developer sets or removes the project webhook endpoint
- **THEN** the console reflects the current webhook URL and the returned signing secret is shown once

#### Scenario: Playing a recording
- **WHEN** the developer plays one of the project's finalized recordings
- **THEN** the video plays in the browser from a short-lived blob URL fetched with the dev token

#### Scenario: Session expiry
- **WHEN** a console request fails with an authentication error
- **THEN** the stored token is cleared and the console login renders

#### Scenario: Continue from the site session
- **WHEN** a visitor signed in on the main site opens the console login
- **THEN** a continue action with their site username is offered and completing it lands them in the console without typing credentials

### Requirement: Disconnected participant indication
The participant list SHALL distinguish a participant whose media has detached
from a fully live participant: a media-detached participant is shown with a
disconnected indication and without active-looking microphone/camera state,
while remaining in the list until the server announces their departure. When
the same participant's media reattaches (rejoin inside the rejoin grace
window), the indication SHALL clear. When the server announces the
participant's departure, the participant is removed from the list.

#### Scenario: Hard disconnect shows disconnected during grace
- **WHEN** a participant hard-disconnects (for example closes the tab) and the
  server holds their seat in the rejoin grace window
- **THEN** the remaining participants see that row marked as disconnected
  instead of a fully live participant

#### Scenario: Rejoin inside the grace window restores the row
- **WHEN** the disconnected participant rejoins before the grace window
  expires
- **THEN** the disconnected indication clears and the row renders as a live
  participant again

#### Scenario: Grace expiry removes the row
- **WHEN** the grace window expires without a rejoin
- **THEN** the participant is removed from the list entirely

### Requirement: Pre-join permission surfacing

The pre-join screen SHALL display the camera and microphone permission state
(granted, denied, prompting, or unknown) before the user attempts to join, and
SHALL show an actionable explanation when a required device is denied or
unavailable instead of failing silently after the join is attempted. The state
SHALL update when the user changes permissions without requiring a page
reload.

#### Scenario: Denied camera explains itself

- **WHEN** the user opens pre-join with camera permission denied
- **THEN** the pre-join screen marks the camera as blocked and explains how to
  unblock it, before any join attempt

#### Scenario: Granting permission updates the screen

- **WHEN** the user grants the camera from the browser's page controls while
  pre-join is open
- **THEN** the pre-join screen updates to show the camera as available without
  a reload
