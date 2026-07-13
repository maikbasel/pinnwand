import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { purgePersistedCache } from "@/shared/lib/idb-persister";
import { noop } from "@/shared/lib/noop";
import { AUTH_KEYS, signOut } from "../api/auth";

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<void, never, void>({
    // Sign-out is an exit path: a failing remote call (offline, expired token)
    // must not prevent the local cache clear and redirect.
    mutationFn: async () => {
      try {
        await signOut();
      } catch {
        // intentionally swallowed; the user is leaving regardless
      }
    },
    onSettled: async () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== AUTH_KEYS.all[0],
      });
      queryClient.setQueryData(AUTH_KEYS.session(), null);
      // Purge the persisted offline cache so a shared device never carries
      // this user's board data into the next session. Best-effort.
      await purgePersistedCache().then(noop, noop);
      await navigate({ to: "/sign-in" });
    },
  });
}
