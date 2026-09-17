# 0007. SDK absorption rule

- Status: accepted
- Date: 2026-09-17
- Context: architecture review of `apps/client`, `packages/client`, `packages/react`
  after the stream-v2 migration

## Context

After the app migrated onto the React bindings, the remaining architectural
question was where room media, participant, and media-policy code belongs:
the vendor app still had app-local behaviors that the packages could own
(hidden-tab producer pause, recording compositor wiring), and future
contributors face the same pull in both directions - duplicating SDK behavior
app-side, or absorbing app domains into the SDK wholesale.

The dogfooding rule (sdk spec) already requires the app to consume only the
public surface. This ADR adds the review-time heuristic that decides where
new behavior lands.

## Decision

Behavior that can live in the SDK packages and matches their job SHALL live
there, not in `apps/client`. Concretely:

- Room media policy, participant projections, capture lifecycle, quality
  adaptation, and reconnect/recovery logic deepen the packages; the app
  consumes the public surface and keeps only presentation and app domains.
- Absorption is judged by three tests: the inputs are already SDK vocabulary;
  the module is self-contained (no app contexts behind its interface); and it
  is testable at the package seam. Example absorbed under this rule: the
  hidden-tab video pause moves into the call-session hook
  (`pauseVideoWhenHidden`), deleting the app's producer reach-in.
- App-specific domains named in the sdk spec - chat, whiteboard, guest
  approval policy - stay in the app and enter packages only as props or
  slots. Local recording was removed on 2026-09-17 (no demand, hidden-tab
  render freeze) rather than absorbed.
- The manager escape hatch (sdk spec: manager reachable via the session for
  app-specific behaviors) stays; absorption does not mean sealing the SDK.

Rejected: keeping a public projection hook alive by re-sourcing it from a new
store when its only job was copying fields - interface without behavior is
abstraction for its own sake. Rejected: unified recording interfaces that
union incompatible adapters (device-local vs server artifacts) into one
seam - the interface ends up wider than either implementation.

## Consequences

- Future architecture reviews propose deepening the packages instead of
  accepting app-local layers; app-local duplicates of SDK-covered behavior
  are treated as bugs, not convenience.
- Contract-affecting absorptions go through OpenSpec changes; the spec's
  app-domains list is the boundary of record.
