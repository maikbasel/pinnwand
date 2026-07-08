import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { useMyBoards } from "@/features/boards";
import { PinnwandLogo } from "@/shared/components/pinnwand-logo";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { BACK_TO_BOARDS_LABEL, BRAND_NAME } from "../lib/copy";
import { useActiveBoardId } from "../lib/destinations";
import { AccountMenu } from "./account-menu";

/**
 * The mobile-only sticky top bar. Left slot is context-aware: the brand name
 * on the boards list, or a back control plus the open board's name on a
 * board's detail route. Right slot is the compact account menu. Hidden at
 * `md` and up, where the sidebar rail carries navigation instead.
 */
export function TopAppBar() {
  const activeBoardId = useActiveBoardId();
  const { memberships } = useMyBoards();

  const activeBoardName = activeBoardId
    ? (memberships.find((membership) => membership.board.id === activeBoardId)
        ?.board.name ?? BRAND_NAME)
    : null;

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-border border-b bg-card/95 px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 backdrop-blur md:hidden">
      <div className="flex min-w-0 items-center gap-1">
        {activeBoardId ? (
          <Link
            aria-label={BACK_TO_BOARDS_LABEL}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "size-11 shrink-0 text-foreground"
            )}
            to="/"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-5" />
          </Link>
        ) : (
          <PinnwandLogo className="ml-1 shrink-0" size={24} title={null} />
        )}
        <span className="min-w-0 truncate font-semibold text-lg tracking-tight">
          {activeBoardId ? activeBoardName : BRAND_NAME}
        </span>
      </div>
      <AccountMenu compact />
    </header>
  );
}
