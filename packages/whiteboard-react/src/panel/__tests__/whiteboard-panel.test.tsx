import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket {
  static instances: FakeSocket[] = [];
  connected = false;
  readonly handlers = new Map<string, Set<(payload?: unknown) => void>>();
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  constructor() {
    FakeSocket.instances.push(this);
  }

  on(event: string, handler: (payload?: unknown) => void): void {
    const listeners = this.handlers.get(event) ?? new Set<(payload?: unknown) => void>();
    listeners.add(handler);
    this.handlers.set(event, listeners);
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }

  disconnect(): void {
    this.connected = false;
  }

  connect(): void {
    this.connected = true;
  }

  emit(event: string, payload?: unknown): void {
    this.emitted.push({ event, payload });
  }

  receive(event: string, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

vi.mock("socket.io-client", () => ({ io: () => new FakeSocket() }));
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: (props: { excalidrawAPI?: (api: unknown) => void }) => {
    props.excalidrawAPI?.({ updateScene: () => {} });
    return <div data-testid="excalidraw-canvas" />;
  },
  restoreElements: (remote: readonly unknown[]) => remote,
}));

import { WhiteboardPanel } from "../whiteboard-panel";

const baseProps = {
  roomSlug: "room-slug",
  socketUrl: "",
  onClose: vi.fn(),
};

function activeSocket(): FakeSocket {
  return FakeSocket.instances[0];
}

describe("WhiteboardPanel", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.clearAllMocks();
  });

  it("shows the draw-lock status and the owner toggle to the owner", () => {
    render(<WhiteboardPanel {...baseProps} isOwner />);

    expect(screen.getByText("Host-only drawing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open drawing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close whiteboard/i })).toBeInTheDocument();
  });

  it("hides the toggle and undo controls from a locked non-owner", () => {
    render(<WhiteboardPanel {...baseProps} isOwner={false} />);

    expect(screen.getByText("Host-only drawing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open drawing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
  });

  it("marks the canvas read-only for a locked non-owner and open for mode open", async () => {
    const { rerender } = render(<WhiteboardPanel {...baseProps} isOwner={false} />);
    const canvas = await screen.findByTestId("board-canvas");
    expect(canvas).toHaveAttribute("data-readonly", "true");

    activeSocket().receive("whiteboard:mode", { roomSlug: "room-slug", mode: "open" });
    await waitFor(() => expect(canvas).toHaveAttribute("data-readonly", "false"));
    expect(screen.getByText("Drawing open")).toBeInTheDocument();

    rerender(<WhiteboardPanel {...baseProps} isOwner />);
    expect(canvas).toHaveAttribute("data-readonly", "false");
  });

  it("toggles the draw-lock mode through the socket", async () => {
    render(<WhiteboardPanel {...baseProps} isOwner />);

    fireEvent.click(await screen.findByRole("button", { name: /open drawing/i }));
    expect(activeSocket().emitted).toContainEqual({
      event: "whiteboard:mode",
      payload: { roomSlug: "room-slug", mode: "open" },
    });
  });

  it("refreshes the auth session once per connection episode after a rejected handshake", async () => {
    const refreshSession = vi.fn().mockResolvedValue(true);
    render(<WhiteboardPanel {...baseProps} isOwner refreshSession={refreshSession} />);
    const socket = activeSocket();

    await act(async () => {
      socket.receive("connect_error", new Error("unauthorized"));
      socket.receive("connect_error", new Error("unauthorized"));
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);

    // A successful connect resets the guard for the next episode.
    await act(async () => {
      socket.receive("connect");
    });
    expect(socket.emitted.some((entry) => entry.event === "whiteboard:join")).toBe(true);
    await act(async () => {
      socket.receive("connect_error", new Error("unauthorized"));
    });
    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(socket.emitted.some((entry) => entry.event === "whiteboard:join")).toBe(true);
  });

  it("reconnects after a server-side auth disconnect once the session refreshes", async () => {
    const refreshSession = vi.fn().mockResolvedValue(true);
    render(<WhiteboardPanel {...baseProps} isOwner refreshSession={refreshSession} />);
    const socket = activeSocket();
    socket.connected = false;

    // The gateway answers an expired access-token cookie with disconnect(),
    // not connect_error; socket.io does not retry this on its own.
    await act(async () => {
      socket.receive("disconnect", "io server disconnect");
    });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(true);
  });

  it("marks the board unavailable when the session cannot be refreshed", async () => {
    const refreshSession = vi.fn().mockResolvedValue(false);
    render(<WhiteboardPanel {...baseProps} isOwner refreshSession={refreshSession} />);

    await act(async () => {
      activeSocket().receive("connect_error", new Error("unauthorized"));
    });

    expect(await screen.findByText(/board is unavailable/i)).toBeInTheDocument();
  });

  it("shows an unavailable notice when the board errors", () => {
    render(<WhiteboardPanel {...baseProps} isOwner />);

    act(() => {
      activeSocket().receive("whiteboard:error", {
        event: "whiteboard:join",
        message: "Forbidden",
      });
    });

    expect(screen.getByText(/board is unavailable/i)).toBeInTheDocument();
  });

  it("mounts the engine after StrictMode double-invokes the socket effect", async () => {
    render(
      <StrictMode>
        <WhiteboardPanel {...baseProps} isOwner />
      </StrictMode>,
    );

    // StrictMode mounts, tears down, remounts: the first socket is dead and
    // a second one carries the live transport. The engine must still mount,
    // exactly once, against the surviving transport.
    expect(FakeSocket.instances.length).toBe(2);
    expect(FakeSocket.instances[0].connected).toBe(false);

    const canvas = await screen.findByTestId("excalidraw-canvas");
    expect(canvas).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("excalidraw-canvas")).toHaveLength(1));
  });
});
