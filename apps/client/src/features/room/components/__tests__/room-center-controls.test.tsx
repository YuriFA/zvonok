import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { RoomCenterControls } from "../room-center-controls";

function renderControls(overrides?: Partial<React.ComponentProps<typeof RoomCenterControls>>) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <RoomCenterControls
          isScreenSharing={false}
          isScreenShareSupported={true}
          isScreenShareBlocked={false}
          screenShareState="idle"
          onToggleScreenShare={vi.fn().mockResolvedValue(undefined)}
          {...overrides}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("RoomCenterControls - screen share button", () => {
  it("renders screen share button when supported", () => {
    renderControls();
    expect(screen.getByRole("button", { name: "Share screen" })).toBeInTheDocument();
  });

  it("hides screen share button when not supported", () => {
    renderControls({ isScreenShareSupported: false });
    expect(screen.queryByRole("button", { name: "Share screen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop screen share" })).not.toBeInTheDocument();
  });

  it("shows Stop icon and aria-pressed=true when sharing is active", () => {
    renderControls({ isScreenSharing: true, screenShareState: "sharing" });
    const btn = screen.getByRole("button", { name: "Stop screen share" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows Share icon and aria-pressed=false when idle", () => {
    renderControls({ isScreenSharing: false, screenShareState: "idle" });
    const btn = screen.getByRole("button", { name: "Share screen" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("disables button during starting state", () => {
    renderControls({ isScreenSharing: false, screenShareState: "starting" });
    expect(screen.getByRole("button", { name: "Share screen" })).toBeDisabled();
  });

  it("disables button when isScreenShareBlocked is true and not sharing", () => {
    renderControls({ isScreenShareBlocked: true, screenShareState: "idle" });
    expect(
      screen.getByRole("button", { name: "Another participant is sharing their screen" }),
    ).toBeDisabled();
  });

  it("does not disable button for the active sharer", () => {
    renderControls({
      isScreenSharing: true,
      isScreenShareBlocked: false,
      screenShareState: "sharing",
    });
    expect(screen.getByRole("button", { name: "Stop screen share" })).not.toBeDisabled();
  });

  it("calls onToggleScreenShare when button is clicked", () => {
    const onToggleScreenShare = vi.fn().mockResolvedValue(undefined);
    renderControls({ onToggleScreenShare });

    fireEvent.click(screen.getByRole("button", { name: "Share screen" }));

    expect(onToggleScreenShare).toHaveBeenCalledOnce();
  });

  it("renders Leave room link", () => {
    renderControls();
    expect(screen.getByRole("link", { name: "Leave room" })).toBeInTheDocument();
  });
});
