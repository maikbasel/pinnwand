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
import { Button } from "@/shared/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/components/ui/drawer";
import { useMediaQuery } from "@/shared/hooks/use-media-query";

const DEFAULT_CANCEL_LABEL = "Abbrechen";
const DESKTOP_BREAKPOINT_QUERY = "(min-width: 768px)";

type ConfirmSheetProps = {
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
 * Responsive destructive-confirmation surface: a bottom `Drawer` on mobile and
 * a centered `AlertDialog` on desktop (the `frontend/mobile-first.md` swap).
 *
 * Right surface ONLY when the confirm is launched from a plain page or a
 * non-drawer trigger — nothing open behind it, so the mobile drawer presents
 * cleanly with no Vaul stacking/body-lock problem. When the trigger lives
 * inside an open bottom sheet, inline the confirm in that sheet instead (a
 * second stacked drawer does not present reliably). `Abbrechen` is the safe
 * default; the destructive action is the one visually-distinct button.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = DEFAULT_CANCEL_LABEL,
  onConfirm,
  confirmTestId,
}: ConfirmSheetProps) {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT_QUERY);

  if (isDesktop) {
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

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent className="px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button
            className="min-h-11 w-full"
            data-testid={confirmTestId}
            onClick={onConfirm}
            size="lg"
            type="button"
            variant="destructive"
          >
            {confirmLabel}
          </Button>
          <DrawerClose
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
            type="button"
          >
            {cancelLabel}
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
