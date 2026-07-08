# shadcn Component Rebuild — Work List

> Resume artifact. Goal: rebuild EVERY UI component on shadcn anatomy, composed like the Mahlzeit sibling. Standing rule (memory `always-use-shadcn-components`): always use shadcn; when no shadcn component fits, STOP and ask the user before hand-rolling.

## Settled foundation (do not re-litigate)

- **Base UI + shadcn anatomy**, NOT Radix. Author each shadcn component's exact structure/classes/API on the `@base-ui/react` equivalent, styled with our Modern Minimal tokens. Never `pnpm dlx shadcn add` (pulls Radix).
- **Mirror Mahlzeit** (`/home/maikb/IdeaProjects/mahlzeit/src/shared/components/ui/` and `/src/features/*/components/`) — it already solved these translations and is the reference the user trusts.
- Mahlzeit does NOT use shadcn's Sidebar/Form blocks; its rail is hand-composed from primitives. Match that.
- Prose/copy: no em dashes. Tests: behavior via roles + copy constants. Strict TS incl `noUncheckedIndexedAccess`.

## Current git state (start of rebuild)

- Branch `feat/boards-slice`, HEAD at base `e643ab3`, **nothing committed, nothing pushed**. The app-shell slice (27 files) is **staged, uncommitted** (user removed the per-task commits, wants to review). Extends PR #5.
- Shell already rebuilt on shadcn/Base-UI this session (root full-bleed fix, avatar/dropdown-menu/scroll-area primitives, account menu = Avatar + DropdownMenu, rail = ScrollArea). 72/72 unit tests green, build + lint clean.

## Primitives present (`src/shared/components/ui/`)

avatar, button, card, dropdown-menu, input-otp, input, label, popover, scroll-area, skeleton.

## Primitives to ADD (mirror Mahlzeit's file of the same name unless noted)

- `alert-dialog.tsx` — destructive confirms (Base UI AlertDialog). Mirror Mahlzeit.
- `dialog.tsx` — modal forms/detail (Base UI Dialog). Mirror Mahlzeit.
- `drawer.tsx` — mobile bottom sheet (Vaul or Base UI). Mirror Mahlzeit; needed for the responsive Dialog/Drawer + ConfirmSheet swap (see `frontend/mobile-first.md`).
- `sonner.tsx` — Toaster wrapper (replace the raw `import { Toaster } from "sonner"` in `__root.tsx`). Mirror Mahlzeit.
- `badge.tsx` — status/labels (e.g. board role, join code chip). Mirror Mahlzeit.
- Add only-if-needed during audit: `alert.tsx` (inline error surfaces — shadcn Alert; Base UI has no direct equiv, compose a styled role="alert" primitive), `separator.tsx`, `tooltip.tsx`, `tabs.tsx`. Author on Base UI when adopted; if a component has NO shadcn fit, ASK before hand-rolling.

## Components to audit + rebuild (per-component: reuse primitive / mirror Mahlzeit component / ask)

Auth:
- [ ] `auth/components/sign-in-form.tsx` — uses Card/Input/Button/Label/InputOTP already; convert the two inline `<p role="alert">` error surfaces to a shadcn `Alert`. Compare to Mahlzeit sign-in structure.
- [ ] `auth/components/sign-out-button.tsx` — already `Button`; verify.

Boards:
- [ ] `boards/components/board-card.tsx` — rebuild on `Card` (+ `Badge` for role). Check vs hand-rolled.
- [ ] `boards/components/boards-page.tsx` — list layout on `Card`/`Button`/`Skeleton`.
- [ ] `boards/components/create-board-entry.tsx` — inline create on `Input`/`Button` (confirm no hand-rolled bits).
- [ ] `boards/components/join-board-page.tsx` — `Card` + `InputOTP` + `Button`.
- [ ] `boards/components/board-share-panel.tsx` — copy/rotate on `Button`, code as `Badge`/`Input` readonly. Audit.
- [ ] `boards/components/board-detail-page.tsx` — destructive leave/delete confirms → `AlertDialog` (desktop) + `Drawer`/ConfirmSheet (mobile) per `frontend/mobile-first.md`; rename inline on `Input`/`Button`. Biggest one.
- [ ] `boards/components/board-empty-pane.tsx` — simple; likely fine, verify tokens.

Navigation (mostly done this session — verify only):
- [x] `account-menu.tsx` (Avatar + DropdownMenu), `sidebar-rail.tsx` (ScrollArea), `navigation-shell.tsx`, `top-app-bar.tsx` (buttonVariants).
- [ ] `rail-primitives.tsx` — hand-composed nav rows (RailItem/RailCreateRow), mirrored from Mahlzeit. CONFIRM with user this hand-composition is acceptable (matches Mahlzeit) vs wanting a `SidebarMenuButton`-style primitive.

Routes (structural, not components, but verify shadcn usage): `__root.tsx` (Toaster→sonner wrapper), `sign-in.tsx`, `auth.callback.tsx`, `_authed*.tsx`.

## Execution approach (post-compact)

1. Audit pass (one subagent, read-only): for each component above, report exactly what is hand-rolled and the shadcn/Base-UI primitive that replaces it, or flag "no shadcn fit — needs user decision". Produce a concrete adopt/ask list.
2. Bring any "no shadcn fit" items to the user before building.
3. Add the missing primitives (mirror Mahlzeit), then rebuild components in dependency order, each with behavior tests (roles + copy constants). Keep uncommitted for review unless the user says otherwise.
4. Verify: `pnpm build`, `NODE_OPTIONS=--no-experimental-webstorage pnpm test`, `pnpm check`, then e2e. Known pre-existing flake: input-otp teardown timer in `join-board-page.test.tsx`/`sign-in-form.test.tsx` (logs errors, no assertion fails) — ignore it.
