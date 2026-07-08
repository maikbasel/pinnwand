# separator

2026-07-08 — Transformation engine (shadcn `new-york` Radix source → Base UI). Verdict: migrated, building. Added as a `sidebar` dependency.

## Changed

- `src/shared/components/ui/separator.tsx` (new):
  - `@radix-ui/react-separator` → `@base-ui/react/separator`.
  - Dropped the `decorative` prop (Base UI's Separator has no equivalent; it renders `role="separator"` and manages orientation itself).
  - `orientation === "horizontal" ? "h-[1px] w-full" : ...` ternary → `data-[orientation=...]` variants (Base UI sets `data-orientation`).
  - `forwardRef` → plain function (React 19).
  - Leftover scan clean.

## Left alone

- Fresh primitive.

## Behavior changes

- No `decorative={false}` escape hatch. Not needed anywhere in this project; the separator is always decorative here.

## Verify by hand

- Used by `SidebarSeparator` only (unused in the current rail). Visual: 1px divider in both orientations.
