// src/features/tasks/lib/position.test.ts
import { describe, expect, it } from "vitest";
import {
  bottomPosition,
  hasRepresentableGap,
  midpoint,
  POSITION_STEP,
  positionForMove,
  renormalize,
} from "./position";

describe("bottomPosition", () => {
  it("returns one step for an empty column", () => {
    expect(bottomPosition([])).toBe(POSITION_STEP);
  });
  it("returns one step past the current max", () => {
    expect(bottomPosition([{ position: 10 }, { position: 40 }])).toBe(
      40 + POSITION_STEP
    );
  });
});

describe("midpoint", () => {
  it("is the step when the column is empty (both neighbours null)", () => {
    expect(midpoint(null, null)).toBe(POSITION_STEP);
  });
  it("halves the first position when inserting at the top", () => {
    expect(midpoint(null, 100)).toBe(50);
  });
  it("adds a step past the last when inserting at the bottom", () => {
    expect(midpoint(200, null)).toBe(200 + POSITION_STEP);
  });
  it("is the average between two neighbours", () => {
    expect(midpoint(100, 200)).toBe(150);
  });
});

describe("hasRepresentableGap", () => {
  it("is true when a distinct midpoint exists", () => {
    expect(hasRepresentableGap(100, 200)).toBe(true);
  });
  it("is false when two neighbours are adjacent doubles", () => {
    const a = 1;
    const b = a + Number.EPSILON;
    expect(hasRepresentableGap(a, b)).toBe(false);
  });
});

describe("positionForMove", () => {
  const ordered = [{ position: 1024 }, { position: 2048 }, { position: 3072 }];
  it("drops to the top half when index 0", () => {
    expect(positionForMove(ordered, 0)).toBe(512);
  });
  it("averages the surrounding neighbours in the middle", () => {
    expect(positionForMove(ordered, 1)).toBe((1024 + 2048) / 2);
  });
  it("appends past the last when index equals length", () => {
    expect(positionForMove(ordered, ordered.length)).toBe(3072 + POSITION_STEP);
  });
});

describe("renormalize", () => {
  it("rewrites ids to evenly spaced positions in order", () => {
    expect(renormalize([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual([
      { id: "a", position: 1024 },
      { id: "b", position: 2048 },
      { id: "c", position: 3072 },
    ]);
  });
});
