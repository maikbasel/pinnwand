---
paths:
  - "vite.config.*"
  - "public/**/*"
  - "src/app/**/*"
  - "src/registerSW.*"
  - "src/sw.*"
---

# PWA

## Service worker

- `vite-plugin-pwa` builds the manifest and service worker via the **`injectManifest`** strategy: the worker source is `src/sw.ts`, which the plugin compiles and injects the precache manifest into (`self.__WB_MANIFEST`). Configure precaching/runtime caching with Workbox modules *inside* `src/sw.ts`.
- **Resolved deviation (was: "don't write a custom service worker").** The project ran `generateSW` until Web Push landed (`add-household-notifications`). Push needs `push` + `notificationclick` listeners in the worker, which a generated worker cannot carry, so it migrated to `injectManifest`. `src/sw.ts` ports the prior offline behaviour verbatim — `precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches()`, and a `NavigationRoute` to `index.html` with the `/auth/ /rest/ /realtime/` denylist — then adds the push handlers. Do not regress to `generateSW`: it would silently drop push. The worker is typed by a dedicated `tsconfig.worker.json` (WebWorker lib); `src/sw.ts` is excluded from `tsconfig.app.json`.
- Use `registerType: 'autoUpdate'`; the worker calls `skipWaiting()` + `clientsClaim()` so a new build activates immediately. Show a "new version available" toast if the update is detected mid-session.
- Workbox runtime caching is fine for static assets. **Do not cache Supabase responses** — staleness in a shared meal plan is worse than a brief offline blank.

## Offline

Core meal planning works offline; sharing does not. The app is offline-first for the planning surface and online-only for everything that needs the network.

- **Reads hydrate from IndexedDB on a cold offline launch.** The TanStack Query cache is persisted via `@tanstack/react-query-persist-client` over an `idb-keyval` async storage persister (`src/shared/lib/idb-persister.ts`). `main.tsx` wraps the app in `PersistQueryClientProvider`; `WeekView` gates on `useIsRestoring()` so the week never flashes empty before the persisted data hydrates. There is **no** static `offline.html`: the precached SPA shell (`navigateFallback` resolves to `index.html`) loads and renders real data.
- **What is persisted is an allowlist**, not everything. `shouldDehydrateOfflineQuery` in `query-client.ts` persists only `meals` / `meal-plans` / `households` (plus members), never the auth session (Supabase owns that) and never the sharing sub-trees (`invites`, `invitePreview`). `gcTime` is raised to the persist `maxAge` (7 days, matching iOS eviction) so persisted queries are not garbage-collected before they are written.
- **Offline meal writes are durable across an app restart.** Meal mutations (create, update, move, delete, duplicate) pause offline (default `networkMode`) and resume on reconnect. Their mutation functions are registered via `setMutationDefaults` in `src/features/meals/mutation-defaults.ts` (called from `main.tsx` before restore) so a mutation paused in a prior session replays with no React scope: functions are not serialized, only mutation state is, and the variables are fully self-contained (household, plan, date) for the same reason. `resumePausedMutations()` runs on restore; reconnect resume is automatic. This is the official persist mechanism, not a hand-rolled queue.
- **Sharing operations are online-only.** Create/rename/delete plan, create/rename household, and generate/accept invite set `networkMode: 'always'` so they fail fast offline (the network error maps to the "Verbindungsproblem" copy) instead of pausing and firing unexpectedly later. They are never persisted.
- **The persisted cache is per-user and purged on sign-out.** The persister `buster` folds in the signed-in user id (read synchronously from the stored session), so one user's blob is discarded rather than hydrated into another user's session on a shared device. `useSignOut` also calls `purgePersistedCache()`.
- **Do not manually merge `postgres_changes` into the persisted cache.** Reconnect re-subscribes the realtime channel, which refetches and overwrites stale cached data: the same invalidation contract as online.

## Icons and manifest

