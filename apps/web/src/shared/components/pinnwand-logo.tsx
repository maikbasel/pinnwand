import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/shared/lib/utils";

export type PinnwandLogoVariant = "default" | "inverted" | "mono" | "ghost";

type Props = Omit<ComponentPropsWithoutRef<"svg">, "viewBox" | "role"> & {
  /** Visual theme. Maps to a `.pinnwand-logo-<variant>` class so external CSS can still override `.pinnwand-bg` / `.pinnwand-glyph`. */
  variant?: PinnwandLogoVariant;
  /** Render size in pixels. Omit to size via CSS (the SVG is intrinsically square). */
  size?: number | string;
  /** Accessible name. Pass `null` to mark decorative (uses `aria-hidden`). */
  title?: string | null;
};

const VARIANT_CLASS: Record<PinnwandLogoVariant, string> = {
  default: "pinnwand-logo-default",
  inverted: "pinnwand-logo-inverted",
  mono: "pinnwand-logo-mono",
  ghost: "pinnwand-logo-ghost",
};

/**
 * The in-app Stecknadel brand mark. The SVG geometry is the single source of
 * truth shared with `public/favicon.svg` (the PWA/favicon icon source): a
 * rounded tile (`.pinnwand-bg`) with a tilted round-headed pin (`.pinnwand-glyph`),
 * a ball head plus a tapered needle. Colours come from CSS variant classes bound
 * to the theme palette, so dark mode adapts automatically. The favicon source
 * additionally carries a radial depth gradient on the head that the themeable
 * flat glyph here omits (it renders at small sizes and in mono/ghost variants).
 */
export function PinnwandLogo({
  variant = "default",
  size,
  title = "Pinnwand",
  className,
  ...rest
}: Props) {
  const decorative = title === null;
  return (
    <svg
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      className={cn("pinnwand-logo", VARIANT_CLASS[variant], className)}
      height={size}
      role={decorative ? undefined : "img"}
      viewBox="0 0 96 96"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {decorative ? null : <title>{title}</title>}
      <rect className="pinnwand-bg" height="96" rx="23" width="96" />
      <g
        className="pinnwand-glyph"
        transform="translate(16.5 16.5) scale(2.625)"
      >
        <g transform="rotate(-32 12 12)">
          <path d="M11.3 8.6L12.7 8.6L12 22.6Z" fillOpacity={0.82} />
          <circle cx="12" cy="5.9" r="4" />
        </g>
      </g>
    </svg>
  );
}
