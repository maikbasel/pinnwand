import { logger } from "../logger";

type ToolErrorResult = {
  content: [{ type: "text"; text: string }];
  isError: true;
};

type SupabaseErrorLike = { code: string; message: string };

const NOT_A_MEMBER_MESSAGE =
  "You are not a member of that board, or it does not exist.";

// RLS makes "denied" and "absent" indistinguishable by design: a filtered
// row and a nonexistent row both surface as one of these PostgREST/Postgres
// codes, so both map to the same user-facing message.
const RLS_DENIAL_OR_EMPTY_CODES = new Set([
  "PGRST116", // .single()/.maybeSingle() found no row
  "42501", // insufficient_privilege (RLS policy violation)
]);

// Postgres `raise exception` from our SECURITY DEFINER RPCs (create_board,
// join_board_by_code, regenerate_join_code) surfaces as PostgREST code
// P0001. Those messages ('invalid join code', 'only the owner can rotate
// the join code', 'not authenticated', ...) are intentionally user-facing —
// show them verbatim rather than falling through generically.
const RPC_RAISED_EXCEPTION_CODE = "P0001";

function isSupabaseErrorLike(err: unknown): err is SupabaseErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: unknown }).code === "string" &&
    typeof (err as { message?: unknown }).message === "string"
  );
}

function messageForSupabaseError(err: SupabaseErrorLike): string {
  if (RLS_DENIAL_OR_EMPTY_CODES.has(err.code)) {
    return NOT_A_MEMBER_MESSAGE;
  }
  if (err.code === RPC_RAISED_EXCEPTION_CODE) {
    // SECURITY DEFINER RPC raised this with an intentional user-facing
    // message (e.g. 'invalid join code') — surface it verbatim.
    return err.message;
  }
  return err.message;
}

/** Converts a caught error into an MCP tool error result with a clear, user-facing message. */
export function toToolError(err: unknown): ToolErrorResult {
  let text: string;
  if (isSupabaseErrorLike(err)) {
    text = messageForSupabaseError(err);
  } else if (err instanceof Error) {
    text = err.message;
  } else {
    text = "An unexpected error occurred.";
  }
  logger.error({ err }, "mcp tool error");
  return { content: [{ type: "text", text }], isError: true };
}
