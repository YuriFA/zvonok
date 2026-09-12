import { act, render } from "@testing-library/react";
import type { PeerQualityStats, QualityLevel, SfuParticipantInfo } from "@zvonok/client/sfu/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef } from "react";

import { ZvonokProvider } from "@zvonok/react";
import { useZvonokSession } from "@zvonok/react";

/**
 * Socket-level fake of the parts of SfuManager the auto-quality engine
 * consumes: stats subscription, layer switching, participant registry.
 */
function createFakeSfuManager() {
  const participants = new Map<string, SfuParticipantInfo>();
  const qualityListeners = new Set<(stats: Map<string, PeerQualityStats>) => void>();
  const participantLeftListeners = new Set<(userId: string) => void>();
  return {
    startStatsCollection: vi.fn(),
    stopStatsCollection: vi.fn(),
    onParticipantLeft: vi.fn((listener: (userId: string) => void) => {
      participantLeftListeners.add(listener);
      return () => participantLeftListeners.delete(listener);
    }),
    onQualityStats: vi.fn((listener: (stats: Map<string, PeerQualityStats>) => void) => {
      qualityListeners.add(listener);
      return () => qualityListeners.delete(listener);
    }),
    emitQualityStats: (stats: Map<string, PeerQualityStats>) => {
      qualityListeners.forEach((listener) => listener(stats));
    },
    setPreferredLayers: vi.fn(),
    // The real manager resolves a user's video consumer; the fake hands
    // back the user's current producer id so assertions read naturally.
    getVideoConsumerIdForUserId: vi.fn((userId: string) => {
      const peer = participants.get(userId);
      return peer ? peer.producers.keys().next().value : undefined;
    }),
    getParticipant: (userId: string) => participants.get(userId),
    simulateParticipantJoined: (peer: SfuParticipantInfo) => {
      participants.set(peer.userId, peer);
    },
    simulateParticipantLeft: (userId: string) => {
      participants.delete(userId);
      participantLeftListeners.forEach((listener) => listener(userId));
    },
  };
}

/** Test helper: pushes a manager into the provider session. */
function SessionManagerProvider({ manager, children }: { manager: unknown; children: React.ReactNode }) {
  return (
    <ZvonokProvider serverUrl="https://sfu.test">
      <SessionSetter manager={manager} />
      {children}
    </ZvonokProvider>
  );
}

function SessionSetter({ manager }: { manager: unknown }) {
  const session = useZvonokSession();
  // Update exactly once: every update recreates the session object, so a
  // session-dependent effect here would loop forever.
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    session.update({ manager: manager as never, status: "joined" });
  }, []);
  return null;
}

import { PeerQualityProvider } from "../peer-quality.context";

function createPeer(userId: string, producerId: string): SfuParticipantInfo {
  return {
    userId,
    username: userId,
    producers: new Map([[producerId, { kind: "video", paused: false }]]),
  };
}

function createQualityStats(userId: string, level: QualityLevel): PeerQualityStats {
  const scoreByLevel = {
    excellent: 100,
    good: 70,
    fair: 50,
    poor: 20,
  } as const;

  return {
    userId,
    stats: {
      bitrate: 1000,
      packetLoss: 0,
      rtt: 10,
      jitter: 5,
      width: 1280,
      height: 720,
      fps: 30,
    },
    score: {
      level,
      score: scoreByLevel[level],
    },
  };
}

describe("PeerQualityProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the latest consumer id when the consumer is replaced during debounce", () => {
    const manager = createFakeSfuManager();
    const setPreferredLayers = vi.spyOn(manager, "setPreferredLayers");
    vi.spyOn(manager, "startStatsCollection").mockImplementation(() => {});

    manager.simulateParticipantJoined(createPeer("user-2", "producer-old"));

    render(
      <SessionManagerProvider manager={manager}>
        <PeerQualityProvider>
          <div />
        </PeerQualityProvider>
      </SessionManagerProvider>,
    );

    act(() => {
      manager.emitQualityStats(new Map([["user-2", createQualityStats("user-2", "poor")]]));
    });

    act(() => {
      const peer = manager.getParticipant("user-2");
      if (!peer) {
        throw new Error("Expected peer to exist");
      }

      peer.producers = new Map([["producer-new", { kind: "video", paused: false }]]);
      vi.advanceTimersByTime(3000);
    });

    expect(setPreferredLayers).toHaveBeenCalledTimes(1);
    expect(setPreferredLayers).toHaveBeenCalledWith("producer-new", 0);
  });

  it("clears stale layer state when a peer leaves and rejoins with the same user id", () => {
    const manager = createFakeSfuManager();
    const setPreferredLayers = vi.spyOn(manager, "setPreferredLayers");
    vi.spyOn(manager, "startStatsCollection").mockImplementation(() => {});

    manager.simulateParticipantJoined(createPeer("user-2", "producer-old"));

    render(
      <SessionManagerProvider manager={manager}>
        <PeerQualityProvider>
          <div />
        </PeerQualityProvider>
      </SessionManagerProvider>,
    );

    act(() => {
      manager.emitQualityStats(new Map([["user-2", createQualityStats("user-2", "poor")]]));
      vi.advanceTimersByTime(3000);
    });

    expect(setPreferredLayers).toHaveBeenCalledTimes(1);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("producer-old", 0);

    act(() => {
      manager.simulateParticipantLeft("user-2");
      manager.simulateParticipantJoined(createPeer("user-2", "producer-new"));
      manager.emitQualityStats(new Map([["user-2", createQualityStats("user-2", "poor")]]));
      vi.advanceTimersByTime(3000);
    });

    expect(setPreferredLayers).toHaveBeenCalledTimes(2);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("producer-new", 0);
  });
});
