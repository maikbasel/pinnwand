/**
 * Curated palette of Tailwind-600-ish hex colors, all readable with white
 * text. Hex (not hsl/oklch) because the Yjs collaboration-caret extension
 * appends an alpha suffix directly onto the color string it's given (e.g.
 * `${color}70` for the selection highlight), which only produces a valid
 * color for a 6-digit hex.
 */
const USER_COLOR_PALETTE = [
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0d9488",
  "#0891b2",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#c026d3",
  "#db2777",
] as const;

/** Simple deterministic string hash (djb2-ish), positive by construction. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) % Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(hash);
}

/**
 * Deterministically maps a user id to a stable color from the curated
 * palette, so the same user always gets the same color and different users
 * are visually distinct (collaboration carets, avatars).
 */
export function colorForUser(userId: string): string {
  const index = hashString(userId) % USER_COLOR_PALETTE.length;
  return USER_COLOR_PALETTE[index] ?? USER_COLOR_PALETTE[0];
}
