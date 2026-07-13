import { describe, expect, it } from "vitest";
import { type EdgeScrollConfig, edgeScrollDelta } from "./edge-scroll";

const CONFIG: EdgeScrollConfig = { zone: 50, minSpeed: 1, maxSpeed: 6 };
// Container spans [100, 500] (width 400).
const LEFT = 100;
const RIGHT = 500;

function delta(pointerX: number): number {
  return edgeScrollDelta(pointerX, LEFT, RIGHT, CONFIG);
}

describe("edgeScrollDelta", () => {
  it("does not scroll when the pointer is in the middle", () => {
    expect(delta(300)).toBe(0);
  });

  it("scrolls right (positive) near the right edge, faster closer in", () => {
    const nearBoundary = delta(RIGHT - 40); // 10px into the 50px zone
    const atEdge = delta(RIGHT); // ramp maxed
    expect(nearBoundary).toBeGreaterThan(0);
    expect(atEdge).toBe(CONFIG.maxSpeed);
    expect(atEdge).toBeGreaterThan(nearBoundary);
  });

  it("scrolls left (negative) near the left edge", () => {
    expect(delta(LEFT + 10)).toBeLessThan(0);
    expect(delta(LEFT)).toBe(-CONFIG.maxSpeed);
  });

  it("stays at maxSpeed once the pointer passes an edge", () => {
    expect(delta(RIGHT + 30)).toBe(CONFIG.maxSpeed);
    expect(delta(LEFT - 30)).toBe(-CONFIG.maxSpeed);
  });

  it("does not scroll just outside the zone", () => {
    // exactly `zone` px from the right edge is the boundary, still no scroll
    expect(delta(RIGHT - CONFIG.zone)).toBe(0);
    expect(delta(LEFT + CONFIG.zone)).toBe(0);
  });
});
