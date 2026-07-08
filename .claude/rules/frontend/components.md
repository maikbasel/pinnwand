---
paths:
  - "src/**/*.tsx"
---

# UI Components: Compose, Don't Reinvent

Reach for an existing primitive before building one. The cost of a hand-rolled `<Button>` or `<Dialog>` is real: a11y holes, focus traps, keyboard nav, mobile gesture handling, RTL — all already solved in the shadcn primitives in `src/shared/components/ui/`.

## Order of preference

1. **An existing primitive in `src/shared/components/ui/`.** Import directly: `import { Button } from "@/shared/components/ui/button"`.
2. **A new shadcn-style primitive on Base UI** — author it under `src/shared/components/ui/<name>.tsx` (see "Sourcing primitives" below). Style it with our Modern Minimal theme tokens (`bg-primary`, `border-input`, `ring-ring`, …), the same tokens `components.json` already sets up.
3. **A wrapper around a primitive** — when a feature needs domain shape (e.g. `TaskCard` wrapping `Card`), the wrapper lives under `src/features/<feature>/components/` and composes the primitive.
4. **A custom component, from scratch** — only when no primitive fits. Domain-specific UI (a board drag handle, the column swiper) qualifies. Even then, prefer composing primitives where they fit inside.

## Sourcing primitives (Base UI, not Radix)

The stack is `@base-ui/react`, not Radix. This constrains how primitives get added:

- **`pnpm dlx shadcn@latest add <name>` pulls the official `@shadcn` registry, which is Radix-based.** Do not run it and merge the result as-is — it imports `@radix-ui/*`, contradicting the Base UI decision. Use it only as a *reference* for the current Tailwind class strings, then author the primitive on the Base UI equivalent (`@base-ui/react/button`, `@base-ui/react/input`; native `<label>`; plain `div` for `Card`).
- **The ReUI registry (`@reui`) is license-gated** (its endpoint returns `401` without a Bearer key) and its components depend on ReUI's own `cn-*` theme CSS layer, which would fight our Modern Minimal tokens. So do not wire `@reui` into `components.json`. Its source is MIT on GitHub (`keenthemes/reui`, Base UI variants under `registry/bases/base/ui/`) — copy a component's *structure* from there when useful, but restyle it with our theme tokens.
- The four foundation primitives (`button`, `input`, `label`, `card`) already follow this pattern — match them when adding more.

## Forbidden

- **Don't fork a shadcn primitive into a feature.** Edit the file under `src/shared/components/ui/` instead, so every consumer benefits.
- **Don't paste community shadcn recipes that import `@radix-ui/*`.** This project uses Base UI (`@base-ui/react`) — translate the recipe before using it (see "Sourcing primitives").
- **Don't reinvent behavior a primitive already owns.** Authoring a thin Base UI translation (props + theme classes over `@base-ui/react`) is expected; hand-rolling focus traps, keyboard nav, or a11y that Base UI or an existing `ui/` file already provides is not.

## Mobile-first reminder

shadcn's `Select`, `Popover`, `DropdownMenu`, `Tooltip` feel desktop-y on touch. Pair with the swap table in `frontend/mobile-first.md`: prefer `Drawer` (Vaul) on mobile, swap to the desktop primitive at `md:` and up.
