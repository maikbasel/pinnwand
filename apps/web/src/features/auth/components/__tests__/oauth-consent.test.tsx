import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_LOAD_ERROR,
  CONSENT_SUBMIT_ERROR,
  CTA_APPROVE,
  CTA_DENY,
} from "../../lib/copy";

const navigate = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const CLIENT_NAME_PATTERN = /Claude MCP Connector/;

const getAuthorizationDetails = vi.fn();
const submitConsent = vi.fn();
vi.mock("@/features/auth/api/oauth-consent", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/auth/api/oauth-consent")
  >("@/features/auth/api/oauth-consent");
  return {
    ...actual,
    getAuthorizationDetails: (...a: unknown[]) => getAuthorizationDetails(...a),
    submitConsent: (...a: unknown[]) => submitConsent(...a),
  };
});

const useSessionMock = vi.fn();
vi.mock("../../hooks/use-session", () => ({
  useSession: () => useSessionMock(),
}));

import { OAuthConsent } from "../oauth-consent";

const AUTHORIZATION_ID = "auth-123";
const AUTHENTICATED_SESSION = {
  access_token: "test-access-token",
  user: { id: "user-1" },
};

const AUTHORIZATION_DETAILS = {
  authorization_id: AUTHORIZATION_ID,
  client: { id: "client-1", name: "Claude MCP Connector" },
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  scope: "openid",
  user: { id: "user-1", email: "alice@dev.local" },
};

function renderConsent() {
  const qc = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(<OAuthConsent authorizationId={AUTHORIZATION_ID} />, {
    wrapper,
  });
}

describe("OAuthConsent", () => {
  beforeEach(() => {
    navigate.mockClear();
    getAuthorizationDetails.mockReset();
    submitConsent.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      isLoading: false,
      session: AUTHENTICATED_SESSION,
      user: AUTHENTICATED_SESSION.user,
    });
    // jsdom's Location.assign is a non-configurable own property, so it can't
    // be vi.spyOn'd in place; stub the whole global instead.
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
  });

  it("renders the requesting client name once authorization details load", async () => {
    getAuthorizationDetails.mockResolvedValue(AUTHORIZATION_DETAILS);
    renderConsent();

    await waitFor(() =>
      expect(screen.getByText(CLIENT_NAME_PATTERN)).toBeInTheDocument()
    );
    expect(getAuthorizationDetails).toHaveBeenCalledWith(
      AUTHORIZATION_ID,
      AUTHENTICATED_SESSION.access_token
    );
  });

  it("approving submits consent then navigates to the returned redirect_url", async () => {
    getAuthorizationDetails.mockResolvedValue(AUTHORIZATION_DETAILS);
    const redirectUrl =
      "https://claude.ai/api/mcp/auth_callback?code=abc123&state=xyz";
    submitConsent.mockResolvedValue({ redirect_url: redirectUrl });
    renderConsent();

    await waitFor(() =>
      expect(screen.getByText(CLIENT_NAME_PATTERN)).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: CTA_APPROVE }));

    await waitFor(() =>
      expect(submitConsent).toHaveBeenCalledWith(
        AUTHORIZATION_ID,
        "approve",
        AUTHENTICATED_SESSION.access_token
      )
    );
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(redirectUrl)
    );
  });

  it("denying submits a deny action", async () => {
    getAuthorizationDetails.mockResolvedValue(AUTHORIZATION_DETAILS);
    const redirectUrl =
      "https://claude.ai/api/mcp/auth_callback?error=access_denied";
    submitConsent.mockResolvedValue({ redirect_url: redirectUrl });
    renderConsent();

    await waitFor(() =>
      expect(screen.getByText(CLIENT_NAME_PATTERN)).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: CTA_DENY }));

    await waitFor(() =>
      expect(submitConsent).toHaveBeenCalledWith(
        AUTHORIZATION_ID,
        "deny",
        AUTHENTICATED_SESSION.access_token
      )
    );
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(redirectUrl)
    );
  });

  it("shows a submit error and re-enables the buttons when submitConsent rejects", async () => {
    getAuthorizationDetails.mockResolvedValue(AUTHORIZATION_DETAILS);
    submitConsent.mockRejectedValue(new Error("boom"));
    renderConsent();

    await waitFor(() =>
      expect(screen.getByText(CLIENT_NAME_PATTERN)).toBeInTheDocument()
    );
    const approveButton = screen.getByRole("button", { name: CTA_APPROVE });
    await userEvent.click(approveButton);

    await waitFor(() =>
      expect(screen.getByText(CONSENT_SUBMIT_ERROR)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: CTA_APPROVE })).toBeEnabled();
    expect(screen.getByRole("button", { name: CTA_DENY })).toBeEnabled();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("shows an error state when authorization details fail to load", async () => {
    getAuthorizationDetails.mockRejectedValue(new Error("not found"));
    renderConsent();

    await waitFor(() =>
      expect(screen.getByText(CONSENT_LOAD_ERROR)).toBeInTheDocument()
    );
  });

  it("redirects to sign-in with a return path when unauthenticated", async () => {
    useSessionMock.mockReturnValue({
      isLoading: false,
      session: null,
      user: null,
    });
    renderConsent();

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        search: {
          redirect: `/oauth/consent?authorization_id=${AUTHORIZATION_ID}`,
        },
        to: "/sign-in",
      })
    );
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
  });
});
