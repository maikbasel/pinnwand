import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth";
import { BOARD_KEYS, BOARD_MUTATION_KEYS, renameBoard } from "../api/boards";
import type { Board, BoardMembership } from "../types";

type RenameBoardContext = { previous: BoardMembership[] | undefined };

export function useRenameBoard(boardId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();

  return useMutation<Board, Error, { name: string }, RenameBoardContext>({
    mutationFn: (input) => renameBoard({ boardId, name: input.name }),
    networkMode: "always",
    mutationKey: BOARD_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "renameBoard" },
    onMutate: async (input) => {
      if (!user) {
        return { previous: undefined };
      }
      const queryKey = BOARD_KEYS.byUser(user.id);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BoardMembership[]>(queryKey);
      queryClient.setQueryData<BoardMembership[]>(queryKey, (current) =>
        current?.map((membership) =>
          membership.board.id === boardId
            ? {
                ...membership,
                board: { ...membership.board, name: input.name },
              }
            : membership
        )
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (user && context?.previous) {
        queryClient.setQueryData(BOARD_KEYS.byUser(user.id), context.previous);
      }
    },
    onSettled: () => {
      if (user) {
        queryClient.invalidateQueries({ queryKey: BOARD_KEYS.byUser(user.id) });
      }
    },
  });
}
