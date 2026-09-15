# Zvonok Quickstart

Add Zvonok video rooms to any React app in five minutes: create a room via the
REST API, mint a participant token, and join it with the `@zvonok/react` SDK.

Prerequisites:

- A Zvonok server you can reach (self-hosted - see `docs/deployment.md`)
- An API key from a developer account (register via `POST /developers/auth/register`,
  create a project, then an API key - the full key is shown exactly once)

This walkthrough uses `https://your-zvonok-server.example` as the server base
URL. Replace it with your deployment's address everywhere below.

## 1. Create the project

```bash
mkdir my-video-app && cd my-video-app
npm init -y
npm i @zvonok/react react react-dom vite @vitejs/plugin-react
```

## 2. Create a room and mint a token

The platform API is key-authenticated. Create a room, then mint a short-lived
token for a participant:

```bash
export ZVONOK_URL=https://your-zvonok-server.example
export ZVONOK_KEY=zk_live_your_api_key

# Create a room (returns id and slug)
curl -s -X POST "$ZVONOK_URL/v1/rooms" \
  -H "Authorization: Bearer $ZVONOK_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "My first room"}'

# Mint a token for the room (use the id from the response above)
curl -s -X POST "$ZVONOK_URL/v1/rooms/<roomId>/tokens" \
  -H "Authorization: Bearer $ZVONOK_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}'
```

Both endpoints return JSON; keep the room `slug` and the token `token` value
from the responses. Tokens expire (default TTL is configured on the server),
so mint a fresh one per session.

## 3. Join the room from React

Two ways to render the room: the embedded entry (next), or the headless
hooks (the rest of this section) when you want full control of the UI.

### Embedded: ZvonokEmbeddedRoom

`main.jsx`:

```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@zvonok/react/css/component-kit.css";
import "@zvonok/react/css/embedded.css";
import { ZvonokEmbeddedRoom } from "@zvonok/react/embedded";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ZvonokEmbeddedRoom
      serverUrl="https://your-zvonok-server.example"
      roomSlug="<slug from step 2>"
      token="<token from step 2>"
    />
  </StrictMode>,
);
```

That is the whole app: pre-join card, video grid, and mic, camera, screen
share, and leave controls. Pass `displayName` to skip the pre-join card,
`onLeft` to react to leaving, and `onError` to observe typed join failures.
`layout="spotlight"` switches the stage to a derivation-driven spotlight
arrangement, and `children` render alongside the stage.

The widget needs its two stylesheets imported once
(`@zvonok/react/css/component-kit.css` and
`@zvonok/react/css/embedded.css`); it puts the `zk` namespace class on its
roots itself.

### Theming the embedded room

The styling contract is token-first: every color, radius, and font parameter
is a `--zk-*` CSS custom property defined on the `.zk` namespace class.
Override the tokens on any ancestor of the widget (or on `:root`) to brand
it - no JavaScript, no props:

```css
:root {
  --zk-color-accent: #4f46e5;
  --zk-color-background: #0b0d12;
  --zk-color-text: #f4f4f5;
  --zk-radius: 14px;
  --zk-font-family: "Inter", system-ui, sans-serif;
}
```

| Token | Default | Controls |
| --- | --- | --- |
| `--zk-color-accent` | `#2f6f4f` | Join button, input focus ring |
| `--zk-color-background` | `#16181d` | Room and input background |
| `--zk-color-text` | `#e6e8eb` | Text and button labels |
| `--zk-radius` | `10px` | Corner radius (tiles scale with it) |
| `--zk-font-family` | `system-ui, ...` | Widget font |

The full token set lives at the top of `component-kit.css`. Without
overrides the widget renders with its built-in defaults. The stable
contract: the exports map, props, hooks, and token names - the preset's
class names and DOM are not and may change in any release.

### Headless: provider + hooks

`index.html`:

```html
<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.jsx"></script>
  </body>
</html>
```

`main.jsx`:

```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ZvonokProvider, useZvonokConnection, useParticipants } from "@zvonok/react";

const SERVER_URL = "https://your-zvonok-server.example";
const ROOM_SLUG = "<slug from step 2>";
const TOKEN = "<token from step 2>";

function Room() {
  const { status, error, join, leave } = useZvonokConnection({
    roomSlug: ROOM_SLUG,
    token: TOKEN,
  });
  const { participants } = useParticipants();

  if (status === "disconnected") {
    return <button onClick={join}>Join room</button>;
  }
  if (status === "connecting") return <p>Connecting...</p>;
  if (status === "error") return <p>Join failed: {error?.message}</p>;

  return (
    <div>
      <p>
        Joined with {participants.length} remote participant(s){" "}
        <button onClick={leave}>Leave</button>
      </p>
      <ul>
        {participants.map((p) => (
          <li key={p.userId}>
            {p.displayName} - camera {p.isCameraEnabled ? "on" : "off"}
          </li>
        ))}
      </ul>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ZvonokProvider serverUrl={SERVER_URL}>
      <Room />
    </ZvonokProvider>
  </StrictMode>,
);
```

Run it:

```bash
npx vite
```

Open the printed localhost URL in two browser windows (mint a second token for
the second window) - both participants land in the same room with live
participant events.

## 4. React to anything: the data channel

Every connected participant (except viewers) can broadcast ephemeral JSON
messages on a topic, and subscribe to other participants' messages - the
transport for reactions, custom sync, or driving an external UI:

