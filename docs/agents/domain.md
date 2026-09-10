# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read this

- **`CONTEXT.md`** at the repo root, if it exists.

If it doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms actually get resolved.

## File structure

This is a single-context repo:

```
/
├── CONTEXT.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Decisions live in code, issues, and PRs

The glossary holds terms only. A design decision is recorded where it is made: in the code that implements it, in the issue that asked for it, and in the PR body that shipped it. When a skill offers to write an ADR, a decision log, or a spec document, decline; `AGENTS.md` § Tracker & commit conventions states the rule.
