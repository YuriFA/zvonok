import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { UseScreenShareResult } from "../../use-screen-share.js";
import type { UseZvonokCallResult } from "../../use-zvonok-call.js";
import { useStage } from "../stage.js";
// Side-effect import: stubs MediaStream for jsdom.
import "../../__tests__/doubles.js";

function remote(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    displayName: userId.toUpperCase(),
    cameraStream: null,
    screenStream: null,
    isCameraEnabled: true,
    isAudioEnabled: true,
    isScreenSharing: false,
    isConnected: true,
    mutedByHost: false,
    ...overrides,
  };
}

function call(overrides: Partial<UseZvonokCallResult> = {}): UseZvonokCallResult {
  return {
    connectionState: "connected",
    capabilities: [],
    isRoomLocked: false,
    mutedByHost: false,
    wasKicked: false,
    participants: [],
    localUserId: "me",
    camera: { isEnabled: true, captureState: null, toggle: vi.fn() },
    microphone: { isEnabled: true, captureState: null, toggle: vi.fn() },
    hostControls: {
      muteAll: vi.fn(),
      mutePeer: vi.fn(),
      lockRoom: vi.fn(),
    },
    kickPeer: vi.fn(),
    localVideoStream: null,
    localAudioStream: null,
    ...overrides,
  } as UseZvonokCallResult;
}

function screenShare(overrides: Partial<UseScreenShareResult> = {}): UseScreenShareResult {
  return {
    sharing: false,
    screenStream: null,
    blocked: false,
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

describe("useStage", () => {
  it("places the local tile first with local streams and control states", () => {
    const localVideoStream = new MediaStream();
    const { result } = renderHook(() =>
      useStage({
        call: call({
          localVideoStream,
          camera: { isEnabled: false, captureState: null, toggle: vi.fn() },
        }),
        screenShare: screenShare(),
        width: 0,
        height: 0,
      }),
    );

    const local = result.current.tiles[0];
    expect(local.key).toBe("local");
    expect(local.isLocal).toBe(true);
    expect(local.stream).toBe(localVideoStream);
    expect(local.isVideoOn).toBe(false);
    expect(local.isAudioOn).toBe(true);
    // Flow grid: the derivation ran without a stage size.
    expect(local.style).toBeUndefined();
    expect(result.current.spotlight).toBeNull();
  });

  it("exposes remote camera tiles with participant data", () => {
    const cameraStream = new MediaStream();
    const { result } = renderHook(() =>
      useStage({
        call: call({
          participants: [
            remote("r1", { cameraStream, isCameraEnabled: false }),
          ] as UseZvonokCallResult["participants"],
        }),
        screenShare: screenShare(),
        width: 0,
        height: 0,
      }),
    );

    const remoteTile = result.current.tiles.find((tile) => tile.key === "r1");
    expect(remoteTile).toMatchObject({
      userId: "r1",
      name: "R1",
      stream: cameraStream,
      isVideoOn: false,
      isAudioOn: true,
      isLocal: false,
      isScreen: false,
    });
  });

  it("resolves a remote sharer's spotlight with the screen stream", () => {
    const screenStream = new MediaStream();
    const { result } = renderHook(() =>
      useStage({
        call: call({
          participants: [
            remote("r1", { screenStream, isScreenSharing: true }),
          ] as UseZvonokCallResult["participants"],
        }),
        screenShare: screenShare(),
        width: 1280,
        height: 720,
      }),
    );

    expect(result.current.spotlight).toMatchObject({
      key: "r1-screen",
      name: "R1's screen",
      stream: screenStream,
      isScreen: true,
      isLocal: false,
    });
    expect(result.current.spotlight?.style).toMatchObject({
      position: "absolute",
    });
  });

  it("resolves the local sharer's spotlight from the captured screen stream", () => {
    const screenStream = new MediaStream();
    const { result } = renderHook(() =>
      useStage({
        call: call(),
        screenShare: screenShare({ sharing: true, screenStream }),
        width: 1280,
        height: 720,
      }),
    );

    expect(result.current.spotlight).toMatchObject({
      key: "local-screen",
      name: "You",
      stream: screenStream,
      isLocal: true,
      isScreen: true,
    });
  });

  it("adds flow-grid screen tiles for remote sharers when not in spotlight mode", () => {
    const screenStream = new MediaStream();
    const { result } = renderHook(() =>
      useStage({
        call: call({
          participants: [
            remote("r1", { screenStream, isScreenSharing: true }),
          ] as UseZvonokCallResult["participants"],
        }),
        screenShare: screenShare(),
        width: 0,
        height: 0,
      }),
    );

    const screenTile = result.current.tiles.find((tile) => tile.isScreen);
    expect(screenTile).toMatchObject({ key: "r1-screen", stream: screenStream });
  });
});
