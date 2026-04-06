import { useMessages, useMarkRead } from "../hooks/use-api";
import { MessageView } from "./message-view";
import { useState } from "react";
import type { EmailMessage } from "@/lib/api-client";

export function MessageList({ accountId }: { accountId: string }) {
  const { data, isLoading } = useMessages(accountId, true);
  const markRead = useMarkRead();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) return <div className="p-3 text-xs text-muted-foreground">Loading...</div>;
  if (!data?.ok) return <div className="p-3 text-xs text-destructive">Failed to load messages</div>;

  const messages = data.data;
  if (messages.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No messages yet</div>;
  }

  function handleExpand(msg: EmailMessage) {
    if (expandedId === msg.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(msg.id);
    if (!msg.isRead) {
      markRead.mutate({ accountId, messageId: msg.id, isRead: true });
    }
  }

  return (
    <div className="border-t border-border">
      {messages.map((msg) => (
        <div key={msg.id}>
          <button
            type="button"
            onClick={() => handleExpand(msg)}
            className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex justify-between items-center">
              <span
                className={`text-xs truncate ${msg.isRead ? "text-muted-foreground" : "text-foreground font-medium"}`}
              >
                {msg.subject ?? "(no subject)"}
              </span>
              <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                {new Date(msg.receivedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{msg.fromAddress}</div>
          </button>
          {expandedId === msg.id && <MessageView message={msg} />}
        </div>
      ))}
    </div>
  );
}
