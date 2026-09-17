## 1. React package: layer moves

- [x] 1.1 Create `src/hooks/`, `src/contexts/`, `src/core/`, `src/wrappers/`; move the state-seam hooks and support modules listed in design.md's mapping table into `hooks/` (`zvonok-context`, `peer-quality-context` into `contexts/`; `tile`, `use-video-stream`, `use-sfu-track-sync`, `peer-quality-engine`, `use-viewport-quality` into `core/`; `capability-gate` into `wrappers/`); move-only, update package-relative imports, keep `src/index.ts` export paths working; `pnpm -C packages/react test` and typecheck green
- [x] 1.2 `src/index.ts` and `embedded/*` imports updated to the new paths; no public export name changed; grep shows no imports of the old root paths remaining

## 2. React package: blocks into components/

- [x] 2.1 Move each `prebuilt/` block into its own folder `src/components/<block>/` (behavior core + `-preset` together): `control-bar`, `media-controls`, `participants-panel`, `device-switcher`, `stage`, `status-cards`; delete `prebuilt/index.ts`; update `src/index.ts` to export the same public names from the new paths; `@zvonok/react/prebuilt` export surface either kept as a subpath re-export or removed together with app updates in the same commit
- [x] 2.2 Embedded room imports and package tests updated to `components/<block>/` paths; grep shows no `prebuilt/` references left in `packages/react`
- [ ] 2.3 Split `embedded/ZvonokEmbeddedRoom.tsx`: extract `PreJoinCard` and the failure/status card compositions into `embedded/` files; the room file remains the composer; embedded tests still green; `@zvonok/react/embedded` entry and props unchanged

## 3. React package: stylesheets

- [ ] 3.1 Split `css/component-kit.css` into per-block files (`css/component-kit/<block>.css`) aggregated by the same subpath entry files (`component-kit.css`, `embedded.css`); built CSS output and `--zk-*` tokens byte-compatible (no selector renames); package css test / smoke graph unchanged

## 4. Client package: manager split

- [ ] 4.1 Extract the join/session lifecycle slice from `sfu/manager.ts` into its own unit under `sfu/`; `createSfuManager` seam and `SfuManager` type unchanged; existing `sfu/__tests__` green
- [ ] 4.2 Extract publish and subscribe slices into their own units; same seam; tests green
- [ ] 4.3 Extract host/guest actions slice beside `event-router.ts`; same seam; tests green; `manager.ts` reduced to composition of the units (or deleted if fully decomposed)

## 5. App cutover

- [ ] 5.1 `apps/client` `participants-list.tsx` consumes the `ParticipantsPanel` projection (or `PanelParticipant[]` derived from it): delete the local `Participant` interface and `sortedParticipants` sort; `participant-item.tsx` consumes `PanelParticipant`; app list test updated, ordering assertions live in package tests
- [ ] 5.2 Audit remaining app room components against the single-source rule: each renders markup over package hooks/panels with no local control-state derivation, host-action handling, or status derivation; delete any found duplicates and their tests
- [ ] 5.3 Grep gate: no app import of package-private paths (`@zvonok/react/src/...`, `@zvonok/client/src/...`); app builds and tests green

## 6. Verification

- [ ] 6.1 `pnpm -C packages/react test`, `pnpm -C packages/client test`, app test suite, typecheck, and lint clean
- [ ] 6.2 Local smoke: embedder page with `ZvonokEmbeddedRoom` (join, device switch, host actions) and app room regression pass
- [ ] 6.3 `pnpm openspec:validate` clean
