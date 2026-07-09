import { useQuery } from "@tanstack/react-query";
import { listBoardMembers, MEMBER_KEYS } from "../api/members";
import type { BoardMember } from "../types";

export function useBoardMembers(boardId: string): {
  members: BoardMember[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const { data, isPending, isError, error } = useQuery({
    queryKey: MEMBER_KEYS.byBoard(boardId),
    queryFn: () => listBoardMembers(boardId),
    enabled: !!boardId,
    staleTime: 60_000,
    meta: { op: "listBoardMembers", scope: { board: boardId } },
  });
  return { members: data ?? [], isPending, isError, error };
}
