import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardMember } from "@/features/members";
import {
  ASSIGNEE_REMOVE_LABEL,
  TASK_ASSIGNEES_ALL_ASSIGNED,
  TASK_ASSIGNEES_EMPTY,
  TASK_ASSIGNEES_LOAD_ERROR,
  TASK_ASSIGNEES_NO_MATCH,
} from "../../lib/copy";

const useBoardMembers = vi.fn();
vi.mock("@/features/members", () => ({
  useBoardMembers: (boardId: string) => useBoardMembers(boardId),
}));

import { AssigneePicker } from "../assignee-picker";

function member(userId: string, displayName: string): BoardMember {
  return { userId, displayName, role: "member" };
}

afterEach(() => vi.clearAllMocks());

describe("AssigneePicker", () => {
  it("adds a member from the search results", async () => {
    useBoardMembers.mockReturnValue({
      members: [member("u1", "Alice"), member("u2", "Bob")],
      isPending: false,
      isError: false,
    });
    const onChange = vi.fn();
    render(<AssigneePicker boardId="b" onChange={onChange} value={["u1"]} />);

    // Alice is already assigned (a chip), so only Bob is an addable result.
    await userEvent.click(screen.getByRole("button", { name: "Bob" }));

    expect(onChange).toHaveBeenCalledWith(["u1", "u2"]);
  });

  it("filters the search results by query", async () => {
    useBoardMembers.mockReturnValue({
      members: [member("u1", "Alice"), member("u2", "Bob")],
      isPending: false,
      isError: false,
    });
    render(<AssigneePicker boardId="b" onChange={vi.fn()} value={[]} />);

    await userEvent.type(screen.getByRole("textbox"), "ali");

    expect(screen.getByRole("button", { name: "Alice" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bob" })
    ).not.toBeInTheDocument();
  });

  it("shows a no-match message when the query matches nobody", async () => {
    useBoardMembers.mockReturnValue({
      members: [member("u1", "Alice")],
      isPending: false,
      isError: false,
    });
    render(<AssigneePicker boardId="b" onChange={vi.fn()} value={[]} />);

    await userEvent.type(screen.getByRole("textbox"), "zzz");

    expect(screen.getByText(TASK_ASSIGNEES_NO_MATCH)).toBeInTheDocument();
  });

  it("removes a selected member via the chip", async () => {
    useBoardMembers.mockReturnValue({
      members: [member("u1", "Alice")],
      isPending: false,
      isError: false,
    });
    const onChange = vi.fn();
    render(<AssigneePicker boardId="b" onChange={onChange} value={["u1"]} />);

    await userEvent.click(
      screen.getByRole("button", { name: `${ASSIGNEE_REMOVE_LABEL}: Alice` })
    );

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows the all-assigned message when every member is selected", () => {
    useBoardMembers.mockReturnValue({
      members: [member("u1", "Alice")],
      isPending: false,
      isError: false,
    });
    render(<AssigneePicker boardId="b" onChange={vi.fn()} value={["u1"]} />);

    expect(screen.getByText(TASK_ASSIGNEES_ALL_ASSIGNED)).toBeInTheDocument();
  });

  it("shows an empty state when the board has no members", () => {
    useBoardMembers.mockReturnValue({
      members: [],
      isPending: false,
      isError: false,
    });
    render(<AssigneePicker boardId="b" onChange={vi.fn()} value={[]} />);

    expect(screen.getByText(TASK_ASSIGNEES_EMPTY)).toBeInTheDocument();
  });

  it("shows an error state when members fail to load", () => {
    useBoardMembers.mockReturnValue({
      members: [],
      isPending: false,
      isError: true,
    });
    render(<AssigneePicker boardId="b" onChange={vi.fn()} value={[]} />);

    expect(screen.getByText(TASK_ASSIGNEES_LOAD_ERROR)).toBeInTheDocument();
  });
});
