import { describe, expect, it } from "vitest";
import { initialsForEmail } from "../account-identity";
import { activeBoardIdForPath } from "../destinations";

describe("activeBoardIdForPath", () => {
  it("returns the board id for a board route", () => {
    expect(activeBoardIdForPath("/boards/abc-123")).toBe("abc-123");
  });
  it("returns null on the list root", () => {
    expect(activeBoardIdForPath("/")).toBeNull();
  });
  it("returns null on the join route", () => {
    expect(activeBoardIdForPath("/boards/join")).toBeNull();
  });
});

describe("initialsForEmail", () => {
  it("takes up to two letters from the local-part, uppercased", () => {
    expect(initialsForEmail("alice@dev.local")).toBe("AL");
  });
  it("falls back for an empty or letterless value", () => {
    expect(initialsForEmail(null)).toBe("?");
    expect(initialsForEmail("123@x.io")).toBe("?");
  });
});
