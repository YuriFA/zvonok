import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatContextValue } from "../../contexts/chat.context";
import type { Message } from "../../types/chat.types";
import { ChatPanel } from "../chat-panel";

const mockUseChatContext = vi.hoisted(() => vi.fn());

vi.mock("../../contexts/chat.context", () => ({
  useChatContext: mockUseChatContext,
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    content: "Hello",
    userId: "u1",
    roomId: "r1",
    createdAt: "2026-01-01T10:30:00Z",
    user: { id: "u1", username: "Alice" },
    ...overrides,
  };
}

function makeChat(overrides: Partial<ChatContextValue> = {}): ChatContextValue {
  return {
    currentUserId: "u1",
    messages: [],
    unreadCount: 0,
    isLoading: false,
    hasMore: false,
    sendMessage: vi.fn(async () => {}),
    loadMore: vi.fn(),
    resetUnreadCount: vi.fn(),
    ...overrides,
  };
}

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseChatContext.mockReturnValue(makeChat());
  });

  it("renders message input", () => {
    render(<ChatPanel />);
    expect(screen.getByLabelText("Chat message input")).toBeInTheDocument();
  });

  it("renders messages from the context", () => {
    mockUseChatContext.mockReturnValue(
      makeChat({ messages: [makeMessage(), makeMessage({ id: "m2", content: "World" })] }),
    );
    render(<ChatPanel />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("World")).toBeInTheDocument();
  });

  it("shows load earlier button when hasMore is true with messages", () => {
    mockUseChatContext.mockReturnValue(makeChat({ messages: [makeMessage()], hasMore: true }));
    render(<ChatPanel />);
    expect(screen.getByText("Load earlier messages")).toBeInTheDocument();
  });

  it("does not show load earlier button when hasMore is false", () => {
    mockUseChatContext.mockReturnValue(makeChat({ messages: [makeMessage()], hasMore: false }));
    render(<ChatPanel />);
    expect(screen.queryByText("Load earlier messages")).not.toBeInTheDocument();
  });
});
