---
name: Feature / Task
about: Build work tied to a feature (F1–F9) or milestone (M0–M4)
title: "[Fx] "
labels: ["feature"]
---

## Related decisions
<!-- Example: F4 Output, D-TTS-PIPELINE. See docs/reference/backend-contract.md. -->
- Feature:
- Decision log (D-*):
- Milestone (M0–M4):

## Work description
<!-- What is being built. One issue = one unit of work. -->

## Acceptance criteria
<!-- Copy the relevant feature acceptance criteria. -->
- [ ]

## Dependencies
<!-- Prerequisite features/issues, contract deliverables -->

## Reference docs
- `docs/`:

## Checklist
- [ ] Schema changes update `docs/reference/backend-contract.md` before the code
- [ ] No unverified assumptions (web/context7 cross-check, then record in docs if needed)
- [ ] No brain in the client (firing ≠ judgment)
- [ ] `cargo check` + `pnpm build` pass
