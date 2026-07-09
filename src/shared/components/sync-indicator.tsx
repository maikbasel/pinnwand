import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

export const SYNC_INDICATOR_LABEL = "Synchronisiert…";

// A sync backed by an optimistic mutation can settle in well under a frame, so
// the pill would flash imperceptibly. Once shown, hold it for at least this long
// so the user actually registers that their change was synced.
const MIN_VISIBLE_MS = 900;

/**
 * Bottom-right floating pill shown while any board-scoped query or mutation is
 * in flight, then held briefly and hidden. Board scope is read from
 * `meta.scope.board` on queries and mutations (set by the tasks feature) — the
 * query-key shape is never inspected, so a new board-scoped query family is
 * covered automatically as long as it carries the meta. Fixed +
 * `pointer-events-none` so it floats over the board without ever blocking a tap,
 * and respects the iOS safe-area insets.
 */
export function SyncIndicator({ boardId }: { boardId: string }) {
  const fetching = useIsFetching({
    predicate: (query) => query.meta?.scope?.board === boardId,
  });
  const mutating = useIsMutating({
    predicate: (mutation) => mutation.meta?.scope?.board === boardId,
  });
  const syncing = fetching > 0 || mutating > 0;

  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (syncing) {
      if (!visible) {
        shownAt.current = performance.now();
        setVisible(true);
      }
      return;
    }
    if (!visible) {
      return;
    }
    const remaining = MIN_VISIBLE_MS - (performance.now() - shownAt.current);
    if (remaining <= 0) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [syncing, visible]);

  if (!visible) {
    return null;
  }
  return (
    <div
      className={cn(
        "pointer-events-none fixed z-30 flex items-center gap-2 rounded-full border bg-popover px-3 py-1.5 text-popover-foreground text-sm shadow-lg",
        "right-[max(env(safe-area-inset-right),1rem)] bottom-[max(env(safe-area-inset-bottom),1rem)]"
      )}
      role="status"
    >
      <Loader2
        aria-hidden="true"
        className="size-4 animate-spin text-muted-foreground"
      />
      <span className="font-medium">{SYNC_INDICATOR_LABEL}</span>
    </div>
  );
}
