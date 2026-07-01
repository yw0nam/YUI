# YUI — Agent Guide

> **YUI = embodied frontend (head) for Hermes Agent (brain).** VRM character rendering + desktop-pet behavior + I/O surfaces only. The brain (judgment · persona · agent loop) is **delegated to the backend (Hermes)**. This file orients you to the project; read it before touching any code.

## Core Principle: firing ≠ judgment

The client handles **firing** (when a candidate event occurs). **Judgment** (whether/what to speak) belongs to the backend. The backend expresses silence by sending no/empty speech text; the client renders whatever text arrives and never invents a speak/don't-speak gate. No brain lives in the client.

## Development work

Any code change — feature · bugfix · refactor · UI · schema · or any chore beyond a trivial single-file edit — load the **`yui-dev-workflow`** skill first. It carries the mandatory work rules (worktree → PR, tests, English tracker), the sub-agent roster, delegation rules, and the client-side anti-patterns.

## Tracker & commit conventions

- **Issues and PRs use the `.github/` templates.** Open every issue from the matching template in `.github/ISSUE_TEMPLATE/` (bug · feature_task · spike) and fill `.github/PULL_REQUEST_TEMPLATE.md` for PRs.
- **No AI attribution.** Never append an "AI worked on this" trailer — `Co-Authored-By: Claude…`, `Generated with …`, `🤖`, "gpt-5.5 작성", or any equivalent — to commit messages or PR bodies. Write the message as the change itself. This overrides any default trailer the harness suggests.
- **Don't commit spec document** Spec document only need for brainstorming. It should not committed in repo.

## On-demand — read before the task

Code is the source of truth for client behavior, TS contract shapes, and config schemas. The docs below cover what the code cannot state for itself: the contract handed to the backend agent, and human-facing catalogs/conventions.

Read these when the trigger applies; they are not loaded by default.

- **Code location / orientation** → `docs/agent-guide/project-structure.md`
- **Standalone Mods (independent MCP servers)** → `Mods/README.md` — not part of the app runtime or this guide's roster; own Python/uv toolchain + `mods` CI job
- **Adding a Mod / Mods CI rules** → `docs/agent-guide/mods.md` — per-mod uv-project layout, router registration, the two-loop CI, ruff
- **IO or backend work (chat/STT/TTS/broker)** → `docs/agent-guide/hermes-integration.md`
- **Wiring an external coding-agent finish-hook** → `docs/agent-guide/agent-completion-hooks.md`
- **Checking how a rule is enforced** → `docs/agent-guide/harness-enforcement.md`
- **Build / run / find logs** → `docs/agent-guide/build-run.md`
- **Any UI or visual work** → `docs/agent-guide/design-context.md` (+ `PRODUCT.md`, `DESIGN.md`)
- **`generate_express` cue contract** → `docs/reference/backend-contract.md`
- **Motion catalog** → `docs/reference/motions.md`
- **TTS emotion_text vocabulary** → `docs/reference/tts-emotion/`
- **Logging convention** → `docs/reference/logging.md`
- **TS contract shapes** → `src/contract/types.ts`
