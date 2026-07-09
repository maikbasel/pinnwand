---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
  - "index.html"
  - "vite.config.*"
---

# PWA Design

Design conventions for an installed, standalone PWA. Once on the home screen, the app no longer has a URL bar, browser back button, or refresh — design for that, not for a tab.

This rule is about PWA-specific design concerns. General mobile design (touch targets, responsive swaps, input zoom) lives in `frontend/mobile-first.md`.

## Safe-area insets

The status bar mode is `black-translucent` (see `index.html`), so the iOS status bar overlays the top of the app. Any fixed top chrome — header, tab bar, modal — must respect the inset.

- Top: `pt-[env(safe-area-inset-top)]` on the topmost fixed/sticky element.
- Bottom: `pb-[env(safe-area-inset-bottom)]` on bottom tab bars, drawer footers, fixed CTAs.
- Sides: `pl-[env(safe-area-inset-left)]` / `pr-[env(safe-area-inset-right)]` on full-bleed surfaces (landscape iOS clips otherwise).
- `viewport-fit=cover` is set in `index.html` — required for the inset env vars to be non-zero. Don't remove it.

## Standalone-mode UX

In standalone mode the user has no browser back button. The app must provide its own navigation.

- Every non-root route renders an in-app back/close affordance (top-left chevron or drawer close button).
- Detect standalone via `window.matchMedia('(display-mode: standalone)').matches` when conditional UI is needed (e.g. hide an "install" CTA after install, hide an iOS "Add to Home Screen" hint inside the installed app).
- Don't deep-link to external URLs in the same window — they open in a fragile in-app browser. Use `target="_blank" rel="noopener noreferrer"`.

## Theme + status bar

- The `theme_color` in the manifest, the `<meta name="theme-color">` in `index.html`, and the top-of-app background must match. A mismatch produces a visible seam on Android and a wrong-color status bar tint on iOS.
- **The theme is owned by `next-themes`**, mounted as `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>` in `src/app/routes/__root.tsx`. It persists the choice under the `theme` localStorage key and toggles the `light` / `dark` class on `documentElement` (Tailwind's dark variant keys off `.dark`). Do NOT add a parallel theme store — drive everything through `next-themes`' `useTheme()`.
- **The theme is user-selectable** (System / Hell / Dunkel) via the Darstellung section on `/settings`. `ThemeSwitch` (`src/features/appearance/`) maps those labels to next-themes' `system` / `light` / `dark` and calls `setTheme`.
- Because the choice is runtime, there is a **single** `<meta name="theme-color">` (no `media`-scoped pair). next-themes does not manage `theme-color`, so `ThemeColorSync` (mounted in `__root.tsx`) sets it from the resolved theme via `applyThemeColor` in `src/features/appearance/lib/theme.ts`. Keep the light/dark background literals there, in the inline bootstrap, and in the manifest in sync (all derive from `--mz-paper`).
- A small inline no-FOUC bootstrap in `index.html` reads next-themes' own `theme` localStorage key, resolves it against `prefers-color-scheme`, and pre-applies the resolved `light`/`dark` class + `theme-color` **before** first paint (next-themes only applies its class after mount, which would otherwise flash). next-themes reconciles to the same class on mount, so they do not conflict; keep the storage key (`theme`) and backgrounds aligned with `theme.ts`.
- Status bar style stays `black-translucent` — if you switch to `default` or `black`, remove the corresponding `pt-[env(safe-area-inset-top)]` paddings (status bar no longer overlays).

## Disable unwanted touch behaviors

- `touch-action: manipulation` on interactive elements that should not double-tap-zoom (use a Tailwind utility or one-off class).
- `overscroll-behavior: contain` on scrollable containers inside the app to prevent the whole page bouncing on iOS or triggering pull-to-refresh on Android.
- `-webkit-tap-highlight-color: transparent` site-wide is fine **only if** every interactive element has an explicit `:active`/`:focus-visible` style — otherwise taps feel dead.
- `user-select: none` on UI chrome (buttons, nav, drag handles). **Never** on user-generated text, meal names, or inputs.

## Offline affordances

- Offline state is a first-class UI state. The bottom-right `SyncIndicator` (`src/shared/components/sync-indicator.tsx`) owns it: offline takes precedence, so it shows a persistent "Offline" badge instead of the "Synchronisiert…" spinner (a paused write still counts as pending, so a spinner offline would mislead). It reads the shared TanStack Query `onlineManager` via `useSyncExternalStore`, not a separate `useOnlineStatus` hook. See `pwa.md` for the offline-first data model behind it.
- Mutations queued while offline must look submitted optimistically (per `production-grade.md`) — never disable inputs on offline alone. Meal writes persist and resume on reconnect; the realtime channel reconnects and reconciles.
- Core meal planning renders offline from the persisted cache (`pwa.md`). There is no static offline fallback page — the precached SPA shell is the offline UX.

## Splash + app shell

- Splash background = app shell background. A white splash that fades into a dark app looks broken.
- The first paint after splash should be the app shell skeleton (header + day grid placeholders), not a full-page spinner. Skeletons are part of every loading state.

## What not to do

- Don't reintroduce the URL bar in design mockups — there isn't one.
- Don't gate features behind "open in browser" affordances. The installed PWA is the product.
- Don't render scrollbars assuming desktop styling on mobile — iOS hides them entirely.
- Don't use `100vh` for full-height layouts — iOS Safari miscalculates with the URL bar. Use `100dvh` or `h-screen` + `h-dvh` fallback.
