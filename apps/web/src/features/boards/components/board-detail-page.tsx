import { BoardSurface } from "@/features/tasks";
import { SyncIndicator } from "@/shared/components/sync-indicator";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { useMyBoards } from "../hooks/use-my-boards";
import { BOARD_NOT_FOUND, BOARDS_LOAD_ERROR } from "../lib/copy";
import { BoardActionsMenu } from "./board-actions-menu";

const FILL_PAGE = "flex h-full min-h-0 w-full flex-1 flex-col";

type BoardDetailPageProps = {
  boardId: string;
};

export function BoardDetailPage({ boardId }: BoardDetailPageProps) {
  const { memberships, isPending, isError } = useMyBoards();
  const membership = memberships.find((m) => m.board.id === boardId);

  if (isPending && !membership) {
    return (
      <div className={`${FILL_PAGE} gap-4 p-4`}>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="min-h-40 w-full flex-1 rounded-xl" />
      </div>
    );
  }

  if (isError && !membership) {
    return (
      <div className={`${FILL_PAGE} p-4`}>
        <Alert variant="destructive">
          <AlertDescription>{BOARDS_LOAD_ERROR}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!membership) {
    return (
      <div className={`${FILL_PAGE} p-4`}>
        <p className="text-muted-foreground text-sm">{BOARD_NOT_FOUND}</p>
      </div>
    );
  }

  const { board, role } = membership;
  const isOwner = role === "owner";

  return (
    <div className={FILL_PAGE}>
      {/* Desktop header: board name + actions. On mobile the top app bar shows
          the board name and hosts the actions menu, so nothing is rendered
          here (avoids duplicating the name). */}
      <header className="hidden items-center gap-3 border-border border-b px-4 py-3 md:flex">
        <h1
          className="min-w-0 flex-1 truncate font-semibold text-xl tracking-tight"
          data-testid="board-name"
        >
          {board.name}
        </h1>
        <BoardActionsMenu board={board} isOwner={isOwner} />
      </header>
      <BoardSurface boardId={board.id} />
      {/* Floats bottom-right; shows only while this board's reads/writes are in
          flight, so the user can see their changes reaching the server. */}
      <SyncIndicator boardId={board.id} />
    </div>
  );
}
