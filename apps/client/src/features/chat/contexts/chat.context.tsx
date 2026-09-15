/**
 * Chat owns its transport in one provider: the socket subscription, paginated
 * history as an infinite query, and live messages as a subscription. Panel
 * components consume the context instead of receiving drilled props.
 */

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";

import { chatKeys } from "@/lib/react-query/query-keys";

import type { Message } from "../types/chat.types";

const SOCKET_URL =
  (import.meta.env as { VITE_SOCKET_URL?: string }).VITE_SOCKET_URL ?? "http://localhost:3000";

interface ChatHistoryPage {
  data: Message[];
  meta: { totalPages: number; page: number };
}

export interface ChatContextValue {
  currentUserId: string | undefined;
  messages: Message[];
  unreadCount: number;
  isLoading: boolean;
  hasMore: boolean;
  sendMessage: (content: string) => Promise<void>;
  loadMore: () => void;
  resetUnreadCount: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

interface ChatProviderProps {
  roomId: string;
  currentUserId: string | undefined;
  children: ReactNode;
}

export function ChatProvider({ roomId, currentUserId, children }: ChatProviderProps) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  // Latest-ref pattern: handlers registered once still see the identity that
  // resolved after the connection opened (guest flow).
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  useEffect(() => {
    const socket = io(`${SOCKET_URL}/chat`, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      // Every (re)connect refetches history from the server; live messages
      // already present in the refetched pages are deduped on merge.
      void queryClient.invalidateQueries({ queryKey: chatKeys.history(roomId) });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("chat:message", (message: Message) => {
      setLiveMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });

      if (message.userId !== currentUserIdRef.current) {
        setUnreadCount((c) => c + 1);
      }
    });

    socket.on("chat:error", ({ message }: { event: string; message: string }) => {
      toast.error(message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [queryClient, roomId]);

  const history = useInfiniteQuery({
    queryKey: chatKeys.history(roomId),
    enabled: isConnected,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      new Promise<ChatHistoryPage>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          reject(new Error("Chat is not connected"));
          return;
        }
        socket.emit("chat:history", { roomId, page: pageParam }, (response: ChatHistoryPage) => {
          if (response?.data) {
            resolve(response);
          } else {
            reject(new Error("Empty chat history response"));
          }
        });
      }),
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
  });

  const messages = useMemo(() => {
    const historyMessages = history.data?.pages.flatMap((page) => page.data) ?? [];
    const historyIds = new Set(historyMessages.map((m) => m.id));
    return [...historyMessages, ...liveMessages.filter((m) => !historyIds.has(m.id))];
  }, [history.data, liveMessages]);

  const sendMessage = useCallback(
    async (content: string) => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        throw new Error("Chat is not connected");
      }
      socket.emit("chat:send", { content, roomId });
    },
    [roomId],
  );

  const loadMore = useCallback(() => {
    void history.fetchNextPage();
  }, [history]);

  const resetUnreadCount = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({
      currentUserId,
      messages,
      unreadCount,
      isLoading: history.isFetchingNextPage,
      hasMore: history.hasNextPage ?? false,
      sendMessage,
      loadMore,
      resetUnreadCount,
    }),
    [
      currentUserId,
      messages,
      unreadCount,
      history.isFetchingNextPage,
      history.hasNextPage,
      sendMessage,
      loadMore,
      resetUnreadCount,
    ],
  );

  return <ChatContext value={value}>{children}</ChatContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return ctx;
}
