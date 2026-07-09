import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardMembership } from "@/features/boards";
import {
  ACCOUNT_LABEL,
  BACK_TO_BOARDS_LABEL,
  BRAND_NAME,
} from "../../lib/copy";

type MockLinkProps = {
  to: string;
  children?: ReactNode;
  className?: string;
  "aria-label"?: string;
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: MockLinkProps) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const useActiveBoardId = vi.hoisted(() => vi.fn(() => null as string | null));
vi.mock("@/features/navigation/lib/destinations", () => ({
  useActiveBoardId,
}));

const useMyBoards = vi.hoisted(() => vi.fn());
vi.mock("@/features/boards", () => ({
  BoardActionsMenu: () => null,
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

import { TopAppBar } from "../top-app-bar";

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

describe("TopAppBar", () => {
  beforeEach(() => {
    useActiveBoardId.mockReturnValue(null);
    useMyBoards.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      memberships: [membership("board-1", "Team-Board")],
    });
  });

  it("shows the brand name, the account menu, and no back link on the list root", () => {
    render(<TopAppBar />);

    expect(screen.getByText(BRAND_NAME)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ACCOUNT_LABEL })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: BACK_TO_BOARDS_LABEL })
    ).not.toBeInTheDocument();
  });

  it("shows the active board's name and a back link on a board route", () => {
    useActiveBoardId.mockReturnValue("board-1");

    render(<TopAppBar />);

    expect(screen.getByText("Team-Board")).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: BACK_TO_BOARDS_LABEL });
    expect(backLink).toHaveAttribute("href", "/");
  });

  it("hides the account menu on a board route (scope by depth)", () => {
    useActiveBoardId.mockReturnValue("board-1");

    render(<TopAppBar />);

    expect(
      screen.queryByRole("button", { name: ACCOUNT_LABEL })
    ).not.toBeInTheDocument();
  });
});
