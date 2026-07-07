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
    meta: { op: "createBoard" },
    onSuccess: () => {
      if (user) {
        queryClient.invalidateQueries({ queryKey: BOARD_KEYS.byUser(user.id) });
      }
    },
  });
}
