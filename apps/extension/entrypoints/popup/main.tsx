import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryCache, QueryClient, type QueryKey } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { RouterProvider } from "@tanstack/react-router";
import { useCopyToClipboard } from "@uidotdev/usehooks";
import { router } from "./router";
import { useLatestCode } from "./hooks/use-api";
import "../../app.css";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: { invalidates?: readonly QueryKey[] };
    mutationMeta: { invalidates?: readonly QueryKey[] };
  }
}

const queryCache = new QueryCache({
  onSuccess: (_data, query) => {
    query.meta?.invalidates?.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
  },
});

const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60,
    },
  },
});

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (typeof msg !== "object" || msg === null) return;
  const m = msg as { type?: string; payload?: { type?: string; accountId?: string } };
  if (m.type !== "CHANNEL_PUSH") return;
  const payload = m.payload;
  if (payload?.type !== "ready" && payload?.type !== "message") return;
  queryClient.invalidateQueries({ queryKey: ["latest-code"] });
  if (payload.accountId) {
    queryClient.invalidateQueries({ queryKey: ["messages", payload.accountId] });
  }
  queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "burner-kit-query-cache",
  throttleTime: 1_000,
});

function AutoCopy() {
  const { data } = useLatestCode();
  const [, copyToClipboard] = useCopyToClipboard();

  useEffect(() => {
    if (!data?.ok) return;
    const ageMs = Date.now() - data.data.receivedAt;
    if (ageMs > 5 * 60 * 1000) return;
    copyToClipboard(data.data.code);
  }, [data, copyToClipboard]);

  return null;
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 }}
    >
      <AutoCopy />
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
