import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "../hooks/use-api";
import DOMPurify from "dompurify";

export function MessageRoute() {
  const { accountId, messageId } = useParams({
    from: "/accounts/$accountId/messages/$messageId",
  });
  const navigate = useNavigate();
  const { data } = useMessages(accountId, true);
  const messages = data?.ok ? data.data : [];
  const message = messages.find((m) => m.id === messageId);

  if (!message) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Message not found
      </div>
    );
  }

  const sanitizedHtml = message.htmlContent ? DOMPurify.sanitize(message.htmlContent) : null;

  const srcDoc = sanitizedHtml
    ? `<!DOCTYPE html><html><head><base target="_blank"><meta http-equiv="Content-Security-Policy" content="script-src 'none';"><style>body{margin:0;padding:12px;font-family:system-ui,sans-serif;font-size:14px;color:#333;background:#fff;}</style></head><body>${sanitizedHtml}</body></html>`
    : null;

  return (
    <div className="flex flex-col max-h-[500px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-[var(--header-h)] border-b border-border">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate({ to: "/accounts/$accountId", params: { accountId } })}
          title="Back to messages"
        >
          <ArrowLeft />
        </Button>
        <span className="text-xs text-muted-foreground">Back to messages</span>
      </div>

      {/* Metadata */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold text-foreground">
          {message.subject ?? "(no subject)"}
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          {message.fromAddress} ·{" "}
          {new Date(message.receivedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {srcDoc ? (
          <iframe
            srcDoc={srcDoc}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="w-full min-h-[200px] border border-border rounded bg-white"
            title="Email content"
          />
        ) : (
          <pre className="text-xs text-foreground whitespace-pre-wrap break-words bg-secondary/50 rounded p-3">
            {message.textContent ?? "(empty message)"}
          </pre>
        )}
      </div>
    </div>
  );
}
