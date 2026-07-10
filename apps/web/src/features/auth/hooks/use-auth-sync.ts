import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AUTH_KEYS, subscribeToAuthChanges } from "../api/auth";

// Mirrors GoTrue's onAuthStateChange into the query cache. setQueryData with
// the authoritative event payload (not invalidate; the "invalidate, don't
// merge" rule is about postgres_changes data, not the auth event).
export function useAuthSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((session) => {
      queryClient.setQueryData(AUTH_KEYS.session(), session);
    });
    return unsubscribe;
  }, [queryClient]);
}
