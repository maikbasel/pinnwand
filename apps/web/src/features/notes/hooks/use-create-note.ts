import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createNote, NOTE_KEYS, NOTE_MUTATION_KEYS } from "../api/notes";
import { UNTITLED_NOTE } from "../lib/title";
import type { Note } from "../types";

export function useCreateNote(boardId: string): {
  createNote: () => Promise<Note>;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: NOTE_MUTATION_KEYS.forBoard(boardId),
    mutationFn: () => createNote({ boardId, title: UNTITLED_NOTE }),
    networkMode: "always",
    meta: { op: "createNote", scope: { board: boardId } },
    onSuccess: (note) => {
      queryClient.setQueryData<Note[]>(
        NOTE_KEYS.byBoard(boardId),
        (previous) => [note, ...(previous ?? [])]
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: NOTE_KEYS.byBoard(boardId),
      });
    },
  });
  return {
    createNote: () => mutation.mutateAsync(),
    isPending: mutation.isPending,
  };
}
