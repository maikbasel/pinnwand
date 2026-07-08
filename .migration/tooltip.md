# tooltip

2026-07-08 — Transformation engine (shadcn `new-york` Radix source → Base UI). Verdict: migrated, building. Added as a `sidebar` dependency.

## Changed

- `src/shared/components/ui/tooltip.tsx` (new):
  - `@radix-ui/react-tooltip` → `@base-ui/react/tooltip`.
  - `Provider` → `Tooltip.Provider` (`delayDuration` → `delay`).
  - `Root`/`Trigger` → `Tooltip.Root`/`Tooltip.Trigger`.
  - `Content` = `Portal` → `Positioner` (holds `side`/`align`/`sideOffset`) → `Popup` (the FORWARD rule: positioning props move to the Positioner).
  - `data-[state=closed]` animation attrs → `data-closed` / `data-open`; `origin-[--radix-tooltip-content-transform-origin]` → `origin-(--transform-origin)`.
  - Kept shadcn's `hidden` prop on `TooltipContent` (returns null) so the sidebar's `hidden={state !== "collapsed" || isMobile}` call site is unchanged.
  - Leftover scan clean.

## Left alone

- Nothing project-specific; this is a fresh primitive.

## Behavior changes

- None observed. Base UI opens/closes on the same hover/focus interactions.

## Verify by hand

- Only reached via a collapsed sidebar (unused today). If adopted elsewhere: hover a trigger, confirm the tip appears after the provider `delay`, positions on the requested side, and dismisses on blur/escape.
