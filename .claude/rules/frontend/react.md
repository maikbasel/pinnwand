---
paths:
  - "src/**/*.tsx"
---

# React 19 + JSX

- Function components only — no class components.
- Hooks at the top level only, never conditionally and never inside loops.
- Specify all dependencies in hook dependency arrays correctly. Don't use `// eslint-disable-next-line react-hooks/exhaustive-deps` to silence valid warnings.
- Use the `key` prop on every iterable element. Prefer stable IDs from data over array indices.
- Nest children between opening and closing tags — don't pass JSX as a prop unless the API truly requires it (e.g., shadcn-style slot props).
- Do not define components inside other components. Move them up or out.
- Use semantic HTML elements; reach for `role` only when no semantic element fits (see `frontend/a11y.md`).

## React 19 specifics

- `ref` is a regular prop now — use it directly. Don't reach for `forwardRef` for new components.
- `use(promise)` and `use(context)` are available — prefer them over wrapper hooks where they fit.
- Server Components are not used in this project (Vite SPA + PWA). Don't add `'use client'` directives.

## Component shape

- One default export per component file — the component itself, named the same as the file.
- Type props as a `type Props = { ... }` declared just above the component, not in a separate file.
- Keep component files focused — if a component file exceeds ~200 lines, look for a sub-component to extract.
