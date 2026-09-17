/**
 * Remote-audio playout as one hook: every remote participant's audio plays
 * through a shared mixer (per-participant gain, output routing), and audio
 * activity readings are fed from the same playout graph - no consumer-managed
 * audio elements, no second sampling pipeline.
 */

import { ActiveSpeakerDetector } from "@zvonok/client/audio/active-speaker-detector";
import { AudioLevelSampler } from "@zvonok/client/audio/audio-level-sampler";
import { RemoteAudioMixer } from "@zvonok/client/audio/remote-audio-mixer";
import { useCallback, useEffect, useRef, useState } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";
import { useParticipants } from "./use-participants.js";

const SAMPLE_INTERVAL_MS = 250;
const ACTIVE_SPEAKER_EVERY_N_TICKS = 2;
/** Level changes smaller than this do not re-render the consumers. */
const LEVEL_HYSTERESIS = 0.05;

export interface UseRemoteAudioOptions {
  /**
   * Includes the local microphone in level and active-speaker analysis.
   * The local track is only analysed, never played back.
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

function isLevelChangeSignificant(prev: number | undefined, next: number): boolean {
  if (prev === undefined) return true;
  if (prev === next) return false;
  if ((prev === 0) !== (next === 0)) return true;
  return Math.abs(prev - next) >= LEVEL_HYSTERESIS;
}

export function useRemoteAudio(options: UseRemoteAudioOptions = {}): UseRemoteAudioResult {
  const { localAudio } = options;
  const session = useZvonokSession();
  const manager = session.manager;
  const { participants } = useParticipants();

  const mixerRef = useRef<RemoteAudioMixer | null>(null);
  const volumesRef = useRef(new Map<string, number>());
  const prevTrackIdsRef = useRef(new Map<string, string>());
  const samplerRef = useRef<AudioLevelSampler | null>(null);
  const detectorRef = useRef<ActiveSpeakerDetector | null>(null);
  const tickRef = useRef(0);
  const levelsRef = useRef<Record<string, number>>({});
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

  // Playout lives while there is a room session; leaving tears everything
  // down (playback elements, gains, analysers, sampling timers). Refs only:
  // runs exactly on manager attach/detach.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!manager) {
      mixerRef.current?.destroy();
      mixerRef.current = null;
      samplerRef.current?.dispose();
      samplerRef.current = null;
      detectorRef.current?.reset();
      detectorRef.current = null;
      prevTrackIdsRef.current = new Map();
      volumesRef.current = new Map();
      levelsRef.current = {};
      setLevels({});
      setActiveSpeakerId(null);
      return;
    }
    if (!mixerRef.current) {
      mixerRef.current = new RemoteAudioMixer();
    }
    if (!samplerRef.current) {
      samplerRef.current = new AudioLevelSampler();
    }
    if (!detectorRef.current) {
      detectorRef.current = new ActiveSpeakerDetector();
    }
  }, [manager]);

  useEffect(() => {
    const mixer = mixerRef.current;
    const sampler = samplerRef.current;
    const detector = detectorRef.current;
    if (!manager || !mixer || !sampler || !detector) {
      return;
    }
    // Local microphone: analysed through the mixer's shared playout
    // context - no dedicated AudioContext - and never played back.
    const localUserId = localAudio?.userId ?? null;
    const micTrack = localAudio?.stream?.getAudioTracks()[0] ?? null;
    if (localUserId && micTrack) {
      const micAnalyser = mixer.addAnalysisTap(localUserId, micTrack);
      if (micAnalyser) {
        sampler.addBorrowed(localUserId, micAnalyser);
      }
    } else if (localUserId) {
      mixer.removeAnalysisTap(localUserId);
      sampler.remove(localUserId);
    }

    // Participant membership -> mixer playout graph.
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
    const currentIds = new Set<string>();
    for (const userId of currentTrackIds.keys()) {
      currentIds.add(userId);
      const analyser = mixer.getAnalyser(userId);
      if (analyser) {
        sampler.addBorrowed(userId, analyser);
      }
    }
    for (const id of sampler.ids()) {
      if (id !== localUserId && !currentIds.has(id)) {
        sampler.remove(id);
      }
    }
    prevTrackIdsRef.current = currentTrackIds;
  }, [manager, participants, localAudio?.userId, localAudio?.stream]);

  // One sampling loop per manager attach: it reads refs only, so room
  // events (participant flips, mute changes) no longer tear down and
  // recreate the timer.
  useEffect(() => {
    if (!manager) {
      return;
    }
    const interval = setInterval(() => {
      const sampled = samplerRef.current?.sample() ?? new Map<string, number>();
      let changed = false;
      const next: Record<string, number> = {};
      for (const [userId, level] of sampled) {
        next[userId] = level;
        if (isLevelChangeSignificant(levelsRef.current[userId], level)) {
          changed = true;
        }
      }
      if (changed || Object.keys(next).length !== Object.keys(levelsRef.current).length) {
        levelsRef.current = next;
        setLevels(next);
      }
      tickRef.current += 1;
      if (tickRef.current % ACTIVE_SPEAKER_EVERY_N_TICKS === 0) {
        setActiveSpeakerId(detectorRef.current?.detect(sampled) ?? null);
      }
    }, SAMPLE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      tickRef.current = 0;
    };
  }, [manager]);

  useEffect(() => {
    const sampler = samplerRef.current;
    const detector = detectorRef.current;
    return () => {
      sampler?.dispose();
      detector?.reset();
    };
  }, []);

  const setVolume = useCallback((userId: string, volume: number) => {
    volumesRef.current.set(userId, volume);
    mixerRef.current?.setGain(userId, volume);
  }, []);

  const setSink = useCallback((deviceId: string) => {
    return mixerRef.current?.setSink(deviceId) ?? Promise.resolve(false);
  }, []);

  return { setVolume, setSink, levels, activeSpeakerId };
}
