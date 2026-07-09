import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BoardMembership } from "../../types";

const navigate = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

const membership: BoardMembership = {
  board: {
    id: "b",
    name: "Team-Board",
    joinCode: "AB12CD34",
    createdBy: null,
    createdAt: "",
  },
  role: "owner",
};
vi.mock("../../hooks/use-my-boards", () => ({
  useMyBoards: () => ({
    memberships: [membership],
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// The board surface is exercised in its own suite; stub it here so this test
// stays focused on the board-first header layout.
vi.mock("@/features/tasks", () => ({
  BoardSurface: () => <div data-testid="board-surface" />,
}));

import { BoardDetailPage } from "../board-detail-page";

function renderPage() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<BoardDetailPage boardId="b" />, { wrapper });
}

describe("BoardDetailPage board-first header", () => {
  it("shows the board name as a heading and fills the body with the board surface", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Team-Board" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("board-surface")).toBeInTheDocument();
  });

  it("exposes the board actions overflow menu", () => {
    renderPage();
    expect(screen.getByTestId("board-actions-trigger")).toBeInTheDocument();
  });
});
