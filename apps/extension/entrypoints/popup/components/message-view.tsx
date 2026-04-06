import type { EmailMessage } from "@/lib/api-client";
import { useRef, useEffect } from "react";

export function MessageView({ message }: { message: EmailMessage }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (message.htmlContent && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(message.htmlContent);
        doc.close();
      }
    }
  }, [message.htmlContent]);

  if (message.htmlContent) {
    return (
      <div className="px-3 pb-3">
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          className="w-full min-h-[200px] border border-border rounded bg-white"
          title="Email content"
        />
      </div>
    );
  }

  return (
    <div className="px-3 pb-3">
      <pre className="text-xs text-foreground whitespace-pre-wrap break-words bg-secondary/50 rounded p-2">
        {message.textContent ?? "(empty message)"}
      </pre>
    </div>
  );
}
