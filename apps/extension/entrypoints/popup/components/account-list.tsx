import { useState } from "react";
import { Copy, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeleteAccount } from "../hooks/use-api";
import type { EmailAccount } from "@/lib/api-client";

export function AccountList({
  accounts,
  onSelect,
}: {
  accounts: EmailAccount[];
  onSelect: (accountId: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const deleteAccount = useDeleteAccount();

  function handleCopy(e: React.MouseEvent, account: EmailAccount) {
    e.stopPropagation();
    navigator.clipboard.writeText(account.email);
    setCopiedId(account.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="divide-y divide-border">
      {accounts.map((account) => {
        const isCopied = copiedId === account.id;
        return (
          <div
            key={account.id}
            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={() => onSelect(account.id)}
          >
            <div className="min-w-0">
              <div className="text-xs font-mono text-foreground truncate">{account.email}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {(account.unreadCount ?? 0) > 0 ? `${account.unreadCount} unread` : "No messages"}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {(account.unreadCount ?? 0) > 0 && (
                <span className="bg-destructive text-destructive-foreground text-[9px] px-1.5 py-0.5 rounded-full font-semibold">
                  {account.unreadCount}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => handleCopy(e, account)}
                title="Copy email"
              >
                {isCopied ? <Check className="text-green-500" /> : <Copy />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteAccount.mutate(account.id);
                }}
                disabled={deleteAccount.isPending}
                title="Delete"
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
