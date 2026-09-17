/**
 * Remote-audio playout as one hook: every remote participant's audio plays
 * through a shared mixer (per-participant gain, output routing) - no
 * consumer-managed audio elements. Levels and the active speaker come from
 * the shared AudioActivityEngine, so the tree runs one sampling pipeline.
 */

import { RemoteAudioMixer } from "@zvonok/client/audio/remote-audio-mixer";
import { useCallback, useEffect, useRef } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";
import { useActiveSpeaker, useAudioActivityEngine, useAudioLevels } from "./use-audio-activity.js";
import { useParticipants } from "./use-participants.js";

export interface UseRemoteAudioOptions {
  /**
   * Includes the local microphone in level and active-speaker analysis.
   * The local track is only analysed, never played back. Without it the
   * engine analyses the manager's produced audio producer.
   */
  localAudio?: { userId: string; stream: MediaStream | null };
}

export interface UseRemoteAudioResult {
  /** Per-participant volume in 0..1; every participant starts at 1. */
  setVolume(userId: string, volume: number): void;
  /** Routes all remote playout to the given output device. */
  setSink(deviceId: string): Promise<boolean>;
  /** Smoothed 0..1 level per audio-active participant id. */
  levels: Record<string, number>;
  /** Currently speaking participant's id, or null in silence. */
  activeSpeakerId: string | null;
}

export function useRemoteAudio(options: UseRemoteAudioOptions = {}): UseRemoteAudioResult {
  const { localAudio } = options;
  const session = useZvonokSession();
  const manager = session.manager;
  const { participants } = useParticipants();
  const engine = useAudioActivityEngine();

  const mixerRef = useRef<RemoteAudioMixer | null>(null);
  const volumesRef = useRef(new Map<string, number>());
  const prevTrackIdsRef = useRef(new Map<string, string>());

  // Readings ride the shared engine; this hook contributes playout only.
  const levels = useAudioLevels();
  const activeSpeakerId = useActiveSpeaker();

  // Playout lives while there is a room session; leaving tears the mixer
  // down (playback elements, gains). Refs only: runs exactly on manager
  // attach/detach.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!manager) {
      mixerRef.current?.destroy();
      mixerRef.current = null;
      prevTrackIdsRef.current = new Map();
      volumesRef.current = new Map();
      return;
    }
    if (!mixerRef.current) {
      mixerRef.current = new RemoteAudioMixer();
    }
  }, [manager]);

  // Local microphone: analysed by the engine, never played back.
  useEffect(() => {
    engine?.setLocalAudio(localAudio?.userId ?? null, localAudio?.stream ?? null);
  }, [engine, localAudio?.userId, localAudio?.stream]);

  // Participant membership -> mixer playout graph.
  useEffect(() => {
    const mixer = mixerRef.current;
    if (!manager || !mixer) {
      return;
    }
    const currentTrackIds = new Map<string, string>();
    for (const participant of participants) {
      const track = participant.audioStream?.getAudioTracks()[0];
      if (!track) continue;
      currentTrackIds.set(participant.userId, track.id);
      const prevTrackId = prevTrackIdsRef.current.get(participant.userId);
      if (!prevTrackId) {
        mixer.addPeer(participant.userId, track);
      } else if (prevTrackId !== track.id) {
        // A swapped track rebuilds the mixer's peer nodes, which resets
        // the gain; the stored volume must be re-applied either way.
        mixer.updatePeerTrack(participant.userId, track);
      } else {
        continue;
      }
      const volume = volumesRef.current.get(participant.userId);
      if (volume !== undefined) {
        mixer.setGain(participant.userId, volume);
      }
    }
    prevTrackIdsRef.current = currentTrackIds;
  }, [manager, participants]);

  const setVolume = useCallback((userId: string, volume: number) => {
    volumesRef.current.set(userId, volume);
    mixerRef.current?.setGain(userId, volume);
  }, []);

  const setSink = useCallback((deviceId: string) => {
    return mixerRef.current?.setSink(deviceId) ?? Promise.resolve(false);
  }, []);

  return { setVolume, setSink, levels, activeSpeakerId };
}
