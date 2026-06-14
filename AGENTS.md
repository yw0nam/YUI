# YUI — Agent Guide

> **YUI = embodied frontend (head) for Hermes Agent (brain).** VRM character rendering + desktop-pet behavior + I/O surfaces only. The brain (judgment · persona · agent loop) is **delegated to the backend (Hermes)**. This file is the canonical guide. Read it before touching any code. 

## Before start it

Load the Karpathy guidelines, vendored at [`.claude/skills/karpathy-guidelines/SKILL.md`](.claude/skills/karpathy-guidelines/SKILL.md): think before coding, simplicity first, surgical changes, goal-driven execution.

## Work Rules (user directive, mandatory)

- **Worktree → PR.** All work happens in a git worktree and lands via PR. The `main` branch ruleset requires a PR and green CI; the local `PreToolUse(Bash)` guard denies `git commit`/`git push` on `main` (set `YUI_ALLOW_MAIN=1` for the lightweight docs/rules exception the user explicitly approves).
  - **New-worktree setup.** Gitignored runtime assets (VRM, reference clips, `.env.local`) do not carry into a fresh worktree. A Claude-created worktree is set up automatically by the `WorktreeCreate` hook; after a manual `git worktree add`, run `bash scripts/worktree-setup.sh <worktree>` to link them from the main checkout. Without it the VRM 404s and chat auth is absent.
