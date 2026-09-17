/**
 * Audio activity: active-speaker detection and per-participant audio levels
 * as React state, computed client-side from the local microphone and remote
 * audio tracks via the core package's detector and sampler primitives.
 */

import { ActiveSpeakerDetector } from "@zvonok/client/audio/active-speaker-detector";
import { AudioLevelSampler } from "@zvonok/client/audio/audio-level-sampler";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import { useEffect, useMemo } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";
import { useStoreSelector } from "./use-store-selector.js";

const TICK_MS = 100;
const LEVEL_EPSILON = 0.01;

export interface AudioActivitySnapshot {
  /** Participant id of the current active speaker; null in silence. */
  activeSpeakerId: string | null;
  /** Smoothed 0..1 audio level per audio-active participant id. */
  levels: Record<string, number>;
}

const EMPTY_AUDIO_ACTIVITY: AudioActivitySnapshot = {
  activeSpeakerId: null,
  levels: {},
};

export interface AudioActivityEngineOptions {
  intervalMs?: number;
  /** Injectable for tests; defaults to the browser AudioContext. */
  audioContextFactory?: () => AudioContext;
  /** Injectable for tests; defaults to the core primitives. */
  sampler?: Pick<AudioLevelSampler, "addOwned" | "addBorrowed" | "remove" | "sample" | "clear">;
}

interface RemoteNodes {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
}

/**
 * Samples audio levels for every audio track flowing through the manager
 * (local microphone included) and derives the active speaker from them.
 * Purely observational: no signalling, no media playout.
 */
export class AudioActivityEngine {
  private readonly manager: SfuManager;
  private readonly sampler: NonNullable<AudioActivityEngineOptions["sampler"]>;
  private readonly detector = new ActiveSpeakerDetector();
  private readonly intervalMs: number;
  private readonly audioContextFactory: () => AudioContext;
  private readonly listeners = new Set<() => void>();
  private remoteNodes = new Map<string, RemoteNodes>();
  private ctx: AudioContext | null = null;
  private localUserId: string | null = null;
  private localTrack: MediaStreamTrack | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unsubscribes: Array<() => void> = [];
  private snapshot: AudioActivitySnapshot = EMPTY_AUDIO_ACTIVITY;
  private refCount = 0;

  constructor(manager: SfuManager, options: AudioActivityEngineOptions = {}) {
    this.manager = manager;
    this.sampler = options.sampler ?? new AudioLevelSampler();
    this.intervalMs = options.intervalMs ?? TICK_MS;
    this.audioContextFactory = options.audioContextFactory ?? (() => new AudioContext());
  }

  /** Stable reference between ticks; safe for useSyncExternalStore. */
  getSnapshot = (): AudioActivitySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  acquire(): void {
    this.refCount += 1;
    if (this.refCount === 1) this.start();
  }

  release(): void {
    this.refCount -= 1;
    if (this.refCount === 0) this.stop();
  }

  private start(): void {
    this.unsubscribes.push(
      this.manager.onTrack((track, kind, userId) => {
        if (kind !== "audio") return;
        this.attachRemote(userId, track);
        track.onended = () => this.detachRemote(userId);
      }),
      this.manager.onParticipantLeft((userId) => this.detachRemote(userId)),
    );
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  private stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
    for (const userId of this.remoteNodes.keys()) this.detachRemote(userId);
    this.detachLocal();
    this.sampler.clear();
    this.detector.reset();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.snapshot = EMPTY_AUDIO_ACTIVITY;
    this.listeners.clear();
  }

  private attachRemote(userId: string, track: MediaStreamTrack): void {
    this.detachRemote(userId);
    try {
      const ctx = this.ensureContext();
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      source.connect(analyser);
      this.remoteNodes.set(userId, { source, analyser });
      this.sampler.addBorrowed(userId, analyser);
    } catch {
      // Analysis is best-effort; media playout is never affected.
    }
  }

  private detachRemote(userId: string): void {
    this.sampler.remove(userId);
    const nodes = this.remoteNodes.get(userId);
    if (nodes) {
      nodes.source.disconnect();
      this.remoteNodes.delete(userId);
    }
  }

  /** Keeps the sampler's local entry in sync with the produced mic track. */
  private reconcileLocal(): void {
    const userId = this.manager.getLocalUserId();
    const track = this.manager.getProducerByKind("audio")?.track ?? null;
    if (userId === this.localUserId && track === this.localTrack) return;
    this.detachLocal();
    if (userId && track) {
      try {
        this.sampler.addOwned(userId, new MediaStream([track]));
      } catch {
        // Best-effort, same as remote attachments.
      }
    }
    this.localUserId = userId;
    this.localTrack = track;
  }

  private detachLocal(): void {
    if (this.localUserId) this.sampler.remove(this.localUserId);
    this.localUserId = null;
    this.localTrack = null;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = this.audioContextFactory();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tick(): void {
    this.reconcileLocal();
    const sampled = this.sampler.sample();
    const activeSpeakerId = this.detector.detect(sampled);

    const levels: Record<string, number> = {};
    for (const [id, level] of sampled) levels[id] = level;

    let changed = activeSpeakerId !== this.snapshot.activeSpeakerId;
    const previous = this.snapshot.levels;
    const ids = Object.keys(levels);
    if (!changed) {
      if (ids.length !== Object.keys(previous).length) {
        changed = true;
      } else {
        changed = ids.some((id) => Math.abs((previous[id] ?? 0) - levels[id]) > LEVEL_EPSILON);
      }
    }

    if (changed) {
      this.snapshot = { activeSpeakerId, levels };
      for (const listener of this.listeners) listener();
    }
  }
}

/** One engine per manager, shared by every hook consumer in the tree. */
const engines = new WeakMap<SfuManager, AudioActivityEngine>();

function engineFor(manager: SfuManager): AudioActivityEngine {
  let engine = engines.get(manager);
  if (!engine) {
    engine = new AudioActivityEngine(manager);
    engines.set(manager, engine);
  }
  return engine;
}

function useAudioActivityEngine(): AudioActivityEngine | null {
  const session = useZvonokSession();
  const manager = session.manager;
  const engine = useMemo(() => (manager ? engineFor(manager) : null), [manager]);

  useEffect(() => {
    if (!engine) return;
    engine.acquire();
    return () => engine.release();
  }, [engine]);

  return engine;
}

const selectActiveSpeaker = (state: AudioActivitySnapshot) => ({
  activeSpeakerId: state.activeSpeakerId,
});

const selectLevels = (state: AudioActivitySnapshot) => state.levels;

/** Currently speaking participant's id, or null in silence; local mic included. */
export function useActiveSpeaker(): string | null {
  const engine = useAudioActivityEngine();
  return useStoreSelector(engine, selectActiveSpeaker)?.activeSpeakerId ?? null;
}

/** Smoothed 0..1 audio level per audio-active participant id, local included. */
export function useAudioLevels(): Record<string, number> {
  const engine = useAudioActivityEngine();
  return useStoreSelector(engine, selectLevels) ?? EMPTY_AUDIO_ACTIVITY.levels;
}
