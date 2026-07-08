import { LayoutGridIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { NO_BOARD_SELECTED_BODY, NO_BOARD_SELECTED_HEADING } from "../lib/copy";

/**
 * The desktop-only main pane shown at the boards list root before a board is
 * selected. The sidebar rail carries the boards list on desktop, so this pane
 * just explains the empty selection. Hidden on mobile, where the full boards
 * list is the main content instead.
 */
export function BoardEmptyPane() {
  return (
    <Empty className="hidden flex-1 border-0 md:flex">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutGridIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{NO_BOARD_SELECTED_HEADING}</EmptyTitle>
        <EmptyDescription>{NO_BOARD_SELECTED_BODY}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
