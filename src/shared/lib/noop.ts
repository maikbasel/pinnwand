/**
 * No-op function. Used as an explicit completion handler for floating promises
 * (e.g. `.then(noop, noop)` on a fire-and-forget cleanup), so the linter
 * doesn't flag the unhandled rejection and a reader can tell the floating call
 * was intentional.
 */
export const noop = (): void => {
  // intentional
};
