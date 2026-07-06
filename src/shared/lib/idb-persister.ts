import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { AsyncStorage } from "@tanstack/react-query-persist-client";
import { clear, createStore, del, get, set } from "idb-keyval";
import { SUPABASE_AUTH_STORAGE_KEY } from "./supabase";

/**
 * Offline-first cache persistence. The dehydrated TanStack Query client +
 * paused task mutations are written to IndexedDB so the installed PWA renders
 * board data on a cold offline launch and resumes offline writes on reconnect.
 */

// Bump ONLY when the shape of what we persist changes incompatibly (query-key
// scheme, dehydrate allowlist, task mutation variable shapes). Bumping discards
// every persisted cache on next launch. It is deliberately NOT tied to the
// build hash: busting on every deploy would wipe users' offline data on every
// release, defeating the point of persistence.
const CACHE_SCHEMA_VERSION = "1";

// One IndexedDB store holds the single dehydrated-client blob. idb-keyval keeps
// writes off the main thread (unlike synchronous localStorage) and is not bound
// by the ~5 MB localStorage cap.
const QUERY_CACHE_STORE = createStore("pinnwand-cache", "query-cache");
const QUERY_CACHE_KEY = "pinnwand-query-cache";

// Throttle dehydration writes so rapid mutations don't thrash IndexedDB.
const PERSIST_THROTTLE_MS = 1000;
// Stale persisted caches self-expire. 7 days matches iOS Safari's aggressive
// eviction of PWA storage after ~1 week of inactivity, so we never hydrate from
// a cache older than the platform would keep anyway.
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const idbStorage: AsyncStorage<string> = {
  getItem: (key) => get<string>(key, QUERY_CACHE_STORE).then((v) => v ?? null),
  setItem: (key, value) => set(key, value, QUERY_CACHE_STORE),
  removeItem: (key) => del(key, QUERY_CACHE_STORE),
};

/**
 * Reads the signed-in user id from the persisted Supabase session in
 * localStorage, synchronously, at startup. Used to partition the persisted
 * cache per user via the `buster`: a blob written by user A carries A's id in
 * its buster, so when user B launches the app, TanStack's buster check fails to
 * match and the blob is discarded rather than hydrated into B's session. Never
 * throws — an unreadable/absent session yields the anonymous partition.
 */
export function startupUserId(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "user" in parsed &&
      parsed.user &&
      typeof parsed.user === "object" &&
      "id" in parsed.user &&
      typeof parsed.user.id === "string"
    ) {
      return parsed.user.id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The cache buster. Combines the schema version with the per-user partition so
 * an incompatible deploy OR a different user both result in the stored blob
 * being discarded instead of restored.
 */
export function cacheBuster(userId: string | null): string {
  return `${CACHE_SCHEMA_VERSION}:${userId ?? "anonymous"}`;
}

export function createIdbPersister() {
  return createAsyncStoragePersister({
    storage: idbStorage,
    key: QUERY_CACHE_KEY,
    throttleTime: PERSIST_THROTTLE_MS,
  });
}

/**
 * Purges the persisted cache from device storage. Called on sign-out so a
 * shared device never carries one user's board data into the next session.
 * Clearing the whole store (not just the keyed blob) also discards any blob a
 * prior schema version wrote under a different key.
 */
export async function purgePersistedCache(): Promise<void> {
  await clear(QUERY_CACHE_STORE);
}
