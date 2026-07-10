// Fractional-index ordering for tasks within a column. Positions are
// `double precision` in Postgres; a reorder writes the midpoint between the
// two neighbours so sibling rows are never touched.
//
// ponytail: copied from apps/web/src/features/tasks/lib/position.ts (three
// pure functions, no dependencies) instead of extracting a shared package.
// Promote to @pinnwand/contracts only if a third consumer appears.
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
