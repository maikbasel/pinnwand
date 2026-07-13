import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TASK_DUE_CLEAR_LABEL, TASK_DUE_PLACEHOLDER } from "../../lib/copy";
import { DueDateField } from "../due-date-field";

describe("DueDateField", () => {
  it("renders an ISO value as a German-formatted date", () => {
    render(<DueDateField onChange={() => undefined} value="2026-08-01" />);
    expect(
      screen.getByRole("button", { name: "01.08.2026" })
    ).toBeInTheDocument();
  });

  it("shows the placeholder when no date is set", () => {
    render(<DueDateField onChange={() => undefined} value="" />);
    expect(
      screen.getByRole("button", { name: TASK_DUE_PLACEHOLDER })
    ).toBeInTheDocument();
  });

  it("emits an ISO date string when a day is picked", async () => {
    const onChange = vi.fn();
    render(<DueDateField onChange={onChange} value="2026-08-15" />);
    await userEvent.click(screen.getByRole("button", { name: "15.08.2026" }));
    // Day cells carry a long German aria-label, so match on visible text.
    const day20 = screen
      .getAllByRole("button")
      .find((button) => button.textContent === "20");
    if (!day20) {
      throw new Error("day 20 not rendered");
    }
    await userEvent.click(day20);
    expect(onChange).toHaveBeenCalledWith("2026-08-20");
  });

  it("clears the date", async () => {
    const onChange = vi.fn();
    render(<DueDateField onChange={onChange} value="2026-08-01" />);
    await userEvent.click(
      screen.getByRole("button", { name: TASK_DUE_CLEAR_LABEL })
    );
    expect(onChange).toHaveBeenCalledWith("");
  });
});
