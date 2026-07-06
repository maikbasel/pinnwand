---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# TanStack Query Patterns

## Query keys

- Query keys are arrays defined as constants in the feature's `api/` module — never inline literals at the call site.
- Convention: `<FEATURE>_KEYS = { all: ['<feature>'] as const, byPlan: (planId) => [...<FEATURE>_KEYS.all, 'plan', planId] as const, ... }`.
- Always `as const` so TypeScript infers literal tuple types.

## Mutations

- Every mutation includes `onSuccess` (or `onSettled`) that invalidates affected queries by key.
- Optimistic updates are required on user-facing mutations — latency must feel instant. Pattern:
  1. `onMutate`: cancel outgoing queries for the affected key, snapshot current data, write the optimistic value.
  2. `onError`: roll back to the snapshot, surface the error to the user.
  3. `onSettled`: invalidate to reconcile with the server.
- Never `setQueryData` from a component — do it inside the mutation lifecycle so reconciliation stays atomic.

## Realtime + invalidation

Supabase realtime subscriptions invalidate queries — they NEVER manually merge `postgres_changes` payloads into the cache.

```ts
useEffect(() => {
  const channel = supabase
    .channel('meals')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'meals' },
      () => queryClient.invalidateQueries({ queryKey: MEAL_KEYS.all }),
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}, [queryClient]);
```

Why: manual merging duplicates state-shape logic that already exists on the server, drifts on schema changes, and turns every realtime event into a potential bug. Invalidation forces a single source of truth.

## Hooks layer

- Every `useXxx` hook owns its query key, its query function (which calls a function in `api/`), and its loading / error / empty handling.
- Components consume `data`, `isPending`, `isError`, `error` — they don't construct or pass query keys.
- Components MUST render an explicit state for `isPending` and `isError`. No hook consumer ships without both.

## Household scope (load-bearing for SyncIndicator)

The `SyncIndicator` in the TopBar filters in-flight work by the active household. It reads `meta.scope.household` on every query and `mutationKey` on every mutation. The query-key SHAPE is NOT inspected.

For **every TanStack Query that reads data scoped to a single household**:

- Attach `meta: householdScopedQueryMeta(householdId)` from `@/features/households`. This is the only mechanism the indicator recognises; forgetting it is the only way for a new household-scoped query family to slip past the indicator.
- For multi-household reads via `useQueries`, attach the meta per-query inside the `.map()`.

For **every mutation that writes data scoped to a single household**:

- Set `mutationKey: HOUSEHOLD_MUTATION_KEYS.forHousehold(householdId)` from `@/features/households`.
- User-wide mutations (auth, profile, set-last-household, accept-invite) stay untagged on purpose — they should NOT flash the indicator for the active household.

`@tanstack/react-query` is module-augmented in `src/shared/lib/query-client.ts` so `QueryMeta.scope.household` is a typed field — `householdScopedQueryMeta()` is the one helper, and the predicate next to it (`isHouseholdScopedQuery`) is what the indicator consumes.

## Anti-patterns

- Importing `@tanstack/react-query`'s `useQuery` directly in a component. Wrap it in a feature hook.
- Using `enabled: false` to "pause" a query when the right answer is to not mount the component yet.
- Using `refetchInterval` for realtime — that's what the realtime channel is for.
