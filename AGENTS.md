# YUI — Agent Guide

> **YUI = embodied frontend (head) for Hermes Agent (brain).** VRM character rendering + desktop-pet behavior + I/O surfaces only. The brain (judgment · persona · agent loop) is **delegated to the backend (Hermes)**. This file is the canonical guide. Read it before touching any code. 

## Before start it

Load Karpathy Guideline.

## Work Rules (user directive, mandatory)

- **Worktree → PR.** All work must be done in a git worktree and submitted via PR. Direct commits/pushes to `main` are prohibited — exception only when the user explicitly says "directly to main" for lightweight changes like docs/rules.
  - **New-worktree setup (mandatory).** Gitignored runtime assets do not carry into a fresh worktree, so before running/verifying the app, link them from the main checkout: symlink the VRM — `ln -sf <main>/resources/vrms/carlotta.vrm <worktree>/resources/vrms/carlotta.vrm` (Vite serves `/vrms/*` from `resources/vrms`) — and copy `.env.local` (`VITE_YUI_CHAT_KEY`). Skipping this makes the VRM 404 and chat auth absent; both stay gitignored so they never touch the PR.
- **GitHub tracker in English.** Issues, issue comments, and PR titles/bodies must be written in English. Chat with the user is OK in any language.
- **UI: review existing → mock HTML → implement.** Before designing any UI, always read existing surfaces (`src/ui/`, `DESIGN.md` tokens, `PRODUCT.md` principles) to align style and patterns. Then create a standalone mock HTML for visual approval, then proceed to implementation.
- **TDD mandatory + per-phase commits mandatory.** Create a separate commit for each of the 3 TDD phases.
  1. **`test: ...`** — Write failing tests (`pnpm test` is red)
  2. **`feat: ...`** — Implementation that passes the tests. Split per logically independent unit.
  3. **`refactor: ...`** — Clean up without changing behavior (only when needed)
  `pnpm test` / `cargo test` are PR gates — new features without tests cannot be merged.
