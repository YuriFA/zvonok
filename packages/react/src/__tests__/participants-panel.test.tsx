import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useParticipantsPanel,
  type PanelParticipant,
} from "../components/participants-panel/participants-panel.js";
import type { UseZvonokCallResult } from "../hooks/use-zvonok-call.js";

function participant(overrides: Partial<PanelParticipant> = {}): PanelParticipant {
  return {
    id: "u1",
    username: "Ann",
    isMuted: false,
    isVideoOff: false,
    isConnected: true,
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
      muteAll: vi.fn().mockResolvedValue(undefined),
      mutePeer: vi.fn().mockResolvedValue(undefined),
      lockRoom: vi.fn().mockResolvedValue(undefined),
      kickPeer: vi.fn().mockResolvedValue(undefined),
    },
    kickPeer: vi.fn().mockResolvedValue(undefined),
    localVideoStream: null,
    localAudioStream: null,
    ...overrides,
  } as UseZvonokCallResult;
}

describe("useParticipantsPanel", () => {
  it("sorts local first, connected before disconnected, then by name", () => {
    const { result } = renderHook(() =>
      useParticipantsPanel({
        call: call({
          localUserId: "me",
          participants: [
            { userId: "zoe", displayName: "Zoe", isConnected: true },
            { userId: "al", displayName: "Al", isConnected: false },
            { userId: "me", displayName: "Me", isConnected: true },
            { userId: "bea", displayName: "Bea", isConnected: true },
          ] as UseZvonokCallResult["participants"],
        }),
      }),
    );

    expect(result.current.participants.map((p) => p.id)).toEqual(["me", "bea", "zoe", "al"]);
  });

  it("derives capability gates from the call's server capabilities", () => {
    const capable = call({ capabilities: ["mute-users", "lock-room"] });
    const { result } = renderHook(() => useParticipantsPanel({ call: capable }));
    expect(result.current.canMuteAll).toBe(true);
    expect(result.current.canLockRoom).toBe(true);
    expect(result.current.canKickParticipant(participant())).toBe(false);

    const remover = call({ capabilities: ["remove-participants"] });
    const { result: removeResult } = renderHook(() => useParticipantsPanel({ call: remover }));
    expect(removeResult.current.canMuteAll).toBe(false);
    expect(removeResult.current.canKickParticipant(participant())).toBe(true);
  });

  it("refuses mute and kick on the local participant and host-muted peers", () => {
    const { result } = renderHook(() =>
      useParticipantsPanel({
        call: call({ capabilities: ["mute-users", "remove-participants"] }),
        currentUserId: "me",
      }),
    );

    expect(result.current.canMuteParticipant(participant({ id: "me" }))).toBe(false);
    expect(result.current.canKickParticipant(participant({ id: "me" }))).toBe(false);
    expect(result.current.canMuteParticipant(participant({ id: "r2", isMutedByHost: true }))).toBe(
      false,
    );
    expect(result.current.canMuteParticipant(participant({ id: "r2" }))).toBe(true);
  });

  it("routes action failures to a typed notice and reports failure", async () => {
    const onNotice = vi.fn();
    const failing = call({
      capabilities: ["mute-users", "lock-room"],
      hostControls: {
        muteAll: vi.fn().mockRejectedValue(new Error("denied")),
        mutePeer: vi.fn().mockResolvedValue(undefined),
        lockRoom: vi.fn().mockRejectedValue(new Error("denied")),
        kickPeer: vi.fn().mockResolvedValue(undefined),
      },
    });
    const { result } = renderHook(() => useParticipantsPanel({ call: failing, onNotice }));

    expect(await result.current.muteAll()).toBe(false);
    expect(await result.current.toggleLock()).toBe(false);
    expect(onNotice).toHaveBeenCalledWith({
      key: "mute-all-failed",
      message: "Could not mute everyone",
    });
    expect(onNotice).toHaveBeenCalledWith({
      key: "lock-failed",
      message: "Could not change the room lock",
    });
  });

  it("drives host actions through the call's host controls and kick", async () => {
    const hostControls = {
      muteAll: vi.fn().mockResolvedValue(undefined),
      mutePeer: vi.fn().mockResolvedValue(undefined),
      lockRoom: vi.fn().mockResolvedValue(undefined),
      kickPeer: vi.fn().mockResolvedValue(undefined),
    };
    const kickPeer = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useParticipantsPanel({
        call: call({
          capabilities: ["mute-users", "remove-participants", "lock-room"],
          isRoomLocked: false,
          hostControls,
          kickPeer,
        }),
      }),
    );

    expect(await result.current.muteAll()).toBe(true);
    expect(await result.current.muteParticipant("r2")).toBe(true);
    expect(await result.current.kickParticipant("r2")).toBe(true);
    expect(await result.current.toggleLock()).toBe(true);
    expect(hostControls.muteAll).toHaveBeenCalledOnce();
    expect(hostControls.mutePeer).toHaveBeenCalledWith("r2");
    expect(kickPeer).toHaveBeenCalledWith("r2");
    expect(hostControls.lockRoom).toHaveBeenCalledWith(true);
  });

  it("shows pending requests only to the owner and delegates the decision", async () => {
    const onApproveRequest = vi.fn().mockResolvedValue(undefined);
    const requests = [{ requestId: "req1", displayName: "Guest" }];
    const owner = renderHook(() =>
      useParticipantsPanel({
        call: call(),
        isOwner: true,
        pendingRequests: requests,
        onApproveRequest,
      }),
    ).result;
    expect(owner.current.hasPendingRequests).toBe(true);
    await owner.current.approveRequest("req1");
    expect(onApproveRequest).toHaveBeenCalledWith("req1");

    const nonOwner = renderHook(() =>
      useParticipantsPanel({ call: call(), pendingRequests: requests }),
    ).result;
    expect(nonOwner.current.hasPendingRequests).toBe(false);
  });
});
