import {
  onlineManager,
  useIsFetching,
  useIsMutating,
} from "@tanstack/react-query";
import { Loader2, type LucideIcon, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/shared/lib/utils";

export const SYNC_INDICATOR_LABEL = "Synchronisiert…";
export const OFFLINE_INDICATOR_LABEL = "Offline";

// A sync backed by an optimistic mutation can settle in well under a frame, so
// the pill would flash imperceptibly. Once shown, hold it for at least this long
// so the user actually registers that their change was synced.
const MIN_VISIBLE_MS = 900;

// Tracks the shared onlineManager (seeded from navigator.onLine in main.tsx and
// updated on the browser online/offline events) so the indicator can distinguish
// "actively syncing" from "offline, waiting to sync".
function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true
  );
}

function IndicatorPill({
  icon: Icon,
  label,
  spin,
}: {
  icon: LucideIcon;
  label: string;
  spin: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed z-30 flex items-center gap-2 rounded-full border bg-popover px-3 py-1.5 text-popover-foreground text-sm shadow-lg",
        "right-[max(env(safe-area-inset-right),1rem)] bottom-[max(env(safe-area-inset-bottom),1rem)]"
      )}
      role="status"
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4 text-muted-foreground", spin && "animate-spin")}
      />
      <span className="font-medium">{label}</span>
    </div>
  );
}

/**
 * Bottom-right floating pill for a board's sync state. Offline takes precedence:
 * a paused write still counts as pending, so while offline it shows a persistent
 * "Offline" badge rather than a misleading spinner. Online, it shows
 * "Synchronisiert…" while any board-scoped query or mutation is in flight, held
 * briefly then hidden. Board scope is read from `meta.scope.board` on queries and
 * mutations (set by the tasks feature) — the query-key shape is never inspected,
 * so a new board-scoped query family is covered automatically as long as it
 * carries the meta. Fixed + `pointer-events-none` so it floats over the board
 * without ever blocking a tap, and respects the iOS safe-area insets.
 */
export function SyncIndicator({ boardId }: { boardId: string }) {
  const isOnline = useIsOnline();
  const fetching = useIsFetching({
    predicate: (query) => query.meta?.scope?.board === boardId,
  });
  const mutating = useIsMutating({
    predicate: (mutation) => mutation.meta?.scope?.board === boardId,
  });
  const syncing = isOnline && (fetching > 0 || mutating > 0);

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

  if (!isOnline) {
    return (
      <IndicatorPill
        icon={WifiOff}
        label={OFFLINE_INDICATOR_LABEL}
        spin={false}
      />
    );
  }
  if (!visible) {
    return null;
  }
  return <IndicatorPill icon={Loader2} label={SYNC_INDICATOR_LABEL} spin />;
}
