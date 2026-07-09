import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import { bottomPosition } from "../../lib/position";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, createTask: vi.fn() };
});

import { createTask } from "../../api/tasks";
import { useCreateTask } from "../use-create-task";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "seed",
    boardId: "b",
    column: "offen",
    title: "Seed",
    description: "",
    priority: "mittel",
    dueDate: null,
    position: 1024,
    assigneeIds: [],
    createdBy: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function setup(seed: Task[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(TASK_KEYS.byBoard("b"), seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCreateTask("b"), { wrapper });
  return { client, result };
}

afterEach(() => vi.clearAllMocks());

describe("useCreateTask", () => {
  it("inserts an optimistic card at the bottom of its column immediately", async () => {
    vi.mocked(createTask).mockImplementation(
      () => new Promise(() => undefined)
    );
    const seed = makeTask({ id: "seed", column: "offen", position: 1024 });
    const { client, result } = setup([seed]);

    act(() => result.current.create("offen", "Neue Karte"));

    await waitFor(() => {
      const cached = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b")) ?? [];
      expect(cached.some((t) => t.title === "Neue Karte")).toBe(true);
    });
    const cached = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b")) ?? [];
    const added = cached.find((t) => t.title === "Neue Karte");
    expect(added?.column).toBe("offen");
    expect(added?.position).toBe(bottomPosition([seed]));
  });

  it("calls the API with a bottom position for the target column", async () => {
    vi.mocked(createTask).mockResolvedValue(
      makeTask({ id: "real", title: "Neue Karte", column: "erledigt" })
    );
    setup([makeTask({ id: "seed", column: "erledigt", position: 2048 })]);
    const { result } = setup([
      makeTask({ id: "seed", column: "erledigt", position: 2048 }),
    ]);

    act(() => result.current.create("erledigt", "Neue Karte"));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: "b",
        column: "erledigt",
        title: "Neue Karte",
        priority: "mittel",
        position: bottomPosition([{ position: 2048 }]),
      })
    );
  });

  it("passes the full form through mutateAsync (sheet path)", async () => {
    vi.mocked(createTask).mockResolvedValue(
      makeTask({ id: "real", title: "Voll", column: "offen" })
    );
    const { result } = setup([]);

    await act(async () => {
      await result.current.mutateAsync({
        column: "offen",
        title: "Voll",
        description: "Details",
        priority: "hoch",
        dueDate: "2026-08-01",
      });
    });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        column: "offen",
        title: "Voll",
        description: "Details",
        priority: "hoch",
        dueDate: "2026-08-01",
      })
    );
  });

  it("rolls back the optimistic card when the create fails", async () => {
    vi.mocked(createTask).mockRejectedValue(new Error("nope"));
    const seed = makeTask({ id: "seed", column: "offen" });
    const { client, result } = setup([seed]);

    act(() => result.current.create("offen", "Verworfen"));

    await waitFor(() => {
      const cached = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b")) ?? [];
      expect(cached.some((t) => t.title === "Verworfen")).toBe(false);
    });
  });
});
