---
name: spec
description: Turn a vague request into a precise, executable spec before any code. Use when a task is unclear, multi-step, or about to be implemented — runs Why → Scope → code-grounded interrogation → draft, then files or updates the GitHub issue in English.
license: MIT
---

# /spec — Author an executable spec

Adapted from the gstack `/spec` methodology for YUI. Turns intent into a spec an
unfamiliar implementer could execute. The output is a **GitHub issue body in
English** (YUI tracker rule), not code. Do **not** propose or write implementation
during `/spec`.

**Why this exists:** the failure this prevents is jumping to a worktree on a
one-paragraph idea, guessing at how the code works, and discovering mid-build
that the real design surface was never mapped. Read the code first; spec second;
build never here.

## When to run
- Before implementing any task that is unclear, touches more than one module, or
  changes behavior at a seam.
- Skip for a typo / one-line fix with no new behavior.

## Process (STRICT — do not skip or combine phases)

### Phase 0 — Reframe (light)
One pass before the questions: is this the right problem? Is there a simpler
framing that dissolves it? State the reframe in one line, or say "framing holds."
Don't dwell — this is a sanity check, not a workshop.

### Phase 1 — Why (answer all five, no hand-waving)
1. **Who** is affected? (end user / the character's behavior / a backend contract / dev workflow)
2. **What is the current behavior?** — verified against the code, not assumed.
3. **What should it be instead?**
4. **Why now?** (blocking work / correctness bug / contract drift / UX gap)
5. **How will we know it's done?** — observable: a test, a log line, a rendered
   state, a screenshot. Not "feels right."

Do not proceed until all five hold.

### Phase 2 — Scope & boundaries (answer all five)
1. **Explicitly out of scope** — lock it early; this prevents creep.
2. **Systems touched** — name files, configs, the contract, Rust commands, the dispatcher path.
3. **Ordering constraints** — must A land before B? (e.g. contract change before producer wiring)
4. **MVP cut** — the smallest version that delivers the value. Always find it.
5. **Failure modes & rollback** — what breaks if shipped wrong; how it degrades.

### Phase 3 — Technical interrogation (HARD requirement: read code first)
**Before asking any Phase 3 question, read at least one piece of real evidence**
(Grep / Glob / Read) and cite `path:line`. Do not ask "which file?" — find it.
This is the step whose absence causes thin specs.

Map the request to evidence, then interrogate only the categories that apply:
- **Contract / types** — `src/contract/types.ts` ↔ `docs/contract.md`. New event, field, enum? Trace every consumer.
- **Dispatcher** — classify → guardrail → route. Is the event classified? Routed? Does a producer actually fire it? (A dormant seam with no producer is the common trap — verify, don't assume.)
- **Renderer** — three.js/VRM state, motion/emotion, perch, frame budget.
- **IO / producers** — `src/io/*` and the Rust `os_event_watcher` / `drag.rs` signals that feed the bus.
- **Config** — does a value belong in `configs/` rather than hardcoded?
- **Testing** — how each layer is tested; what regresses.

State any assumption you could not verify in code as an explicit open question.

### Phase 4 — Draft & file
Present the full issue draft and ask: **"Does this capture it? What did I get wrong?"**
Iterate until confirmed. Then:
- Check for a near-duplicate: `gh issue list --search "<keywords>" --state open`.
- File a new issue or update the existing one (English, declarative, acceptance criteria as a checklist).

## Spec body shape
```
## Summary            — one paragraph: who, what, why now
## Current behavior   — verified, with path:line citations
## Desired behavior   — what it should do
## Scope              — In / Out (locked)
## Design surface     — systems touched, ordering, open questions
## MVP cut            — smallest valuable version
## Acceptance criteria — observable checkboxes (tests/logs/screenshots)
## Failure modes      — what breaks if wrong, how it degrades
```

## Hand-off
A confirmed spec hands to `/plan` (architecture + scope challenge + test plan)
before any sub-agent implements. `/spec` answers *what & why*; `/plan` answers *how*.
