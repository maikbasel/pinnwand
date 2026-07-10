import { createFileRoute } from "@tanstack/react-router";
import { JoinBoardPage } from "@/features/boards";

export const Route = createFileRoute("/_authed/boards/join")({
  component: JoinBoardPage,
});
