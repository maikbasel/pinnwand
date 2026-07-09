import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { TASK_PRIORITIES, type TaskPriorityId } from "../columns";

const TONE_CLASS: Record<TaskPriorityId, string> = {
  niedrig: "bg-muted text-muted-foreground",
  mittel: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  hoch: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

// Solid fill for the compact card dot (the labelled badge tones above are too
// light to read at 8px). Named after the priority, not the color.
const DOT_CLASS: Record<TaskPriorityId, string> = {
  niedrig: "bg-muted-foreground",
  mittel: "bg-amber-500",
  hoch: "bg-red-500",
};

function priorityLabel(priority: TaskPriorityId): string {
  return TASK_PRIORITIES.find((p) => p.id === priority)?.label ?? priority;
}

export function PriorityBadge({ priority }: { priority: TaskPriorityId }) {
  return (
    <Badge className={TONE_CLASS[priority]} variant="secondary">
      {priorityLabel(priority)}
    </Badge>
  );
}

// Compact priority indicator for the mobile task card: a small colored dot that
// carries the priority word only to assistive tech, so a card with no assignees
// collapses to a single title line (Trello-style).
export function PriorityDot({ priority }: { priority: TaskPriorityId }) {
  return (
    <span
      aria-label={priorityLabel(priority)}
      className={cn("mt-1 size-2 shrink-0 rounded-full", DOT_CLASS[priority])}
      role="img"
    />
  );
}
