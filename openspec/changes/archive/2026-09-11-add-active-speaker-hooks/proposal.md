# Proposal: add-active-speaker-hooks

## Why

The platform gap audit (docs/research/platform-gap-audit.md, Gap 2) confirmed
that the audio-activity primitives are publicly exported from the core
package (`ActiveSpeakerDetector`, `AudioLevelSampler` under
`@zvonok/client/audio/*`) but the React layer exposes no hook for them. Both
reference platforms surface speaker state (VideoSDK `activeSpeakerId`, Stream
`dominantSpeaker` + `useDominantSpeaker`); every integrator building a
participant grid reinvents wiring the core already ships. The audit sized
this S: pure lift, zero server work.

This is change 1 of the coordinated 0.4.0 wave (1: active-speaker hooks →
2: participant metadata → 3: list pagination → 4: data channel →
5: SDK reconnection).

## What Changes

1. `@zvonok/react` gains `useActiveSpeaker()`: the currently speaking
   participant's id, or `null` in silence, computed with the core
   `ActiveSpeakerDetector` semantics (threshold, hold time, switch margin).
   The local participant is included while they publish audio.
2. `@zvonok/react` gains `useAudioLevels()`: a smoothed 0..1 audio level per
   audio-active participant id (local included), updated on a fixed tick
   while the room is joined.
3. Both hooks are pure client-side state over existing tracks - no server
   events, no new signalling, no capability gating. They follow the wave
   convention of discrete, single-purpose hooks.

## Capabilities

### Modified Capabilities

- `sdk`: the React binding's hook surface grows audio-activity state.

## Impact

- **packages/client**: adds `getLocalUserId()` to the manager interface so
  the local microphone is sampled under the server-verified participant id.
- **apps/server**: none.
- **Docs**: quickstart hook list.
- No breaking changes.
