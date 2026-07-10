import { onlineManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { seedSessionFromStorage } from "@/features/auth";
import { registerTaskMutationDefaults } from "@/features/tasks";
import {
  cacheBuster,
  createIdbPersister,
  PERSIST_MAX_AGE_MS,
  startupUserId,
} from "@/shared/lib/idb-persister";
import { noop } from "@/shared/lib/noop";
import {
  queryClient,
  shouldDehydrateOfflineMutation,
  shouldDehydrateOfflineQuery,
} from "@/shared/lib/query-client";
import "./index.css";
import { RouterError, RouterPending } from "./router-fallbacks";
import { routeTree } from "./routeTree.gen";

// Seed the online state from the browser at startup. onlineManager defaults to
// "online" and only flips on an online/offline event, so a cold launch while
// offline would otherwise let a mutation run (and fail) instead of pausing.
if (typeof navigator !== "undefined") {
  onlineManager.setOnline(navigator.onLine);
}

// Each offline-first feature registers its resumable mutation defaults here
// (via queryClient.setMutationDefaults) BEFORE the persister resumes a write
// queued in a prior offline session. A resumed mutation has no React hook to
// supply its mutationFn; the registered default provides it.
registerTaskMutationDefaults(queryClient);

// Prime the session cache synchronously from Supabase's stored blob so the
// route guard resolves a returning user on a cold (possibly offline) boot
// without a blocking getSession().
seedSessionFromStorage(queryClient);

const persister = createIdbPersister();
// The buster folds in the user id read synchronously from the persisted
// session, so a blob written by another user (shared device) fails the buster
// check and is discarded rather than hydrated into this session.
const persistOptions = {
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: cacheBuster(startupUserId()),
  dehydrateOptions: {
    shouldDehydrateQuery: shouldDehydrateOfflineQuery,
    shouldDehydrateMutation: shouldDehydrateOfflineMutation,
  },
};

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: { queryClient },
  defaultPendingComponent: RouterPending,
  defaultErrorComponent: RouterError,
  defaultPendingMs: 300,
});

declare module "@tanstack/react-router" {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging requires interface (TanStack Router Register)
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      onSuccess={() => {
        // Restore finished: replay any task mutations queued in a prior offline
        // session. Reconnect-driven resume is automatic; this covers the
        // cold-start-after-restart path. Fire-and-forget with explicit
        // handlers; failures surface through the global MutationCache.onError.
        queryClient.resumePausedMutations().then(noop, noop);
      }}
      persistOptions={persistOptions}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>
);
