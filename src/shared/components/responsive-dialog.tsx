import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/components/ui/drawer";
import { useMediaQuery } from "@/shared/hooks/use-media-query";

const DESKTOP_BREAKPOINT_QUERY = "(min-width: 768px)";

type ResponsiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading of the surface, e.g. "Teilen". */
  title: string;
  /** One line of context under the title. */
  description?: ReactNode;
  children: ReactNode;
};

/**
 * A content surface that swaps a centered `Dialog` on desktop for a bottom
 * `Drawer` on mobile (the `frontend/mobile-first.md` Dialog<->Drawer swap).
 * For CONTENT (forms, share panels) opened from a plain trigger. Destructive
 * confirmations use `ConfirmSheet` instead.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: ResponsiveDialogProps) {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT_QUERY);

  if (isDesktop) {
    return (
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent className="pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          {description ? (
            <DrawerDescription>{description}</DrawerDescription>
          ) : null}
        </DrawerHeader>
        <div className="px-4 pb-4">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
