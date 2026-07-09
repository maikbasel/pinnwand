// src/features/tasks/lib/position.ts
// Fractional-index ordering for tasks within a column. Positions are
// `double precision` in Postgres; a reorder writes the midpoint between the two
// neighbours so sibling rows are never touched.
export const POSITION_STEP = 1024;

export function bottomPosition(items: readonly { position: number }[]): number {
  if (items.length === 0) {
    return POSITION_STEP;
  }
  return Math.max(...items.map((item) => item.position)) + POSITION_STEP;
}

export function midpoint(prev: number | null, next: number | null): number {
  if (prev === null && next === null) {
    return POSITION_STEP;
  }
  if (prev === null) {
    return (next as number) / 2;
  }
  if (next === null) {
    return prev + POSITION_STEP;
  }
  return (prev + next) / 2;
}

export function hasRepresentableGap(
  prev: number | null,
  next: number | null
): boolean {
  const mid = midpoint(prev, next);
  return mid !== prev && mid !== next;
}

export function positionForMove(
  ordered: readonly { position: number }[],
  index: number
): number {
  const prevItem = index > 0 ? ordered[index - 1] : undefined;
  const nextItem = index < ordered.length ? ordered[index] : undefined;
  return midpoint(prevItem?.position ?? null, nextItem?.position ?? null);
}

export function renormalize(
  ordered: readonly { id: string }[]
): { id: string; position: number }[] {
  return ordered.map((item, i) => ({
    id: item.id,
    position: (i + 1) * POSITION_STEP,
  }));
}
