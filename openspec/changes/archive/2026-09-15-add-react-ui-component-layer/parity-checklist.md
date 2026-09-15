# Widget parity checklist (8.1)

Derived from the pre-slice `packages/react/src/prebuilt/ZvonokRoom.tsx`
(539 lines) and `zvonok-room.test.tsx`. The `./embedded` rebuild (8.4) must
reproduce every row below at user-visible level; deletions and improvements
are noted explicitly.

## Props

| Old prop | New surface | Notes |
|---|---|---|
| `serverUrl` | same | Own `ZvonokProvider`; no enclosing provider required |
| `roomSlug` | same | |
| `token` | same | Identity from token claims, never the name field |
| `displayName?` | same | Pre-fills name; presence skips prejoin; labels local tile |
| `skipPrejoin?` | same | Auto-join, mic+camera on |
| `onLeft?` | same | Fires on widget leave control, not on errors |
| `onError?` | same | Fires with the typed join error |
| - | `layout?: "grid" \| "spotlight"` | NEW: string layout option (D7) |
| - | `children?: ReactNode` | NEW: rendered alongside the stage |
| - | `className?` | NEW: passthrough to the room root |

## Render stages (in priority order)

1. **Skip blank**: skip requested, join not connected yet - render `null`
   (no prejoin flash). Today: `autoJoinPending && status === "disconnected"`.
2. **Join error**: `status === "error"` - alert card with `ZvonokError.code`
   badge, `error.message`, Back button. Back calls `connection.leave()`
   (NOT `onLeft` - the participant never reached the room) and returns to
   the prejoin card without re-triggering a skip join.
3. **In room**: `joined | connecting | reconnecting` - room surface with
   header, connecting/reconnecting status line, grid, notice area, controls.
4. **Prejoin card**: form with name input (hidden when `displayName` given),
   mic/camera toggles (simulated choices, no capture), Join submit.

## Behaviors

- **Join**: `devices.start({video, audio})` first; capture failures never
  block joining; then `connection.join()`; then publish initial tracks
  (each active capture: `produceTrack` + `resumeProducer`).
- **Publish toggles** (mic/camera): capture toggle gates the sequence;
  disable pauses producer; enable produces when missing (rollback on
  failure) and resumes. Improvement allowed: rebuilds on
  `usePublishControls` (replace-then-resume when a producer exists - more
  correct than today's resume-and-rely-on-sync, same user-visible result).
- **Replace-track sync**: capture restart while producer exists swaps the
  published track - via the package `useSfuTrackSync` (deletes the inline
  D5 effect).
- **Screen share**: `useScreenShare`; blocked share disables the button
  while not sharing; typed failures map to notices: blocked / unsupported /
  denied / cancelled (via `mapScreenShareError`).
- **Record control**: renders only with the server-delivered
  `start-recording` capability (via `hasCapabilities`); toggles
  `egressControls.start({record: true})` / `stop()`; failures surface in
  the notice area.
- **Leave**: `devices.stop()` + `connection.leave()` + `onLeft?.()`.
- **Remote audio**: shared `useRemoteAudio()` graph, no per-tile audio.
- **Quality**: remote camera tiles get viewport-driven layer selection;
  local and screen tiles stay unwired (`useViewportQuality` inside `Tile`).
- **Tiles**: memoized, stable across unrelated room events; camera-off
  overlay with initial; name badge with "(you)" for local; muted badge;
  screen tiles labeled "<name>'s screen", always video-on.
- **Local name label**: `displayName?.trim() || nameDraft.trim() || "You"`.
- **Live flags**: mic/camera live = active capture state AND track present.

## Styling (D6)

- Old: single `zvonok.css`, `zvk-*` classes, side-effect import, export
  `./zvonok.css`.
- New: `./css/component-kit.css` (tokens + primitives) and
  `./css/embedded.css` (room composition); tokens `--zk-*` on the `.zk`
  namespace class; class names and DOM are NOT a stable contract.

## Error codes surfaced

`ZvonokError.code` renders on the join-error card; the message renders
always; non-ZvonokError degrades gracefully.

## Test-suite parity

`zvonok-room.test.tsx` behaviors that must keep passing against the new
entry: auto-join + tiles, initial publish, typed join error + onError,
producer pause/capture flip from controls, prejoin name/device collection,
record gating by capability, screen-share blocking + notice, skip by
displayName, css export manifest.
