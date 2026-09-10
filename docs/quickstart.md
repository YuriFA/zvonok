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

Two ways to render the room: the drop-in `ZvonokRoom` component (next), or
the headless hooks (the rest of this section) when you want full control of
the UI.

### Drop-in: ZvonokRoom

`main.jsx`:

```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ZvonokRoom } from "@zvonok/react";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ZvonokRoom
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
The widget imports its own stylesheet (`zvonok.css`, all classes `zvk-`
prefixed); for manual stylesheet control it is also exported as
`@zvonok/react/zvonok.css`.

### Theming the prebuilt

`ZvonokRoom` reads a small set of CSS custom properties. Define them on any
ancestor of the widget (or on `:root`) to brand it - no JavaScript, no props:

```css
:root {
  --zvonok-accent-color: #4f46e5;
  --zvonok-background-color: #0b0d12;
  --zvonok-text-color: #f4f4f5;
  --zvonok-radius: 14px;
  --zvonok-font-family: "Inter", system-ui, sans-serif;
}
```

| Variable | Default | Controls |
| --- | --- | --- |
| `--zvonok-accent-color` | `#2f6f4f` | Join button, input focus ring |
| `--zvonok-background-color` | `#16181d` | Room and input background |
| `--zvonok-text-color` | `#e6e8eb` | Text and button labels |
| `--zvonok-radius` | `10px` | Corner radius (tiles scale with it) |
| `--zvonok-font-family` | `system-ui, ...` | Widget font |

Without overrides the widget renders with its built-in defaults; the
variables only ever read, never leak globally. Renaming a variable is a
breaking change.

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

## What the SDK exposes

- `ZvonokProvider` - carries the server URL and the shared media manager
- `ZvonokRoom` - drop-in meeting room component (see the drop-in variant
  in step 3); renders its own provider from a `serverUrl` prop
- `useZvonokConnection({ roomSlug, token })` - join lifecycle plus publishing
  controls (`produceTrack`, `pauseProducer`, `resumeProducer`, `replaceTrack`)
  and the underlying `manager` for advanced use
- `useParticipants()` - remote participants with their camera/screen/audio
  streams and enabled flags
- `useOwnCapabilities()` - the server-delivered capability list for the local
  participant (empty until join); gate UI on membership, e.g.
  `capabilities.includes("mute-users")`
- `useHostControls()` - `mutePeer`, `muteAll`, `lockRoom`, `kickPeer` for
  participants whose capabilities include the matching moderation right;
  every action settles on the server's acknowledgement
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
