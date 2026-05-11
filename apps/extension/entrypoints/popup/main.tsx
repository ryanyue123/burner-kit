import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { useLatestCode } from "./hooks/use-api";
import "../../app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60,
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "burner-kit-query-cache",
  throttleTime: 1_000,
});

function AutoCopy() {
  const { data } = useLatestCode();

  useEffect(() => {
    if (!data?.ok) return;
    const ageMs = Date.now() - data.data.receivedAt;
    if (ageMs > 5 * 60 * 1000) return;
    navigator.clipboard.writeText(data.data.code).catch(() => {
      // ignore: focus/permission errors
    });
  }, [data]);

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
