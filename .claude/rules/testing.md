---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
---

# Testing Philosophy (Outside-In TDD)

## Approach

Start with an acceptance test (Playwright) that describes the full observable behavior. Let it stay red. Each failure message tells you what to build next. Drop into a Vitest unit test only when you need fast design feedback on a specific seam (a hook, an api function, a zod schema, a component state). When all pieces are in place, the acceptance test goes green — done.

## The inner loop

Each step in the implementation order runs this micro-cycle:

1. Run the acceptance test — observe the first failing assertion.
2. Write the smallest focused Vitest test that targets that specific seam — it must be red for the right reason.
3. Implement just enough to make that focused test green.
4. Refactor if needed.
5. Re-run the acceptance test — move to the next failure and repeat.

**Focused tests are disposable.** Some focused tests exist only to drive the design of a seam while the acceptance test is still red. Once the acceptance test goes green, delete any focused test whose assertion is fully covered by the acceptance test. Coverage is a side-effect, not the goal.

## Vitest unit tests

- Triggered by a *new requirement*, not a code change.
- Test behavior of a unit (hook, api function, zod schema) — not implementation details.
- Used for fast feedback on a specific design seam, not for coverage padding.
- Location: `src/features/<feature>/**/*.test.ts(x)` co-located with the unit under test.

## Test against real Supabase, not mocks (where possible)

- For tests of `api/` repositories, run against a local Supabase started with `supabase start` rather than mocking the client. The mock drift is real and silent.
- Hooks tests use `@testing-library/react` + a TanStack Query wrapper. Mock the `api/` layer at its function boundary, not the Supabase client.
- Realtime behavior is too important to mock — exercise it in Playwright with two browser contexts.

## Bug fixes — reproduce first

When resolving a bug, **always write a failing test that reproduces the behavior before touching production code**. The test locks in the expected behavior, proves the fix actually fixes *this* bug (not a similar one), and guards against regression. No exceptions — even "obvious" one-line fixes get a reproducing test.

- Start with the highest-level test that can reproduce (acceptance > integration > unit).
- Run the test and confirm it fails **for the reason you expect**. A test failing for the wrong reason is worse than no test.
- Only then write the fix. The test must turn green without loosening its assertions.
- If a bug cannot be reproduced in a test, stop and ask why — untestable bugs are design smells.

## Test resilience rule

A change in implementation must not break a test as long as the requirement is still fulfilled. If it does, the test is testing implementation, not behavior — fix the test.

## Anti-patterns to avoid

- Testing implementation details (private methods, internal state).
- Writing tests after the fact to hit coverage numbers.
- Mocking the Supabase client when a real local Supabase + RLS test is available.
- One test per function — test behaviors and outcomes instead.
