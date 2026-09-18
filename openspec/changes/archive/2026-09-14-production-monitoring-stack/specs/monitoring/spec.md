# Monitoring Specification (delta)

## Purpose

Server-side observability: a Prometheus metrics endpoint describing call
activity and process health, and error reporting to a self-hosted
Sentry-compatible backend. Lets the operator answer "how many clients and
rooms are active, how loaded is the process, what just broke" without
shell access.

## ADDED Requirements

### Requirement: Internal Prometheus metrics endpoint

The server SHALL expose `GET /metrics` returning metrics in the Prometheus
text exposition format, including default Node.js process metrics (event
loop, GC, heap) and gauges for:

- active rooms: rooms with a live SFU router;
- connected peers: the number of peers currently tracked in rooms;
- open mediasoup transports.

The endpoint SHALL NOT be routed through the public gateway: no public
HTTP route, no TLS termination, no auth-bypassing exposure. It is scraped
by the monitoring stack from the host network only.

#### Scenario: Prometheus scrapes call activity

- **WHEN** the monitoring stack scrapes `GET /metrics` while two rooms are
  active with three and one connected peers
- **THEN** the response contains a rooms-active gauge equal to `2` and a
  connected-peers gauge equal to `4`, plus process metrics

#### Scenario: Room lifecycle is reflected in gauges

- **WHEN** a room is created, peers join, the room is ended, and its
  router closes
- **THEN** the rooms-active gauge increments on creation, the
  connected-peers gauge tracks joins and leaves, and both return to their
  baseline after the room ends

#### Scenario: Metrics are not publicly reachable

- **WHEN** an external client requests `https://<site>/metrics` through
  the public gateway
- **THEN** the gateway does not route the path to the server (SPA or 404
  response), and no public route to `/metrics` exists

### Requirement: Error reporting to a Sentry-compatible backend

When an error-reporting DSN is configured, the server SHALL report
unhandled server errors (unhandled promise rejections, uncaught
exceptions, and 5xx responses) as events to the configured
Sentry-compatible backend (GlitchTip). When no DSN is configured, the
server SHALL run normally with error reporting disabled.

Reports SHALL NOT include secrets: cookies, authorization headers, or
password field values.

#### Scenario: A 5xx error reaches GlitchTip

- **WHEN** a request handler throws an unexpected error with a DSN
  configured
- **THEN** the error is reported as an event with the request route and
  stack trace, and the client still receives the normal error response

#### Scenario: Reporting is opt-in

- **WHEN** the server starts without an error-reporting DSN
- **THEN** no error reporting is initialized and the server behaves
  exactly as before this change
