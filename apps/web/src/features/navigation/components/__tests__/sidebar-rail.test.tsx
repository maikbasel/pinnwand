import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardMembership } from "@/features/boards";
import {
  BOARDS_NAV_LABEL,
  CREATE_BOARD_RAIL_LABEL,
  JOIN_BOARD_RAIL_LABEL,
  RAIL_LOAD_ERROR,
} from "../../lib/copy";

const navigate = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const useActiveBoardId = vi.hoisted(() => vi.fn(() => "board-2"));
vi.mock("@/features/navigation/lib/destinations", () => ({ useActiveBoardId }));

const useMyBoards = vi.hoisted(() => vi.fn());
const createBoardMutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@/features/boards", () => ({
  useCreateBoard: () => ({
    isPending: false,
    mutateAsync: createBoardMutateAsync,
  }),
  useMyBoards,
}));

const useSignOut = vi.hoisted(() =>
  vi.fn(() => ({ isPending: false, mutate: vi.fn() }))
);
const useSession = vi.hoisted(() =>
  vi.fn(() => ({
    isError: false,
    isLoading: false,
    session: null,
    user: { email: "alice@dev.local", id: "user-1" },
  }))
);
vi.mock("@/features/auth", () => ({ useSession, useSignOut }));

import { SidebarProvider } from "@/shared/components/ui/sidebar";
import { SidebarRail } from "../sidebar-rail";

function renderRail() {
  return render(
    <SidebarProvider>
      <SidebarRail />
    </SidebarProvider>
  );
}

function membership(id: string, name: string): BoardMembership {
  return {
    board: {
      createdAt: new Date().toISOString(),
      createdBy: "owner-id",
      id,
      joinCode: "ABCD2345",
      name,
    },
    role: "owner",
  };
}

describe("SidebarRail", () => {
  beforeEach(() => {
    navigate.mockClear();
    createBoardMutateAsync.mockReset();
    useActiveBoardId.mockReturnValue("board-2");
  });

  it("lists every board as a rail item and marks the active one", () => {
    useMyBoards.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      memberships: [
        membership("board-1", "Team-Board"),
        membership("board-2", "Charlies Board"),
      ],
    });

    renderRail();

    const nav = screen.getByRole("navigation", { name: BOARDS_NAV_LABEL });
    expect(nav).toBeInTheDocument();

    const teamBoard = screen.getByText("Team-Board").closest("button");
    const charliesBoard = screen.getByText("Charlies Board").closest("button");
    expect(teamBoard).not.toHaveAttribute("aria-current");
    expect(charliesBoard).toHaveAttribute("aria-current", "page");
  });

  it("renders the create row and the join row", () => {
    useMyBoards.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      memberships: [],
    });

    renderRail();

    expect(screen.getByText(CREATE_BOARD_RAIL_LABEL)).toBeInTheDocument();
    expect(screen.getByText(JOIN_BOARD_RAIL_LABEL)).toBeInTheDocument();
  });

  it("shows an alert when the boards query fails", () => {
    useMyBoards.mockReturnValue({
      error: new Error("boom"),
      isError: true,
      isPending: false,
      memberships: [],
    });

    renderRail();

    expect(screen.getByRole("alert")).toHaveTextContent(RAIL_LOAD_ERROR);
  });
});
