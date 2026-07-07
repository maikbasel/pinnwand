import { ChevronRight } from "lucide-react";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";
import { ROLE_LABELS } from "../lib/copy";
import type { BoardMembership } from "../types";

const ROLE_PILL_BASE = "shrink-0 rounded-full px-2 py-0.5 font-medium text-xs";
const ROLE_PILL_TONE = {
  owner: "bg-primary/10 text-primary",
  member: "bg-muted text-muted-foreground",
} as const;

type BoardCardProps = {
  membership: BoardMembership;
  onOpen: () => void;
};

export function BoardCard({ membership, onOpen }: BoardCardProps) {
  const { board, role } = membership;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <button
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 active:bg-accent"
        onClick={onOpen}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate font-medium">
          {board.name}
        </span>
        <span className={cn(ROLE_PILL_BASE, ROLE_PILL_TONE[role])}>
          {ROLE_LABELS[role]}
        </span>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>
    </Card>
  );
}
