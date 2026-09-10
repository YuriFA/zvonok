# Tasks: participant-vocabulary-and-quality

## 1. packages/client rename

- [x] 1.1 Rename public peer-named exports to participant equivalents (`SfuParticipantInfo`, `ISfuParticipantRegistry`, `remoteParticipants`, participant-lifecycle callback types, event-router public names); internals unchanged; update package exports map if paths move
- [x] 1.2 Update package unit tests to the new names; suites green

## 2. packages/react

- [x] 2.1 `useQualityControls()` hook: `setParticipantQuality(userId, "low"|"medium"|"high")` over `getVideoConsumerIdForUserId` + `setPreferredLayers`; typed error for ids without subscribed video; unit tests (per-level mapping applied, unknown-id error, audio unaffected)
- [x] 2.2 Align any peer-named re-exports with the participant vocabulary; tests green

## 3. apps/client migration

- [x] 3.1 Compiler-driven migration to renamed imports/types; suites and e2e green

## 4. Docs and verification

- [x] 4.1 Quickstart + docs-site examples use participant vocabulary and document the quality hook
- [x] 4.2 Full verification: packages suites, app lint/tsc/e2e
