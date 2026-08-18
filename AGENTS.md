# YUI — Agent Guide

> **YUI = embodied frontend (head) for Hermes Agent (brain).** VRM character rendering + desktop-pet behavior + I/O surfaces only. The brain (judgment · persona · agent loop) is **delegated to the backend (Hermes)**. This file orients you to the project; read it before touching any code.

## Core Principle: firing ≠ judgment

The client handles **firing** (when a candidate event occurs). **Judgment** (whether/what to speak) belongs to the backend. The backend expresses silence by sending no/empty speech text; the client renders whatever text arrives and never invents a speak/don't-speak gate. No brain lives in the client.

## Development work

Any code change — feature · bugfix · refactor · UI · schema · or any chore beyond a trivial single-file edit — load the **`yui-dev-workflow`** skill first. It carries the mandatory work rules (worktree → PR, tests, English tracker), delegation rules and the review/verification gates, and the client-side anti-patterns.

## Tracker & commit conventions

- **Issues and PRs use the `.github/` templates.** Open every issue from the matching template in `.github/ISSUE_TEMPLATE/` (bug · feature_task · spike) and fill `.github/PULL_REQUEST_TEMPLATE.md` for PRs.
- **No AI attribution.** Never append an "AI worked on this" trailer — `Co-Authored-By: Claude…`, `Generated with …`, `🤖`, "gpt-5.5 작성", or any equivalent — to commit messages or PR bodies. Write the message as the change itself. This overrides any default trailer the harness suggests.
- **Don't commit spec document** Spec document only need for brainstorming. It should not committed in repo.
- **Evidence-gated claims.** Bug-prevention claims need a measured RED (failing test · repro · per-bug gating table); numeric claims (line counts, edit sites) need their measurement cited. Unverified claims are rejected on sight. See `docs/agents/issue-tracker.md` § Claim discipline.

## Engineering principles

- Before designing a solution, look at how established products solve the same problem. Adopt proven patterns and conventions instead of inventing approaches from scratch.
- Do not preserve backward compatibility. Delete unused paths instead of adding compat layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets current requirements. No speculative abstractions, config values, or layers of indirection.
- Grow the system in layers: start from a minimal end-to-end working version and add features on top of working results. Never trade working code for unfinished complexity.
- Separate components into modules with clear separation of concerns.
- Prefer proven, maintained libraries when they lower overall complexity or raise stability. Check already-installed dependencies before implementing something yourself or adding a package — and never claim "this library can't do that" without checking its docs and types.
- Make architecture decisions with a long-term view. Reject stopgaps that only get past today and must be replaced later.

## On-demand — read before the task

Code is the source of truth for client behavior, TS contract shapes, and config schemas. The docs below cover what the code cannot state for itself: the contract handed to the backend agent, and human-facing catalogs/conventions.

Read these when the trigger applies; they are not loaded by default.

- **Code location / orientation** → `docs/agent-guide/project-structure.md`
- **Standalone Mods (independent MCP servers)** → `Mods/README.md` — not part of the app runtime; own Python/uv toolchain + `mods` CI job
- **Adding a Mod / Mods CI rules** → `docs/agent-guide/mods.md` — per-mod uv-project layout, router registration, the two-loop CI, ruff
- **IO or backend work (chat/STT/TTS/broker)** → `docs/agent-guide/hermes-integration.md`
- **Wiring an external coding-agent's lifecycle hooks** → `docs/agent-guide/agent-completion-hooks.md`
- **Checking how a rule is enforced** → `docs/agent-guide/harness-enforcement.md`
- **Build / run / find logs** → `docs/agent-guide/build-run.md`
- **Any UI or visual work** → `docs/agent-guide/design-context.md` (+ `PRODUCT.md`, `DESIGN.md`)
- **`generate_express` cue contract, or the `client_context` prompt-text format sent to the backend** → `docs/reference/client-context.md`
- **Motion catalog** → `docs/reference/motions.md`
- **TTS emotion_text vocabulary** → `docs/reference/tts-emotion/`
- **Logging convention** → `docs/reference/logging.md`
- **TS contract shapes** → `src/contract/types.ts`
