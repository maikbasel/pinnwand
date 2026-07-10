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

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return {
    ...actual,
    createTask: vi.fn().mockResolvedValue({
      id: "r",
      boardId: "b",
      column: "offen",
      title: "X",
      description: "",
      priority: "mittel",
      dueDate: null,
      position: 1024,
      assigneeIds: [],
      createdBy: null,
      createdAt: "",
      updatedAt: "",
    }),
  };
});

import { createTask } from "../../api/tasks";
import { DeferredDeleteProvider } from "../deferred-delete";
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

function renderSheet() {
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
      mode={{ kind: "create", column: "offen" }}
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
