# sheet

2026-07-08 — Transformation engine (shadcn `new-york` Radix source → Base UI). Verdict: migrated, building. Added as a `sidebar` dependency (mobile offcanvas).

## Changed

- `src/shared/components/ui/sheet.tsx` (new):
  - `@radix-ui/react-dialog` → `@base-ui/react/dialog` (same anatomy already proven by `alert-dialog.tsx`).
  - `Overlay` → `Backdrop`; `Content` → `Popup` (wrapped in `SheetPortal` + `SheetOverlay`).
  - `data-[state=open]/closed` → `data-open`/`data-closed`; kept `tw-animate-css` bare `slide-in-from-*` / `slide-out-to-*` (verified defined = ±100%).
  - `forwardRef` → plain functions (React 19).
  - `Title`/`Description` → `Dialog.Title`/`Dialog.Description`.
  - Close button copy localized to „Schließen".
  - Leftover scan clean.

## Left alone

- Fresh primitive; nothing project-specific replaced.

## Behavior changes

- None functionally. Base UI Dialog manages focus trap + scroll lock like Radix.

## Verify by hand

- Reached only via the sidebar's mobile branch (unused today: rail is `collapsible="none"`). If adopted: open, confirm focus moves in, Escape + backdrop-tap close, focus returns to trigger.
