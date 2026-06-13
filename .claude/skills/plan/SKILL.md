---
name: plan
description: Lock architecture, scope, and a test plan before delegating implementation. Use after /spec (or whenever a task is confirmed but the how is unsettled) — the drafter runs a scope challenge and an engineering lens, then an independent reviewer sub-agent adversarially reviews the plan before any code.
license: MIT
---

# /plan — Lock the how before building

Adapted from the gstack `/plan-eng-review` methodology for YUI. Takes a confirmed
spec and produces the **design decision + test plan** an implementing sub-agent
executes. Runs before delegation, not after.

**Why this exists:** `/spec` answers *what & why*. `/plan` answers *how* — and
catches the over-built design, the structural-and-behavioral change bundled into
one diff, and the missing test plan before any code is written.

**Two roles.** The **drafter** (you) maps the how. An **independent reviewer** (a
different sub-agent than the drafter and than the implementer) adversarially checks
it before build. The drafter never approves their own plan — that self-review is the
anti-pattern this gate exists to break.

# Drafter

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

# Reviewer

## Independent plan-review (mandatory — a different agent)
The drafter does not approve their own plan. Hand the drafted plan to an
**independent reviewer sub-agent** — not the drafter, not the implementer. Default
reviewer: **Software Architect** (architecture + contract). Scale up when warranted:
add a **product** review (against `PRODUCT.md`) when scope or value is unsettled,
and a **design** review (`/impeccable`) for UI. A small, well-scoped change gets one
eng-review pass; a large or risky one gets the full set.

The reviewer is adversarial and returns:
- **Scope** — is the cut minimal? Does Step 0 hold, or is something over/under-built?
- **Architecture** — is the data flow sound? Any seam, race, or ordering missed?
- **Edge cases** — what is not enumerated?
- **Test plan** — does it cover the behavior and the edges, failing-first?
- **Invariants** — firing ≠ judgment, no `should_speak`, no inline tags, no hardcoding.
- **Verdict** — `ready` or `revise`, plus a list of **unresolved decisions**.

The drafter revises until the verdict is `ready`. Unresolved decisions the drafter
cannot settle from the code go to the user — never silently resolved.

## Record the decision
YUI docs are current-state only; the *plan* (future work) lives in the GitHub issue.
Record the chosen design and the reviewer's verdict as a comment on the issue. The
`docs/` update that reflects the new behavior lands in the implementation PR,
matching the code — not ahead of it.

## Exit gate (before delegating)
Do not hand off until:
- [ ] Step 0 scope challenge done; complexity smell resolved.
- [ ] Architecture/data-flow diagram exists.
- [ ] Contract consumers traced (if the contract changes).
- [ ] Edge cases enumerated.
- [ ] Test plan written (failing-tests-first list).
- [ ] Independent plan-review returned `ready`; unresolved decisions surfaced to the user.
- [ ] Decision + verdict recorded on the issue.

## Hand-off
Delegate to the owning sub-agent (see AGENTS.md roster) with the test plan. The
implementer writes the failing tests first (`test:`), then the implementation
(`feat:`). Verification (Reality Checker) and review (Code Reviewer) follow.
