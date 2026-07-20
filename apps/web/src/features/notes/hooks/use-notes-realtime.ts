import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { noop } from "@/shared/lib/noop";
import { supabase } from "@/shared/lib/supabase";
import { NOTE_KEYS } from "../api/notes";

/**
 * Keeps the notes list fresh when another member creates, renames, or deletes
 * a note. Per tanstack-query.md, realtime only invalidates; it never merges
 * payloads into the cache by hand.
 *
 * Document content is not handled here. That rides note_updates and is applied
 * to the Y.Doc by use-note-doc.
 */
export function useNotesRealtime(boardId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!boardId) {
      return;
    }
    const channel = supabase
      .channel(`board-notes:${boardId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notes",
          filter: `board_id=eq.${boardId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: NOTE_KEYS.byBoard(boardId),
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel).then(noop, noop);
    };
  }, [boardId, queryClient]);
}
