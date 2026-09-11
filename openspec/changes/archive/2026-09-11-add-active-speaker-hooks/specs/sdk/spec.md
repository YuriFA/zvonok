# sdk

## ADDED Requirements

### Requirement: Audio activity hooks
`@zvonok/react` SHALL expose audio-activity state over the room's audio
participants, computed client-side from local and remote audio tracks with
no new signalling: an active-speaker hook reporting the currently speaking
participant's id or `null` in silence (including the local participant while
they publish audio), and an audio-levels hook reporting a smoothed level in
0..1 per audio-active participant id. When no audio tracks exist the hooks
SHALL report `null` and an empty collection respectively, and they SHALL
clean up their sampling resources when the room is left.

#### Scenario: Active speaker switches
- **WHEN** participant B becomes and stays louder than the current speaker A
- **THEN** the active-speaker hook reports B's id after the detector's switch window, without the consumer wiring any audio analysis

#### Scenario: Silence reports null
- **WHEN** no participant produces audio above the speaking threshold
- **THEN** the active-speaker hook reports `null` after the detector's hold time

#### Scenario: Local participant included
- **WHEN** the local participant is publishing microphone audio and speaks
- **THEN** the active-speaker hook can report the local participant's id

#### Scenario: Levels track every audio participant
- **WHEN** remote participants publish audio alongside the local microphone
- **THEN** the audio-levels hook reports a level for each audio-active participant id, local included
