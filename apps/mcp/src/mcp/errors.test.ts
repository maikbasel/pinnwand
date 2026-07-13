import { describe, expect, it } from "vitest";
import { toToolError } from "./errors";

describe("toToolError", () => {
  it("maps an RLS-denial-shaped Supabase error to a clear membership message", () => {
    const result = toToolError({ code: "42501", message: "permission denied" });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "You are not a member of that board, or it does not exist.",
        },
      ],
      isError: true,
    });
  });

  it("maps an empty-single-row Supabase error to the same membership message", () => {
    const result = toToolError({
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    });
    expect(result.content[0].text).toBe(
      "You are not a member of that board, or it does not exist."
    );
  });

  it("surfaces a P0001 SECURITY DEFINER exception message verbatim", () => {
    const result = toToolError({ code: "P0001", message: "invalid join code" });
    expect(result.content[0].text).toBe("invalid join code");
    expect(result.isError).toBe(true);
  });

  it("passes through other Supabase error messages verbatim", () => {
    const result = toToolError({
      code: "23505",
      message: "duplicate key value",
    });
    expect(result.content[0].text).toBe("duplicate key value");
  });

  it("uses the message of a thrown Error", () => {
    const result = toToolError(new Error("boom"));
    expect(result.content[0].text).toBe("boom");
  });

  it("falls back to a generic message for a non-Error throw", () => {
    const result = toToolError("not an error object");
    expect(result.content[0].text).toBe("An unexpected error occurred.");
  });
});
