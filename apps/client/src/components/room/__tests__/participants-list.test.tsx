import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ParticipantsList } from "../participants-list";
import type { Participant } from "../participants-list";

const participants: Participant[] = [
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

describe("ParticipantsList host mute control", () => {
  it("shows the mute control to the owner for remote participants only", () => {
    render(
      <ParticipantsList
        participants={participants}
        currentUserId="u1"
        roomOwnerId="u1"
        onMuteParticipant={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Mute bob")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mute alice")).not.toBeInTheDocument();
  });

  it("hides the mute control from non-owners", () => {
    render(
      <ParticipantsList
        participants={participants}
        currentUserId="u2"
        roomOwnerId="u1"
        onMuteParticipant={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Mute bob")).not.toBeInTheDocument();
  });

  it("calls onMuteParticipant with the participant id", async () => {
    const onMuteParticipant = vi.fn();
    render(
      <ParticipantsList
        participants={participants}
        currentUserId="u1"
        roomOwnerId="u1"
        onMuteParticipant={onMuteParticipant}
      />,
    );

    fireEvent.click(screen.getByLabelText("Mute bob"));
    expect(onMuteParticipant).toHaveBeenCalledWith("u2");
  });

  it("reflects a host mute on the row and retires the mute control", () => {
    render(
      <ParticipantsList
        participants={participants.map((p) =>
          p.id === "u2" ? { ...p, isMutedByHost: true } : p,
        )}
        currentUserId="u1"
        roomOwnerId="u1"
        onMuteParticipant={vi.fn()}
      />,
    );

    expect(screen.getByText("Muted by host")).toBeInTheDocument();
    expect(screen.getByLabelText("Muted by host")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mute bob")).not.toBeInTheDocument();
  });
});
