import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";

const DEFAULT_CANCEL_LABEL = "Abbrechen";

type ConfirmAlertProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Question-form title, e.g. "Pinnwand löschen?". */
  title: string;
  /** One line stating the consequence (what is deleted, that it cascades). */
  description: ReactNode;
  /** Action-specific destructive verb, e.g. "Endgültig löschen". */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /** Hook for e2e to target the destructive button. */
  confirmTestId?: string;
};

/**
 * Shared destructive-confirmation surface. A single centered `AlertDialog` on
 * every viewport — the platform-standard surface for an irreversible confirm
 * and the only one that works when the trigger lives inside a bottom sheet
 * (stacking a second Vaul Drawer never presents). Callers own the mutation
 * fired on confirm. `Abbrechen` is the safe default; the destructive action is
 * the one visually-distinct button.
 */
export function ConfirmAlert({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = DEFAULT_CANCEL_LABEL,
  onConfirm,
  confirmTestId,
}: ConfirmAlertProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11"
            data-testid={confirmTestId}
            onClick={onConfirm}
            variant="destructive"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
