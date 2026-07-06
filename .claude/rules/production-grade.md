# Production-Grade Implementations Only

Pinnwand is a real product teams use to coordinate their work. Every line of code, every test, every migration, every error path must assume a real person is on the other end. There is no "throwaway", no "we'll fix it later", no "good enough for demo". If something isn't ready for a real user to encounter while managing their tasks, it does not merge.

## What this forbids

- **POC / prototype code in main.** Exploratory code lives on a throwaway branch and is deleted, not merged "behind a flag for now".
- **TODOs, FIXMEs, HACKs, XXX comments** pointing at work intended for later. Either do the work or delete the hook for it.
- **Stub functions, placeholder copy, lorem ipsum.** No "Coming soon" pages unless the "Coming soon" page itself is the finished product.
- **Happy-path-only implementations.** Error paths, empty states, loading states, and offline states are part of the feature, not a v2.
- **Silent failures.** Swallowed exceptions, empty `catch {}` blocks, promises without `await`, `.catch(() => {})`. If you can't recover, log and surface.
- **`console.log` / `debugger` in production code.** Use a small logger module if you need leveled output; strip stray logs before merging.
- **Dev-only shortcuts shipped to prod.** No `if (import.meta.env.DEV)` guards that hide missing behavior. If it works in dev, it must work in prod.
- **Magic strings / numbers without names.** Extract a constant.
- **Bypassing TanStack Query state for realtime.** Manual merge of `postgres_changes` payloads into cached data is forbidden — invalidate the query and let it refetch.

## What this requires

- **Every feature is complete end-to-end before merge**: SQL migration → generated types → `api/` repository → hook → component → loading + error + empty states → optimistic update → tests.
- **Error paths are designed, not caught by a global boundary as an afterthought.** Each failure mode (offline, RLS denial, conflict) has a user-visible outcome — retry, fallback, clear message.
- **Optimistic updates on every mutation.** Latency must feel instant. Roll back on error, surface the error to the user.
- **Realtime sync is verified across two browser tabs** before claiming a feature done — this is a two-user app and realtime IS the feature.
- **Empty states, long task titles, empty columns, network failures, slow networks, double-submits, re-opened dialogs, stale clients** all work.

## If you're tempted to ship something half-done

Ask instead: *"What would I need to do to make this actually production-ready?"* Then scope honestly. If it's too big for this PR, cut the feature's surface area — ship less, but ship it done. Never ship more, done halfway.