```jsx
import { useBroadcast, useBroadcasts } from "@zvonok/react";

function Reactions() {
  const { send } = useBroadcast();               // ack-settled send action
  const { messages } = useBroadcasts("reactions"); // topic-filtered receive

  return (
    <div>
      <button onClick={() => send("reactions", { emoji: "wave" })}>
        Wave
      </button>
      <ul>
        {messages.map((m) => (
          <li key={m.timestamp + m.senderId}>
            {m.senderId}: {m.payload.emoji}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

The rules:

- `send` resolves on the server's acknowledgement and rejects with a typed
  `ZvonokBroadcastError` on denial: `MISSING_CAPABILITY` without the
  `send-data-message` capability (host and participant roles have it,
  viewers do not), `PAYLOAD_TOO_LARGE` over 8192 serialized bytes,
  `INVALID_TOPIC` outside 1-64 chars of `[A-Za-z0-9._-]`
- the server relays to every *other* participant - you never receive your
  own message back
- delivery is ephemeral: no persistence, no replay for late joiners;
  per-sender ordering follows their socket

## 5. Surviving network blips

Signalling drops no longer end the call. After a successful join the SDK
recovers automatically: the status moves to `reconnecting`, local camera
and microphone tracks are kept alive (never re-acquired), and when the
socket returns the SDK rejoins the same room, rebuilds transports,
republishes your tracks, and resubscribes to everyone else - status back
to `joined`. No consumer code is involved.

The server holds a dropped participant's seat for 30 seconds: other
participants see no departure events and no `participant.left`/`participant.joined`
webhooks fire for the blip. If the peer does not return in time, the leave
flow runs with departure reason `disconnect`. A kicked participant is
terminal for the room's lifetime: their rejoin is refused with a
`KICKED_FROM_ROOM` denial and recovery stops.

One caveat for long calls: room tokens expire. Hand the hook a
`tokenProvider` and a rejoin denied for expiry is retried once with a
fresh token - the provider is never called for the initial join:

```jsx
const connection = useZvonokConnection({
  roomSlug,
  token,
  tokenProvider: async () => fetchFreshTokenFromYourBackend(),
});

// connection.status: "joined" | "reconnecting" | "error" | ...
```

Without a provider, an expired-token rejoin surfaces as a typed
`ZvonokJoinError` and the SDK stops retrying.

## What the SDK exposes

- `ZvonokProvider` - carries the server URL and the shared media manager
- `ZvonokEmbeddedRoom` - embedded meeting room (see the embedded variant
  in step 3); import from `@zvonok/react/embedded`; renders its own
  provider from a `serverUrl` prop
- `useZvonokConnection({ roomSlug, token })` - join lifecycle plus publishing
  controls (`produceTrack`, `pauseProducer`, `resumeProducer`, `replaceTrack`)
  and the underlying `manager` for advanced use
- `useActiveSpeaker()` - the currently speaking participant's id (or `null`
  in silence), computed from local and remote audio tracks client-side
- `useAudioLevels()` - smoothed 0..1 audio level per audio-active
  participant id, local microphone included
- `useParticipants()` - remote participants with their camera/screen/audio
  streams and enabled flags
- `useOwnCapabilities()` - the server-delivered capability list for the local
  participant (empty until join); gate UI on membership, e.g.
  `capabilities.includes("mute-users")`
- `useHostControls()` - `mutePeer`, `muteAll`, `lockRoom`, `kickPeer` for
  participants whose capabilities include the matching moderation right;
  every action settles on the server's acknowledgement
- `useBroadcast()` / `useBroadcasts(topic)` - the data channel: send an
  ack-settled broadcast on a topic and receive other participants' messages
  filtered to one topic (see step 4)
- `useZvonokConnection({ roomSlug, token, tokenProvider? })` - join lifecycle
  with automatic blip recovery: `reconnecting` status, silent server-side
  seat hold (30s), track republish on return, optional one-shot token
  refresh (see step 5)
- `useQualityControls()` - manual simulcast preference per remote participant:
  `setParticipantQuality(userId, "low" | "medium" | "high")`; affects only
  your own subscription, never audio or other subscribers

## Next steps

- Host controls require the host role on the token: request it when minting
  (`"role": "host"` in the token payload); the server resolves the role to
  capabilities and delivers them with the join acknowledgement
- Room lifecycle (end room, list rooms) lives in the same `/v1` API
- Everything above works against a locally running server too
  (`http://localhost:3000`)

## Webhooks

Want your backend to know what happens in a room without polling? Configure a
webhook endpoint for your project (developer API, bearer = developer session
token):

```bash
curl -X PUT "$ZVONOK_URL/developers/projects/<projectId>/webhooks" \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-backend.example/zvonok/webhooks"}'
```

The response contains your signing secret. The full event list, delivery
headers, and retry policy live in the [API reference](/api-reference). Verify
every delivery before trusting it:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(req, rawBody, secret) {
  const [tsHeader, sigHeader] = [
    req.headers["x-zvonok-timestamp"],
    req.headers["x-zvonok-signature"],
  ];
  const expected = createHmac("sha256", secret)
    .update(`${tsHeader}.${rawBody}`)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(`sha256=${expected}`),
    Buffer.from(sigHeader),
  );
}
```

Respond `2xx` as soon as you have persisted the event - retry and drop
behavior are covered in the [API reference](/api-reference).
