import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CTA_RESEND,
  CTA_SEND_CODE,
  EMAIL_LABEL,
  ERROR_OTP_INVALID,
  ERROR_RATE_LIMIT,
  ERROR_TRANSPORT,
  OTP_HEADING,
  OTP_SENT_NEUTRAL,
} from "../../lib/copy";

const RESEND_COOLDOWN_MS = 60_000;
const RESEND_COUNTDOWN_NAME_PATTERN = /Erneut senden in/;

const navigate = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

// jsdom has no layout engine, so it doesn't implement
// `document.elementFromPoint`. input-otp's password-manager-badge detection
// polls it (via setTimeout) whenever the field is focused, which is exactly
// what happens when a real code is typed into the field below. Stub it so
// those background timers resolve instead of throwing an unhandled
// exception after the test has already made its assertions.
if (typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null;
}

const requestMagicLink = vi.fn((..._args: unknown[]) => Promise.resolve());
const verifyEmailOtp = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@/features/auth/api/auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/auth/api/auth")
  >("@/features/auth/api/auth");
  return {
    ...actual,
    requestMagicLink: (...a: unknown[]) => requestMagicLink(...a),
    verifyEmailOtp: (...a: unknown[]) => verifyEmailOtp(...a),
  };
});

import { SignInForm } from "../sign-in-form";

function renderForm() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(<SignInForm redirect="/" />, { wrapper });
}

describe("SignInForm", () => {
  beforeEach(() => {
    navigate.mockClear();
    requestMagicLink.mockReset();
    requestMagicLink.mockResolvedValue(undefined);
    verifyEmailOtp.mockReset();
    verifyEmailOtp.mockResolvedValue(undefined);
  });

  it("advances to the OTP step after sending", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(EMAIL_LABEL), "alice@dev.local");
    await userEvent.click(screen.getByRole("button", { name: CTA_SEND_CODE }));
    await waitFor(() =>
      expect(screen.getByText(OTP_HEADING)).toBeInTheDocument()
    );
    expect(requestMagicLink).toHaveBeenCalledOnce();
  });

  it("advances to the OTP step even on a 422 (anti-enumeration)", async () => {
    requestMagicLink.mockRejectedValueOnce(
      Object.assign(new Error("Signups not allowed"), { status: 422 })
    );
    renderForm();
    await userEvent.type(
      screen.getByLabelText(EMAIL_LABEL),
      "nobody@dev.local"
    );
    await userEvent.click(screen.getByRole("button", { name: CTA_SEND_CODE }));
    await waitFor(() =>
      expect(screen.getByText(OTP_SENT_NEUTRAL)).toBeInTheDocument()
    );
  });

  it("shows an inline error on a rate limit (429)", async () => {
    requestMagicLink.mockRejectedValueOnce(
      Object.assign(new Error("rate"), { status: 429 })
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(EMAIL_LABEL), "alice@dev.local");
    await userEvent.click(screen.getByRole("button", { name: CTA_SEND_CODE }));
    await waitFor(() =>
      expect(screen.getByText(ERROR_RATE_LIMIT)).toBeInTheDocument()
    );
    expect(screen.queryByText(OTP_HEADING)).not.toBeInTheDocument();
  });

  it("navigates into the app after a valid code", async () => {
    const { container } = renderForm();
    await userEvent.type(screen.getByLabelText(EMAIL_LABEL), "alice@dev.local");
    await userEvent.click(screen.getByRole("button", { name: CTA_SEND_CODE }));
    await waitFor(() =>
      expect(screen.getByText(OTP_HEADING)).toBeInTheDocument()
    );

    const otpInput = container.querySelector("input");
    if (!otpInput) {
      throw new Error("expected the input-otp field to render an <input>");
    }
    await userEvent.type(otpInput, "123456");

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("does not navigate when the OTP verify fails", async () => {
    verifyEmailOtp.mockRejectedValueOnce(
      Object.assign(new Error("invalid_otp"), { status: 401 })
    );
    const { container } = renderForm();
    await userEvent.type(screen.getByLabelText(EMAIL_LABEL), "alice@dev.local");
    await userEvent.click(screen.getByRole("button", { name: CTA_SEND_CODE }));
    await waitFor(() =>
      expect(screen.getByText(OTP_HEADING)).toBeInTheDocument()
    );

    const otpInput = container.querySelector("input");
    if (!otpInput) {
      throw new Error("expected the input-otp field to render an <input>");
    }
    await userEvent.type(otpInput, "123456");

    await waitFor(() =>
      expect(screen.getByText(ERROR_OTP_INVALID)).toBeInTheDocument()
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("surfaces a resend failure below the code cells without leaving the OTP step", async () => {
    vi.useFakeTimers();
    try {
      renderForm();
      fireEvent.change(screen.getByLabelText(EMAIL_LABEL), {
        target: { value: "alice@dev.local" },
      });
      fireEvent.click(screen.getByRole("button", { name: CTA_SEND_CODE }));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(OTP_HEADING)).toBeInTheDocument();

      // Clear the cooldown so the resend button is enabled again.
      act(() => {
        vi.advanceTimersByTime(RESEND_COOLDOWN_MS);
      });

      // The resend hits a rate limit (not existence-revealing: an unknown email
      // is a 422, which stays silent).
      requestMagicLink.mockRejectedValueOnce(
        Object.assign(new Error("rate"), { status: 429 })
      );
      fireEvent.click(screen.getByRole("button", { name: CTA_RESEND }));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(ERROR_RATE_LIMIT)).toBeInTheDocument();
      expect(screen.getByText(OTP_HEADING)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps resend enabled after a transport failure (nothing was sent)", async () => {
    vi.useFakeTimers();
    try {
      renderForm();
      fireEvent.change(screen.getByLabelText(EMAIL_LABEL), {
        target: { value: "alice@dev.local" },
      });
      fireEvent.click(screen.getByRole("button", { name: CTA_SEND_CODE }));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(OTP_HEADING)).toBeInTheDocument();

      // Clear the initial cooldown so resend is enabled again.
      act(() => {
        vi.advanceTimersByTime(RESEND_COOLDOWN_MS);
      });

      // A transport failure (no status) must not start a new cooldown.
      requestMagicLink.mockRejectedValueOnce(new Error("network down"));
      fireEvent.click(screen.getByRole("button", { name: CTA_RESEND }));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(ERROR_TRANSPORT)).toBeInTheDocument();
      // Still immediately resendable: no countdown, button enabled.
      expect(screen.getByRole("button", { name: CTA_RESEND })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables resend with a countdown, then re-enables once the cooldown expires", async () => {
    vi.useFakeTimers();
    try {
      renderForm();
      fireEvent.change(screen.getByLabelText(EMAIL_LABEL), {
        target: { value: "alice@dev.local" },
      });
      fireEvent.click(screen.getByRole("button", { name: CTA_SEND_CODE }));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(OTP_HEADING)).toBeInTheDocument();

      const resendButton = screen.getByRole("button", {
        name: RESEND_COUNTDOWN_NAME_PATTERN,
      });
      expect(resendButton).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(RESEND_COOLDOWN_MS);
      });

      const resendButtonAfterCooldown = screen.getByRole("button", {
        name: CTA_RESEND,
      });
      expect(resendButtonAfterCooldown).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