- **GitHub tracker in English.** Issues, issue comments, and PR titles/bodies are written in English (chat with the user is any language). The `pr-title` CI job enforces an English (ASCII) subject on PR titles.
- **UI: review existing → propose text structure → mock HTML → implement.** Before designing any UI, read existing surfaces (`src/ui/`, `DESIGN.md` tokens, `PRODUCT.md` principles) to align style and patterns. First propose the UI structure/layout to the user in text to get confirmation, then create a standalone mock HTML for visual approval, and finally proceed to implementation.
- **Tests accompany behavior.** New or changed behavior ships its test in the same PR. The `test-guard` CI job fails a PR whose `src/`/`src-tauri/` change exceeds the threshold without an accompanying test; the `skip-tests` label bypasses it for justified exceptions (rename, config-only, generated code). `pnpm test` / `cargo test` are PR gates. Working style: write the failing test first (`test:`), then the implementation (`feat:`), then refactor if needed (`refactor:`).
- **Sub-agent-based development.** Implementation is delegated to specialist agents in [Sub-agent Roster](#sub-agent-roster). The main agent focuses on requirements clarification, task delegation, verification, and orchestration. Exception: a small change with no new behavior (≈20 lines or fewer — a typo, a one-line fix, a doc tweak) the main agent may make directly.
- **Verify what you can verify before asking the user.** Anything observable (UI rendering / DOM state / logs) — verify yourself, and attach the proof to the PR's Runtime-evidence section. Ask the user to confirm **only** things that genuinely require them (audio playback, physical input feel).
- **Comments: minimal, present-tense only.** No decision-history / spec-citation / issue-number breadcrumbs in code comments. Comment only what the code cannot say itself, in one line.
- **Docs: current-state only.** Write what the system *is*, declaratively, matching the code. No change-narrative — no "was X, now Y", no "제거/대체/축소/supersede/더 이상/이전엔/추가했다/이제", no PR/issue numbers as prose, no dated decision-logs or changelogs. **Do not document future/unbuilt work in docs** — planned features and follow-ups live only in GitHub issues. Docs describe the present implementation; issues hold the future. The `PostToolUse` docs guard blocks change-narrative vocabulary in markdown.

## Sub-agent Roster

Specialist definitions are vendored in [`.claude/agents/`](.claude/agents/) so they travel with worktrees. Invoke an agent by its exact `name:` (the **Agent** column). Each row maps a YUI work area to the agent responsible for it.

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

## Harness & Enforcement

Mandatory rules have an enforcement point — the gate, not memory, is the source of truth. Rules without one are working style, applied by judgment.

| Rule | Enforced by |
|---|---|
| No direct commits to `main`; PR + green CI required | GitHub branch ruleset · `PreToolUse(Bash)` hook (`YUI_ALLOW_MAIN=1` bypass) |
| New/changed behavior ships a test | `test-guard` CI job (`skip-tests` label bypass) |
| Conventional, English PR titles | `pr-title` CI job |
| Format + lint | `lint` CI job (`pnpm lint`, Biome) |
| No raw `console.*` in `src/` | `lint` CI job (Biome `noConsole`) |
| Rust format + clippy | `rust` CI job (`cargo fmt --check`, `cargo clippy -D warnings`) |
| Runtime verification of UI/DOM/runtime change | PR template Runtime-evidence section |
| Docs are current-state only | `PostToolUse(Write\|Edit)` hook (change-narrative vocabulary block) |
| `.env.local` secret stays out of the transcript | `PreToolUse(Bash\|Read)` hook |
| Worktree runtime assets linked | `WorktreeCreate` hook + `scripts/worktree-setup.sh` |
| TDD ordering, UI mock approval, delegation | Working style (no machine gate) |

Hook scripts live in [`.claude/hooks/`](.claude/hooks/) and are wired in [`.claude/settings.json`](.claude/settings.json); all fail open. The `configs/motions.json` ↔ `docs/motions.md` pair surfaces a non-blocking sync nudge.

## Core Principle: firing ≠ judgment

The client handles **firing** (when a candidate event occurs). **Judgment** (whether/what to speak) belongs to the backend. There is no `should_speak` flag (**D-NO-SPEAK-GATE**) — the backend expresses silence by sending no/empty speech text; the client renders whatever text arrives. No brain lives in the client.

## Design Context

Before any UI/visual work, read [`PRODUCT.md`](PRODUCT.md) + [`DESIGN.md`](DESIGN.md). The impeccable skill (`/impeccable`) uses these as its canonical source.

> **Workflow (mandatory):** ① Review existing UI surfaces (`src/ui/`, `DESIGN.md`, `PRODUCT.md`) to align style and patterns, ② Propose the UI structure/layout to the user in text for confirmation, ③ Create a **standalone mock HTML** for visual approval, then ④ Proceed to implementation.

- **Register:** `product` — design serves the character, not marketing.
- **Core tone:** **invisible-by-default, warm-when-present.**
- **5 principles:** ① character is protagonist ② warm when present ③ render state only, no invention ④ legible on anything (transparent window) ⑤ calm, non-intrusive (respect reduced-motion).
- **Prohibited:** SaaS chatbot widget / messenger UI / retro mascot speech bubbles / decorative glass / gradient text.

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | tauri 2.11.x |
| Build / dev server | Vite | 8.x (dev port `YUI_DEV_PORT`, default **1420**; auto-port launchers pick a free port per worktree) |
| Language | TypeScript | 6.x (bundler mode, `noEmit`) |
| Render | three.js | 0.180.x |
| VRM / motion | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| Voice | `@ricky0123/vad-web` (Silero+ONNX) | 0.0.x |

## Directory Map

```
YUI/
  index.html                # Vite entry
  vite.config.ts            # dev port YUI_DEV_PORT|1420, strictPort, host 127.0.0.1
  biome.json                # Format + lint config (curated rule set)
  .claude/
    hooks/                  # Workflow guards (worktree setup, main/secret guard, docs guard) — fail open
    skills/                 # Vendored skills (karpathy-guidelines)
    agents/                 # Vendored sub-agent definitions
  scripts/                  # Dev launchers (dev-port.mjs, tauri-dev.mjs, dev-auto.mjs) + worktree-setup.sh + ci/test-guard.sh
  configs/                  # Runtime-loaded config (no hardcoding)
    endpoints.json            # chat/stt/tts base urls + tts_provider + irodori_* + broker_base_url
    emotion_registry.json     # emotion id → vrm_expression + fallback
    motions.json              # motion registry
    avatar.json               # VRM avatar config
    emotion_text/             # per-provider voice-tag vocabulary (e.g. emotion_text/irodori.json)
  public/motions/           # VRMA motion assets
  motion-preview.html       # Dev motion/emotion inspector (not in Tauri window)
  src/
    dev/                    # Dev-only tooling (motion-preview.ts, motion-preview.css)
    main.ts                 # Bootstrap wiring
    contract/               # TS contract types — source of truth (types.ts, index.ts)
    renderer/               # three.js + VRM (index.ts, emotion-resolver.ts, motion-controller.ts)
    io/                     # I/O layer (chat-client.ts, tts-pipeline.ts, stt-vad.ts, os-context.ts, etc.)
    dispatcher/             # Event bus + classify→guardrail→route
    ambient/tier1.ts        # Blink / idle sway / breath (backend-independent)
    config/                 # Config load + validate + reactive store + hot-reload
    styles.css
  src-tauri/
    tauri.conf.json         # Transparent always-on-top pet window
    src/                    # Rust: lib.rs, main.rs, drag.rs, screenshot.rs, os_event_watcher/ (mod·macos·windows)
  docs/                     # Design source of truth
```

## Hermes Integration

Chat and STT use the **OpenAI-compatible API**; TTS depends on `tts_provider` (irodori is not OpenAI-compatible) and the broker is an MCP. Separate processes, all swappable via config:

- **chat → Hermes Agent** `localhost:8643` `/v1/responses`
- **STT →** `localhost:5517` `/audio/transcriptions`
- **TTS →** provider-selected via `tts_provider` (default `irodori`): `irodori` → irodori_TTS `irodori_base_url` (`localhost:8091`) `/synthesize` (NOT OpenAI-compatible, reference-voice based, per-speaker voices in `irodori_voices`); `openai` → OpenAI-compatible `/audio/speech` at `tts_base_url` (`localhost:8092`)
- **Expression Broker** (config-driven) `broker_base_url` (`localhost:3201/mcp`, streamable-http MCP) — YUI publishes renderable emotion/motion/emotion_text vocabulary, the agent reads it (publish skipped if unset)

**Control signals** are delivered as server-side `generate_express` tool-calls in the `/v1/responses` stream. Arguments are flat: `{ emotion_id?, motion_id?, emotion_text? }` — no `should_speak` (**D-NO-SPEAK-GATE**); `emotion_text` is a per-provider TTS voice tag whose renderable vocabulary is published by the Expression Broker (irodori = emoji set, openai-compatible/fishspeech = free text), which the agent learns via the broker. Speech text is a separate assistant text stream (`response.output_text.delta`). `function_call` items are excluded from final `output[]` — must be captured during streaming. The renderable emotion/motion vocabulary is brokered by the Expression Broker MCP; the `generate_express` cue contract handed to the backend agent lives in [`docs/backend_agent_broker_interaction.md`](docs/backend_agent_broker_interaction.md).

## Key Docs

> **Code is the source of truth.** Client behavior (how responses are parsed and rendered), the TS contract shapes (`src/contract/types.ts`), and the config schemas (`configs/*.json`) are authoritative — read the code, not a prose mirror. The docs below are the few things the code cannot state for itself: the contract handed to the backend agent, and human-facing catalogs/conventions.

- **`docs/backend_agent_broker_interaction.md`** — the `generate_express` cue contract handed to the backend agent (tool args, streaming shape, per-sentence one-shot cue rules)
- **`docs/motions.md`** — Motion catalog: every `configs/motions.json` id with description, playback policy, and source clip
- **`docs/tts_emotion/`** — per-provider `emotion_text` voice-tag vocabulary rules
- **`docs/logging.md`** — Logging convention: message format, namespaces, level semantics (TS + Rust)
- **`src/contract/types.ts`** — TS contract shapes (Emotion / Motion / Control envelope / Input context / Endpoints)

## Build / Run

```bash
pnpm install
pnpm dev                    # Vite dev server (fixed port 1420) — browser only
pnpm tauri dev              # Tauri app (fixed port 1420, transparent pet window)
pnpm dev:auto               # Vite dev server, browser only — auto-picks a free port from 1420 up (or honors YUI_DEV_PORT)
pnpm tauri:dev              # Tauri app — auto-picks a free port from 1420 up (or honors YUI_DEV_PORT); enables concurrent worktrees
pnpm build                  # tsc + vite build
pnpm test                   # vitest run
pnpm test:watch             # vitest watch
pnpm lint                   # biome check (format + lint)
pnpm lint:fix               # biome check --write (apply safe fixes)
pnpm tauri build            # Native bundle
cd src-tauri && cargo check # Rust compile check
cd src-tauri && cargo test  # Rust unit tests
```

## Logs

Frontend (`src/logger.ts` → `[YUI][namespace] …`) and Rust (`log` crate) lines are written to per-day files `YUI_YYYY-MM-DD.log`, rotated at midnight in the `YUI_LOG_TZ` timezone and retained 14 days (older dated files are pruned on rotation). Dev (`pnpm tauri dev`): `<repo>/logs/` (gitignored) — tail with `tail -f logs/*.log`. Release (macOS): `~/Library/Logs/com.yui.desktop/`. Levels: dev `debug`, release `warn`; override frontend via `VITE_YUI_LOG_LEVEL` (`debug|info|warn|error`).

## Anti-patterns (do not do)

- **No brain in the client.** Judgment / persona state / mode branching belongs to the backend.
- **No inline control tags.** Emotion/motion goes through `generate_express` tool-call arguments only — not inline tokens in speech text.
- **No unverified assumptions.** Consult docs first. If not in docs, record the decision in docs before implementing.
- **No hardcoding.** Endpoints/models/VRM paths/motion sets go in `configs/`.
