import { describe, expect, it } from "vitest";
import { colorForUser } from "./user-color";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

describe("colorForUser", () => {
  it("returns the same color for the same id", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(colorForUser(id)).toBe(colorForUser(id));
  });

  it("can return different colors for different ids", () => {
    const colors = new Set(
      ["alice", "bob", "charlie", "dave", "erin"].map(colorForUser)
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("returns a hex color", () => {
    expect(colorForUser("alice")).toMatch(HEX_COLOR_PATTERN);
  });

  it("returns a valid palette color for an empty id without crashing", () => {
    expect(colorForUser("")).toMatch(HEX_COLOR_PATTERN);
  });
});
