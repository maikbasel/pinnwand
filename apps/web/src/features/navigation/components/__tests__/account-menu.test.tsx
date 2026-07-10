import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_LABEL, SIGN_OUT_LABEL } from "../../lib/copy";

const signOutMutate = vi.hoisted(() => vi.fn());
const useSignOut = vi.hoisted(() =>
  vi.fn(() => ({ isPending: false, mutate: signOutMutate }))
);
const useSession = vi.hoisted(() =>
  vi.fn(() => ({
    isError: false,
    isLoading: false,
    session: null,
    user: { email: "alice@dev.local", id: "user-1" },
  }))
);

vi.mock("@/features/auth", () => ({ useSession, useSignOut }));

import { AccountMenu } from "../account-menu";

describe("AccountMenu", () => {
  beforeEach(() => {
    signOutMutate.mockClear();
    useSignOut.mockReturnValue({ isPending: false, mutate: signOutMutate });
  });

  it("exposes the trigger with the account label", () => {
    render(<AccountMenu />);
    expect(
      screen.getByRole("button", { name: ACCOUNT_LABEL })
    ).toBeInTheDocument();
  });

  it("shows the identity email in the full trigger", () => {
    render(<AccountMenu />);
    expect(screen.getByTestId("account-menu-email")).toHaveTextContent(
      "alice@dev.local"
    );
  });

  it("hides the identity email in compact mode", () => {
    render(<AccountMenu compact />);
    expect(screen.queryByTestId("account-menu-email")).not.toBeInTheDocument();
  });

  it("signs out when Abmelden is activated", async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);

    await user.click(screen.getByRole("button", { name: ACCOUNT_LABEL }));
    await user.click(await screen.findByText(SIGN_OUT_LABEL));

    expect(signOutMutate).toHaveBeenCalledOnce();
  });

  it("disables the sign out action while pending", async () => {
    useSignOut.mockReturnValue({ isPending: true, mutate: signOutMutate });
    const user = userEvent.setup();
    render(<AccountMenu />);

    await user.click(screen.getByRole("button", { name: ACCOUNT_LABEL }));

    expect(await screen.findByTestId("account-signout")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });
});
