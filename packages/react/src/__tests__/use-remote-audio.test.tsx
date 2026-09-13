import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import type { SfuManager } from "@zvonok/client/sfu/manager";

import { ZvonokProvider, useZvonokSession } from "../zvonok-context.js";
import { useRemoteAudio } from "../use-remote-audio.js";
import { createMockSfuManager, createTrack, type MockSfuManager } from "./doubles.js";

const mixerHarness = vi.hoisted(() => {
  const instances: Array<{
    addPeer: ReturnType<typeof vi.fn>;
    removePeer: ReturnType<typeof vi.fn>;
    updatePeerTrack: ReturnType<typeof vi.fn>;
    setGain: ReturnType<typeof vi.fn>;
    setSink: ReturnType<typeof vi.fn>;
    getAnalyser: ReturnType<typeof vi.fn>;
    addAnalysisTap: ReturnType<typeof vi.fn>;
    removeAnalysisTap: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  return { instances };
});

vi.mock("@zvonok/client/audio/remote-audio-mixer", () => ({
  RemoteAudioMixer: vi.fn(function () {
    const instance = {
      addPeer: vi.fn(),
      removePeer: vi.fn(),
      updatePeerTrack: vi.fn(),
      setGain: vi.fn(),
      setSink: vi.fn(async () => true),
      getAnalyser: vi.fn(() => ({ fake: "analyser" })),
      addAnalysisTap: vi.fn(() => ({ fake: "mic-analyser" })),
      removeAnalysisTap: vi.fn(),
      destroy: vi.fn(),
    };
    mixerHarness.instances.push(instance);
    return instance;
  }),
}));

const samplerHarness = vi.hoisted(() => ({
  sample: vi.fn<() => Map<string, number>>(() => new Map()),
  addOwned: vi.fn(),
  addBorrowed: vi.fn(),
  remove: vi.fn(),
  ids: vi.fn(() => [] as string[]),
  dispose: vi.fn(),
}));

vi.mock("@zvonok/client/audio/audio-level-sampler", () => ({
  AudioLevelSampler: vi.fn(function () {
    return {
      addOwned: samplerHarness.addOwned,
      addBorrowed: samplerHarness.addBorrowed,
      remove: samplerHarness.remove,
      ids: samplerHarness.ids,
      sample: samplerHarness.sample,
      clear: vi.fn(),
      dispose: samplerHarness.dispose,
    };
  }),
}));

const detectorHarness = vi.hoisted(() => ({
  detect: vi.fn<() => string | null>(() => null),
  reset: vi.fn(),
}));

vi.mock("@zvonok/client/audio/active-speaker-detector", () => ({
  ActiveSpeakerDetector: vi.fn(function () {
    return { detect: detectorHarness.detect, reset: detectorHarness.reset };
  }),
}));

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

function renderRemoteAudio(options?: Parameters<typeof useRemoteAudio>[0]) {
  return renderHook(
    () => {
      const session = useZvonokSession();
      const hook = useRemoteAudio(options);
      return { session, hook };
    },
    { wrapper: Provider },
  );
}

async function attachManager(
  result: ReturnType<typeof renderRemoteAudio>["result"],
  sfu: MockSfuManager,
) {
  await act(async () => {
    result.current.session.update({ manager: sfu.manager as unknown as SfuManager, status: "joined" });
  });
}

describe("useRemoteAudio", () => {
  let sfu: MockSfuManager;
  let levelSpy: MockInstance;

  beforeEach(() => {
    sfu = createMockSfuManager();
    mixerHarness.instances.length = 0;
    samplerHarness.sample.mockImplementation(() => new Map());
    samplerHarness.ids.mockImplementation(() => []);
    samplerHarness.addOwned.mockClear();
    samplerHarness.addBorrowed.mockClear();
    samplerHarness.remove.mockClear();
    samplerHarness.dispose.mockClear();
    detectorHarness.detect.mockImplementation(() => null);
    detectorHarness.reset.mockClear();
    levelSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => levelSpy.mockRestore();
  });

  it("wires audible remote participants into the mixer", async () => {
    const { result } = renderRemoteAudio();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      sfu.manager.emitTrack(createTrack("audio", "mic-1"), "audio", "peer-1");
    });

    const mixer = mixerHarness.instances.at(-1)!;
    expect(mixer.addPeer).toHaveBeenCalledWith("peer-1", expect.anything());
  });

  it("applies a set volume and re-applies it over track swaps", async () => {
    const { result } = renderRemoteAudio();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      sfu.manager.emitTrack(createTrack("audio", "mic-1"), "audio", "peer-1");
    });

    act(() => {
      result.current.hook.setVolume("peer-1", 0);
    });

    const mixer = mixerHarness.instances.at(-1)!;
    expect(mixer.setGain).toHaveBeenCalledWith("peer-1", 0);

    // The peer swaps to a fresh track (republish): the mixer rebuilds the
    // peer, and the stored volume is re-applied over the rebuild.
    act(() => {
      sfu.manager.emitTrack(createTrack("audio", "mic-2"), "audio", "peer-1");
    });
    expect(mixer.updatePeerTrack).toHaveBeenCalledWith("peer-1", expect.anything());
    expect(mixer.setGain).toHaveBeenLastCalledWith("peer-1", 0);
  });

  it("routes playout to the selected output device", async () => {
    const { result } = renderRemoteAudio();
    await attachManager(result, sfu);

    await act(async () => {
      await expect(result.current.hook.setSink("speakers-9")).resolves.toBe(true);
    });
    expect(mixerHarness.instances.at(-1)!.setSink).toHaveBeenCalledWith("speakers-9");
  });

  it("feeds levels and the active speaker from the playout graph", async () => {
    vi.useFakeTimers();
    try {
      samplerHarness.ids.mockImplementation(() => ["peer-1"]);
      samplerHarness.sample.mockImplementation(() => new Map([["peer-1", 0.5]]));
      detectorHarness.detect.mockImplementation(() => "peer-1");
      const { result } = renderRemoteAudio();
      await act(async () => {
        await attachManager(result, sfu);
      });
      act(() => {
        sfu.manager.emitPeerJoined("peer-1", "Alice");
        sfu.manager.emitTrack(createTrack("audio", "mic-1"), "audio", "peer-1");
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(result.current.hook.levels).toEqual({ "peer-1": 0.5 });
      expect(result.current.hook.activeSpeakerId).toBe("peer-1");
      expect(samplerHarness.addBorrowed).toHaveBeenCalledWith("peer-1", { fake: "analyser" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("includes the local microphone in analysis without playing it", async () => {
    const { result } = renderRemoteAudio({
      localAudio: { userId: "me-1", stream: new MediaStream([createTrack("audio", "local-mic")]) },
    });
    await attachManager(result, sfu);

    const mixer = mixerHarness.instances.at(-1)!;
    expect(mixer.addAnalysisTap).toHaveBeenCalledWith("me-1", expect.anything());
    expect(samplerHarness.addBorrowed).toHaveBeenCalledWith("me-1", { fake: "mic-analyser" });
    expect(mixer.addPeer).not.toHaveBeenCalledWith("me-1", expect.anything());
  });

  it("releases playout and sampling resources on leave", async () => {
    const { result } = renderRemoteAudio();
    await attachManager(result, sfu);
    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      sfu.manager.emitTrack(createTrack("audio", "mic-1"), "audio", "peer-1");
    });

    await act(async () => {
      result.current.session.update({ manager: null, status: "disconnected" });
    });

    expect(mixerHarness.instances.at(-1)!.destroy).toHaveBeenCalled();
    expect(samplerHarness.dispose).toHaveBeenCalled();
    expect(detectorHarness.reset).toHaveBeenCalled();
    expect(result.current.hook.levels).toEqual({});
    expect(result.current.hook.activeSpeakerId).toBeNull();
  });
});
