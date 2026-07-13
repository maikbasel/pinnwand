import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREATE_TASK_TITLE,
  SAVE_TASK_LABEL,
  TASK_TITLE_LABEL,
} from "../../lib/copy";

// Defined inside the factory (not referencing an outer const) because vi.mock is
// hoisted above module-level declarations.
vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  const row = {
    id: "t1",
    boardId: "b",
    column: "offen",
    title: "Designs reviewen",
    description: "",
    priority: "mittel",
    dueDate: null,
    position: 1024,
    assigneeIds: [],
    createdBy: null,
    createdAt: "",
    updatedAt: "",
  };
  return {
    ...actual,
    createTask: vi.fn().mockResolvedValue({ ...row, id: "r" }),
    updateTask: vi.fn().mockResolvedValue(row),
  };
});

const SAMPLE_TASK = {
  id: "t1",
  boardId: "b",
  column: "offen" as const,
  title: "Designs reviewen",
  description: "",
  priority: "mittel" as const,
  dueDate: null,
  position: 1024,
  assigneeIds: [] as string[],
  createdBy: null,
  createdAt: "",
  updatedAt: "",
};

vi.mock("@/features/members", () => ({
  useBoardMembers: () => ({
    members: [],
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { createTask, updateTask } from "../../api/tasks";
import { DeferredDeleteProvider } from "../deferred-delete";
import type { TaskDetailMode } from "../task-detail-sheet";
import { TaskDetailSheet } from "../task-detail-sheet";

// Force the desktop (Base UI Sheet) surface: it renders reliably in jsdom and
// exercises the same form logic as the mobile Drawer. The setup stub otherwise
// reports matches:false (mobile) for every query.
beforeEach(() => {
  window.matchMedia = ((query: string) =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => vi.clearAllMocks());

function renderSheet(
  mode: TaskDetailMode = { kind: "create", column: "offen" }
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DeferredDeleteProvider boardId="b">{children}</DeferredDeleteProvider>
    </QueryClientProvider>
  );
  return render(
    <TaskDetailSheet
      boardId="b"
      mode={mode}
      onOpenChange={() => undefined}
      open
    />,
    { wrapper }
  );
}

describe("TaskDetailSheet (create)", () => {
  it("creates a task from the title field", async () => {
    renderSheet();
    expect(screen.getByText(CREATE_TASK_TITLE)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(TASK_TITLE_LABEL), "Neue Sache");
    await userEvent.click(
      screen.getByRole("button", { name: SAVE_TASK_LABEL })
    );
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Neue Sache", column: "offen" })
    );
  });
});

describe("TaskDetailSheet (edit)", () => {
  it("commits an inline title edit immediately, without Speichern", async () => {
    renderSheet({ kind: "edit", task: SAMPLE_TASK });
    // The title reads as a heading button until clicked.
    await userEvent.click(
      screen.getByRole("button", { name: SAMPLE_TASK.title })
    );
    const input = screen.getByLabelText(TASK_TITLE_LABEL);
    await userEvent.clear(input);
    await userEvent.type(input, "Neuer Titel");
    await userEvent.keyboard("{Enter}");
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: SAMPLE_TASK.id, title: "Neuer Titel" })
    );
  });

  it("does not write when the inline edit is cancelled with Escape", async () => {
    renderSheet({ kind: "edit", task: SAMPLE_TASK });
    await userEvent.click(
      screen.getByRole("button", { name: SAMPLE_TASK.title })
    );
    const input = screen.getByLabelText(TASK_TITLE_LABEL);
    await userEvent.clear(input);
    await userEvent.type(input, "Verworfen");
    await userEvent.keyboard("{Escape}");
    expect(updateTask).not.toHaveBeenCalled();
  });
});
