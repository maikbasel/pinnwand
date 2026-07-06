---
paths:
  - "src/**/*.tsx"
---

# Mobile-First Design

This is a PWA. Most users open it on a phone. Design for the smallest screen first, then layer on larger breakpoints.

## Tailwind discipline

- **Base classes = mobile.** Add `sm:`, `md:`, `lg:` modifiers only to scale UP for larger viewports.
- Never use desktop-first patterns like `hidden lg:block`. Prefer `block lg:hidden` (visible on mobile, hidden on desktop) — or just write the mobile case as the default.
- Touch targets: interactive elements are at least 44×44px on mobile (`min-h-11 min-w-11`).
- Responsive padding: `px-4` base, `sm:px-6 lg:px-8` to scale.
- Responsive typography: start with mobile sizes, scale up (`text-2xl sm:text-3xl lg:text-4xl`).
- Single-column layouts on mobile; multi-column via `md:grid-cols-*` or `lg:grid-cols-*`.
- The minimum target viewport is **375px wide** (iPhone SE). Test there.

## Responsive component swaps

Components that rely on hover, have small targets, or use horizontal space aggressively need a mobile alternative.

| Desktop (`md:` and up) | Mobile (base) | When to swap |
|---|---|---|
| Dialog | Drawer (bottom sheet) | Forms, detail views, complex confirmations |
| Select / DropdownMenu | Drawer | Selection lists, action menus |
| Popover | Drawer | Filters, secondary actions |
| Side panel | Drawer | Settings, detail panels |
| Tooltip | Inline hint or `(i)` icon → Drawer | No hover on touch devices |
| Data table | Card list / stacked key-value pairs | Columns overflow; cells too small to tap |
| Combobox / Autocomplete | Full-screen search Drawer | Inline dropdowns clip and fight the keyboard |
| Pagination | "Load more" button or infinite scroll | Pagination controls are fiddly on touch |
| Horizontal stepper | Progress bar + single-step view | Labels overflow on narrow screens |
| Master-detail split | Stack navigation (list → detail push) | No side-by-side on small screens |
| Right-click context menu | Long-press or action button → Drawer | No right-click on touch |
| Sidebar navigation | Bottom tab bar (primary) or hamburger Drawer | Thumb-zone ergonomics; bottom tabs preferred |

- Always include a visible dismiss action on a Drawer (e.g., a "Close" button in the footer) alongside swipe-to-dismiss and overlay-tap.

## Destructive confirmations: pick the surface by what is open behind it

There are three confirm surfaces. Choose by **whether a bottom sheet is open when the confirm fires**, never by habit.

| Trigger context | Mobile surface | Desktop surface | Component |
|---|---|---|---|
| A plain page / non-drawer trigger (nothing open behind) | bottom `Drawer` | centered `AlertDialog` | `ConfirmSheet` (`src/shared/components/confirm-sheet.tsx`) |
| *Inside* an already-open bottom sheet (a drawer's row menu) | **inline confirm in the open sheet** | centered `AlertDialog` | inline block + `ConfirmAlert` |
| Must stay centered on every viewport | centered `AlertDialog` | centered `AlertDialog` | `ConfirmAlert` (`src/shared/components/confirm-alert.tsx`) |

**Never stack a second `Drawer` on an open one.** A second Vaul drawer opened over (or immediately after closing) the first does not present reliably — see the body-lock note below. So when the confirm is launched from *inside* an open sheet, inline it: morph the offending row into the confirm in place (trash glyph, „name" löschen?, consequence line, Abbrechen / Löschen). The meal-plan switcher does exactly this on mobile; on desktop the row menu is a `DropdownMenu`, so it routes to a centered `ConfirmAlert` instead. When nothing is open behind the confirm (e.g. the household detail page is a plain route), use `ConfirmSheet` — a real bottom drawer on mobile, `AlertDialog` on desktop — there is no sheet to stack on.

**The Vaul body-lock.** When a Vaul `Drawer` closes it leaves `pointer-events: none` stuck on `<body>`, and its cleanup lags the close animation (emilkowalski/vaul#245, radix-ui/primitives#1241; note `onAnimationEnd` does not fire for a controlled drawer, vaul#520, so you cannot hang work off it). Anything portaled to `<body>` — a centered `AlertDialog`, the `DropdownMenu` popup, or a second drawer — inherits that lock: it paints but taps fall through to Vaul's overlay, which dismisses the first drawer instead of firing the action. Two consequences: (1) the inline-in-sheet pattern sidesteps it entirely (no second portal surface, no close/reopen race, no `setTimeout` hand-off); (2) for the surfaces that *do* portal, the fix lives once in the primitives — `AlertDialog`'s backdrop + popup, the `DropdownMenu` popup, and `DrawerContent` all set `pointer-events-auto` so they stay interactive regardless of the lock. Do NOT reintroduce a `setTimeout`-based hand-off — if a confirm or menu seems swallowed on mobile, the missing `pointer-events-auto` on the portaled primitive is the bug, not the timing.

`HouseholdRemoveConfirm` (household leave/delete, launched from the detail page) uses `ConfirmSheet`. The meal-plan switcher's plan deletion inlines the confirm in its drawer on mobile and uses `ConfirmAlert` on desktop. The responsive `Dialog`/`Drawer` swap in the table above is also how *content/forms* opened from a non-drawer trigger work.

## Patterns to avoid on mobile

- Stacking a second bottom sheet on top of an open one — see the confirmation note above; inline the confirm in the open sheet, or use a centered `AlertDialog`.
- Hover-dependent interactions — use visible tap affordances.
- Nested scrolling on the same axis — flatten the layout.
- Multi-level dropdown menus — flatten to single-level or push-navigate.
- Complex drag-and-drop without a fallback — provide grab handles + up/down buttons too.
- Input `font-size` below 16px — iOS Safari auto-zooms on focus otherwise.
- Spacing between interactive elements below 8px — prevents mis-taps.
