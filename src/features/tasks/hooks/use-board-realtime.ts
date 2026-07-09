import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { noop } from "@/shared/lib/noop";
import { supabase } from "@/shared/lib/supabase";
import { TASK_KEYS } from "../api/tasks";

/**
 * Subscribes the board to Postgres change events and invalidates the board's
 * task query on any write, so the other tab reconciles within a second. Both
 * `tasks` (scoped to this board) and `task_assignees` (no `board_id` column, so
 * unfiltered) route through a single channel. Per tanstack-query.md, realtime
 * only invalidates — it never merges payloads into the cache by hand.
 */
export function useBoardRealtime(boardId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!boardId) {
      return;
    }
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: TASK_KEYS.byBoard(boardId) });
    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `board_id=eq.${boardId}`,
        },
        invalidate
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_assignees" },
        invalidate
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel).then(noop, noop);
    };
  }, [boardId, queryClient]);
}
