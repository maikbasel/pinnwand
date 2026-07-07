import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { useRegenerateJoinCode } from "../hooks/use-regenerate-join-code";
import {
  CANCEL_LABEL,
  COPY_CODE_BUTTON,
  COPY_CODE_COPIED,
  ROTATE_CODE_BUTTON,
  ROTATE_CODE_CONFIRM,
  SHARE_CODE_HINT,
  SHARE_PANEL_HEADING,
} from "../lib/copy";
import type { Board } from "../types";

const COPIED_FEEDBACK_MS = 2000;

function RotateCodeControl({ boardId }: { boardId: string }) {
  const [confirming, setConfirming] = useState(false);
  const regenerateJoinCode = useRegenerateJoinCode(boardId);

  async function confirmRotate(): Promise<void> {
    await regenerateJoinCode.mutateAsync();
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <Button
        onClick={() => setConfirming(true)}
        type="button"
        variant="outline"
      >
        {ROTATE_CODE_BUTTON}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">{ROTATE_CODE_CONFIRM}</p>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={regenerateJoinCode.isPending}
          onClick={confirmRotate}
          type="button"
        >
          {ROTATE_CODE_BUTTON}
        </Button>
        <Button
          className="flex-1"
          disabled={regenerateJoinCode.isPending}
          onClick={() => setConfirming(false)}
          type="button"
          variant="ghost"
        >
          {CANCEL_LABEL}
        </Button>
      </div>
    </div>
  );
}

type BoardSharePanelProps = {
  board: Board;
  isOwner: boolean;
};

export function BoardSharePanel({ board, isOwner }: BoardSharePanelProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimeoutRef.current), []);

  async function copyCode(): Promise<void> {
    await navigator.clipboard.writeText(board.joinCode);
    setCopied(true);
    window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
    }, COPIED_FEEDBACK_MS);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{SHARE_PANEL_HEADING}</CardTitle>
        <CardDescription>{SHARE_CODE_HINT}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-center font-mono text-3xl tracking-[0.3em]">
          {board.joinCode}
        </p>
        <Button onClick={copyCode} type="button" variant="outline">
          {copied ? COPY_CODE_COPIED : COPY_CODE_BUTTON}
        </Button>
        {isOwner ? <RotateCodeControl boardId={board.id} /> : null}
      </CardContent>
    </Card>
  );
}
