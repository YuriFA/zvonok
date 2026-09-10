import { act, render } from "@testing-library/react";
import { createMockSfuManager } from "@zvonok/client/sfu/__mocks__/manager";
import type { PeerQualityStats, QualityLevel, SfuParticipantInfo } from "@zvonok/client/sfu/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SfuManagerProvider } from "@/features/sfu/contexts/sfu-manager.context";

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
    const manager = createMockSfuManager();
    const setPreferredLayers = vi.spyOn(manager, "setPreferredLayers");
    vi.spyOn(manager, "startStatsCollection").mockImplementation(() => {});

    manager.simulateParticipantJoined(createPeer("user-2", "producer-old"));

    render(
      <SfuManagerProvider manager={manager}>
        <PeerQualityProvider>
          <div />
        </PeerQualityProvider>
      </SfuManagerProvider>,
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
    const manager = createMockSfuManager();
    const setPreferredLayers = vi.spyOn(manager, "setPreferredLayers");
    vi.spyOn(manager, "startStatsCollection").mockImplementation(() => {});

    manager.simulateParticipantJoined(createPeer("user-2", "producer-old"));

    render(
      <SfuManagerProvider manager={manager}>
        <PeerQualityProvider>
          <div />
        </PeerQualityProvider>
      </SfuManagerProvider>,
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
