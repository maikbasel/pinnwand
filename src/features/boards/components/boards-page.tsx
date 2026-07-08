import { Link, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { buttonVariants } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { useMyBoards } from "../hooks/use-my-boards";
import {
  BOARDS_EMPTY_STATE,
  BOARDS_LOAD_ERROR,
  BOARDS_PAGE_HEADING,
  JOIN_BOARD_CTA,
} from "../lib/copy";
import type { Board } from "../types";
import { BoardCard } from "./board-card";
import { CreateBoardEntry } from "./create-board-entry";

const SKELETON_ROWS = [0, 1, 2];

export function BoardsPage() {
  const navigate = useNavigate();
  const { memberships, isPending, isError } = useMyBoards();

  function openBoard(boardId: string): void {
    navigate({ params: { boardId }, to: "/boards/$boardId" });
  }

  function onCreated(board: Board): void {
    navigate({ params: { boardId: board.id }, to: "/boards/$boardId" });
  }

  const isInitialLoad = isPending && memberships.length === 0;
  const isEmpty = !(isInitialLoad || isError) && memberships.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="font-semibold text-2xl tracking-tight">
        {BOARDS_PAGE_HEADING}
      </h1>

      {isInitialLoad ? (
        <div className="flex flex-col gap-3">
          {SKELETON_ROWS.map((row) => (
            <Skeleton className="h-16 w-full rounded-xl" key={row} />
          ))}
        </div>
      ) : null}

      {isError ? (
        <Alert variant="destructive">
          <AlertDescription>{BOARDS_LOAD_ERROR}</AlertDescription>
        </Alert>
      ) : null}

      {isEmpty ? (
        <p className="text-muted-foreground text-sm">{BOARDS_EMPTY_STATE}</p>
      ) : null}

      {isInitialLoad || isError || isEmpty ? null : (
        <div className="flex flex-col gap-3">
          {memberships.map((membership) => (
            <BoardCard
              key={membership.board.id}
              membership={membership}
              onOpen={() => openBoard(membership.board.id)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <CreateBoardEntry onCreated={onCreated} />
        <Link
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          to="/boards/join"
        >
          {JOIN_BOARD_CTA}
        </Link>
      </div>
    </div>
  );
}
