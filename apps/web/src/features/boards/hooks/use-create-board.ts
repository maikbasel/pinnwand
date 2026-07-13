import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth";
import { BOARD_KEYS, createBoard } from "../api/boards";
import type { Board } from "../types";

export function useCreateBoard() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation<Board, Error, { name: string }>({
    mutationFn: createBoard,
    networkMode: "always",
    // The CreateBoardEntry surface renders its own inline error; suppress the
    // global toast so a failed create is not reported twice.
    meta: { op: "createBoard", suppressToast: true },
    onSuccess: () => {
      if (user) {
        queryClient.invalidateQueries({ queryKey: BOARD_KEYS.byUser(user.id) });
      }
    },
  });
}
