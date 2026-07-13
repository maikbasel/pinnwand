import { createFileRoute } from "@tanstack/react-router";
import { BoardEmptyPane, BoardsPage } from "@/features/boards";

export const Route = createFileRoute("/_authed/")({
  component: BoardsIndex,
});

function BoardsIndex() {
  return (
    <>
      <div className="md:hidden">
        <BoardsPage />
      </div>
      <BoardEmptyPane />
    </>
  );
}
