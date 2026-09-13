import { cn } from "@/lib/utils";

import { useChatContext } from "../contexts/chat.context";
import { MessageInput } from "./message-input";
import { MessageList } from "./message-list";

interface ChatPanelProps {
  className?: string;
}

export function ChatPanel({ className }: ChatPanelProps) {
  const { messages, currentUserId, isLoading, hasMore, sendMessage, loadMore } = useChatContext();

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <MessageList
        messages={messages}
        currentUserId={currentUserId ?? ""}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />
      <MessageInput onSend={sendMessage} />
    </div>
  );
}
