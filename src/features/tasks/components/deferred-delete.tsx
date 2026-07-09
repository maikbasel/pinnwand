import { Trash2 } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { useDeleteTask } from "../hooks/use-delete-task";
import { TASK_DELETED_TOAST, UNDO_LABEL } from "../lib/copy";
import type { Task } from "../types";

const UNDO_WINDOW_MS = 5000;

type DeferredDeleteApi = {
  requestDelete: (task: Task) => void;
  pendingDeleteIds: ReadonlySet<string>;
};

const DeferredDeleteContext = createContext<DeferredDeleteApi | null>(null);

/**
 * Board-scoped deferred delete. `requestDelete` hides the card immediately (via
 * `pendingDeleteIds`, which the board filters out) and opens a ~5s Undo
 * snackbar. If the window elapses untouched, the real optimistic DELETE fires;
 * if the user taps Undo, the timer is cancelled and the card reappears. Timers
 * are cleared on unmount so a pending delete never fires after the board is
 * gone.
 */
export function DeferredDeleteProvider({
  boardId,
  children,
}: {
  boardId: string;
  children: ReactNode;
}) {
  const deleteTask = useDeleteTask(boardId);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clear = useCallback((taskId: string) => {
    const timer = timers.current.get(taskId);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(taskId);
    }
  }, []);

  const drop = useCallback((taskId: string) => {
    setPending((cur) => {
      const next = new Set(cur);
      next.delete(taskId);
      return next;
    });
  }, []);

  const requestDelete = useCallback(
    (task: Task) => {
      setPending((cur) => new Set(cur).add(task.id));
      const timer = setTimeout(() => {
        timers.current.delete(task.id);
        deleteTask.mutate(
          { taskId: task.id },
          { onSettled: () => drop(task.id) }
        );
      }, UNDO_WINDOW_MS);
      timers.current.set(task.id, timer);
      // A custom toast (not the default action-pill) so the layout is a clean
      // icon + label + a real shadcn Undo button, and bottom-center so it sits
      // near the delete zone the card was dropped on rather than at the top.
      toast.custom(
        (id) => (
          <div className="flex w-full items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-lg">
            <Trash2
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="flex-1 font-medium text-sm">
              {TASK_DELETED_TOAST}
            </span>
            <Button
              onClick={() => {
                clear(task.id);
                drop(task.id);
                toast.dismiss(id);
              }}
              size="sm"
              variant="secondary"
            >
              {UNDO_LABEL}
            </Button>
          </div>
        ),
        { duration: UNDO_WINDOW_MS, position: "bottom-center" }
      );
    },
    [deleteTask, drop, clear]
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) {
        clearTimeout(timer);
      }
      active.clear();
    };
  }, []);

  return (
    <DeferredDeleteContext.Provider
      value={{ requestDelete, pendingDeleteIds: pending }}
    >
      {children}
    </DeferredDeleteContext.Provider>
  );
}

export function useDeferredDelete(): DeferredDeleteApi {
  const ctx = useContext(DeferredDeleteContext);
  if (!ctx) {
    throw new Error(
      "useDeferredDelete must be used within DeferredDeleteProvider"
    );
  }
  return ctx;
}
