// biome-ignore-all lint/style/useFilenamingConvention: TanStack Router file-based route param uses `$boardId` per https://tanstack.com/router/latest/docs/framework/react/routing/dynamic-route-segments
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useSession } from "@/features/auth";
import { BoardDetailPage } from "@/features/boards";
import { useBoardMembers } from "@/features/members";
import { NotesPanel } from "@/features/notes";
import { Button } from "@/shared/components/ui/button";
import { colorForUser } from "@/shared/lib/user-color";

const FALLBACK_DISPLAY_NAME = "Unbekannt";

export const Route = createFileRoute("/_authed/boards/$boardId")({
  component: BoardView,
});

function BoardView() {
  const { boardId } = Route.useParams();
  const [view, setView] = useState<"board" | "notes">("board");
  const { user } = useSession();
  const { members } = useBoardMembers(boardId);
  const displayName =
    members.find((member) => member.userId === user?.id)?.displayName ||
    FALLBACK_DISPLAY_NAME;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex gap-1 border-b px-3 py-2" role="tablist">
        <Button
          aria-selected={view === "board"}
          onClick={() => setView("board")}
          role="tab"
          size="sm"
          variant={view === "board" ? "secondary" : "ghost"}
        >
          Board
        </Button>
        <Button
          aria-selected={view === "notes"}
          onClick={() => setView("notes")}
          role="tab"
          size="sm"
          variant={view === "notes" ? "secondary" : "ghost"}
        >
          Notizen
        </Button>
      </div>
      {view === "board" ? (
        <BoardDetailPage boardId={boardId} />
      ) : (
        <NotesPanel
          boardId={boardId}
          userColor={colorForUser(user?.id ?? displayName)}
          userName={displayName}
        />
      )}
    </div>
  );
}
