import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth";
import { BOARD_KEYS, joinBoardByCode } from "../api/boards";
import type { Board } from "../types";

export function useJoinBoard() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation<Board, Error, { code: string }>({
    mutationFn: joinBoardByCode,
    networkMode: "always",
    // The caller renders its own inline error under the code input; suppress
    // the global toast to avoid doubling up.
    meta: { op: "joinByCode", suppressToast: true },
    onSuccess: () => {
      if (user) {
        queryClient.invalidateQueries({ queryKey: BOARD_KEYS.byUser(user.id) });
      }
    },
  });
}
