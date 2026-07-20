import {
  defaultShouldDehydrateMutation,
  defaultShouldDehydrateQuery,
  type Mutation,
  MutationCache,
  type Query,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { PERSIST_MAX_AGE_MS } from "./idb-persister";

const AUTH_ERROR_PATTERN = /JWT|auth/i;

// Query-key first segments whose data must be available offline (the board
// surface). Everything else stays out of the persisted blob: the auth session,
// and any join-code/sharing sub-trees.
const OFFLINE_QUERY_ROOTS: ReadonlySet<string> = new Set([
  "boards",
  "tasks",
  "notes",
  "board-members",
  // The viewer's own profile row (display name). Per-user buster, not shared.
  "profile",
]);

// Sub-trees under `boards` that are sharing-only (join-code preview/lookup):
// network-only, never written to device storage.
const SHARING_BOARD_SUBKEYS: ReadonlySet<string> = new Set([
  "joinPreview",
  "joinPreviewByCode",
]);

/**
 * Allowlist of what gets persisted to IndexedDB for offline board work. Persist
 * only successful board/task/member/profile reads, never the auth session
 * (Supabase owns that in its own storage) and never the sharing sub-trees.
 * Exported for unit coverage of the predicate.
 */
export function shouldDehydrateOfflineQuery(query: Query): boolean {
  if (!defaultShouldDehydrateQuery(query)) {
    return false;
  }
  const [root, sub] = query.queryKey;
  if (typeof root !== "string" || !OFFLINE_QUERY_ROOTS.has(root)) {
    return false;
  }
  if (root === "boards" && typeof sub === "string") {
    return !SHARING_BOARD_SUBKEYS.has(sub);
  }
  return true;
}

// First segment of every durable mutation key. Task writes (create, edit, move
// between columns, reorder, delete, assign) use the resumable
// `[root, op, boardId]` shape and must survive an offline app restart. Board
// create/join/rename/delete run network-only (they need the server), are never
// paused, and so never reach persistence.
const DURABLE_MUTATION_ROOTS: ReadonlySet<string> = new Set(["tasks", "notes"]);

/**
 * Allowlist of what gets persisted to IndexedDB for offline writes. Only paused
 * task mutations are durable; everything else (board/membership/join) is
 * online-only and must not be queued across a restart. Exported for unit
 * coverage of the predicate.
 */
export function shouldDehydrateOfflineMutation(mutation: Mutation): boolean {
  if (!defaultShouldDehydrateMutation(mutation)) {
    return false;
  }
  const root = mutation.options.mutationKey?.[0];
  return typeof root === "string" && DURABLE_MUTATION_ROOTS.has(root);
}

/**
 * Optional per-mutation / per-query meta. Tag a mutation with `op` for
 * diagnostics; set `suppressToast: true` when the call site renders its own
 * error UI and would double up with the global toast. Set `scope.board` on a
 * query that reads data scoped to a single board so a future sync indicator can
 * pick it up without inspecting the query-key shape.
 */
type PinnwandMeta = {
  op?: string;
  suppressToast?: boolean;
  scope?: {
    board?: string;
  };
};

declare module "@tanstack/react-query" {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging requires interface
  interface Register {
    mutationMeta: PinnwandMeta;
    queryMeta: PinnwandMeta;
  }
}

function readMeta(meta: unknown): PinnwandMeta {
  if (meta && typeof meta === "object") {
    return meta as PinnwandMeta;
  }
  return {};
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Must be >= the persister's maxAge: a query garbage-collected from
      // memory is dropped from the next dehydration, so a short gcTime would
      // silently shrink the offline cache. Keeping board queries resident for
      // the persist window keeps the cold-offline-launch set complete.
      gcTime: PERSIST_MAX_AGE_MS,
      retry: (failureCount, error) => {
        if (error instanceof Error && AUTH_ERROR_PATTERN.test(error.message)) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const meta = readMeta(mutation.meta);
      if (!meta.suppressToast) {
        const message =
          error instanceof Error ? error.message : "Etwas ist schiefgelaufen.";
        toast.error(message);
      }
    },
  }),
  queryCache: new QueryCache({
    // Queries default to no toast; most query errors are surfaced inline
    // (skeletons / empty states / inline error text) by the consumer hook.
  }),
});
