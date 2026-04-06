import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import App from "./App";
import "../../app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000, // data considered fresh for 30s
      gcTime: 1000 * 60 * 60, // keep unused cache for 1 hour
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "burner-kit-query-cache",
  throttleTime: 1_000,
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 }}
    >
      <App />
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
