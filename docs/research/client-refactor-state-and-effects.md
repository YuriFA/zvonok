# Client refactor: state flow and effects (stream-chat-react + @videosdk.live patterns)

Date: 2026-09-13.
Question: how should we refactor `apps/client` (and `@zvonok/react`) to remove prop drilling and unnecessary `useEffect`s, borrowing from [stream-chat-react](https://github.com/GetStream/stream-chat-react) and `@videosdk.live/react-native-sdk`?

Sources: audit of our own code (file-level verified), stream-chat-react source at `master` (default branch; `main` does not exist), and the shipped npm sources of `@videosdk.live/react-native-sdk` (no public GitHub repo exists - the org only publishes examples; readable source recovered from the RN package itself, the `@videosdk.live/react-sdk@1.1.1` sourcemap `sourcesContent`, and the readable `@videosdk.live/hooks-core@0.0.1-beta.2`).

## 1. Verdict

Both SDKs converge on the same end-state architecture:

1. Room state lives in an **external store**, components subscribe with **selectors** through `useSyncExternalStore` - they never receive state as props from a parent that re-rendered.
2. Contexts are **split into state and actions**, and hot/high-frequency state gets its **own** context or store.
3. The provider translates **engine/socket events into store updates exactly once**; UI components contain **zero subscription effects**.
4. **Custom hooks are the component API**: leaves consume hooks that read contexts, instead of parents destructuring hook results into 8-10 props.

We already own every primitive needed: `peer-quality.store.ts` + `useSyncExternalStore`, `room-tracker.ts`, per-concern hooks in `@zvonok/react`, TanStack Query. The refactor is formalizing and extending what exists, not adding infrastructure. Recommended: no new dependency (a ~30-line `useStoreSelector` clone replaces what `react-tracked`/Zustand would provide).

## 2. Current state (audit)

### 2.1 Context inventory

| Context | File | Holds | Notes |
|---|---|---|---|
| `AuthContext` | `apps/client/src/features/auth/contexts/auth.context.tsx` | user, auth actions | consumed at point of use elsewhere - good |
| `DevAuthContext` | `apps/client/src/features/console/contexts/dev-auth.context.tsx` | dev token, `isLoading` | `isLoading` starts `true` then a mount effect flips it although the token read is synchronous |
| `ZvonokSessionContext` | `packages/react/src/zvonok-context.tsx` | manager, status, `update()` | single context; every `status` change re-renders all consumers |
| `MediaStreamContext` | `apps/client/src/features/media/contexts/media-stream.context.tsx` | mirrors of mediaManager events in 4 `useState`s | `mountedRef` dance exists only because of the mirrors |
| `PeerQualityContext` | `apps/client/src/features/room/contexts/peer-quality.context.tsx` | external `PeerQualityStore` | the good pattern: store + `useSyncExternalStore` + per-peer selectors (`peer-quality.store.ts:67-75`) |
| `RoomAudioContext` | `apps/client/src/features/room/contexts/room-audio.context.tsx` | active speaker id, per-user levels | high-frequency data in context - the typing-context trap |
| `GuestRequestsContext` | `apps/client/src/features/room/contexts/guest-requests.context.tsx` | SDK hook + REST actions | fine |

TanStack Query usage is consistent (centralized query keys, feature hooks). No other store exists.

### 2.2 Prop drilling (verified chains)

1. **`session` blob** (`UseRoomSessionResult`): `room-view.tsx:29` -> `active-room-view.tsx:36-60` (receives whole object, destructures) -> fans out into three control bars: `RoomLeftControls` (8 props, `active-room-view.tsx:414-422`), `RoomCenterControls` (11 props, `:424-436`), `RoomRightControls` (9 props, `:437-455`). All of it originates from one `useRoomSession` call one level up.
2. **`currentUserId`**: `routes/room.tsx:106` -> `room-view.tsx` (unused there) -> `active-room-view.tsx:39` -> `ParticipantsList` (`:384`) -> `ChatPanel` -> `MessageList` -> `MessageBubble`. `chat-panel.tsx:28-35` is a pure forwarding shell: all 6 props pass through, zero local logic. Identity already lives in `AuthContext`.
3. **`displayName`/`currentUsername`**: same route -> `room-view.tsx:50` -> `active-room-view.tsx:40` -> `RoomVideo username` -> audio overlay.
4. **`connection`** (`UseZvonokConnectionResult`): `room-view.tsx:19` receives it solely to hand it to `useRoomSession` (`:29`).
5. **`isOwner` computed twice** independently: `room-view.tsx:28` and `active-room-view.tsx:183` - drift risk.
6. **Passthrough callbacks**: `handleToggleVideo/handleToggleAudio` (`active-room-view.tsx:175-181`) wrap SDK calls only to forward them to controls and shortcuts.
7. `packages/react/src/prebuilt/ZvonokRoom.tsx` internally drills join callbacks through `ZvonokRoomSurface` -> `PreJoinCard` and 6 derived props per `RoomTile`; package-internal, lower priority.

### 2.3 useEffect census (~65 in non-test files)

- **(a) State-sync-from-props / derived state** - 3, all verified:
  - `routes/room.tsx:119-134` - `guestCheck` promise into `setGuestPreApproved`/`setDisplayName`; fetching in an effect on a page that already uses `useRoom`.
  - `routes/room.tsx:137-145` - `getRoomMe` into `setGuestUserId`; same, and it is the reason `currentUserId` is late-resolving state at all.
  - `active-room-view.tsx:261-265` - `screenShareState` synced from `isSharing` by an effect: two sources of truth for one state machine; derive it instead.
- **(b) Fetching that duplicates TanStack Query** - `use-chat.ts:43-90`: chat history over socket acks into 4 `useState`s (`messages/hasMore/isLoading/unreadCount`) - a hand-rolled query cache plus an inline subscription.
- **(c) Inline subscriptions in components**: `media-stream.context.tsx:50-68` mirrors `onVideoStateChange/onAudioStateChange` into two state pairs (duplicates the single-snapshot approach of `use-device-controls.ts` in `packages/react`); `active-room-view.tsx:145-173` has a ResizeObserver inline in a 459-line component; `use-chat.ts:39-41` mirrors `currentUserId` into a ref.
- **(d) Legitimate DOM effects** (srcObject attachment, scroll management) - 8, fine.
- **(e) Run-once/mount effects**: `media-stream.context.tsx:43-48` (`mountedRef` - dies with the mirrors), `theme-switcher.tsx` (initial state from effect instead of lazy `useState` initializer), `dev-auth.context.tsx` (`isLoading` flipped in a mount effect).

**Patterns already done right** (reuse, do not reinvent): `peer-quality.store.ts:67-75` (`useSyncExternalStore` + per-peer subscription), `room-tracker.ts` + `use-participants.ts` (pub/sub tracker, zero per-event React state), `use-audio-activity.ts` (refcounted engine), `use-zvonok-connection.ts` (lifecycle in one hook, `leaveRef` for unmount), the `room-panels.ts` descriptor/plugin pattern for room overlays.

## 3. stream-chat-react patterns

### 3.1 `useStateStore`: selector subscription over an external store (highest value)

`StateStore` is a plain observable POJO holder; the React hook wraps it in `useSyncExternalStore`: `subscribeWithSelector(selector, onStoreChange)` notifies only when the selected slice changes, and a memoized snapshot closure shallow-compares the selection per key and returns the old reference when the slice is semantically unchanged (no snapshot loops). Result: `const { attachments } = useStateStore(attachmentManager.state, selector)` - components re-render only for their slice and receive zero props for it.
Source: [src/store/hooks/useStateStore.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/store/hooks/useStateStore.ts) (verified verbatim).

### 3.2 State/action context split per domain

`Channel` provides two sibling contexts: `ChannelStateContext` is pure data (`messages`, `read`, `watcherCount`...), `ChannelActionContext` is pure functions (`loadMore`, `markRead`, `sendMessage`...). Action identities are stable, so action-only consumers (buttons) never re-render when state changes.
Sources: [ChannelStateContext.tsx](https://github.com/GetStream/stream-chat-react/blob/master/src/context/ChannelStateContext.tsx), [ChannelActionContext.tsx](https://github.com/GetStream/stream-chat-react/blob/master/src/context/ChannelActionContext.tsx).

### 3.3 Custom hooks as the component API

Behavior other codebases pass as callback props lives in hooks that read contexts themselves: `useMarkRead`, `useUserRole` (derives from `channelCapabilities`), `useReactionHandler`, `useEditMessageHandler`, composer bindings. Leaf components take only visual props; `Message`/`MessageList` trees pass a handful, not dozens.
Example: [useMarkRead.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageList/hooks/useMarkRead.ts).

### 3.4 Event subscriptions live in the store layer, registered once

`useChat` calls `client.threads.registerSubscriptions()` etc. once per client with matching unregister in cleanup; the composer registers subscriptions in one controller hook. UI components never attach listeners - they read `composer.state` slices via `useStateStore`. Docs state the model: client state is non-reactive; UI subscribes to slices.
Sources: [useChat.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Chat/hooks/useChat.ts), [useMessageComposerController.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageComposer/hooks/useMessageComposerController.ts), [state management guide](https://getstream.io/chat/docs/sdk/react/guides/sdk-state-management/).

### 3.5 Event emitter -> `useSyncExternalStore` without any `setState`

`useSelectedChannelState`: `subscribe` maps event keys to `channel.on(et, () => onStoreChange(selector(channel)))`; `getSnapshot` is just `selector(channel)`. No `useState`, no derived-sync effect - React owns consistency. Works over any emitter.
Source: [useSelectedChannelState.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/ChannelList/hooks/useSelectedChannelState.ts) (verified verbatim).

### 3.6 High-frequency state gets its own context

Typing state is carved out of `ChannelStateContext` (`Omit<ChannelState, 'typing'>`) into `TypingContext`, whose value identity changes only when the *set* of typists changes. `TypingIndicator` reads only that.
Sources: [useCreateTypingContext.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Channel/hooks/useCreateTypingContext.ts), [TypingContext.tsx](https://github.com/GetStream/stream-chat-react/blob/master/src/context/TypingContext.tsx). Our analog: `RoomAudioContext` (audio levels) must not share a context with participants.

### 3.7 `useCreate*Context` memoization - and its dark side

Context values are built with primitive-signature memo deps (`channelCid`, counts) so mutated-but-equal SDK objects don't invalidate them. But to keep `messages` stable they serialize every message into a memo dep, with the maintainer's own comment: "FIXME: this is crazy ... A great example of memoization gone wrong" ([useCreateChannelStateContext.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Channel/hooks/useCreateChannelStateContext.ts)). Lesson: signature-memoization is the legacy half-measure they are migrating away from, toward 3.1.

### 3.8 Connection bootstrap owned by one hook

`useCreateChatClient` connects inside one effect with an interrupt flag (cleanup disconnects the in-flight client); `Chat` renders `null` until the client exists. No `isConnected` boolean drilled through the tree, no per-consumer connect effects.
Source: [useCreateChatClient.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Chat/hooks/useCreateChatClient.ts).

### 3.9 Selector discipline as documented contract

Docs codify: selectors return a named object, live at module scope or are `useCallback`-memoized (unstable selectors cause resubscribe cycles), never build new arrays/objects; break components into the smallest reasonable parts ([guide](https://getstream.io/chat/docs/sdk/react/guides/sdk-state-management/)). Worth copying into `@zvonok/react` docs.

## 4. @videosdk.live/react-native-sdk patterns

Provenance: npm latest 1.0.1 ships readable ESM ([registry](https://registry.npmjs.org/@videosdk.live/react-native-sdk)) but is a thin native bridge over `@videosdk.live/react-sdk@1.1.1`, which ships minified JS with a **sourcemap containing full original source** ([index.js.map](https://unpkg.com/@videosdk.live/react-sdk@1.1.1/dist/index.js.map)). The 2.0.0-beta chain delegates to the fully readable [hooks-core](https://unpkg.com/@videosdk.live/hooks-core@0.0.1-beta.2/dist/esm/createHooksBundle.js). GitHub org has examples only; SDK source is closed.

### 4.1 `useStableEvent`: one stable listener, fresh handler via ref

`handlerRef.current = handler` every render; a single `useEffect([eventName])` registers one unchanging wrapper and returns `emitter.off` as cleanup. `useMeeting` is ~40 consecutive `useStableEvent` calls - no resubscribe churn on callback identity change, no stale closures.
Source: [createStableEventHook.js](https://unpkg.com/@videosdk.live/hooks-core@0.0.1-beta.2/dist/esm/hooks/createStableEventHook.js) (verified verbatim).

### 4.2 Engine -> store translation happens exactly once, in the Provider

`MeetingProviderInner`'s `join()` attaches ~45 engine listeners and per-participant listeners that dispatch store actions and re-emit namespaced per-id topics; listener pairs are tracked in a ref Map and detached on `meeting-left`/unmount. App components never call `.on()` and contain no subscription effects.
Source: react-sdk sourcemap `../src/meeting/MeetingProvider.js` (join-time attach ~1102-1173, unmount detach ~1374-1384); hooks-core equivalent: [createMeetingProvider.js](https://unpkg.com/@videosdk.live/hooks-core@0.0.1-beta.2/dist/esm/hooks/tier2/createMeetingProvider.js).

### 4.3 Split contexts: methods, tracked state, and a live state ref

Three contexts instead of one fat value: a methods context (stable `useMemo` functions), a react-tracked container (proxy-tracked property-level subscriptions), and a "live state" context holding a **ref** to the latest committed state, maintained by a renderless `StateRefSync` child that alone subscribes to full state. Any hook can read current values inside event handlers/timeouts without subscribing - which deletes every `useEffect(() => { ref.current = state })` mirror.
Source: react-sdk sourcemap `../src/meeting/MeetingProvider.js` (provider tree ~1394-1423).

### 4.4 One Proxy-merged hook object: tracked state + stable methods

`useMeeting()` / `useParticipant(id)` return a memoized `Proxy`: state keys subscribe via the tracked proxy, method keys hit a methods ref (stable identity, no subscription). Consumers destructure freely: `const { participants, join } = useMeeting()`. The RN package extends the web hooks with the same Proxy trick (`RN_EXTRAS`) without forking.
Source: react-sdk sourcemap `../src/participant/useParticipant.js` (~306-377); RN wrapper: [index.js](https://unpkg.com/@videosdk.live/react-native-sdk@1.0.1/index.js).

### 4.5 Per-participant hook over a keyed store + per-id event topics

Participant state is one flat record keyed by id; central translation re-emits `${event}-${participantId}` topics on a shared emitter. `useParticipant(id, { onStreamEnabled })` subscribes to exactly that id's topics and record; `<ParticipantView id={id} />` needs only the `id` prop - everything else comes from the hook.
Source: react-sdk sourcemap `../src/participant/participantStateContext.js`, `../src/utils.js` (events map, `setMaxListeners(9999)` - they knew listener count scales with participants).

### 4.6 `usePubSub`: ref buffers + version counter + race-safe async subscribe

Messages accumulate in refs (not state); each batch bumps a version counter so `messages` identity changes only on real mutations. Options for scale: `maxMessages` FIFO cap, `bufferMessages: false` (callback-only, never renders). The subscribe effect handles the hard cases we hit too: `isSubscribed` guard against double-fire, a `cancelled` flag undoing an in-flight async subscribe when cleanup ran first ("React 18 StrictMode does exactly that on every mount" - still true in React 19 dev), failed-subscribe reset for retry, and `.catch` on unsubscribe (unhandled rejection becomes a React error overlay).
Source: react-sdk sourcemap `../src/pubSub/usePubSub.js`; RN copy ships readable: [usePubSub.js](https://unpkg.com/@videosdk.live/react-native-sdk@1.0.1/src/pubSub/usePubSub.js).

### 4.7 Engine-agnostic hooks via factory injection

`createHooksBundle({ emitter })` returns the whole hook set wired to one emitter; `createMeetingProvider` takes SDK-specific `onInit`/`createMeeting` as injected props, so web and RN share identical React code over different engines. Hooks tier: per-id (tier1) -> meeting (tier2) -> features (tier3).
Source: [createHooksBundle.js](https://unpkg.com/@videosdk.live/hooks-core@0.0.1-beta.2/dist/esm/createHooksBundle.js).

### 4.8 Antipatterns in their own shipped code - avoid

`useMediaDevice` (RN 1.0.1) registers a native listener in a mount-once effect calling the callback captured at mount (new callback silently ignored), cleans up with `removeAllListeners` on a shared emitter (nukes other components' listeners), and smuggles an unrelated global side effect (`InCallManager.start()`) into the same effect. RN `MeetingProvider` gates children on a one-shot fetch effect (children flash out of existence) and constructs an E2EE manager during render (module-state mutation). None of this in the newer hooks-core.

## 5. Adoption plan (mapped to our code)

Ordered by leverage; each step is independently shippable.

1. **`useStoreSelector(store, selector)` in `@zvonok/react`** - a `useStateStore` clone (~30 lines: `subscribeWithSelector`-style notification + memoized shallow-compare snapshot). Apply it to `PeerQualityStore` (replace `usePeerQuality`'s hand-rolled pair), room tracker, and any future high-frequency store. Keep zero new deps; the hand-rolled store in `peer-quality.store.ts` proves the shape.
2. **Kill identity drilling** - `ParticipantsList`, `ChatPanel`, `MessageBubble`, `RoomVideo` read `currentUserId`/`displayName` from `AuthContext` (or a `RoomIdentityContext` fed once by the guest-id query) instead of receiving them as props. Deletes chains 2-3 above and the double `isOwner` (derive once, or compute at point of use from context).
3. **`RoomSessionContext` split state/actions** - provider in `room-view.tsx` holds the `useRoomSession` result; expose `useRoomSessionState()` (media states, participants, capabilities) and `useRoomSessionActions()` (toggles, host controls). `ActiveRoomView` and the three control bars consume contexts instead of receiving 11-prop blobs; delete the passthrough `useCallback` wrappers (the actions are already stable SDK calls).
4. **Chat: context + query** - `ChatProvider` owns the socket; `ChatPanel`/`MessageList`/`MessageInput` consume it (deletes the 6/6 forwarding shell). History becomes `useInfiniteQuery` (server already paginates `chat:history`), live messages stay a subscription, `unreadCount` lives in the same context with `resetUnreadCount`. Copy `usePubSub`'s StrictMode/`cancelled`/version-counter discipline for the live part. The `currentUserIdRef` mirror (`use-chat.ts:39-41`) dies with the videosdk "live state ref" pattern (one `StateRefSync`-style provider child instead of per-hook ref effects).
5. **`useStableEvent` in `@zvonok/react`** - adopt for every socket/manager subscription hook; then `use-guest-join-requests` and `use-room-sfu` guards can collapse to store + stable listeners.
6. **Replace fetch-in-effects in `routes/room.tsx`** - `guestCheck` -> `useQuery(['guest-check', slug], { enabled: !user })`; `getRoomMe` -> `useQuery(['room-me', slug], { enabled: viewState === 'active' })`; derive `currentUserId` as `user?.id ?? roomMe?.userId` (a `const`, not state). This also removes the late-identity problem that motivated the ref mirror in chat.
7. **Local cleanups** - extract `use-element-size` from `active-room-view.tsx:145-173`; derive `screenShareState` instead of syncing it (`:261-265`); lazy `useState` initializers in `theme-switcher`/`dev-auth`; drop the `mountedRef` mirrors in `media-stream.context.tsx` by moving it onto a store like peer-quality.
8. **Structural, opportunistic** - `@zvonok/react` hooks keep depending on an injected client/emitter interface (they already do via `useZvonokSession`); the `createHooksBundle` factory shape is worth copying only when a second consumer of the bindings appears. Do not build it speculatively.

Guardrails from stream-chat's selector rules: selectors return named objects, live at module scope or `useCallback`; never create new arrays/objects per call; high-frequency data (audio levels, quality) stays in its own store/context and never joins participant state.

## 6. What not to copy

- stream-chat's legacy `Channel.tsx` mirror-reducer (throttled `copyStateFromChannelOnEvent`, giant `handleEvent` switch, a `setState`-from-derived-state thread-sync effect, and an unbalanced `client.on('user.messages.deleted')` without `off` in cleanup) - this is the machinery `useStateStore` replaces.
- Signature-string memoization of context values (`useCreateChannelStateContext`) - "memoization gone wrong" by their own comment.
- Videosdk's mount-once listener effects that ignore callback identity, `removeAllListeners` on shared emitters, provider gating that unmounts children for async setup (prefer a `status: 'connecting'` context value), render-time module mutation.
- The double `LegacyThreadContext`/`ThreadContext` migration cruft.

## 7. Sources

- Audit: `apps/client/src`, `packages/react/src` (this repo, 2026-09-13; line refs verified against working tree).
- stream-chat-react @ `master`: [useStateStore.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/store/hooks/useStateStore.ts), [ChannelStateContext.tsx](https://github.com/GetStream/stream-chat-react/blob/master/src/context/ChannelStateContext.tsx), [ChannelActionContext.tsx](https://github.com/GetStream/stream-chat-react/blob/master/src/context/ChannelActionContext.tsx), [useMarkRead.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageList/hooks/useMarkRead.ts), [useChat.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Chat/hooks/useChat.ts), [useMessageComposerController.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageComposer/hooks/useMessageComposerController.ts), [useSelectedChannelState.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/ChannelList/hooks/useSelectedChannelState.ts), [useCreateTypingContext.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Channel/hooks/useCreateTypingContext.ts), [useCreateChannelStateContext.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Channel/hooks/useCreateChannelStateContext.ts), [useCreateChatClient.ts](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Chat/hooks/useCreateChatClient.ts), [Channel.tsx](https://github.com/GetStream/stream-chat-react/blob/master/src/components/Channel/Channel.tsx), [state management guide](https://getstream.io/chat/docs/sdk/react/guides/sdk-state-management/).
- @videosdk.live: [registry metadata](https://registry.npmjs.org/@videosdk.live/react-native-sdk), [RN 1.0.1 index.js](https://unpkg.com/@videosdk.live/react-native-sdk@1.0.1/index.js), [RN usePubSub.js](https://unpkg.com/@videosdk.live/react-native-sdk@1.0.1/src/pubSub/usePubSub.js), [RN useMediaDevice.js](https://unpkg.com/@videosdk.live/react-native-sdk@1.0.1/useMediaDevice.js), [react-sdk 1.1.1 sourcemap](https://unpkg.com/@videosdk.live/react-sdk@1.1.1/dist/index.js.map) (MeetingProvider.js, meetingProviderContextDef.js, useParticipant.js, participantStateContext.js, utils.js, usePubSub.js), [hooks-core createHooksBundle.js](https://unpkg.com/@videosdk.live/hooks-core@0.0.1-beta.2/dist/esm/createHooksBundle.js), [createStableEventHook.js](https://unpkg.com/@videosdk.live/hooks-core@0.0.1-beta.2/dist/esm/hooks/createStableEventHook.js), [createMeetingProvider.js](https://unpkg.com/@videosdk.live/hooks-core@0.0.1-beta.2/dist/esm/hooks/tier2/createMeetingProvider.js).
