// Custom horizontal edge auto-scroll for the board strip. dnd-kit's built-in
// auto-scroll cannot drive a horizontal container whose columns are themselves
// vertically scrollable (clauderic/dnd-kit#1108): it flings to the end and
// ignores `acceleration`. So the strip is excluded from dnd-kit auto-scroll and
// scrolled here instead, at a speed we fully control.

export type EdgeScrollConfig = {
  /** Distance from an edge (px) within which scrolling engages. */
  zone: number;
  /** Per-frame scroll speed (px) at the zone's outer boundary. */
  minSpeed: number;
  /** Per-frame scroll speed (px) when the pointer reaches the edge. */
  maxSpeed: number;
};

// Tuned conservative — the strip is ~70vw per column, so a gentle ramp reads as
// controlled. Bump `maxSpeed` if it feels sluggish on a real phone.
export const EDGE_SCROLL: EdgeScrollConfig = {
  zone: 56,
  minSpeed: 0.5,
  maxSpeed: 3,
};

function speedFor(into: number, config: EdgeScrollConfig): number {
  const ratio = Math.max(0, Math.min(1, into / config.zone));
  return config.minSpeed + ratio * (config.maxSpeed - config.minSpeed);
}

/**
 * Horizontal scroll delta (px per frame) for a pointer at `pointerX` over a
 * container spanning [left, right]. Negative scrolls left, positive scrolls
 * right, 0 when the pointer sits outside both edge zones. Speed ramps from
 * `minSpeed` at the zone's outer boundary to `maxSpeed` at the container edge
 * (and stays at `maxSpeed` once the pointer passes the edge).
 */
export function edgeScrollDelta(
  pointerX: number,
  left: number,
  right: number,
  config: EdgeScrollConfig = EDGE_SCROLL
): number {
  const distLeft = pointerX - left;
  const distRight = right - pointerX;
  if (distLeft <= distRight) {
    return distLeft < config.zone
      ? -speedFor(config.zone - distLeft, config)
      : 0;
  }
  return distRight < config.zone
    ? speedFor(config.zone - distRight, config)
    : 0;
}
