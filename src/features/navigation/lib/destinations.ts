import { useRouterState } from "@tanstack/react-router";

const BOARD_PATH = /^\/boards\/([^/]+)$/;

/** The open board id, parsed from the pathname; null on the list root or a
 * non-board route (e.g. /boards/join). Derived from the route, never local
 * state, so deep links and back/forward highlight the right rail item. */
export function activeBoardIdForPath(pathname: string): string | null {
  const match = BOARD_PATH.exec(pathname);
  const id = match?.[1];
  if (!id) {
    return null;
  }
  return id === "join" ? null : id;
}

export function useActiveBoardId(): string | null {
  return useRouterState({
    select: (state) => activeBoardIdForPath(state.location.pathname),
  });
}
