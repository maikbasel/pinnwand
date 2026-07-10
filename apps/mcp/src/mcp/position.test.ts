import { describe, expect, it } from "vitest";
import { bottomPosition, midpoint, POSITION_STEP } from "./position";

describe("midpoint", () => {
  it("returns the step for an empty column", () => {
    expect(midpoint(null, null)).toBe(1024);
  });

  it("returns the arithmetic midpoint between two neighbours", () => {
    expect(midpoint(0, 1024)).toBe(512);
  });

  it("halves the next position when dropped at the top", () => {
    expect(midpoint(null, 1024)).toBe(512);
  });

  it("adds one step when dropped at the bottom", () => {
    expect(midpoint(1024, null)).toBe(1024 + POSITION_STEP);
  });
});

describe("bottomPosition", () => {
  it("returns the step for an empty column", () => {
    expect(bottomPosition([])).toBe(1024);
  });

  it("returns one step past the highest existing position", () => {
    const items = [{ position: 1024 }, { position: 3072 }, { position: 2048 }];
    expect(bottomPosition(items)).toBe(3072 + POSITION_STEP);
  });
});
