import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth";
import {
  BOARD_KEYS,
  BOARD_MUTATION_KEYS,
  regenerateJoinCode,
} from "../api/boards";
import type { BoardMembership } from "../types";

export function useRegenerateJoinCode(boardId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();

  return useMutation<string, Error, void>({
    mutationFn: () => regenerateJoinCode({ boardId }),
    networkMode: "always",
    mutationKey: BOARD_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "regenerateJoinCode" },
    onSuccess: (newCode) => {
      if (!user) {
        return;
      }
      const queryKey = BOARD_KEYS.byUser(user.id);
      queryClient.setQueryData<BoardMembership[]>(queryKey, (current) =>
        current?.map((membership) =>
          membership.board.id === boardId
            ? {
                ...membership,
                board: { ...membership.board, joinCode: newCode },
              }
            : membership
        )
      );
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
