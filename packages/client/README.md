# @zvonok/client

Headless TypeScript core for ZvonOK video rooms: SFU connection, media
capture, device management, and screen share over mediasoup + Socket.io.
Framework-free; the React layer lives in [`@zvonok/react`](https://www.npmjs.com/package/@zvonok/react).

## Install

```bash
npm i @zvonok/client
```

## Usage

No barrel file - import from subpaths:

```ts
import { createSfuManager } from "@zvonok/client/sfu/manager";
import { createMediaManager } from "@zvonok/client/media/manager-factory";
```

The public surface is exactly the `exports` map in `package.json`; modules
outside it are implementation details. There are no published test doubles -
drive the real modules with fake transports instead.

## Docs

Full walkthrough for external consumers: `docs/quickstart.md` in the
[repository](https://github.com/YuriFA/zvonOK).

## License

MIT
