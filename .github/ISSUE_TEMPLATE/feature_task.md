---
name: Feature / Task
about: Build work for a feature or task
title: "[feature] "
labels: ["feature"]
---

## Work description
<!-- What is being built. One issue = one unit of work. -->

## Acceptance criteria
<!-- Copy the relevant feature acceptance criteria. -->
- [ ]

## Architecture map
<!-- The module and part of docs/agent-guide/architecture/map.js this work goes into, the modules it touches, the exchanges it adds, removes, or changes, and the state of those modules and exchanges before and after. For work inside one part, name the part and write "no exchange changes". -->

## Dependencies
<!-- Prerequisite features/issues, contract deliverables -->

## Reference docs
- `docs/`:

## Checklist
- [ ] Schema changes update `docs/reference/client-context.md` before the code
- [ ] No unverified assumptions (web/context7 cross-check, then record in docs if needed)
- [ ] No brain in the client (firing ≠ judgment)
- [ ] `cargo check` + `pnpm build` pass
