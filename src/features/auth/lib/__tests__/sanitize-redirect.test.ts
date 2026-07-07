import { describe, expect, it } from "vitest";
import { sanitizeRedirect } from "../sanitize-redirect";

describe("sanitizeRedirect", () => {
  it("accepts a plain absolute path", () => {
    expect(sanitizeRedirect("/boards/abc")).toBe("/boards/abc");
  });
  it("accepts a path with a query string", () => {
    expect(sanitizeRedirect("/boards?x=1")).toBe("/boards?x=1");
  });
  it("rejects a protocol-relative URL", () => {
    expect(sanitizeRedirect("//evil.example/x")).toBe("/");
  });
  it("rejects an absolute URL", () => {
    expect(sanitizeRedirect("https://evil.example")).toBe("/");
  });
  it("rejects a javascript: pseudo-URL", () => {
    expect(sanitizeRedirect("javascript:alert(1)")).toBe("/");
  });
  it("rejects null, undefined, empty", () => {
    expect(sanitizeRedirect(null)).toBe("/");
    expect(sanitizeRedirect(undefined)).toBe("/");
    expect(sanitizeRedirect("")).toBe("/");
  });
  it("rejects a path that does not start with /", () => {
    expect(sanitizeRedirect("boards/abc")).toBe("/");
  });
  it("rejects a same-origin path that smuggles a colon", () => {
    expect(sanitizeRedirect("/foo:bar")).toBe("/");
  });
});
