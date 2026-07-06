# Living Documentation

`CLAUDE.md` and `.claude/rules/*.md` are living artifacts. Keep them in sync with what ships.

## When to update

- **`CLAUDE.md`** — update when the project's tech stack, top-level architecture, or essential commands change. Keep it under 200 lines; push the detail into a rule.
- **A rule file** — update the relevant rule when an implementation pattern is decided, refined, or deprecated. One topic per file. If a rule file grows past one topic, split it.
- **New rule file** — write one when a new domain or file type acquires conventions worth recording. Add `paths:` frontmatter scoping it to where it applies; leave frontmatter off for safety-critical rules that must always load (security, migrations, production-grade).

## What NOT to update retroactively

- Don't rewrite history. If a decision changed, add a "Resolved deviation" note explaining why, rather than silently replacing the original intent.
- Don't update docs to match broken or incomplete implementations — fix the implementation first.
- Don't promote a one-off pattern into a rule until it has been used in at least two features. Premature rules create noise.

## Checklist before merging

- [ ] Does `CLAUDE.md` still accurately describe the stack and structure?
- [ ] Did this change introduce a new convention? If so, is it captured in a rule (with correct `paths:` frontmatter) and not just inline in code review?
- [ ] If a rule file changed, did its frontmatter `description` stay accurate?
