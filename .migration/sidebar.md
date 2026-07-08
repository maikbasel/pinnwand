# sidebar

2026-07-08 — Transformation engine (no existing Radix in-repo; shadcn `new-york` Radix source fetched from the registry and transformed to Base UI). Verdict: migrated and building; rail composes the Base-UI primitive.

## Changed

- `src/shared/components/ui/sidebar.tsx` (new, 774-line upstream ported to Base UI):
  - `@radix-ui/react-slot` `Slot` + `asChild` → Base UI `useRender` + `mergeProps` with a `render` prop on the five composable parts (`SidebarGroupLabel`, `SidebarGroupAction`, `SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuSubButton`).
  - All `React.forwardRef` wrappers → plain function components (React 19 ref-as-prop; project rule `frontend/react.md`).
  - `TooltipProvider delayDuration={0}` → Base UI `delay={0}`.
  - `theme(spacing.4)` (Tailwind v3) → `--spacing(4)` (Tailwind v4) in the floating/inset width calcs.
  - `shadow-[0_0_0_1px_hsl(var(--sidebar-border))]` → `var(--sidebar-border)` (tokens are already oklch, not hsl-wrapped).
  - Custom `data-*` defaults flow through an identity helper `withDefaults()` because Base UI's `mergeProps` object-literal parameter rejects `data-*` keys via excess-property checks.
  - `data-slot` added to every part (matches the rest of `ui/`).
  - Leftover scan clean: `grep -n "radix-ui\|@radix-ui" src/shared/components/ui/sidebar.tsx` → none.
- `src/shared/hooks/use-mobile.ts` (new): `useIsMobile()`, verbatim shadcn (not Radix).
- `src/features/navigation/components/sidebar-rail.tsx`: rebuilt on `Sidebar`/`SidebarHeader`/`SidebarContent`/`SidebarGroup`/`SidebarMenu`/`SidebarMenuItem`/`SidebarMenuButton`/`SidebarMenuSkeleton`/`SidebarFooter`/`SidebarInput`. Board rows are `SidebarMenuButton` (active → `isActive` + `aria-current="page"`); inline create row morphs `SidebarMenuButton` → `SidebarInput`.
- `src/features/navigation/components/navigation-shell.tsx`: wraps the shell in `SidebarProvider` + `SidebarInset`.
- `src/features/navigation/components/rail-primitives.tsx`: deleted (hand-rolled `RailItem`/`RailCreateRow` superseded by the sidebar primitive).
- `src/features/navigation/components/__tests__/sidebar-rail.test.tsx`: render helper wraps `SidebarRail` in `SidebarProvider` (the primitive requires the context). Assertions unchanged.
- `src/test/setup.ts`: added a `matchMedia` jsdom stub (the sidebar's `useIsMobile` and the confirm surfaces' `useMediaQuery` read it on mount).

## Left alone

- `vaul` (drawer), `sonner`, `input-otp`, `@base-ui/react` primitives — not Radix.
- The floating/inset/offcanvas/mobile-Sheet/collapsible machinery is ported faithfully but unused by the rail (`collapsible="none"`, desktop-only). Kept for fidelity per the user's "full faithful port" choice.

## Behavior changes

- **Collapse state is not persisted.** Upstream writes `document.cookie` on toggle; this project forbids direct `document.cookie` writes (`security.md`, enforced by Ultracite `noDocumentCookie`), so state stays in memory. Moot for the `collapsible="none"` rail.
- The Cmd/Ctrl+B keyboard shortcut still toggles `open`, but with `collapsible="none"` it has no visual effect.

## Verify by hand

- Desktop ≥768px: rail visible, sticky, boards listed, active board highlighted, create-row morphs to input on click and commits on Enter/blur, join row navigates.
- Mobile <768px: rail hidden, top app bar drives nav.
- Keyboard: Tab through rail buttons; focus ring visible.
