import { useDroppable } from "@dnd-kit/core";
import { Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { DELETE_ZONE_LABEL } from "../lib/copy";

export const DELETE_ZONE_ID = "delete-zone";

/**
 * The red delete target that appears at the top of the board while a card is
 * being dragged. Dropping a card here routes it through the deferred-delete
 * flow. It renders nothing when no drag is active so it never competes with the
 * columns for space.
 */
export function DeleteDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: DELETE_ZONE_ID });
  if (!active) {
    return null;
  }
  return (
    // Floats over the bottom of the board (absolute, not in flow) so it never
    // pushes the columns down when a drag begins and never covers the column
    // headings at the top. The parent board container is the positioning
    // context. z-20 keeps it above the columns but below the portaled
    // DragOverlay card.
    <div
      className={cn(
        "absolute inset-x-3 bottom-3 z-20 flex items-center justify-center gap-2 rounded-lg border border-destructive border-dashed bg-background/90 py-3 text-destructive text-sm shadow-sm backdrop-blur-sm transition-colors",
        isOver && "bg-destructive text-destructive-foreground"
      )}
      ref={setNodeRef}
    >
      <Trash2 className="size-4" />
      {DELETE_ZONE_LABEL}
    </div>
  );
}
