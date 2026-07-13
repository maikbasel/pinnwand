import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_LABEL, CREATE_BOARD_CTA } from "../../lib/copy";
import type { Board } from "../../types";

// The hook mock reads `pendingState.value` on every render, so a mutation that
// flips it to `true` disables the input mid-flight — the same state the real
// hook produces while `create_board` is in flight.
const pendingState = vi.hoisted(() => ({ value: false }));
const createBoardMutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@/features/boards/hooks/use-create-board", () => ({
  useCreateBoard: () => ({
    isPending: pendingState.value,
    mutateAsync: createBoardMutateAsync,
  }),
}));

import { CreateBoardEntry } from "../create-board-entry";

const NEW_BOARD: Board = {
  createdAt: new Date().toISOString(),
  createdBy: "user-1",
  id: "new-board-id",
  joinCode: "ABCD2345",
  name: "Family Board",
};

describe("CreateBoardEntry", () => {
  beforeEach(() => {
    pendingState.value = false;
    createBoardMutateAsync.mockReset();
    createBoardMutateAsync.mockResolvedValue(NEW_BOARD);
  });

  it("creates a board and reports it back once the name is confirmed", async () => {
    const onCreated = vi.fn();
    render(<CreateBoardEntry onCreated={onCreated} />);

    await userEvent.click(
      screen.getByRole("button", { name: CREATE_BOARD_CTA })
    );
    await userEvent.type(
      screen.getByLabelText(CREATE_BOARD_CTA),
      NEW_BOARD.name
    );
    await userEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(createBoardMutateAsync).toHaveBeenCalledWith({
      name: NEW_BOARD.name,
    });
    expect(onCreated).toHaveBeenCalledWith(NEW_BOARD);
  });

  it("does not fire a second create when the disabled input blurs mid-flight", async () => {
    // Hold the mutation in flight and flip the pending flag, so the input is
    // disabled after the first commit — reproducing the browser's disable-blur.
    createBoardMutateAsync.mockImplementation(() => {
      pendingState.value = true;
      return new Promise<Board>(() => {
        // never resolves: the create stays in flight for the duration
      });
    });
    const onCreated = vi.fn();
    const { rerender } = render(<CreateBoardEntry onCreated={onCreated} />);

    await userEvent.click(
      screen.getByRole("button", { name: CREATE_BOARD_CTA })
    );
    const input = screen.getByLabelText(CREATE_BOARD_CTA);
    await userEvent.type(input, NEW_BOARD.name);
    await userEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    // The first commit started the create and flipped isPending. The real hook
    // re-renders on that transition, disabling the input and rebuilding onBlur
    // against the pending state; force the same re-render here. In a browser,
    // disabling a focused input then dispatches blur -> onBlur -> commit, so
    // fire that blur explicitly. The pending guard must swallow it.
    rerender(<CreateBoardEntry onCreated={onCreated} />);
    fireEvent.blur(input);

    expect(createBoardMutateAsync).toHaveBeenCalledTimes(1);
  });
});
