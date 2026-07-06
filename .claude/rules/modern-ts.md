---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Modern TypeScript Standards

## Type safety & explicitness

- Strict mode is on. No `any`. No `as unknown as X` escape hatches.
- Prefer `unknown` over `any` when a type is genuinely unknown — narrow it with `zod` or a type guard.
- Use `const` assertions (`as const`) for immutable values and literal-type unions.
- Lean on TypeScript's narrowing rather than type assertions.
- Prefer `type` over `interface` for data shapes; reserve `interface` for declaration merging.
- Replace magic numbers and repeated strings with named constants in `SCREAMING_SNAKE_CASE`.

## Modern JavaScript / TypeScript

- Arrow functions for callbacks and short helpers.
- `for...of` over `.forEach()` or indexed `for` loops.
- Optional chaining (`?.`) and nullish coalescing (`??`) for safer property access.
- Template literals over string concatenation.
- Destructuring for object and array assignment.
- `const` by default; `let` only when reassignment is necessary; never `var`.

## Async & promises

- Always `await` promises in async functions — don't drop return values.
- `async/await` over `.then()` chains for readability.
- `try/catch` for error paths in async code; never swallow with empty `catch {}`.
- Don't use async functions as Promise executors.

## Error handling & debugging

- No `console.log`, `debugger`, or `alert` in production code.
- Throw `Error` objects (or subclasses) with descriptive messages — never strings.
- Use `try/catch` meaningfully; don't catch only to rethrow.
- Early returns over deeply-nested error branches.

## Code organization

- Keep functions focused. If cyclomatic complexity is creeping up, split.
- Extract complex boolean expressions into named variables.
- Group related code; separate concerns.
- Avoid nested ternaries — use a helper or a small `if`/`else`.

## Performance

- No spread syntax inside accumulator loops (`acc = [...acc, x]` in a `reduce`).
- Hoist regex literals out of hot loops.
- Prefer named imports over namespace imports.
- Avoid barrel files that re-export everything (they defeat tree-shaking) — prefer feature `index.ts` files that export only the public surface.

## Package selection

- Prefer well-maintained, widely-adopted packages over hand-rolled implementations.
- Before adopting a package, check: weekly npm downloads (>10k), last publish (<6 months), React 19 / Vite compatibility, bundle size impact.
- Bundle size matters — this is a PWA loaded over flaky mobile connections.
