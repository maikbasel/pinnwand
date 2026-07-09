import { useEffect, useRef, useState } from "react";
import { ConfirmSheet } from "@/shared/components/confirm-sheet";
import { ResponsiveDialog } from "@/shared/components/responsive-dialog";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { useRegenerateJoinCode } from "../hooks/use-regenerate-join-code";
import {
  COPY_CODE_BUTTON,
  COPY_CODE_COPIED,
  COPY_CODE_ERROR,
  ROTATE_CODE_BUTTON,
  ROTATE_CODE_CONFIRM,
  ROTATE_CODE_TITLE,
  SHARE_CODE_HINT,
  SHARE_PANEL_HEADING,
} from "../lib/copy";
import type { Board } from "../types";

const COPIED_FEEDBACK_MS = 2000;

function RotateCodeControl({ boardId }: { boardId: string }) {
  const [confirming, setConfirming] = useState(false);
  const regenerateJoinCode = useRegenerateJoinCode(boardId);

  async function confirmRotate(): Promise<void> {
    try {
      await regenerateJoinCode.mutateAsync();
    } finally {
      // Whether it succeeds or the global toast surfaces the failure, close the
      // confirm so the owner sees the fresh code or can retry.
      setConfirming(false);
    }
  }

  return (
    <>
      <Button
        className="w-full"
        onClick={() => setConfirming(true)}
        type="button"
        variant="outline"
      >
        {ROTATE_CODE_BUTTON}
      </Button>
      <ConfirmSheet
        confirmLabel={ROTATE_CODE_BUTTON}
        description={ROTATE_CODE_CONFIRM}
        onConfirm={confirmRotate}
        onOpenChange={setConfirming}
        open={confirming}
        title={ROTATE_CODE_TITLE}
      />
    </>
  );
}

type BoardShareSurfaceProps = {
  board: Board;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The join-code sharing surface, presented as a responsive Dialog/Drawer from
 * the board actions menu (no longer inline on the board canvas, so the board
 * fills the page). Shows the code, a copy button, and — for owners — a
 * confirm-gated rotate control.
 */
export function BoardShareSurface({
  board,
  isOwner,
  open,
  onOpenChange,
}: BoardShareSurfaceProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimeoutRef.current), []);

  async function copyCode(): Promise<void> {
    try {
      if (!navigator.clipboard) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(board.joinCode);
      setCopyFailed(false);
      setCopied(true);
      window.clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, COPIED_FEEDBACK_MS);
    } catch {
      // Insecure context or a denied permission: the code is already shown on
      // screen, so fall back to asking the user to copy it manually.
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <ResponsiveDialog
      description={SHARE_CODE_HINT}
      onOpenChange={onOpenChange}
      open={open}
      title={SHARE_PANEL_HEADING}
    >
      <div className="flex flex-col gap-4">
        <p
          className="text-center font-mono text-3xl tracking-[0.3em]"
          data-testid="board-share-code"
        >
          {board.joinCode}
        </p>
        <Button
          className="w-full"
          onClick={copyCode}
          type="button"
          variant="outline"
        >
          {copied ? COPY_CODE_COPIED : COPY_CODE_BUTTON}
        </Button>
        {copyFailed ? (
          <Alert variant="destructive">
            <AlertDescription>{COPY_CODE_ERROR}</AlertDescription>
          </Alert>
        ) : null}
        {isOwner ? <RotateCodeControl boardId={board.id} /> : null}
      </div>
    </ResponsiveDialog>
  );
}
