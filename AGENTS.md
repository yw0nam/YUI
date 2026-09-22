# YUI — Agent Guide

> **YUI = embodied frontend (head) for the selected backend (brain).** VRM character rendering + desktop-pet behavior + I/O surfaces only. The brain (judgment · persona · agent loop) is **delegated to the backend**. This file orients you to the project; read it before touching any code.

## Core Principle: firing ≠ judgment

The client handles **firing** (when a candidate event occurs). **Judgment** (whether/what to speak) belongs to the backend. The backend expresses silence by sending no/empty speech text or the bare `[SILENT]` token; the client renders whatever text arrives and never invents a speak/don't-speak gate. No brain lives in the client.

## Backend-agnostic

The backend is whichever agent the user selects. No code path, doc, or skill outside `integrations/<agent>/` assumes a specific backend agent's behavior, configuration, or install route; each addresses any agent that speaks the contract in `docs/reference/`. Agent-specific wiring lives under `integrations/<agent>/`. Plugin-discovery files whose names an outside ecosystem fixes (`.claude-plugin/`, `.agents/plugins/`, `SKILL.md` frontmatter) are packaging and carry no such assumption.

A feature lives in the shared consumer; a transport's wiring only turns that transport's frames or stream events into calls on it. A feature ships a producer for every transport whose wire carries its data, in the same PR. A feature only one transport has is limited to what that transport alone can deliver — for the push transport, delivery the client did not request.

## Development work

Any code change — feature · bugfix · refactor · UI · schema · or any chore beyond a trivial single-file edit — load the **`yui-dev-workflow`** skill first. It carries the mandatory work rules (worktree → PR, tests, English tracker), delegation rules and the review/verification gates, and the client-side anti-patterns.

## Tracker & commit conventions

- **Issues and PRs use the `.github/` templates.** Open every issue from the matching template in `.github/ISSUE_TEMPLATE/` (bug · feature_task · spike) and fill `.github/PULL_REQUEST_TEMPLATE.md` for PRs.
- **No AI attribution.** Never append an "AI worked on this" trailer — `Co-Authored-By: Claude…`, `Generated with …`, `🤖`, "gpt-5.5 작성", or any equivalent — to commit messages or PR bodies. Write the message as the change itself. This overrides any default trailer the harness suggests.
- **Don't commit spec document** Spec document only need for brainstorming. It should not committed in repo. The same goes for decision records (ADRs, decision logs): a decision lives in the code, the issue, and the PR body.
- **Evidence-gated claims.** Bug-prevention claims need a measured RED (failing test · repro · per-bug gating table); numeric claims (line counts, edit sites) need their measurement cited. Unverified claims are rejected on sight. See `docs/agents/issue-tracker.md` § Claim discipline.

## Engineering principles

- Before designing a solution, look at how established products solve the same problem. Adopt proven patterns and conventions instead of inventing approaches from scratch.
- Do not preserve backward compatibility. Delete unused paths instead of adding compat layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets current requirements. No speculative abstractions, config values, or layers of indirection. Always write the least code that does the job without harming functionality, readability, or project structure — don't pad it out for its own sake.
- Grow the system in layers: start from a minimal end-to-end working version and add features on top of working results. Never trade working code for unfinished complexity.
- Separate components into modules with clear separation of concerns. Core logic lives in its own module behind an explicit interface (inputs in, results out); the main flow — an `index.ts`, a shell, a `create*` factory — only imports modules and routes I/O between them. A new handler, flag, or branch goes into a module, never inline into the file that composes others. A composing file that has started holding logic shows it as a closure over many DOM references or flags read by nested functions, or a `dispose()` that knows every section's cleanup; move the block out before adding to it.
- Group files by feature, inside a layered top level. `src/` is ordered `contract`, `tauri-env`, `logger` → `config` → `renderer` → `io` → `dispatcher` → `ambient` → `ui` → `app` → `windows`, and a folder or root file imports only from what sits to its left. Inside a layer, a folder holds one feature's files or one sub-folder per feature, nested until a folder holds one feature (`io/window/pet/`); sibling sub-folders may import each other. A new module joins the sub-folder of its feature; a new feature opens its own sub-folder; a feature's wiring sits with the feature when it imports only leftward, and in `app/` otherwise. A flat folder that lists the files of two or more features side by side and tells them apart by a name prefix or suffix (`filler-*`, `*-section`) is an anti-pattern: split it before adding to it.
- Write only the test cases needed to confirm a feature actually works. Piling on test cases for volume's sake is an anti-pattern, not thoroughness.
- Prefer proven, maintained libraries when they lower overall complexity or raise stability. Check already-installed dependencies before implementing something yourself or adding a package — and never claim "this library can't do that" without checking its docs and types.
- Make architecture decisions with a long-term view. Reject stopgaps that only get past today and must be replaced later.

## On-demand — read before the task

Code is the source of truth for client behavior, TS contract shapes, and config schemas. The docs below cover what the code cannot state for itself: the contract handed to the backend agent, and human-facing catalogs/conventions.

Read these when the trigger applies; they are not loaded by default.

- **Code location / orientation** → `docs/agent-guide/project-structure.md`
- **Standalone Mods (independent MCP servers)** → `Mods/README.md` — not part of the app runtime; own Python/uv toolchain + `mods` CI job
- **Adding a Mod / Mods CI rules** → `docs/agent-guide/mods.md` — per-mod uv-project layout, router registration, the two-loop CI, ruff
- **Agent desire system (Hermes-side)** → `integrations/hermes/desire/README.md`
- **Connecting Hermes Agent as the backend (Responses mode, dev proxy, auth)** → `integrations/hermes/README.md`
- **Handing a `ready-for-agent` issue to the backend agent for headless implementation** → `integrations/hermes/skills/yui-dispatch/SKILL.md`
- **Runtime evidence for a yui platform plugin change (live Hermes gateway, throwaway profile)** → `integrations/hermes/platform/yui/skills/yui-platform-smoke-test/SKILL.md`
- **IO or backend work (chat/STT/TTS/broker)** → `docs/agent-guide/backend-integration.md`
- **Wiring an external coding-agent's lifecycle hooks** → `docs/agent-guide/agent-completion-hooks.md`
- **Checking how a rule is enforced** → `docs/agent-guide/harness-enforcement.md`
- **Build / run / find logs** → `docs/agent-guide/build-run.md`
- **Any UI or visual work** → `docs/agent-guide/design-context.md` (+ `PRODUCT.md`, `DESIGN.md`)
- **`generate_express` cue contract, or the `client_context` prompt-text format sent to the backend** → `docs/reference/client-context.md`
- **`POST /signals` envelope, buffering, and delivery rules** → `docs/reference/signals-ingress.md`
- **Push transport (`chat_api: "push"`) frames, reconnect, and limits** → `docs/reference/push-transport.md`
- **Motion catalog** → `docs/reference/motions.md`
- **TTS emotion_text vocabulary** → `docs/reference/tts-emotion/`
- **Logging convention** → `docs/reference/logging.md`
- **Witness activity log (format, location, retention)** → `docs/reference/witness-log.md`
- **TS contract shapes** → `src/contract/types.ts`
