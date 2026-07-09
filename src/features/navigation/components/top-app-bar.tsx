import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { BoardActionsMenu, useMyBoards } from "@/features/boards";
import { PinnwandLogo } from "@/shared/components/pinnwand-logo";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { BACK_TO_BOARDS_LABEL, BRAND_NAME } from "../lib/copy";
import { useActiveBoardId } from "../lib/destinations";
import { AccountMenu } from "./account-menu";

/**
 * The mobile-only sticky top bar. Left slot is context-aware: the brand name
 * on the boards list, or a back control plus the open board's name (the page's
 * <h1> on mobile) on a board's detail route. The right slot is scoped by depth:
 * on a board route it carries only the board actions menu; on the boards list
 * (and other non-board routes) it carries only the account menu — the account
 * lives at the root the back chevron returns to, not on every board. Hidden at
 * `md` and up, where the sidebar rail carries navigation instead.
 */
export function TopAppBar() {
  const activeBoardId = useActiveBoardId();
  const { memberships } = useMyBoards();

  const activeMembership = activeBoardId
    ? memberships.find((membership) => membership.board.id === activeBoardId)
    : undefined;
  const activeBoardName = activeMembership?.board.name ?? BRAND_NAME;

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
        {activeBoardId ? (
          <h1
            className="min-w-0 truncate font-semibold text-lg tracking-tight"
            data-testid="board-name"
          >
            {activeBoardName}
          </h1>
        ) : (
          <span className="min-w-0 truncate font-semibold text-lg tracking-tight">
            {BRAND_NAME}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {activeMembership ? (
          <BoardActionsMenu
            board={activeMembership.board}
            isOwner={activeMembership.role === "owner"}
          />
        ) : null}
        {activeBoardId ? null : <AccountMenu compact />}
      </div>
    </header>
  );
}
