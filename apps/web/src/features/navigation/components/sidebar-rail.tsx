import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  PlusIcon,
  SquareKanbanIcon,
  UsersRoundIcon,
} from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { useCreateBoard, useMyBoards } from "@/features/boards";
import { PinnwandLogo } from "@/shared/components/pinnwand-logo";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/shared/components/ui/sidebar";
import {
  BOARDS_NAV_LABEL,
  BRAND_NAME,
  CREATE_BOARD_PLACEHOLDER,
  CREATE_BOARD_RAIL_ERROR,
  CREATE_BOARD_RAIL_LABEL,
  JOIN_BOARD_RAIL_LABEL,
  RAIL_LOAD_ERROR,
} from "../lib/copy";
import { useActiveBoardId } from "../lib/destinations";
import { AccountMenu } from "./account-menu";

const SKELETON_ROWS = [0, 1];
const BOARD_NAME_MIN = 1;
const BOARD_NAME_MAX = 80;

function isValidBoardName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= BOARD_NAME_MIN && trimmed.length <= BOARD_NAME_MAX;
}

/**
 * The desktop left navigation rail, composed from the shadcn sidebar
 * primitives (sidebar-10 shape): the create and join actions sit as their own
 * rows above a collapsible "Pinnwände" group (a `square-kanban` labelled
 * trigger over the board list). The account menu lives in the footer. Hidden
 * below the `md` breakpoint, where the mobile top app bar takes over.
 */
export function SidebarRail() {
  const navigate = useNavigate();
  const activeBoardId = useActiveBoardId();
  const { memberships, isPending, isError } = useMyBoards();
  const createBoard = useCreateBoard();
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [boardsOpen, setBoardsOpen] = useState(true);

  function openBoard(boardId: string): void {
    navigate({ params: { boardId }, to: "/boards/$boardId" });
  }

  function startCreate(): void {
    // The inline input lives inside the collapsible board list, so expand it
    // first or the field the user just asked for would be hidden.
    setBoardsOpen(true);
    setCreating(true);
  }

  function resetCreate(): void {
    setCreating(false);
    setDraft("");
  }

  async function commitCreate(): Promise<void> {
    if (!isValidBoardName(draft)) {
      resetCreate();
      return;
    }
    const name = draft.trim();
    resetCreate();
    setCreateError(null);
    try {
      const board = await createBoard.mutateAsync({ name });
      navigate({ params: { boardId: board.id }, to: "/boards/$boardId" });
    } catch {
      setCreateError(CREATE_BOARD_RAIL_ERROR);
    }
  }

  function onCreateKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitCreate();
    } else if (event.key === "Escape") {
      event.preventDefault();
      resetCreate();
    }
  }

  const isInitialLoad = isPending && memberships.length === 0;

  return (
    <Sidebar
      className="sticky top-0 hidden h-svh w-60 border-sidebar-border border-r md:flex"
      collapsible="none"
    >
      <SidebarHeader className="px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="flex items-center gap-2">
          <PinnwandLogo className="shrink-0" size={24} title={null} />
          <span className="font-semibold text-lg tracking-tight">
            {BRAND_NAME}
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-testid="rail-create-board"
                  onClick={startCreate}
                >
                  <PlusIcon aria-hidden="true" />
                  <span>{CREATE_BOARD_RAIL_LABEL}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-testid="rail-join-board"
                  onClick={() => navigate({ to: "/boards/join" })}
                >
                  <UsersRoundIcon aria-hidden="true" />
                  <span>{JOIN_BOARD_RAIL_LABEL}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Collapsible onOpenChange={setBoardsOpen} open={boardsOpen}>
          <SidebarGroup>
            <SidebarGroupLabel
              className="group/boards-label gap-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              render={<CollapsibleTrigger />}
            >
              <SquareKanbanIcon aria-hidden="true" />
              <span>{BOARDS_NAV_LABEL}</span>
              <ChevronRightIcon
                aria-hidden="true"
                className="ml-auto transition-transform group-data-[panel-open]/boards-label:rotate-90"
              />
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <nav aria-label={BOARDS_NAV_LABEL}>
                  <SidebarMenuSub>
                    {creating ? (
                      <SidebarMenuSubItem>
                        <SidebarInput
                          aria-label={CREATE_BOARD_RAIL_LABEL}
                          autoFocus
                          disabled={createBoard.isPending}
                          maxLength={BOARD_NAME_MAX}
                          onBlur={commitCreate}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={onCreateKeyDown}
                          placeholder={CREATE_BOARD_PLACEHOLDER}
                          value={draft}
                        />
                      </SidebarMenuSubItem>
                    ) : null}

                    {isInitialLoad
                      ? SKELETON_ROWS.map((row) => (
                          <SidebarMenuSubItem key={row}>
                            <SidebarMenuSkeleton showIcon={false} />
                          </SidebarMenuSubItem>
                        ))
                      : null}

                    {isInitialLoad || isError
                      ? null
                      : memberships.map((membership) => (
                          <SidebarMenuSubItem key={membership.board.id}>
                            <SidebarMenuSubButton
                              aria-current={
                                membership.board.id === activeBoardId
                                  ? "page"
                                  : undefined
                              }
                              // Rendered as a <button> (a form control), which
                              // sizes to its content rather than stretching like
                              // the default <a>, so w-full makes the row and its
                              // active highlight span the list width.
                              className="w-full"
                              isActive={membership.board.id === activeBoardId}
                              onClick={() => openBoard(membership.board.id)}
                              render={<button type="button" />}
                            >
                              <span>{membership.board.name}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                  </SidebarMenuSub>
                </nav>
                {isError ? (
                  <Alert
                    className="border-0 bg-transparent"
                    variant="destructive"
                  >
                    <AlertDescription>{RAIL_LOAD_ERROR}</AlertDescription>
                  </Alert>
                ) : null}
                {createError ? (
                  <Alert
                    className="mt-1 border-0 bg-transparent"
                    variant="destructive"
                  >
                    <AlertDescription>{createError}</AlertDescription>
                  </Alert>
                ) : null}
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>
      <SidebarFooter className="pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <AccountMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
