import { useState } from "react";
import { useDeleteAccount } from "../hooks/use-api";
import { MessageList } from "./message-list";
import type { EmailAccount } from "@/lib/api-client";

export function AccountList({ accounts }: { accounts: EmailAccount[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const deleteAccount = useDeleteAccount();

  function handleCopy(email: string) {
    navigator.clipboard.writeText(email);
  }

  return (
    <div className="divide-y divide-border">
      {accounts.map((account) => {
        const isExpanded = expandedId === account.id;
        return (
          <div key={account.id}>
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : account.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-muted-foreground">
                  {isExpanded ? "\u25BC" : "\u25B6"}
                </span>
                <span className="text-xs font-mono text-foreground truncate">
                  {account.email}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(account.unreadCount ?? 0) > 0 && (
                  <span className="bg-destructive text-destructive-foreground text-[9px] px-1.5 py-0.5 rounded-full font-semibold">
                    {account.unreadCount}
                  </span>
                )}
                <button
                  type="button"
                  className="text-primary hover:text-primary/80 text-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(account.email);
                  }}
                  title="Copy"
                >
                  {"\u{1F4CB}"}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive text-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAccount.mutate(account.id);
                  }}
                  title="Delete"
                >
                  {"\u{1F5D1}"}
                </button>
              </div>
            </div>
            {isExpanded && <MessageList accountId={account.id} />}
          </div>
        );
      })}
    </div>
  );
}
