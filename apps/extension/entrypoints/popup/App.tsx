import { useState } from "react";

type MeResponse =
  | { ok: true; user: { userId: string; createdAt: string; isAnonymous: boolean } }
  | { ok: false; error: string };

export default function App() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<MeResponse | null>(null);

  async function handleClick() {
    setStatus("loading");
    try {
      const response = (await chrome.runtime.sendMessage({ type: "GET_ME" })) as MeResponse;
      setResult(response);
      setStatus(response.ok ? "done" : "error");
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
      setStatus("error");
    }
  }

  return (
    <main
      style={{
        padding: 16,
        minWidth: 320,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      <h1 style={{ fontSize: 16, margin: "0 0 12px 0" }}>burner-kit</h1>

      <button
        onClick={handleClick}
        disabled={status === "loading"}
        style={{
          padding: "6px 12px",
          fontSize: 13,
          cursor: status === "loading" ? "wait" : "pointer",
        }}
      >
        {status === "loading" ? "Loading…" : "Who am I?"}
      </button>

      {status === "done" && result?.ok && (
        <pre
          style={{
            marginTop: 12,
            padding: 8,
            background: "#f4f4f4",
            borderRadius: 4,
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {JSON.stringify(result.user, null, 2)}
        </pre>
      )}

      {status === "error" && result && !result.ok && (
        <p style={{ marginTop: 12, color: "#c00" }}>Error: {result.error}</p>
      )}
    </main>
  );
}
