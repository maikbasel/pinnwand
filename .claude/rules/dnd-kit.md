---
paths:
  - "src/**/*.tsx"
  - "src/**/*.ts"
---

# dnd-kit (Drag and Drop)

## Sensors

- Touch + pointer + keyboard sensors are all required. Configure them at the `DndContext` provider level in the feature that owns the drag surface.
- Touch sensor: set `activationConstraint: { delay: 150, tolerance: 5 }` — without a delay, scrolling the week view triggers drags on iOS.
- Pointer sensor: `activationConstraint: { distance: 8 }` so a click doesn't start a drag.
- Keyboard sensor must be present for accessibility — never ship a drag surface without it.

## Drag handles

- Every draggable meal exposes an explicit drag handle (icon button) — don't make the whole card draggable. Whole-card drags fight with tap-to-edit.
- The drag handle is a real `<button>` with `aria-label="Reorder meal"` so screen readers and keyboard users can use it.

## Optimistic reorder

- Reorder mutations write the optimistic order through TanStack Query's `onMutate` (see `tanstack-query.md`). Roll back if the Supabase update fails.
- Server-side ordering is authoritative — the optimistic result is reconciled on `onSettled` invalidation.

## Mobile verification

- Test drag on a real iOS Safari and Android Chrome before merging. Touch drag has subtle behaviors (auto-scroll, momentum) that desktop dev tools' touch emulation does not reproduce faithfully.
- A drag that feels good on desktop but stutters on mobile is unfinished.

## Coexisting gesture layers

The week surface stacks three pointer gestures inside the same `DndContext`: vertical scroll, dnd-kit reorder, the per-card `react-swipeable` swipe-to-delete, and a week-level `react-swipeable` swipe-to-change-week. They are kept from fighting by distance and origin, not by `stopPropagation`:

- **Distance separates the two horizontal swipes.** The card delete delta is ~10px; the week-change activation distance is a much larger named constant (`WEEK_SWIPE_ACTIVATION_DISTANCE_PX`, 60px). A short card swipe never reads as a week change.
- **A start-target guard separates child gestures from week navigation.** The card subtree carries `data-meal-card`; the week handler records in `onSwipeStart` whether the gesture began inside a card *or* an inline text field (`event.target.closest('[data-meal-card], input, textarea')`) and ignores navigation when it did. This is the authoritative mechanism — prefer it over `stopPropagation`, which cannot stop the desktop mouse path because `react-swipeable` tracks `mousemove`/`mouseup` on `document` (they never bubble through the card). Because the dnd-kit grip lives inside a card, the same guard also excludes reorders from triggering navigation; including `input`/`textarea` keeps a horizontal drag-to-select inside the create/edit meal field from navigating away mid-edit.
- **`touch-action: pan-y` + `preventScrollOnSwipe: false`** on the week surface keep vertical scrolling native; `react-swipeable` only emits Left/Right for a dominantly-horizontal gesture, so scroll is never hijacked.
- **Any selection suppression for mouse swipes is transient** — toggle `user-select` imperatively on swipe start and restore it on swipe end. Never a persistent `user-select: none` over meal text (see `pwa-design.md`).
