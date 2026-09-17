# @zvonok/react

React bindings for the ZvonOK video platform: an embedded room entry and
headless hooks over [`@zvonok/client`](https://www.npmjs.com/package/@zvonok/client).

## Install

```bash
npm i @zvonok/react
```

Peer dependency: `react >= 18`.

## Embedded room

```jsx
// Styles: import once, before or with the component.
import "@zvonok/react/css/component-kit.css";
import "@zvonok/react/css/embedded.css";
import { ZvonokEmbeddedRoom } from "@zvonok/react/embedded";

<ZvonokEmbeddedRoom
  serverUrl="https://your-zvonok-server.example"
  roomSlug="my-room"
  token="<minted room token>"
/>;
```

## Headless hooks

```jsx
import { ZvonokProvider, useZvonokConnection, useParticipants } from "@zvonok/react";
```

`useHostControls()` adds `mutePeer`, `muteAll`, `lockRoom`, and `kickPeer`
for room tokens minted with the admin claim.

## Styling contract

Both stylesheets are required for the embedded room; the component puts the
`zk` namespace class on its roots itself. Colors, radii, and fonts are
`--zk-*` CSS custom properties defined on `.zk` - override them to brand the
room. The stable styling contract is the exports map, props, hooks, and
token names; the preset's class names and DOM are not.

## Docs

Full walkthrough for external consumers: `docs/quickstart.md` in the
[repository](https://github.com/YuriFA/zvonOK).

## License

MIT
