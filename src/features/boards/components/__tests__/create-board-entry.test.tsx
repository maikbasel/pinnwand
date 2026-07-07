import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_LABEL, CREATE_BOARD_CTA } from "../../lib/copy";
import type { Board } from "../../types";

const createBoardMutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@/features/boards/hooks/use-create-board", () => ({
  useCreateBoard: () => ({
    isPending: false,
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
});
