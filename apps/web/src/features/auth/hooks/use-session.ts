import { useQuery } from "@tanstack/react-query";
import { AUTH_KEYS, getSession } from "../api/auth";
import type { AuthSession, AuthUser } from "../types";

type UseSessionResult = {
  session: AuthSession | null;
  user: AuthUser | null;
  isLoading: boolean;
  isError: boolean;
};

export function useSession(): UseSessionResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: AUTH_KEYS.session(),
    queryFn: getSession,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return {
    session: data ?? null,
    user: data?.user ?? null,
    isLoading,
    isError,
  };
}
