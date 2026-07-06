---
paths:
  - "src/**/*.tsx"
---

# UI Components: Compose, Don't Reinvent

Reach for an existing primitive before building one. The cost of a hand-rolled `<Button>` or `<Dialog>` is real: a11y holes, focus traps, keyboard nav, mobile gesture handling, RTL — all already solved in the shadcn primitives in `src/shared/components/ui/`.

## Order of preference

1. **An existing primitive in `src/shared/components/ui/`.** Import directly: `import { Button } from "@/shared/components/ui/button"`.
2. **A new shadcn primitive** — add it via `pnpm dlx shadcn@latest add <name>` (writes to `src/shared/components/ui/<name>.tsx` per `components.json`). Do not paste shadcn source manually.
3. **A wrapper around a primitive** — when a feature needs domain shape (e.g. `MealCard` wrapping shadcn `Card`), the wrapper lives under `src/features/<feature>/components/` and composes the primitive.
4. **A custom component, from scratch** — only when no primitive fits. Domain-specific UI (drag handle for the meal cell, week navigator strip) qualifies. Even then, prefer composing shadcn primitives where they fit inside.

## Forbidden

- **Don't fork a shadcn primitive into a feature.** Edit the file under `src/shared/components/ui/` instead, so every consumer benefits.
- **Don't paste community shadcn recipes that import `@radix-ui/*`.** This project uses Base UI (`@base-ui/react`) — translate the recipe before using it.
- **Don't recreate primitives by hand to "avoid the dependency".** They're already vendored; there is no install cost to using them.

## Mobile-first reminder

shadcn's `Select`, `Popover`, `DropdownMenu`, `Tooltip` feel desktop-y on touch. Pair with the swap table in `frontend/mobile-first.md`: prefer `Drawer` (Vaul) on mobile, swap to the desktop primitive at `md:` and up.
