import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JOIN_ERROR_INVALID_CODE } from "../../lib/copy";

const navigate = vi.fn(() => Promise.resolve());

type MockLinkProps = {
  to: string;
  children?: ReactNode;
  className?: string;
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: MockLinkProps) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

const joinBoardMutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@/features/boards/hooks/use-join-board", () => ({
  useJoinBoard: () => ({
    isPending: false,
    mutateAsync: joinBoardMutateAsync,
  }),
}));

// jsdom has no layout engine, so it doesn't implement
// `document.elementFromPoint`. input-otp's password-manager-badge detection
// polls it (via setTimeout) whenever the field is focused, which is exactly
// what happens when a real code is typed into the field below. Stub it so
// those background timers resolve instead of throwing an unhandled
// exception after the test has already made its assertions.
if (typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null;
}

import { JoinBoardPage } from "../join-board-page";

describe("JoinBoardPage", () => {
  beforeEach(() => {
    navigate.mockClear();
    joinBoardMutateAsync.mockReset();
  });

  it("shows the invalid-code copy and does not navigate on a rejected join", async () => {
    joinBoardMutateAsync.mockRejectedValueOnce(new Error("invalid join code"));
    const { container } = render(<JoinBoardPage />);

    const otpInput = container.querySelector("input");
    if (!otpInput) {
      throw new Error("expected the input-otp field to render an <input>");
    }
    await userEvent.type(otpInput, "ABCD2345");

    await screen.findByText(JOIN_ERROR_INVALID_CODE);
    expect(navigate).not.toHaveBeenCalled();
  });
});
