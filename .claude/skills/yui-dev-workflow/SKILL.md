---
name: yui-dev-workflow
description: Use when writing, changing, reviewing, testing, or delegating any code in the YUI repo — any feature, bugfix, refactor, UI, schema, or chore beyond a trivial single-file edit.
---

# YUI Development Workflow

How development happens in YUI: the mandatory work rules, the sub-agent roster, delegation decisions, and the client-side anti-patterns. Load this before touching code. Project identity and the on-demand doc index stay in `AGENTS.md`.

## Before you start

**REQUIRED SUB-SKILL:** load `karpathy-guidelines` — surface assumptions, keep changes surgical, define verifiable success criteria before writing code.

## Work Rules (user directive, mandatory)

- **Worktree → PR.** All work happens in a git worktree and lands via PR; `main` requires a PR and green CI (`PreToolUse(Bash)` guard denies `git commit`/`git push` on `main` — the agent cannot commit/push to `main` and must request the user to run it directly). New-worktree setup: run `bash scripts/worktree-setup.sh <worktree>` after a manual `git worktree add` (Claude-created worktrees run this automatically via `WorktreeCreate` hook).
- **GitHub tracker in English.** Issues, issue comments, and PR titles/bodies are written in English (chat with the user is any language); enforced by the `pr-title` CI job.
- **UI: review existing → propose text structure → mock HTML → implement.** Read `src/ui/`, `DESIGN.md`, `PRODUCT.md` before any UI work; propose structure, get confirmation, create a standalone mock HTML, then implement (detail: `docs/agent-guide/design-context.md`).
- **Tests accompany behavior.** New or changed behavior ships its test in the same PR; the `test-guard` CI job enforces this (`skip-tests` label bypasses). Write the failing test first (`test:`), then implementation (`feat:`), then refactor if needed (`refactor:`).
- **Sub-agent-based development.** See `## When to delegate` below.
- **Verify what you can verify before asking the user.** Anything observable (UI rendering / DOM state / logs) — verify yourself and attach proof to the PR's Runtime-evidence section; ask the user only for things that genuinely require them (audio playback, physical input feel).
- **Comments: minimal, present-tense only.** Comment only what the code cannot say itself, in one line; no decision-history, spec-citation, or issue-number breadcrumbs.
- **Docs: current-state only.** Write what the system *is*, declaratively, matching the code — no change-narrative, no PR/issue numbers as prose, no dated changelogs, no future/unbuilt work (`PostToolUse` docs guard enforces this).

## Sub-agent Roster

Specialist definitions are vendored in `.claude/agents/`. Invoke an agent by its exact `name:` (the **Agent** column).

| Area | Agent (`name:`) | Model | Responsibility |
|---|---|---|---|
| **Renderer — graphics** | **Technical Artist** | `sonnet` | `src/renderer/` — shaders, expressions, motion, lipsync, frame-budget/perf |
| **Renderer — load / Chat IO** | **Frontend Developer** | `sonnet` | `src/renderer/` three.js/VRM load + `src/io/chat-client.ts` Responses API SSE parser, `generate_express` capture |
| **Dispatcher** | **Backend Architect** | `sonnet` | `src/dispatcher/` — event-bus, classify→guardrail→route |
| **Audio IO** | **Voice AI Integration Engineer** | `sonnet` | `src/io/tts-pipeline.ts` + `stt-vad.ts` — TTS queue/ordering, VAD→STT |
| **Tauri / Rust** | **Senior Developer** | `sonnet` | `src-tauri/` — os_event_watcher, IPC contract, `cargo test` |
| **Contract / Schema** | **Software Architect** | `sonnet` | `src/contract/types.ts` (contract source of truth) + JSON schema validation |
| **UI / Mock** | **UI Designer** | `sonnet` | Mock HTML authoring, DESIGN.md token compliance |
| **Docs** | **Technical Writer** | `sonnet` | `docs/` updates — reference/backend-contract.md, reference/motions.md, reference/logging.md, reference/tts-emotion/ |
| **Review** | **Code Reviewer** | `sonnet` | Diff review — correctness / maintainability / security / performance |
| **Verification** | **Reality Checker** | `sonnet` | Evidence-based gating — Playwright screenshot + app-run log proof of UI/DOM/runtime behavior before certifying |
| **Performance** | **Performance Benchmarker** | `sonnet` | Frame budget, lipsync/TTS timing, regression checks |

> **No dedicated agent** for Test-writing, `configs/*.json` loaders, or `src/ambient/tier1.ts` — these are handled by the **same agent that owns the area**. The implementing agent writes its own failing tests first.

### Main Agent Role

1. **Requirements clarification** — understand user intent and define work scope
2. **Task delegation** — distribute work to sub-agents (ensure failing tests precede implementation — TDD ordering)
3. **Integration verification** — confirm `pnpm test` + `cargo test` + `pnpm build` + `pnpm lint` pass
4. **Orchestration** — manage task ordering and dependencies
5. **Chore work** - You can directly commit and push to the main branch if the work is chore work. chore work means: 3~4 files edit and less than 100 line edit. In this case you don't need to worktree either. just edit, stage, then report back to user.

## When to delegate

Default by rule; ask only on the boundary.

- **Delegate to a sub-agent** if ANY: adds/changes behavior (needs TDD), touches a roster specialist area, or spans multiple files/steps.
- **Do it directly** if ALL: no new behavior (typo·doc·comment·rename·config), ~20 lines or fewer, single file, mechanical.
- **Genuinely borderline?** Ask the user one line: "이거 ○○ 작업인데 직접 할까요, 서브에이전트로 위임할까요?"

## Anti-patterns (do not do)

- **No brain in the client.** Judgment / persona state / mode branching belongs to the backend.
- **No inline control tags.** Emotion/motion goes through `generate_express` tool-call arguments only — not inline tokens in speech text.
- **No unverified assumptions.** Consult docs first. If not in docs, record the decision in docs before implementing.
- **No hardcoding.** Endpoints/models/VRM paths/motion sets go in `configs/`.
