function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

const INVALID_CODE_PATTERN = /invalid join code/i;

export type JoinErrorKind = "invalid-code" | "transport";

// The `join_board_by_code` RPC raises a plain "invalid join code" exception
// for an unknown code (see supabase/migrations/20260706120000_init.sql).
// Anything else (network failure, unexpected server error) is a transport
// failure.
export function classifyJoinError(error: unknown): JoinErrorKind {
  return INVALID_CODE_PATTERN.test(messageOf(error))
    ? "invalid-code"
    : "transport";
}
