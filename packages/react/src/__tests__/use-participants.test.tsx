import { act, renderHook } from "@testing-library/react";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ZvonokProvider,
  useZvonokSession,
  type ZvonokSession,
} from "../contexts/zvonok-context.js";
import { useParticipants } from "../hooks/use-participants.js";
import { createMockSfuManager, createTrack, type MockSfuManager } from "./doubles.js";

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

function renderParticipants() {
  return renderHook(
    () => {
      const session = useZvonokSession();
      const { participants } = useParticipants();
      return { session: session as ZvonokSession, participants };
    },
    { wrapper: Provider },
  );
}

async function attachManager(
  result: ReturnType<typeof renderParticipants>["result"],
  sfu: MockSfuManager,
) {
  await act(async () => {
    result.current.session.store.setManager(sfu.manager as unknown as SfuManager);
    result.current.session.store.joined();
  });
}

describe("useParticipants", () => {
  let sfu: MockSfuManager;

  beforeEach(() => {
    sfu = createMockSfuManager();
  });

  it("returns an empty list while no manager is connected", () => {
    const { result } = renderParticipants();

    expect(result.current.participants).toEqual([]);
  });

  it("adds a participant on peer joined with display name", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
    });

    expect(result.current.participants).toHaveLength(1);
    expect(result.current.participants[0]).toMatchObject({
      userId: "peer-1",
      displayName: "Alice",
      cameraStream: null,
      screenStream: null,
      audioStream: null,
      isCameraEnabled: false,
      isScreenSharing: false,
      isAudioEnabled: false,
      mutedByHost: false,
    });
  });

  it("assembles camera and audio streams from track events", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      sfu.manager.emitTrack(createTrack("video", "cam-1"), "video", "peer-1");
      sfu.manager.emitTrack(createTrack("audio", "mic-1"), "audio", "peer-1");
    });

    const participant = result.current.participants[0];
    expect(participant.cameraStream?.getTracks().map((track) => track.id)).toEqual(["cam-1"]);
    expect(participant.audioStream?.getTracks().map((track) => track.id)).toEqual(["mic-1"]);
    expect(participant.isCameraEnabled).toBe(true);
    expect(participant.isAudioEnabled).toBe(true);
  });

  it("falls back to a generic display name when only a track is seen", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitTrack(createTrack("video", "cam-1"), "video", "peer-2");
    });

    expect(result.current.participants[0]).toMatchObject({
      userId: "peer-2",
      displayName: "Participant",
    });
  });

  it("updates enabled flags via track mute/unmute handlers", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    let camera: ReturnType<typeof createTrack>;
    let audio: ReturnType<typeof createTrack>;
    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      camera = createTrack("video", "cam-1");
      audio = createTrack("audio", "mic-1");
      sfu.manager.emitTrack(camera, "video", "peer-1");
      sfu.manager.emitTrack(audio, "audio", "peer-1");
    });

    act(() => {
      camera!.onmute?.(new Event("mute"));
      audio!.onmute?.(new Event("mute"));
    });
    expect(result.current.participants[0].isCameraEnabled).toBe(false);
    expect(result.current.participants[0].isAudioEnabled).toBe(false);

    act(() => {
      camera!.onunmute?.(new Event("unmute"));
      audio!.onunmute?.(new Event("unmute"));
    });
    expect(result.current.participants[0].isCameraEnabled).toBe(true);
    expect(result.current.participants[0].isAudioEnabled).toBe(true);
  });

  it("clears the camera stream when the track ends", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    let camera: ReturnType<typeof createTrack>;
    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      camera = createTrack("video", "cam-1");
      sfu.manager.emitTrack(camera, "video", "peer-1");
    });

    act(() => {
      camera!.onended?.(new Event("ended"));
    });
    expect(result.current.participants[0].cameraStream).toBeNull();
    expect(result.current.participants[0].isCameraEnabled).toBe(false);
  });

  it("tracks screen share via source and clears on stop", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      sfu.manager.emitTrack(createTrack("video", "screen-1"), "video", "peer-1", "screen");
    });
    expect(result.current.participants[0]).toMatchObject({
      isScreenSharing: true,
      isCameraEnabled: false,
    });
    expect(
      result.current.participants[0].screenStream?.getTracks().map((track) => track.id),
    ).toEqual(["screen-1"]);

    act(() => {
      sfu.manager.emitScreenShareStopped("peer-1");
    });
    expect(result.current.participants[0].screenStream).toBeNull();
    expect(result.current.participants[0].isScreenSharing).toBe(false);
  });

  it("reflects remote producer pauses and clears mutedByHost when the peer unmutes", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      sfu.manager.emitTrack(createTrack("audio", "mic-1"), "audio", "peer-1");
      sfu.socket.fire("sfu:peer-muted", { userId: "peer-1" });
      sfu.manager.emitProducerState({ userId: "peer-1", kind: "audio", paused: true });
    });
    expect(result.current.participants[0].isAudioEnabled).toBe(false);
    expect(result.current.participants[0].mutedByHost).toBe(true);

    act(() => {
      sfu.manager.emitProducerState({ userId: "peer-1", kind: "audio", paused: false });
    });
    expect(result.current.participants[0].isAudioEnabled).toBe(true);
    expect(result.current.participants[0].mutedByHost).toBe(false);
  });

  it("marks participants muted by host on sfu:peer-muted", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      sfu.socket.fire("sfu:peer-muted", { userId: "peer-1" });
    });

    expect(result.current.participants[0].mutedByHost).toBe(true);
  });

  it("removes participants on peer left", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
      sfu.manager.emitPeerJoined("peer-2", "Bob");
      sfu.manager.emitPeerLeft("peer-1");
    });

    expect(result.current.participants.map((participant) => participant.userId)).toEqual([
      "peer-2",
    ]);
  });

  it("clears participants when the manager goes away", async () => {
    const { result } = renderParticipants();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitPeerJoined("peer-1", "Alice");
    });
    expect(result.current.participants).toHaveLength(1);

    await act(async () => {
      result.current.session.store.disconnected();
    });
    expect(result.current.participants).toEqual([]);
  });
});
