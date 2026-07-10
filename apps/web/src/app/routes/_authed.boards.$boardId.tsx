// biome-ignore-all lint/style/useFilenamingConvention: TanStack Router file-based route param uses `$boardId` per https://tanstack.com/router/latest/docs/framework/react/routing/dynamic-route-segments
import { createFileRoute } from "@tanstack/react-router";
import { BoardDetailPage } from "@/features/boards";

export const Route = createFileRoute("/_authed/boards/$boardId")({
  component: BoardView,
});

function BoardView() {
  const { boardId } = Route.useParams();
  return <BoardDetailPage boardId={boardId} />;
}
