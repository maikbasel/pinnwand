import { describe, expect, it } from "vitest";
import {
  classifyEmailSubmitError,
  classifyOtpError,
} from "../classify-auth-error";

function withStatus(status: number): unknown {
  return Object.assign(new Error("x"), { status });
}

describe("classifyEmailSubmitError", () => {
  it("maps 422 to anti-enumeration", () => {
    expect(classifyEmailSubmitError(withStatus(422))).toBe("anti-enumeration");
  });
  it("maps 429 to rate-limit", () => {
    expect(classifyEmailSubmitError(withStatus(429))).toBe("rate-limit");
  });
  it("maps anything else to transport", () => {
    expect(classifyEmailSubmitError(withStatus(500))).toBe("transport");
    expect(classifyEmailSubmitError(new Error("boom"))).toBe("transport");
    expect(classifyEmailSubmitError(null)).toBe("transport");
  });
});

describe("classifyOtpError", () => {
  it("maps 429 to rate-limit", () => {
    expect(classifyOtpError(withStatus(429))).toBe("rate-limit");
  });
  it("maps 400/401/403 to invalid-or-expired", () => {
    expect(classifyOtpError(withStatus(400))).toBe("invalid-or-expired");
    expect(classifyOtpError(withStatus(401))).toBe("invalid-or-expired");
    expect(classifyOtpError(withStatus(403))).toBe("invalid-or-expired");
  });
  it("maps anything else to transport", () => {
    expect(classifyOtpError(withStatus(500))).toBe("transport");
    expect(classifyOtpError(new Error("boom"))).toBe("transport");
  });
});