- The single source of truth is `public/favicon.svg` (the Pinnwand pushpin mark: a rounded blue tile with `.pinnwand-bg` / `.pinnwand-glyph` class hooks). It is built from plain `<rect>` + a triangle `<path>` only — **no `<text>`, no negative-scale transforms, no `oklch()` colours**. resvg (the rasterizer `@vite-pwa/assets-generator` uses) drops glyphs under some flipped/complex transforms and cannot parse `oklch()`, which is how an icon renders as an empty coloured tile on an Android PWA. Keep the source rasterizer-safe.
- PNGs (`pwa-64`, `pwa-192`, `pwa-512`, `maskable-icon-512`, `apple-touch-icon-180`, `favicon.ico`) are generated from the SVG by `@vite-pwa/assets-generator` — config in `pwa-assets.config.ts`, run via `pnpm generate-pwa-assets`. Regenerate and commit the PNGs whenever the source SVG changes.
- **The maskable and apple presets fill their padding with a solid brand-blue `background` (`pwa-assets.config.ts`), so those icons are 0% transparent — never an empty tile on Android.** After regenerating, verify the glyph actually rasterized (don't trust the generator): sample the PNGs and confirm both background-blue and glyph-white pixels are present, e.g. decode `public/pwa-512x512.png` with `sharp` and assert a few % white. A solid tile with no glyph is the empty-icon bug.
- `vite-plugin-pwa` is configured with `pwaAssets: { config: true, overrideManifestIcons: true }` so the build-time PWA HTML head injection (favicon links + apple-touch-icon) and manifest `icons` array are derived from the generator's output. **Do not hand-maintain `<link rel="apple-touch-icon">` in `index.html`** — VitePWA emits it.
- `display: standalone`, `theme_color` matches the Tailwind app theme, `start_url: '/'`.
- Test the install prompt on real Android Chrome before shipping a manifest change — the prompt is fragile.

## In-app logo component

- `src/shared/components/pinnwand-logo.tsx` (`<PinnwandLogo variant size title />`) is the canonical in-app brand mark. Its SVG geometry is the single source of truth shared with `public/favicon.svg`. Variants (`default` | `inverted` | `mono` | `ghost`) map to CSS classes in `src/app/index.css`; `default` carries fixed brand colours (blue tile, white glyph), the others bind to theme tokens so dark mode swaps automatically.
- Pass `title={null}` when the mark is decorative (e.g. next to the visible `Pinnwand` wordmark in the rail header / mobile top bar); pass a string for standalone uses (sign-in screen). Current placements: sidebar rail header, mobile `TopAppBar` brand slot, `/sign-in`.

## iOS

- iOS Safari does not show an install prompt. The onboarding UI must include a "Add to Home Screen" instruction with a screenshot for iOS users.
- iOS clears service worker storage aggressively after ~7 days of inactivity. Don't rely on long-term offline state on iOS.

## Verification before merging PWA changes

There is no CI gate for the PWA — Lighthouse's PWA category was removed in v12 and a hand-rolled static audit was judged not worth the maintenance cost. The `vite build` step in CI catches `vite-plugin-pwa` config errors (broken manifest, missing icons referenced from config). The remaining hand-eyes verification is mostly visual (icon legibility at small sizes, install-prompt flow on a real device).

Before merging anything that touches the manifest, icons, service-worker config, or `index.html`:

- [ ] `pnpm build && pnpm preview`, then Chrome DevTools → Application → Manifest to confirm "Installable" with no errors.
- [ ] iOS Safari "Add to Home Screen" — launch the installed app, exercise the golden path.
- [ ] Cold-launch offline: sign in online, kill the network, relaunch the installed app — confirm the last week, switchers, and member avatars render (no blank week, no empty-to-populated flash) and the offline indicator shows.
- [ ] Add a meal offline, fully close and reopen the app while still offline — confirm the meal is still shown.
- [ ] Reconnect — confirm queued meal mutations sync (no duplicates) and the offline indicator clears.
- [ ] Shared device: sign in as A, sign out, sign in as B — confirm none of A's meals/households hydrate for B.
