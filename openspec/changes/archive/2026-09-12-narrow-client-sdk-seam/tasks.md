## 1. Public surface

- [x] 1.1 Prune `packages/client/package.json` exports to the agreed public set; add a resolve-smoke check that every listed subpath imports and every internal one does not
- [x] 1.2 Add `createSfuManager(options)` factory (composes `SfuConnection` internally; options: server URL, identity, socket factory override) and export it from `sfu/manager`
- [x] 1.3 Delete `sfu/interfaces.ts`; move contract JSDoc onto `SfuManager`; migrate the 7 `ISfuManager` imports in `packages/react` to the class type
- [x] 1.4 Delete `sfu/__mocks__/manager.ts` and `screen-share/__mocks__/service.ts`
- [x] 1.5 Delete the unimplemented role interfaces (`ICaptureStateReader`, `ICaptureController`, `ICaptureTrackProvider`) from `media/interfaces.ts`

## 2. State and connection ownership

- [x] 2.1 Shrink `SfuState` to `connectionState`, `capabilities`, `egress`, `lastBroadcast`, `{audio,video,screen}ProducerId`, `isScreenShareBlocked`; move the four transport/device flags into manager internals
- [x] 2.2 Switch `use-zvonok-connection.ts` to `createSfuManager` and drop its direct `SfuConnection` assembly

## 3. Consumers and tests

- [x] 3.1 Re-point `peer-quality.context.test.tsx` from `createMockSfuManager` to the socket-level fake pattern
- [x] 3.2 Update any remaining mock/role-interface imports surfaced by typecheck

## 4. Verification

- [x] 4.1 `pnpm -C packages/client test` and `pnpm -C packages/react test` green
- [x] 4.2 `pnpm -C apps/client typecheck` and `test` green
- [x] 4.3 Resolve-smoke proof: public subpaths import, `sfu/connection`, `sfu/interfaces`, both `__mocks__` paths fail to resolve
- [x] 4.4 `pnpm openspec:validate` passes with the change staged
