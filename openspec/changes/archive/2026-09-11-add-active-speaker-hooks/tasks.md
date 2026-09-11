# Tasks: add-active-speaker-hooks

## 1. React hook module

- [x] 1.1 Create `packages/react/src/use-audio-activity.ts`: a shared engine that subscribes to the session manager's track lifecycle, attaches `AudioLevelSampler` entries (owned for the local mic track, borrowed analysers for remote audio), ticks sampling on an interval, and feeds `ActiveSpeakerDetector`; expose `useActiveSpeaker()` and `useAudioLevels()` from it
- [x] 1.2 Export both hooks and their result types from `packages/react/src/index.ts`
- [x] 1.3 Unit tests: speaker switches to the loudest sustained participant; silence returns `null`; local mic participates; sampling stops on leave (no interval leak)

## 2. Docs and verification

- [x] 2.1 Add `useActiveSpeaker` / `useAudioLevels` bullets to the quickstart's "What the SDK exposes" list
- [x] 2.2 Verify: `packages/react` tsc + vitest green, `apps/client` tsc + vitest + oxlint + oxfmt green
