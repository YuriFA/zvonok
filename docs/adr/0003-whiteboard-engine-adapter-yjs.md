# ADR 0003: Whiteboard behind an engine adapter with Yjs sync

> **Status:** accepted
> **Date:** 2026-09-08

## Context

The whiteboard (change `add-whiteboard`, 2026-09-06) shipped on tldraw ^5.4.0
with a snapshot-relay protocol over the `/whiteboard` Socket.io namespace. It
was built under the platform-roadmap principle "integrate before building
(Yjs/tldraw class), never from scratch". tldraw's license change for v4.0
(Sep 17, 2025) then removed free production use entirely: any production
deployment requires a paid license key (pricing unpublished; last public
anchor $6,000/yr), the free-with-watermark tier is gone, and without a key the
editor stops rendering after five seconds on non-loopback HTTPS. The
deployment currently runs a pre-whiteboard build, so there is no live
exposure - but the dependency cannot ship.

At the same time the product direction (grilling session 2026-09-08) settled
on a constructor-style client: room capabilities as isolated widgets with
host-owned auth, chat to follow later.

## Decision

- Remove tldraw completely. No license purchase; the possibility of a tldraw
  engine later is preserved by the adapter interface, not by carried code.
- Replace it with upstream Excalidraw (MIT) as the default engine behind a
  `WhiteboardEngine` adapter: the engine owns its document model and mounts
  into a container; the host injects an opaque byte transport. Adding another
  engine never touches sync, authorization, or the room UI.
- Sync moves to Yjs from day one: a server-held in-memory `Y.Doc` per room in
  the existing `/whiteboard` namespace (auth, guest admission, SFU-peer
  checks, room-closed teardown unchanged). Clients exchange incremental Yjs
  updates; late joiners receive the full document state directly from the
  server. Element-level conflicts resolve last-writer-wins by Excalidraw
  `version`/`versionNonce`; property-level merging is out of scope.
- Undo/redo is multiplayer: Excalidraw's built-in history is disabled and
  `Y.UndoManager` with tracked local origins drives it - undo reverts the
  user's own actions and propagates to everyone.
- Packaging: `@zvonok/whiteboard-core` (framework-free wire contract, engine
  interface, Yjs helpers) and `@zvonok/whiteboard-react` (Excalidraw engine +
  panel), mirroring the `client`/`react` precedent. Separate repositories are
  deferred until an out-of-monorepo consumer or license isolation demands
  them.
- The room UI gains a minimal panel registry; the whiteboard is its first
  registrant. A widget-composition ADR is deferred until chat actually
  migrates.

## Alternatives considered

- **Buy a tldraw license** - price on request, $6k/yr anchor, to keep a
  product this decision replaces; also keeps vendor lock-in the adapter is
  meant to remove.
- **Snapshot relay + Excalidraw** (excalidraw.com's own architecture:
  LWW reconciliation over the MIT `excalidraw-room` relay) - zero new sync
  code, but keeps full-board payloads, throttle lag, and was already chosen
  against for delta sync, server-held state, and persistence readiness.
- **`@excalidraw-yjs/excalidraw` fork** - property-level CRDT out of the box,
  but a hard fork: own wire/storage format, drift from upstream, contradicts
  "standard engine behind the adapter".
- **`y-excalidraw`** - unmaintained since 2024-12, pins Excalidraw ^0.17.
- **Keep the board on tldraw behind a feature flag** - carries the license
  obligations and the 1 MB vendor chunk for a hypothetical paying user.
- **Separate repositories now** - GitHub Packages auth, per-repo CI, versioned
  releases, with no second consumer to serve; workspace packages extract
  mechanically later.

## Consequences

- The `/whiteboard` wire protocol breaks (`whiteboard:op`/`whiteboard:snapshot`
  replaced by `whiteboard:update`/`whiteboard:state`); no external consumers
  exist, so the cutover ships atomically with this change.
- We own a small Excalidraw<->Yjs binding (element map + order array, LWW by
  version) - the change's main new code surface, isolated in
  `@zvonok/whiteboard-react` with dedicated two-document tests.
- The server keeps its own copy of the wire constants (Nest build cannot
  consume workspace TS source); drift is pinned by the protocol e2e suite.
- Boards remain ephemeral and in-memory; server restarts still blank them.
  Persistence becomes a later, small decision (a Yjs state snapshot per room).
- The roadmap principle "integrate, never build" gains its documented
  exception: integrate the MIT engine, own the thin binding.
