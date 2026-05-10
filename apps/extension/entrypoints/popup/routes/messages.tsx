import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Copy, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages, useMarkRead, useDeleteAccount, useEmailAccounts } from "../hooks/use-api";

export function MessagesRoute() {
  const { accountId } = useParams({ from: "/accounts/$accountId" });
  const navigate = useNavigate();
  const { data: accountsData } = useEmailAccounts();
  const { data, isLoading } = useMessages(accountId, true);
  const markRead = useMarkRead();
  const deleteAccount = useDeleteAccount();
  const [copied, setCopied] = useState(false);

  const accounts = accountsData?.ok ? accountsData.data : [];
  const account = accounts.find((a) => a.id === accountId);
  const email = account?.email ?? "";

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    deleteAccount.mutate(accountId);
    navigate({ to: "/" });
  }

  function handleSelectMessage(messageId: string, isRead: boolean) {
    if (!isRead) {
      markRead.mutate({ accountId, messageId, isRead: true });
    }
    navigate({
      to: "/accounts/$accountId/messages/$messageId",
      params: { accountId, messageId },
    });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate({ to: "/" })} title="Back">
          <ArrowLeft />
        </Button>
        <span className="text-xs font-mono text-foreground truncate flex-1">{email}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon-sm" onClick={handleCopy} title="Copy email">
            {copied ? <Check className="text-green-500" /> : <Copy />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDelete}
            disabled={deleteAccount.isPending}
            title="Delete account"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {/* Messages */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : !data?.ok ? (
        <div className="p-3 text-xs text-destructive">Failed to load messages</div>
      ) : data.data.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          No messages yet
        </div>
      ) : (
        <div className="divide-y divide-border">
          {data.data.map((msg) => (
            <button
              key={msg.id}
              type="button"
              onClick={() => handleSelectMessage(msg.id, msg.isRead)}
              className="w-full text-left px-4 py-3 hover:bg-secondary/30 transition-colors"
            >
              <div
                className={`text-xs truncate ${msg.isRead ? "text-muted-foreground" : "text-foreground font-semibold"}`}
              >
                {msg.subject ?? "(no subject)"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {msg.fromAddress} ·{" "}
                {new Date(msg.receivedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
