import { ChevronRight } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import { ROLE_LABELS } from "../lib/copy";
import type { BoardMembership } from "../types";

const ROLE_BADGE_VARIANT = {
  owner: "default",
  member: "secondary",
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
        <Badge variant={ROLE_BADGE_VARIANT[role]}>{ROLE_LABELS[role]}</Badge>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>
    </Card>
  );
}