- **Sub-agent-based development.** Implementation is delegated to specialist agents in [Sub-agent Roster](#sub-agent-roster). **The main agent does not implement** — it focuses on requirements clarification, task delegation, verification, and orchestration.
- **Verify what you can verify before asking the user.** Anything observable (UI rendering / DOM state / logs) — verify yourself. Ask the user to confirm **only** things that genuinely require them (audio playback, physical input feel).
- **Comments: minimal, present-tense only.** No decision-history / spec-citation / issue-number breadcrumbs in code comments. Comment only what the code cannot say itself, in one line.

## Sub-agent Roster

| Agent | Model | Responsibility |
|---|---|---|
| **Renderer Agent** | `opus` | `src/renderer/` — three.js/VRM load, expressions, motion, lipsync |
| **Dispatcher Agent** | `opus` | `src/dispatcher/` — event-bus, classify→guardrail→route |
| **IO / Chat Agent** | `sonnet` | `src/io/chat-client.ts` — Responses API SSE parser, `generate_express` tool-call capture |
| **IO / Audio Agent** | `sonnet` | `src/io/tts-pipeline.ts` + `stt-vad.ts` — TTS queue/ordering, VAD→STT |
| **Tauri / Rust Agent** | `sonnet` | `src-tauri/` — os_event_watcher, IPC contract, `cargo test` |
| **Contract / Schema Agent** | `sonnet` | `src/contract/types.ts` ↔ `docs/contract.md` sync, JSON schema validation |
| **Test Writer Agent** | `sonnet` | TDD first — write failing tests before implementation |
| **UI / Mock Agent** | `sonnet` | Mock HTML authoring, DESIGN.md token compliance |
| **Config Agent** | `haiku` | `configs/*.json` loader, schema validation |
| **Ambient Agent** | `haiku` | `src/ambient/tier1.ts` — blink/idle sway/breath |
| **Docs Agent** | `haiku` | `docs/` updates — contract.md, prd.md sync |

### Main Agent Role

1. **Requirements clarification** — understand user intent and define work scope
2. **Task delegation** — distribute work to sub-agents (ensure Test Writer → implementation ordering)
3. **Integration verification** — confirm `pnpm test` + `cargo test` + `pnpm build` pass
4. **Orchestration** — manage task ordering and dependencies

## Core Principle: firing ≠ judgment

The client handles **firing** (when a candidate event occurs). **Judgment** (whether/what to speak) belongs to the backend. There is no `should_speak` flag (**D-NO-SPEAK-GATE**) — the backend expresses silence by sending no/empty speech text; the client renders whatever text arrives. No brain lives in the client.

## Design Context

Before any UI/visual work, read [`PRODUCT.md`](PRODUCT.md) + [`DESIGN.md`](DESIGN.md). The impeccable skill (`/impeccable`) uses these as its canonical source.

> **Workflow (mandatory):** ① Review existing UI surfaces (`src/ui/`, `DESIGN.md`, `PRODUCT.md`) to align style and patterns, ② Create a **standalone mock HTML** for visual approval, then ③ Proceed to implementation.

- **Register:** `product` — design serves the character, not marketing.
- **Core tone:** **invisible-by-default, warm-when-present.**
- **5 principles:** ① character is protagonist ② warm when present ③ render state only, no invention ④ legible on anything (transparent window) ⑤ calm, non-intrusive (respect reduced-motion).
- **Prohibited:** SaaS chatbot widget / messenger UI / retro mascot speech bubbles / decorative glass / gradient text.

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | tauri 2.11.x |
| Build / dev server | Vite | 8.x (port **1420** fixed) |
| Language | TypeScript | 6.x (bundler mode, `noEmit`) |
| Render | three.js | 0.180.x |
| VRM / motion | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| Voice | `@ricky0123/vad-web` (Silero+ONNX) | 0.0.x |

## Directory Map

```
YUI/
  index.html                # Vite entry
  vite.config.ts            # port 1420, strictPort, host 127.0.0.1
  configs/                  # Runtime-loaded config (no hardcoding)
    endpoints.json            # chat/stt/tts base url
    emotion_registry.json     # emotion id → vrm_expression + fallback
    motions.json              # motion registry
  public/motions/           # VRMA motion assets
  motion-preview.html       # Dev motion/emotion inspector (not in Tauri window)
  src/
    dev/                    # Dev-only tooling (motion-preview.ts, motion-preview.css)
    main.ts                 # Bootstrap wiring
    contract/               # TS types from docs/contract.md (types.ts, index.ts)
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

All transport uses the **OpenAI-compatible API**. Three separate processes (swappable via config):

- **chat → Hermes Agent** `localhost:8643` `/v1/responses`
- **STT →** `localhost:5517` `/audio/transcriptions`
- **TTS →** `localhost:8092` `/audio/speech`

**Control signals** are delivered as server-side `generate_express` tool-calls in the `/v1/responses` stream. Arguments are flat: `{ emotion_id?, motion_id?, emotion_text? }` — no `should_speak` (**D-NO-SPEAK-GATE**); `emotion_text` is a free-text FishSpeech voice tag. Speech text is a separate assistant text stream (`response.output_text.delta`). `function_call` items are excluded from final `output[]` — must be captured during streaming. The renderable emotion/motion vocabulary is brokered by the Expression Broker MCP (`docs/expression-broker-mcp.md`).

## Key Docs

- **`docs/contract.md`** — Source of truth for TS types (Emotion / Motion / Control envelope / Input context / Endpoints)
- **`docs/prd.md`** — Features + decision log + milestones
- **`docs/event-dispatcher.md`** — Dispatcher component design
- **`docs/concept.md`** — Big picture + non-goals

## Build / Run

```bash
pnpm install
pnpm dev                    # Vite dev server (port 1420) — browser only
pnpm tauri dev              # Tauri app (transparent pet window)
pnpm build                  # tsc + vite build
pnpm test                   # vitest run
pnpm test:watch             # vitest watch
pnpm tauri build            # Native bundle
cd src-tauri && cargo check # Rust compile check
cd src-tauri && cargo test  # Rust unit tests
```

## Logs

Frontend (`src/logger.ts` → `[YUI][namespace] …`) and Rust (`log` crate) lines merge into one file via `tauri-plugin-log`. Dev (`pnpm tauri dev`): `<repo>/logs/` (gitignored) — tail with `tail -f logs/*.log`. Release (macOS): `~/Library/Logs/com.yui.desktop/`. Levels: dev `debug`, release `warn`; override frontend via `VITE_YUI_LOG_LEVEL` (`debug|info|warn|error`).

## Anti-patterns (do not do)

- **No brain in the client.** Judgment / persona state / mode branching belongs to the backend.
- **No inline control tags.** Emotion/motion goes through `generate_express` tool-call arguments only — not inline tokens in speech text.
- **No unverified assumptions.** Consult docs first. If not in docs, record the decision in docs before implementing.
- **No hardcoding.** Endpoints/models/VRM paths/motion sets go in `configs/`.
