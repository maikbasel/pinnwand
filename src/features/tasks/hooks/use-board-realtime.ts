import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { noop } from "@/shared/lib/noop";
import { supabase } from "@/shared/lib/supabase";
import { TASK_KEYS } from "../api/tasks";

// True once the channel handshake completes; until then a write on another
// client is not yet observed here. Callers can gate on this (e.g. a connection
// hint, or an e2e waiting for the second client to be live before writing).
export type BoardRealtimeStatus = { subscribed: boolean };

/**
 * Subscribes the board to Postgres change events and invalidates the board's
 * task query on any write, so the other tab reconciles within a second. Both
 * `tasks` (scoped to this board) and `task_assignees` (no `board_id` column, so
 * unfiltered) route through a single channel. Per tanstack-query.md, realtime
 * only invalidates — it never merges payloads into the cache by hand. Returns
 * the live subscription status.
 */
export function useBoardRealtime(boardId: string): BoardRealtimeStatus {
  const queryClient = useQueryClient();
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    if (!boardId) {
      return;
    }
    setSubscribed(false);
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
      .subscribe((status) => setSubscribed(status === "SUBSCRIBED"));
    return () => {
      setSubscribed(false);
      supabase.removeChannel(channel).then(noop, noop);
    };
  }, [boardId, queryClient]);
  return { subscribed };
}
