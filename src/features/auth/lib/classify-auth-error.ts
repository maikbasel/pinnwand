function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return;
}

export type EmailSubmitErrorKind =
  | "anti-enumeration"
  | "rate-limit"
  | "transport";

// 422 means the address is unknown or signup is disabled. Treat it as an
// anti-enumeration success at the UI layer; never distinguish enrolled from
// unenrolled emails on the sign-in surface.
export function classifyEmailSubmitError(error: unknown): EmailSubmitErrorKind {
  const status = statusOf(error);
  if (status === 422) {
    return "anti-enumeration";
  }
  if (status === 429) {
    return "rate-limit";
  }
  return "transport";
}

export type OtpErrorKind = "invalid-or-expired" | "rate-limit" | "transport";

export function classifyOtpError(error: unknown): OtpErrorKind {
  const status = statusOf(error);
  if (status === 429) {
    return "rate-limit";
  }
  if (status === 400 || status === 401 || status === 403) {
    return "invalid-or-expired";
  }
  return "transport";
}
