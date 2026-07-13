import { useNavigate } from "@tanstack/react-router";
import {
  LogOutIcon,
  MoreVerticalIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { ConfirmSheet } from "@/shared/components/confirm-sheet";
import { buttonVariants } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { useDeleteBoard } from "../hooks/use-delete-board";
import { useLeaveBoard } from "../hooks/use-leave-board";
import {
  BOARD_ACTIONS_LABEL,
  DELETE_BOARD_BUTTON,
  DELETE_BOARD_CONFIRM,
  DELETE_BOARD_TITLE,
  LEAVE_BOARD_BUTTON,
  LEAVE_BOARD_CONFIRM,
  LEAVE_BOARD_TITLE,
  RENAME_LABEL,
  SHARE_PANEL_HEADING,
} from "../lib/copy";
import type { Board } from "../types";
import { BoardRenameSurface } from "./board-rename-surface";
import { BoardShareSurface } from "./board-share-surface";

type ActiveSurface = "none" | "share" | "rename" | "destructive";

/**
 * The board's action affordances, collapsed into a single overflow menu so the
 * board itself fills the page. Sharing and renaming open responsive
 * Dialog/Drawer surfaces; the destructive action (delete for owners, leave for
 * members) sits below a separator and is confirm-gated. Rendered in the
 * desktop board header and in the mobile top app bar.
 */
export function BoardActionsMenu({
  board,
  isOwner,
}: {
  board: Board;
  isOwner: boolean;
}) {
  const [surface, setSurface] = useState<ActiveSurface>("none");
  const navigate = useNavigate();
  const deleteBoard = useDeleteBoard(board.id);
  const leaveBoard = useLeaveBoard(board.id);

  async function confirmDestructive(): Promise<void> {
    try {
      await (isOwner ? deleteBoard.mutateAsync() : leaveBoard.mutateAsync());
    } catch {
      // The global toast surfaces the failure; close so the user can retry.
      setSurface("none");
      return;
    }
    setSurface("none");
    await navigate({ to: "/" });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={BOARD_ACTIONS_LABEL}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "size-11 shrink-0 text-foreground"
          )}
          data-testid="board-actions-trigger"
        >
          <MoreVerticalIcon aria-hidden="true" className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" sideOffset={8}>
          <DropdownMenuItem
            data-testid="board-action-share"
            onClick={() => setSurface("share")}
          >
            <Share2Icon aria-hidden="true" className="text-muted-foreground" />
            <span>{SHARE_PANEL_HEADING}</span>
          </DropdownMenuItem>
          {isOwner ? (
            <DropdownMenuItem
              data-testid="board-action-rename"
              onClick={() => setSurface("rename")}
            >
              <PencilIcon
                aria-hidden="true"
                className="text-muted-foreground"
              />
              <span>{RENAME_LABEL}</span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="board-action-destructive"
            onClick={() => setSurface("destructive")}
            variant="destructive"
          >
            {isOwner ? (
              <Trash2Icon aria-hidden="true" />
            ) : (
              <LogOutIcon aria-hidden="true" />
            )}
            <span>{isOwner ? DELETE_BOARD_BUTTON : LEAVE_BOARD_BUTTON}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BoardShareSurface
        board={board}
        isOwner={isOwner}
        onOpenChange={(next) => setSurface(next ? "share" : "none")}
        open={surface === "share"}
      />
      {isOwner ? (
        <BoardRenameSurface
          board={board}
          onOpenChange={(next) => setSurface(next ? "rename" : "none")}
          open={surface === "rename"}
        />
      ) : null}
      <ConfirmSheet
        confirmLabel={isOwner ? DELETE_BOARD_BUTTON : LEAVE_BOARD_BUTTON}
        confirmTestId={isOwner ? "confirm-delete-board" : "confirm-leave-board"}
        description={isOwner ? DELETE_BOARD_CONFIRM : LEAVE_BOARD_CONFIRM}
        onConfirm={confirmDestructive}
        onOpenChange={(next) => setSurface(next ? "destructive" : "none")}
        open={surface === "destructive"}
        title={isOwner ? DELETE_BOARD_TITLE : LEAVE_BOARD_TITLE}
      />
    </>
  );
}
