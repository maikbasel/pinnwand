import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADD_TASK_SUBMIT, TASK_TITLE_PLACEHOLDER } from "../../lib/copy";

const create = vi.fn();
vi.mock("../../hooks/use-create-task", () => ({
  useCreateTask: () => ({ create, isPending: false, isError: false }),
}));

import { TaskComposer } from "../task-composer";

afterEach(() => vi.clearAllMocks());

describe("TaskComposer", () => {
  it("creates a task with the typed title, then clears for the next entry", async () => {
    const onClose = vi.fn();
    render(
      <TaskComposer boardId="b" column="zu_erledigen" onClose={onClose} />
    );
    const input = screen.getByRole("textbox", { name: TASK_TITLE_PLACEHOLDER });
    await userEvent.type(input, "Design finalisieren");
    await userEvent.click(
      screen.getByRole("button", { name: ADD_TASK_SUBMIT })
    );
    expect(create).toHaveBeenCalledWith("zu_erledigen", "Design finalisieren");
    expect(input).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not create a task for a blank title", async () => {
    render(<TaskComposer boardId="b" column="offen" onClose={vi.fn()} />);
    await userEvent.type(
      screen.getByRole("textbox", { name: TASK_TITLE_PLACEHOLDER }),
      "   "
    );
    await userEvent.click(
      screen.getByRole("button", { name: ADD_TASK_SUBMIT })
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<TaskComposer boardId="b" column="offen" onClose={onClose} />);
    const input = screen.getByRole("textbox", { name: TASK_TITLE_PLACEHOLDER });
    await userEvent.type(input, "x");
    await userEvent.type(input, "{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
