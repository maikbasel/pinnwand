import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth";
import { BOARD_KEYS, BOARD_MUTATION_KEYS, leaveBoard } from "../api/boards";
import type { BoardMembership } from "../types";

type LeaveBoardContext = { previous: BoardMembership[] | undefined };

export function useLeaveBoard(boardId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();

  return useMutation<void, Error, void, LeaveBoardContext>({
    // biome-ignore lint/style/noNonNullAssertion: leaving a board requires a signed-in user
    mutationFn: () => leaveBoard({ boardId, userId: user!.id }),
    networkMode: "always",
    mutationKey: BOARD_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "leaveBoard" },
    onMutate: async () => {
      if (!user) {
        return { previous: undefined };
      }
      const queryKey = BOARD_KEYS.byUser(user.id);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BoardMembership[]>(queryKey);
      queryClient.setQueryData<BoardMembership[]>(queryKey, (current) =>
        current?.filter((membership) => membership.board.id !== boardId)
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
