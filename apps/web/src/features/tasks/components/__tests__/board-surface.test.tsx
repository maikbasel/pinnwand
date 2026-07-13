import { TASK_COLUMNS } from "@pinnwand/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADD_TASK_LABEL, TASK_TITLE_PLACEHOLDER } from "../../lib/copy";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, listBoardTasks: vi.fn() };
});
vi.mock("@/features/members", () => ({
  useBoardMembers: () => ({
    members: [],
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { listBoardTasks } from "../../api/tasks";
import { BoardSurface } from "../board-surface";

function renderSurface() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<BoardSurface boardId="b" />, { wrapper });
}

const sample: Task = {
  id: "1",
  boardId: "b",
  column: "offen",
  title: "Sichtbare Aufgabe",
  description: "",
  priority: "hoch",
  dueDate: null,
  position: 10,
  assigneeIds: [],
  createdBy: null,
  createdAt: "",
  updatedAt: "",
};

afterEach(() => vi.clearAllMocks());

describe("BoardSurface", () => {
  it("renders a task card once loaded", async () => {
    vi.mocked(listBoardTasks).mockResolvedValue([sample]);
    renderSurface();
    expect(await screen.findByText("Sichtbare Aufgabe")).toBeInTheDocument();
  });
  it("shows an inline add affordance in every column when there are no tasks", async () => {
    vi.mocked(listBoardTasks).mockResolvedValue([]);
    renderSurface();
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: new RegExp(ADD_TASK_LABEL),
        })
      ).toHaveLength(TASK_COLUMNS.length)
    );
  });
  it("reveals the inline composer when an add affordance is activated", async () => {
    vi.mocked(listBoardTasks).mockResolvedValue([]);
    renderSurface();
    const [firstAdd] = await screen.findAllByRole("button", {
      name: new RegExp(ADD_TASK_LABEL),
    });
    if (!firstAdd) {
      throw new Error("expected an add affordance to render");
    }
    await userEvent.click(firstAdd);
    expect(
      screen.getByRole("textbox", { name: TASK_TITLE_PLACEHOLDER })
    ).toBeInTheDocument();
  });
});
