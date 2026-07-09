import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { groupByColumn } from "./group";

function task(
  partial: Partial<Task> & {
    id: string;
    column: Task["column"];
    position: number;
  }
): Task {
  return {
    boardId: "b",
    title: "t",
    description: "",
    priority: "mittel",
    dueDate: null,
    assigneeIds: [],
    createdBy: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  } as Task;
}

describe("groupByColumn", () => {
  it("buckets tasks into all four columns, empty arrays included", () => {
    const grouped = groupByColumn([
      task({ id: "1", column: "offen", position: 10 }),
    ]);
    expect(Object.keys(grouped)).toEqual([
      "offen",
      "zu_erledigen",
      "in_bearbeitung",
      "erledigt",
    ]);
    expect(grouped.zu_erledigen).toEqual([]);
  });
  it("sorts within a column by position ascending", () => {
    const grouped = groupByColumn([
      task({ id: "b", column: "offen", position: 20 }),
      task({ id: "a", column: "offen", position: 10 }),
    ]);
    expect(grouped.offen.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
