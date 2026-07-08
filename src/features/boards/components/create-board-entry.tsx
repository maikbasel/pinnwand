import { Check, Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useCreateBoard } from "../hooks/use-create-board";
import {
  CANCEL_LABEL,
  CONFIRM_LABEL,
  CREATE_BOARD_CTA,
  CREATE_BOARD_PLACEHOLDER,
  TRANSPORT_ERROR,
} from "../lib/copy";
import type { Board } from "../types";

type CreateBoardEntryProps = {
  onCreated: (board: Board) => void;
};

export function CreateBoardEntry({ onCreated }: CreateBoardEntryProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createBoard = useCreateBoard();

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  function reset(): void {
    setIsEditing(false);
    setName("");
    setError(null);
  }

  async function commit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      reset();
      return;
    }
    setError(null);
    try {
      const board = await createBoard.mutateAsync({ name: trimmed });
      reset();
      onCreated(board);
    } catch {
      setError(TRANSPORT_ERROR);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      reset();
    }
  }

  if (!isEditing) {
    return (
      <Button
        className="w-full border-dashed"
        onClick={() => setIsEditing(true)}
        type="button"
        variant="outline"
      >
        <Plus aria-hidden className="size-4" />
        {CREATE_BOARD_CTA}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label={CREATE_BOARD_CTA}
          disabled={createBoard.isPending}
          onBlur={commit}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={CREATE_BOARD_PLACEHOLDER}
          ref={inputRef}
          value={name}
        />
        <Button
          aria-label={CONFIRM_LABEL}
          disabled={createBoard.isPending}
          onClick={commit}
          onMouseDown={(event) => event.preventDefault()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Check className="size-4" />
        </Button>
        <Button
          aria-label={CANCEL_LABEL}
          disabled={createBoard.isPending}
          onClick={reset}
          onMouseDown={(event) => event.preventDefault()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="size-4" />
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
