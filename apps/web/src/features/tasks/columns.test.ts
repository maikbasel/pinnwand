import { TASK_COLUMNS, TASK_PRIORITIES } from "@pinnwand/contracts";
import { describe, expect, it } from "vitest";

describe("task columns", () => {
  it("has exactly the four fixed columns in board order", () => {
    expect(TASK_COLUMNS.map((column) => column.id)).toEqual([
      "offen",
      "zu_erledigen",
      "in_bearbeitung",
      "erledigt",
    ]);
  });

  it("labels every column", () => {
    for (const column of TASK_COLUMNS) {
      expect(column.label).not.toBe("");
    }
  });
});

describe("task priorities", () => {
  it("has the three priority levels from low to high", () => {
    expect(TASK_PRIORITIES.map((priority) => priority.id)).toEqual([
      "niedrig",
      "mittel",
      "hoch",
    ]);
  });
});
