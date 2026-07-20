import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { noop } from "@/shared/lib/noop";
import { NOTE_KEYS, setNoteTitle } from "../api/notes";
import { UPDATE_FLUSH_MS } from "../lib/note-doc";

/**
 * Owns the debounced title write for a note: derives nothing itself (callers
 * pass the already-derived title), skips redundant writes, and flushes a
 * pending write on unmount instead of dropping it (e.g. the user navigates
 * back within UPDATE_FLUSH_MS).
 */
export function useSetNoteTitle(
  noteId: string,
  boardId: string
): (title: string) => void {
  const queryClient = useQueryClient();
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTitle = useRef<string>("");
  const pendingTitle = useRef<string>("");

  useEffect(
    () => () => {
      if (titleTimer.current === null) {
        return;
      }
      // A debounced title write was still pending when the panel unmounted.
      // Cancelling the timer alone would drop that write silently, so flush
      // it immediately instead — the effect cleanup runs before teardown.
      clearTimeout(titleTimer.current);
      titleTimer.current = null;
      const next = pendingTitle.current;
      if (next === lastTitle.current) {
        return;
      }
      lastTitle.current = next;
      setNoteTitle({ noteId, title: next })
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: NOTE_KEYS.byBoard(boardId),
          })
        )
        .then(noop, noop);
    },
    [noteId, boardId, queryClient]
  );

  return useCallback(
    (title: string) => {
      pendingTitle.current = title;
      if (titleTimer.current !== null) {
        clearTimeout(titleTimer.current);
      }
      titleTimer.current = setTimeout(() => {
        titleTimer.current = null;
        const next = pendingTitle.current;
        if (next === lastTitle.current) {
          return;
        }
        lastTitle.current = next;
        setNoteTitle({ noteId, title: next })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: NOTE_KEYS.byBoard(boardId),
            })
          )
          .catch(() => {
            // The title is a derived cache. A failed write is corrected on
            // the next edit, so it must not interrupt writing with a toast.
            lastTitle.current = "";
          });
      }, UPDATE_FLUSH_MS);
    },
    [noteId, boardId, queryClient]
  );
}
