import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SYNC_INDICATOR_LABEL, SyncIndicator } from "../sync-indicator";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// A never-settling board-scoped query, so it stays in `fetching` for the
// assertion. `meta.scope.board` is what the indicator filters on.
function Probe({ board }: { board: string }) {
  useQuery({
    queryKey: ["tasks", "byBoard", board],
    queryFn: () => new Promise<never>(() => undefined),
    meta: { scope: { board } },
  });
  return null;
}

// A board-scoped query whose settle is triggered by the test, to exercise the
// post-settle hold window.
let settleProbe: (() => void) | null = null;
function DeferredProbe({ board }: { board: string }) {
  useQuery({
    queryKey: ["tasks", "byBoard", board],
    queryFn: () =>
      new Promise<null>((resolve) => {
        settleProbe = () => resolve(null);
      }),
    meta: { scope: { board } },
  });
  return null;
}

afterEach(() => {
  client.clear();
  settleProbe = null;
});

describe("SyncIndicator", () => {
  it("stays hidden when no board-scoped work is in flight", () => {
    client = new QueryClient();
    render(<SyncIndicator boardId="b" />, { wrapper });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the syncing label while this board's query is fetching", async () => {
    client = new QueryClient();
    render(
      <>
        <Probe board="b" />
        <SyncIndicator boardId="b" />
      </>,
      { wrapper }
    );
    expect(await screen.findByText(SYNC_INDICATOR_LABEL)).toBeInTheDocument();
  });

  it("ignores work scoped to a different board", async () => {
    client = new QueryClient();
    render(
      <>
        <Probe board="other" />
        <SyncIndicator boardId="b" />
      </>,
      { wrapper }
    );
    // The other board's fetch is in flight; give the subscription a chance to
    // fire, then confirm this board's indicator never appeared.
    await waitFor(() => expect(client.isFetching()).toBeGreaterThan(0));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("holds the indicator on screen briefly after the work settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <>
        <DeferredProbe board="b" />
        <SyncIndicator boardId="b" />
      </>,
      { wrapper }
    );
    expect(await screen.findByText(SYNC_INDICATOR_LABEL)).toBeInTheDocument();
    // Work finishes; the pill must still be up (an optimistic sync settles
    // faster than a person can see).
    await act(async () => {
      settleProbe?.();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Past the minimum-visible floor, it hides.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
