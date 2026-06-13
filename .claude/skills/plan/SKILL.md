---
name: plan
description: Lock architecture, scope, and a test plan before delegating implementation. Use after /spec (or whenever a task is confirmed but the how is unsettled) — runs a scope challenge, an engineering lens, product/design lenses when they apply, and records the decision in docs/.
license: MIT
---

# /plan — Lock the how before building

Adapted from the gstack `/plan-eng-review` methodology for YUI. Takes a confirmed
spec and produces the **design decision + test plan** an implementing sub-agent
executes. Runs before delegation, not after.

**Why this exists:** `/spec` answers *what & why*. `/plan` answers *how* — and
catches the over-built design, the structural-and-behavioral change bundled into
one diff, and the missing test plan before any code is written.

## Step 0 — Scope challenge (always, first)
Answer before any design work:
1. **What already solves this, partially or fully?** Can existing flows be extended/captured instead of building parallel ones? (Read the code; cite `path:line`.)
2. **Minimum set of changes** that achieves the stated goal. Be ruthless about deferring the rest.
3. **Complexity smell:** if the design touches **more than ~8 files** or adds **more than 2 new modules/services**, STOP and challenge whether the same goal fits in fewer moving parts. Surface the trade to the user before continuing.
4. **Built-in vs custom:** does three.js / Tauri / the framework already provide this? Don't roll a custom version of a built-in.
5. **Sequencing:** is this a structural change *and* a behavioral change? Split them — *make the change easy, then make the easy change*. Never bundle a refactor and a behavior change into one diff.

If the complexity smell fires, ask the user (name what's over-built, propose the
minimal cut) before proceeding.

## Engineering lens (always)
- **Architecture & data flow** — draw the path as an **ASCII diagram** (producer → bus → dispatcher → renderer, or the relevant seam). Show where the new code sits.
- **Contract impact** — if types/events/enums change, list every consumer and the `docs/contract.md` ↔ `src/contract/types.ts` sync.
- **Edge cases** — enumerate them: empty/missing payload, races, reduced-motion, multi-monitor/DPI, non-Tauri (browser) fallback, teardown ordering.
- **YUI invariants** — confirm the design keeps firing ≠ judgment (no brain in client), no `should_speak`, no inline control tags, no hardcoding.
- **Test plan** — name the failing tests to write first (TDD), per layer: what each asserts and at which seam. This is the hand-off artifact.

## Product lens (when scope or value is unsettled)
Check against `PRODUCT.md`: does this serve the character (invisible-by-default,
warm-when-present)? Is the MVP cut the right one, or is there a sharper 10-point
version of the request? Flag scope that contradicts a prior decision in docs.

## Design lens (UI work only)
Defer to the existing UI workflow: read `src/ui/`, `DESIGN.md`, `PRODUCT.md`,
then run `/impeccable`. Propose structure in text → mock HTML → implement. Do not
re-invent this here.

## Record the decision (mandatory)
Before delegating, record the chosen design in `docs/` (declarative, current-state —
no change-narrative). A design that isn't in docs isn't decided. If the decision
revises an existing doc, update it in place. This satisfies the AGENTS.md rule:
*if it's not in docs, record the decision in docs before implementing.*

## Exit gate (before delegating)
Do not hand off until:
- [ ] Step 0 scope challenge done; complexity smell resolved.
- [ ] Architecture/data-flow diagram exists.
- [ ] Contract consumers traced (if the contract changes).
- [ ] Edge cases enumerated.
- [ ] Test plan written (failing-tests-first list).
- [ ] Decision recorded in `docs/`.

## Hand-off
Delegate to the owning sub-agent (see AGENTS.md roster) with the test plan. The
implementer writes the failing tests first (`test:`), then the implementation
(`feat:`). Verification (Reality Checker) and review (Code Reviewer) follow.
