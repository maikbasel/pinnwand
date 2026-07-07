import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth";
import { BOARD_KEYS, listMyBoards } from "../api/boards";
import type { BoardMembership } from "../types";

type UseMyBoardsResult = {
  memberships: BoardMembership[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

export function useMyBoards(): UseMyBoardsResult {
  const { user } = useSession();
  const { data, isPending, isError, error } = useQuery({
    queryKey: user ? BOARD_KEYS.byUser(user.id) : BOARD_KEYS.all,
    // biome-ignore lint/style/noNonNullAssertion: gated by `enabled: !!user`
    queryFn: () => listMyBoards(user!.id),
    enabled: !!user,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    meta: { op: "listMyBoards" },
  });
  return {
    memberships: data ?? [],
    isPending,
    isError,
    error,
  };
}
