// biome-ignore-all lint/performance/noBarrelFile: feature public surface per .claude/rules/architecture.md
// Public API of the `boards` feature. A Pinnwand (board): create, list (owned +
// shared), rename, delete, and the join-code sharing surface.
export { BOARD_KEYS } from "./api/boards";
export { BoardActionsMenu } from "./components/board-actions-menu";
export { BoardDetailPage } from "./components/board-detail-page";
export { BoardEmptyPane } from "./components/board-empty-pane";
export { BoardsPage } from "./components/boards-page";
export { JoinBoardPage } from "./components/join-board-page";
export { useCreateBoard } from "./hooks/use-create-board";
export { useDeleteBoard } from "./hooks/use-delete-board";
export { useJoinBoard } from "./hooks/use-join-board";
export { useLeaveBoard } from "./hooks/use-leave-board";
export { useMyBoards } from "./hooks/use-my-boards";
export { useRegenerateJoinCode } from "./hooks/use-regenerate-join-code";
export { useRenameBoard } from "./hooks/use-rename-board";
export type { Board, BoardMembership, BoardRole } from "./types";
