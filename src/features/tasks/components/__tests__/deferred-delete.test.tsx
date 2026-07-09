import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/shared/components/ui/sonner";
import { TASK_DELETED_TOAST, UNDO_LABEL } from "../../lib/copy";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, deleteTask: vi.fn().mockResolvedValue(undefined) };
});

import { deleteTask } from "../../api/tasks";
import { DeferredDeleteProvider, useDeferredDelete } from "../deferred-delete";

const sample: Task = {
  id: "t",
  boardId: "b",
  column: "offen",
  title: "Weg",
  description: "",
  priority: "mittel",
  dueDate: null,
  position: 1024,
  assigneeIds: [],
  createdBy: null,
  createdAt: "",
  updatedAt: "",
};

function Harness() {
  const { requestDelete } = useDeferredDelete();
  return (
    <button onClick={() => requestDelete(sample)} type="button">
      go
    </button>
  );
}

function renderHarness() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DeferredDeleteProvider boardId="b">{children}</DeferredDeleteProvider>
      <Toaster />
    </QueryClientProvider>
  );
  return render(<Harness />, { wrapper });
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("deferred delete", () => {
  it("fires DELETE only after the undo window elapses", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText(TASK_DELETED_TOAST)).toBeInTheDocument();
    expect(deleteTask).not.toHaveBeenCalled();
    // The timer fires the mutation, whose async onMutate (cancelQueries)
    // resolves on a microtask before mutationFn runs — the async timer API
    // flushes that chain so the api call is observable synchronously below.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(deleteTask).toHaveBeenCalledWith({ taskId: "t" });
  });

  it("does not fire DELETE when Undo is clicked in the window", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "go" }));
    await user.click(screen.getByRole("button", { name: UNDO_LABEL }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("flushes a still-pending delete on unmount instead of abandoning it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderHarness();
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(deleteTask).not.toHaveBeenCalled();
    // Leave the board mid-window: the requested delete must still fire.
    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(deleteTask).toHaveBeenCalledWith({ taskId: "t" });
  });
});
