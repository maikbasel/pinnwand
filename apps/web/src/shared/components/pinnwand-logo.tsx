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
 * The in-app pushpin brand mark. The SVG geometry is the single source of
 * truth shared with `public/favicon.svg` (the PWA/favicon icon source): a
 * rounded tile (`.pinnwand-bg`) with a tilted pushpin glyph (`.pinnwand-glyph`).
 * Colours come from CSS variant classes bound to the theme palette, so dark
 * mode adapts automatically.
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
      <rect className="pinnwand-bg" height="96" rx="22" width="96" />
      <g
        className="pinnwand-glyph"
        transform="translate(48 48) scale(0.8) translate(-39 -44)"
      >
        <g transform="rotate(-22 48 48)">
          <rect height="20" rx="10" width="42" x="27" y="14" />
          <rect height="11" opacity="0.82" rx="3" width="16" x="40" y="33" />
          <path d="M43 44 L53 44 L48 82 Z" />
        </g>
      </g>
    </svg>
  );
}
