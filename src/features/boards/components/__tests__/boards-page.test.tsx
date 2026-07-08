import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARDS_EMPTY_STATE, BOARDS_LOAD_ERROR } from "../../lib/copy";
import type { BoardMembership } from "../../types";

const navigate = vi.fn(() => Promise.resolve());

type MockLinkProps = {
  to: string;
  children?: ReactNode;
  className?: string;
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: MockLinkProps) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

const useMyBoards = vi.hoisted(() => vi.fn());
vi.mock("@/features/boards/hooks/use-my-boards", () => ({ useMyBoards }));

const createBoardMutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@/features/boards/hooks/use-create-board", () => ({
  useCreateBoard: () => ({
    isPending: false,
    mutateAsync: createBoardMutateAsync,
  }),
}));

import { BoardsPage } from "../boards-page";

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

describe("BoardsPage", () => {
  beforeEach(() => {
    navigate.mockClear();
    createBoardMutateAsync.mockReset();
  });

  it("shows the empty-state copy when there are no boards", () => {
    useMyBoards.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      memberships: [],
    });

    render(<BoardsPage />);

    expect(screen.getByText(BOARDS_EMPTY_STATE)).toBeInTheDocument();
  });

  it("renders every board name from the memberships", () => {
    useMyBoards.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      memberships: [
        membership("1", "Team-Board"),
        membership("2", "Charlies Board"),
      ],
    });

    render(<BoardsPage />);

    expect(screen.getByText("Team-Board")).toBeInTheDocument();
    expect(screen.getByText("Charlies Board")).toBeInTheDocument();
  });

  it("shows the load-error copy when the query fails", () => {
    useMyBoards.mockReturnValue({
      error: new Error("boom"),
      isError: true,
      isPending: false,
      memberships: [],
    });

    render(<BoardsPage />);

    expect(screen.getByText(BOARDS_LOAD_ERROR)).toBeInTheDocument();
  });
});
