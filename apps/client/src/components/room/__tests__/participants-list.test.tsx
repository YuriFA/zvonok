import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PanelParticipant, ParticipantsPanel } from "@zvonok/react";

import { ParticipantsList } from "../participants-list";

const participants: PanelParticipant[] = [
  {
    id: "u1",
    userId: "u1",
    username: "alice",
    isMuted: false,
    isVideoOff: false,
    isConnected: true,
  },
  {
    id: "u2",
    userId: "u2",
    username: "bob",
    isMuted: false,
    isVideoOff: false,
    isConnected: true,
  },
];

function makePanel(overrides: Partial<ParticipantsPanel> = {}): ParticipantsPanel {
  return {
    participants,
    isRoomLocked: false,
    canMuteAll: false,
    canLockRoom: false,
    muteAll: vi.fn().mockResolvedValue(true),
    toggleLock: vi.fn().mockResolvedValue(true),
    canMuteParticipant: () => true,
    canKickParticipant: () => false,
    muteParticipant: vi.fn().mockResolvedValue(true),
    kickParticipant: vi.fn().mockResolvedValue(true),
    pendingRequests: [],
    hasPendingRequests: false,
    canReviewRequests: false,
    approveRequest: vi.fn().mockResolvedValue(undefined),
    denyRequest: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ParticipantsList over the package panel projection", () => {
  it("shows the mute control for participants the panel marks mutable", () => {
    render(<ParticipantsList panel={makePanel()} currentUserId="u1" />);

    expect(screen.getByLabelText("Mute bob")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mute alice")).not.toBeInTheDocument();
  });

  it("hides the mute control when the panel denies muting", () => {
    const panel = makePanel({ canMuteParticipant: () => false });
    render(<ParticipantsList panel={panel} currentUserId="u1" />);

    expect(screen.queryByLabelText("Mute bob")).not.toBeInTheDocument();
  });

  it("routes the mute action through the panel", async () => {
    const muteParticipant = vi.fn().mockResolvedValue(true);
    const panel = makePanel({ muteParticipant });
    render(<ParticipantsList panel={panel} currentUserId="u1" />);

    fireEvent.click(screen.getByLabelText("Mute bob"));
    expect(muteParticipant).toHaveBeenCalledWith("u2");
  });

  it("reflects a host mute on the row and retires the mute control", () => {
    const muted = participants.map((p) => (p.id === "u2" ? { ...p, isMutedByHost: true } : p));
    render(<ParticipantsList panel={makePanel({ participants: muted })} currentUserId="u1" />);

    expect(screen.getByText("Muted by host")).toBeInTheDocument();
    expect(screen.getByLabelText("Muted by host")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mute bob")).not.toBeInTheDocument();
  });
});
