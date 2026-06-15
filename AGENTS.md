# YUI — Agent Guide

> **YUI = embodied frontend (head) for Hermes Agent (brain).** VRM character rendering + desktop-pet behavior + I/O surfaces only. The brain (judgment · persona · agent loop) is **delegated to the backend (Hermes)**. This file is the canonical guide. Read it before touching any code. 

## Before start it

Load the Karpathy guidelines, vendored at [`.claude/skills/karpathy-guidelines/SKILL.md`](.claude/skills/karpathy-guidelines/SKILL.md): think before coding, simplicity first, surgical changes, goal-driven execution.

## Work Rules (user directive, mandatory)

- **Worktree → PR.** All work happens in a git worktree and lands via PR; `main` requires a PR and green CI (`PreToolUse(Bash)` guard denies `git commit`/`git push` on `main`; set `YUI_ALLOW_MAIN=1` for explicit docs/rules exceptions). New-worktree setup: run `bash scripts/worktree-setup.sh <worktree>` after a manual `git worktree add` (Claude-created worktrees run this automatically via `WorktreeCreate` hook).
- **GitHub tracker in English.** Issues, issue comments, and PR titles/bodies are written in English (chat with the user is any language); enforced by the `pr-title` CI job.
- **UI: review existing → propose text structure → mock HTML → implement.** Read `src/ui/`, `DESIGN.md`, `PRODUCT.md` before any UI work; propose structure, get confirmation, create a standalone mock HTML, then implement (detail: `docs/agent-guide/design-context.md`).
- **Tests accompany behavior.** New or changed behavior ships its test in the same PR; the `test-guard` CI job enforces this (`skip-tests` label bypasses). Write the failing test first (`test:`), then implementation (`feat:`), then refactor if needed (`refactor:`).
- **Sub-agent-based development.** See `## When to delegate` below.
- **Verify what you can verify before asking the user.** Anything observable (UI rendering / DOM state / logs) — verify yourself and attach proof to the PR's Runtime-evidence section; ask the user only for things that genuinely require them (audio playback, physical input feel).
- **Comments: minimal, present-tense only.** Comment only what the code cannot say itself, in one line; no decision-history, spec-citation, or issue-number breadcrumbs.
- **Docs: current-state only.** Write what the system *is*, declaratively, matching the code — no change-narrative, no PR/issue numbers as prose, no dated changelogs, no future/unbuilt work (`PostToolUse` docs guard enforces this).

## Sub-agent Roster

Specialist definitions are vendored in [`.claude/agents/`](.claude/agents/). Invoke an agent by its exact `name:` (the **Agent** column).

| Area | Agent (`name:`) | Model | Responsibility |
|---|---|---|---|
| **Renderer — graphics** | **Technical Artist** | `opus` | `src/renderer/` — shaders, expressions, motion, lipsync, frame-budget/perf |
| **Renderer — load / Chat IO** | **Frontend Developer** | `opus` | `src/renderer/` three.js/VRM load + `src/io/chat-client.ts` Responses API SSE parser, `generate_express` capture |
| **Dispatcher** | **Backend Architect** | `opus` | `src/dispatcher/` — event-bus, classify→guardrail→route |
| **Audio IO** | **Voice AI Integration Engineer** | `sonnet` | `src/io/tts-pipeline.ts` + `stt-vad.ts` — TTS queue/ordering, VAD→STT |
| **Tauri / Rust** | **Senior Developer** | `sonnet` | `src-tauri/` — os_event_watcher, IPC contract, `cargo test` |
| **Contract / Schema** | **Software Architect** | `sonnet` | `src/contract/types.ts` (contract source of truth) + JSON schema validation |
| **UI / Mock** | **UI Designer** | `sonnet` | Mock HTML authoring, DESIGN.md token compliance |
| **Docs** | **Technical Writer** | `sonnet` | `docs/` updates — backend_agent_broker_interaction.md, motions.md, logging.md, tts_emotion/ |
| **Review** | **Code Reviewer** | `sonnet` | Diff review — correctness / maintainability / security / performance |
| **Verification** | **Reality Checker** | `sonnet` | Evidence-based gating — Playwright screenshot + app-run log proof of UI/DOM/runtime behavior before certifying |
| **Performance** | **Performance Benchmarker** | `sonnet` | Frame budget, lipsync/TTS timing, regression checks |

> **No dedicated agent** for Test-writing, `configs/*.json` loaders, or `src/ambient/tier1.ts` — these are handled by the **same agent that owns the area**. The implementing agent writes its own failing tests first.

### Main Agent Role

1. **Requirements clarification** — understand user intent and define work scope
2. **Task delegation** — distribute work to sub-agents (ensure failing tests precede implementation — TDD ordering)
3. **Integration verification** — confirm `pnpm test` + `cargo test` + `pnpm build` + `pnpm lint` pass
4. **Orchestration** — manage task ordering and dependencies

## When to delegate

Default by rule; ask only on the boundary.

- **Delegate to a sub-agent** if ANY: adds/changes behavior (needs TDD), touches a roster specialist area, or spans multiple files/steps.
- **Do it directly** if ALL: no new behavior (typo·doc·comment·rename·config), ~20 lines or fewer, single file, mechanical.
- **Genuinely borderline?** Ask the user one line: "이거 ○○ 작업인데 직접 할까요, 서브에이전트로 위임할까요?"

## Core Principle: firing ≠ judgment

The client handles **firing** (when a candidate event occurs). **Judgment** (whether/what to speak) belongs to the backend. The backend expresses silence by sending no/empty speech text; the client renders whatever text arrives and never invents a speak/don't-speak gate. No brain lives in the client.

## Anti-patterns (do not do)

- **No brain in the client.** Judgment / persona state / mode branching belongs to the backend.
- **No inline control tags.** Emotion/motion goes through `generate_express` tool-call arguments only — not inline tokens in speech text.
- **No unverified assumptions.** Consult docs first. If not in docs, record the decision in docs before implementing.
- **No hardcoding.** Endpoints/models/VRM paths/motion sets go in `configs/`.

## On-demand — read before the task

Code is the source of truth for client behavior, TS contract shapes, and config schemas. The docs below cover what the code cannot state for itself: the contract handed to the backend agent, and human-facing catalogs/conventions.

Read these when the trigger applies; they are not loaded by default.

- **Code location / orientation** → `docs/agent-guide/project-structure.md`
- **IO or backend work (chat/STT/TTS/broker)** → `docs/agent-guide/hermes-integration.md`
- **Checking how a rule is enforced** → `docs/agent-guide/harness-enforcement.md`
- **Build / run / find logs** → `docs/agent-guide/build-run.md`
- **Any UI or visual work** → `docs/agent-guide/design-context.md` (+ `PRODUCT.md`, `DESIGN.md`)
- **`generate_express` cue contract** → `docs/backend_agent_broker_interaction.md`
- **Motion catalog** → `docs/motions.md`
- **TTS emotion_text vocabulary** → `docs/tts_emotion/`
- **Logging convention** → `docs/logging.md`
- **TS contract shapes** → `src/contract/types.ts`
