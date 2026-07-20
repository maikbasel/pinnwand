import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteNote, NOTE_KEYS, NOTE_MUTATION_KEYS } from "../api/notes";
import type { Note } from "../types";

export function useDeleteNote(boardId: string): {
  deleteNote: (noteId: string) => Promise<void>;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation<void, Error, string, { previous: Note[] }>({
    mutationKey: NOTE_MUTATION_KEYS.forBoard(boardId),
    mutationFn: (noteId) => deleteNote(noteId),
    networkMode: "always",
    meta: { op: "deleteNote", scope: { board: boardId } },
    onMutate: async (noteId) => {
      await queryClient.cancelQueries({ queryKey: NOTE_KEYS.byBoard(boardId) });
      const previous =
        queryClient.getQueryData<Note[]>(NOTE_KEYS.byBoard(boardId)) ?? [];
      queryClient.setQueryData<Note[]>(
        NOTE_KEYS.byBoard(boardId),
        previous.filter((note) => note.id !== noteId)
      );
      return { previous };
    },
    onError: (_error, _noteId, context) => {
      if (context) {
        queryClient.setQueryData(NOTE_KEYS.byBoard(boardId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: NOTE_KEYS.byBoard(boardId),
      });
    },
  });
  return {
    deleteNote: (noteId) => mutation.mutateAsync(noteId),
    isPending: mutation.isPending,
  };
}
