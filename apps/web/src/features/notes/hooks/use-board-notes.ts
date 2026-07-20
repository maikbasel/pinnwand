import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listBoardNotes, NOTE_KEYS } from "../api/notes";
import type { Note } from "../types";

export function useBoardNotes(boardId: string): {
  notes: Note[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const { data, isPending, isError, error } = useQuery({
    queryKey: NOTE_KEYS.byBoard(boardId),
    queryFn: () => listBoardNotes(boardId),
    enabled: !!boardId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    meta: { op: "listBoardNotes", scope: { board: boardId } },
  });
  return { notes: data ?? [], isPending, isError, error };
}
