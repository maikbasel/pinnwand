import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { useDeleteBoard } from "../hooks/use-delete-board";
import { useLeaveBoard } from "../hooks/use-leave-board";
import { useMyBoards } from "../hooks/use-my-boards";
import { useRenameBoard } from "../hooks/use-rename-board";
import {
  BACK_LABEL,
  BOARD_NOT_FOUND,
  BOARDS_LOAD_ERROR,
  CANCEL_LABEL,
  DELETE_BOARD_BUTTON,
  DELETE_BOARD_CONFIRM,
  LEAVE_BOARD_BUTTON,
  LEAVE_BOARD_CONFIRM,
  RENAME_LABEL,
  TASKS_PLACEHOLDER,
} from "../lib/copy";
import type { Board } from "../types";
import { BoardSharePanel } from "./board-share-panel";

type BoardHeadingProps = {
  board: Board;
  isOwner: boolean;
};

function BoardHeading({ board, isOwner }: BoardHeadingProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(board.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameBoard = useRenameBoard(board.id);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  function cancel(): void {
    setIsEditing(false);
    setName(board.name);
  }

  async function commit(): Promise<void> {
    // The input stays mounted-but-disabled while pending, and disabling it
    // fires onBlur -> commit again; bail so a single rename never double-fires.
    if (renameBoard.isPending) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      cancel();
      return;
    }
    try {
      await renameBoard.mutateAsync({ name: trimmed });
      setIsEditing(false);
    } catch {
      // The optimistic update rolled back and the global toast shows the error;
      // close the editor so the reverted name is shown.
      cancel();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  if (isEditing) {
    return (
      <Input
        aria-label={RENAME_LABEL}
        disabled={renameBoard.isPending}
        onBlur={commit}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={onKeyDown}
        ref={inputRef}
        value={name}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <h1 className="min-w-0 flex-1 truncate font-semibold text-2xl tracking-tight">
        {board.name}
      </h1>
      {isOwner ? (
        <Button
          aria-label={RENAME_LABEL}
          onClick={() => setIsEditing(true)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Pencil className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function DeleteBoardControl({ boardId }: { boardId: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const deleteBoard = useDeleteBoard(boardId);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    }
  }, [confirming]);

  async function confirmDelete(): Promise<void> {
    try {
      await deleteBoard.mutateAsync();
    } catch {
      // The global toast surfaces the failure; reset so the owner can retry.
      setConfirming(false);
      return;
    }
    await navigate({ to: "/" });
  }

  if (!confirming) {
    return (
      <Button
        className="w-full"
        onClick={() => setConfirming(true)}
        type="button"
        variant="destructive"
      >
        {DELETE_BOARD_BUTTON}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 p-3">
      <p className="text-destructive text-sm">{DELETE_BOARD_CONFIRM}</p>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={deleteBoard.isPending}
          onClick={confirmDelete}
          type="button"
          variant="destructive"
        >
          {DELETE_BOARD_BUTTON}
        </Button>
        <Button
          className="flex-1"
          disabled={deleteBoard.isPending}
          onClick={() => setConfirming(false)}
          ref={cancelRef}
          type="button"
          variant="ghost"
        >
          {CANCEL_LABEL}
        </Button>
      </div>
    </div>
  );
}

function LeaveBoardControl({ boardId }: { boardId: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const leaveBoard = useLeaveBoard(boardId);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    }
  }, [confirming]);

  async function confirmLeave(): Promise<void> {
    try {
      await leaveBoard.mutateAsync();
    } catch {
      // The global toast surfaces the failure; reset so the user can retry.
      setConfirming(false);
      return;
    }
    await navigate({ to: "/" });
  }

  if (!confirming) {
    return (
      <Button
        className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setConfirming(true)}
        type="button"
        variant="outline"
      >
        {LEAVE_BOARD_BUTTON}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 p-3">
      <p className="text-destructive text-sm">{LEAVE_BOARD_CONFIRM}</p>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={leaveBoard.isPending}
          onClick={confirmLeave}
          type="button"
          variant="destructive"
        >
          {LEAVE_BOARD_BUTTON}
        </Button>
        <Button
          className="flex-1"
          disabled={leaveBoard.isPending}
          onClick={() => setConfirming(false)}
          ref={cancelRef}
          type="button"
          variant="ghost"
        >
          {CANCEL_LABEL}
        </Button>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      aria-label={BACK_LABEL}
      className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
      to="/"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {BACK_LABEL}
    </Link>
  );
}

type BoardDetailPageProps = {
  boardId: string;
};

export function BoardDetailPage({ boardId }: BoardDetailPageProps) {
  const { memberships, isPending, isError } = useMyBoards();
  const membership = memberships.find((m) => m.board.id === boardId);

  if (isPending && !membership) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (isError && !membership) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <BackLink />
        <p className="text-destructive text-sm" role="alert">
          {BOARDS_LOAD_ERROR}
        </p>
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <p className="text-muted-foreground text-sm">{BOARD_NOT_FOUND}</p>
        <BackLink />
      </div>
    );
  }

  const { board, role } = membership;
  const isOwner = role === "owner";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <BackLink />
      <BoardHeading board={board} isOwner={isOwner} />
      <BoardSharePanel board={board} isOwner={isOwner} />
      <Card className="border-dashed bg-muted/30">
        <CardContent className="py-6 text-center text-muted-foreground text-sm">
          {TASKS_PLACEHOLDER}
        </CardContent>
      </Card>
      {isOwner ? (
        <DeleteBoardControl boardId={board.id} />
      ) : (
        <LeaveBoardControl boardId={board.id} />
      )}
    </div>
  );
}
