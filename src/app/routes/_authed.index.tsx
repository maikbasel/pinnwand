import { createFileRoute } from "@tanstack/react-router";
import { BoardsPage } from "@/features/boards";

export const Route = createFileRoute("/_authed/")({
  component: BoardsPage,
});
