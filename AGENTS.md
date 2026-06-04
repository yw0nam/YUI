# YUI — Agent Guide

> **YUI = embodied frontend (head) for Hermes Agent (brain).** Responsible only for VRM character rendering + desktop-pet behavior + I/O surfaces. The brain (MCP · tool calling · search · long-term memory · agent loop · proactivity *judgment*) is **delegated to the backend (Hermes)**. This file is the canonical guide. Read it before touching any code.

## Work Rules (user directive, mandatory)

- **Worktree → PR.** All work must be done in a git worktree and submitted via PR. Direct commits/pushes to `main` are prohibited — exception only when the user explicitly says "directly to main" for lightweight changes like docs/rules.
- **GitHub tracker in English.** Issues, issue comments, and PR titles/bodies must be written in English (in preparation for OSS release). Chat with the user is OK in any language.
- **UI: mock HTML first.** New UI follows the mock-HTML approval gate in [Design Context](#design-context) below.
- **TDD mandatory + per-phase commits mandatory.** Create a separate commit for each of the 3 TDD phases. Do not bundle the entire implementation into a single commit.
  1. **`test: ...`** — Write failing tests (`it.todo` → real assertions, `pnpm test` is red)
  2. **`feat: ...`** — Implementation that passes the tests. **Splitting `feat` into multiple commits is strongly recommended** — commit for each logically independent unit (one function, one branch, etc.), keeping `pnpm test` green at every checkpoint.
  3. **`refactor: ...`** — Clean up without changing behavior (keep green, only when needed)
  `pnpm test` / `cargo test` are PR gates — new features without tests cannot be merged.
- **Sub-agent-based development.** Implementation work is delegated to specialist agents listed in [Sub-agent Roster](#sub-agent-roster) below. **The main agent (talking with the user) does not implement** — it focuses exclusively on requirements clarification, task delegation, output integration, verification, and orchestration.

## Sub-agent Roster

Specialist agents the main agent can delegate to. Each agent must not touch anything outside its own responsibility boundary.

| Agent | Model | Rationale | Responsibility | Key Outputs |
|---|---|---|---|---|
| **Renderer Agent** | `opus` | 3D render pipeline + VRM state machine — requires multi-step reasoning | `src/renderer/` — three.js/VRM load, expressions · motion · lipsync | `renderer/index.ts`, VRM expression tests |
| **Dispatcher Agent** | `opus` | TC-01~15 state machine + guardrail logic — highest logical complexity | `src/dispatcher/` — event-bus, classify→guardrail→route, TC-01~15 | dispatcher logic, `tests/dispatcher/scenarios.test.ts` |
| **IO / Chat Agent** | `sonnet` | SSE stream parsing + protocol implementation — moderate complexity | `src/io/chat-client.ts` — Responses API SSE parser, `express` tool-call capture | SSE parsing logic, stream unit tests |
| **IO / Audio Agent** | `sonnet` | TTS ordering guarantees · concurrency — moderate complexity | `src/io/tts-pipeline.ts` + `stt-vad.ts` — TTS queue · ordering, VAD→STT | audio pipeline, ordering contract tests |
| **Tauri / Rust Agent** | `sonnet` | Rust + IPC contract — language expertise required, limited scope | `src-tauri/` — os_event_watcher, IPC serialization contract, `cargo test` | Rust unit tests, IPC event contract |
| **Contract / Schema Agent** | `sonnet` | Type↔docs sync judgment — mechanical but requires consistency review | `src/contract/types.ts` ↔ `docs/contract.md` sync, `express_tool.schema.json` validation | type consistency tests, JSON schema validation |
| **Test Writer Agent** | `sonnet` | Designing what to test — judgment-heavy, not purely mechanical writing | TDD first — write failing tests (`it.todo` → real assertions) before implementation | `.test.ts` / `_test.rs` files |
| **UI / Mock Agent** | `sonnet` | Design token interpretation + HTML composition — creative but rule-bounded | mock HTML authoring, DESIGN.md token compliance, impeccable pass | self-contained mock HTML file |
| **Config Agent** | `haiku` | JSON load/validation — mechanical work with clear rules | `configs/*.json` loader, hot-reload (`config/load.ts`), schema validation | configs validity tests |
| **Ambient Agent** | `haiku` | Timer-based simple animation — low reasoning depth | `src/ambient/tier1.ts` — blink/idle sway/breath (backend-independent autonomous behavior) | ambient timing/state tests |
| **Docs Agent** | `haiku` | Text sync of existing decisions — no new decisions, transformation work | `docs/` updates — contract.md · prd.md · decision log D-* sync | decision record updates in docs |

### Main Agent Role (user ↔ sub-agent bridge)

The main agent focuses exclusively on:

1. **Requirements clarification** — understand user intent and define work scope
2. **Task delegation** — distribute work to appropriate sub-agents (ensure Test Writer → implementation Agent ordering)
3. **Integration verification** — confirm `pnpm test` + `cargo test` + type check (`pnpm build`) pass
4. **Sanity testing** — build passes, no type errors, no contract (contract.md) violations
5. **Orchestration** — manage task ordering and dependencies, coordinate PR gates

## Core Principle: firing ≠ judgment

The client is responsible only for **when a candidate event occurs (firing)**. **Whether to speak / what to say (judgment)** belongs to the backend. The dispatcher enforces this boundary — tier 2/3 events fire only through a backend call, and if the backend returns `should_speak:false` via the `express` tool-call, the client silently drops it.
→ No brain (mode branching · persona state · judgment) lives in the client.

## Design Context

Before any UI/visual work, read [`PRODUCT.md`](PRODUCT.md) (strategy) + [`DESIGN.md`](DESIGN.md) (visual, SEED). The impeccable skill (`/impeccable`) uses these two as its canonical source.

> **Workflow (mandatory, user directive):** When building new UI — ① first create a **standalone mock HTML** (self-contained single file, temporary) and show it to the user (preview/screenshot) for visual approval, then ② proceed to actual code/architecture design. Do not jump straight to `src/` implementation from a brief text description — mock HTML approval is the gate.

- **Register:** `product` — design *serves* the character/functionality. Not a marketing surface.
- **Core tone:** **invisible-by-default, warm-when-present** — UI recedes by default (character is the protagonist), appears warm and characterful only when strictly necessary.
- **5 principles:** ① character is protagonist, UI is staff ② warm when present ③ firing≠judgment in UI too (render state only, no invention) ④ legible on anything (transparent window) ⑤ calm, non-intrusive (respect reduced-motion).
- **Visual (DESIGN.md SEED, "The Hearthlight"):** Restrained palette + amber accent ≤10% (10% Warmth Rule), humanist warm sans, floating surfaces self-scrimmed for legibility on any background (Legible-on-Anything), single Float shadow layer, Responsive motion.
- **Prohibited:** SaaS chatbot widget / messenger UI / retro mascot speech bubbles / decorative glass / side-stripe border / gradient text.

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | tauri 2.11.x, CLI 2.11.x |
| Build / dev server | Vite | 8.x (port **1420** fixed) |
| Language | TypeScript | 6.x (bundler mode, `noEmit`) |
| Render | three.js | 0.180.x |
| VRM / motion | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| Voice | `@ricky0123/vad-web` (Silero+ONNX) | 0.0.x (used in F3) |

## Directory Map

```
YUI/
  index.html              # Vite entry (#app mount → src/main.ts)
  vite.config.ts          # Tauri convention: port 1420, strictPort, host 127.0.0.1
  configs/                # config-driven (no hardcoding). Runtime-loaded.
    endpoints.json          # chat/stt/tts base url (contract.md §Endpoint)
    emotion_registry.json   # emotion id → vrm_expression + fallback (contract.md §1)
    emotion_tts_prefix.json # emotion → TTS prefix. ⚠ TBD stub — do not invent tokens (D-EMOTION-DUAL)
    motions.json            # MVP 5-entry semantic registry: idle(×5 variants)/drag/happy/laughing/shy_point (contract.md §2, D-MOTION-VARIANTS)
  public/
    motions/              # VRMA motion assets (git-tracked, ~2.4MB). Vite serves at /motions/<id>.vrma.
                          # idle_01~idle_05.vrma · drag.vrma · happy.vrma · laughing.vrma · shy_point.vrma
  motion-preview.html     # dev motion-preview inspector (Vite separate entry, screenshot-verification surface — NOT in Tauri pet window).
                          # MOTION 섹션: VRMA 선택/재생/crossfade controls. EMOTION 섹션: 10종 emotion 버튼
                          # + intensity slider + transition_ms slider + explicit-neutral/hold-null 버튼.
  src/
    dev/                  # dev-only tooling (not bundled in production)
      motion-preview.ts     # motion-preview.html logic (play/crossfade controls, VRMA selector)
      motion-preview.css    # motion-preview UI styles
    main.ts               # bootstrap (placeholder, actual assembly in M1)
    contract/             # TS types from docs/contract.md §1~§4 (source of truth = contract.md)
      types.ts              # EmotionId/EmotionSignal/MotionSignal/MotionRegistryEntry/
                            # ExpressArgs/ControlEnvelope/InputContext/ScreenSource/EndpointsConfig
      index.ts              # re-export barrel
    renderer/
      index.ts              # three.js + VRM load/expression/motion + amplitude lipsync (F1).
                            # setEmotion(#6) 구현됨: EmotionResolver.resolve → per-frame crossfade
                            # (stepEmotion, vrm.update 직전 weight lerp). setEmotion(null) = NO-OP
                            # (hold previous). emotionRegistry 주입: RendererOptions.emotionRegistry /
                            # setEmotionRegistry(). VRM 핫스왑마다 hasExpression 술어 + resolver 재생성.
                            # playMotion(#5) 구현됨: VRMAnimationLoaderPlugin + createVRMAnimationClip,
                            # AnimationMixer (per VRM, vrm.update 직전), crossfade(fade_ms),
                            # LoopOnce+clampWhenFinished (oneshot), oneshot→previous ambient 복귀,
                            # VRM 로드 시 idle baseline 자동 재생.
                            # 미구현: applyDirective(#16) / 립싱크(#15).
      emotion-resolver.ts   # pure emotion state resolver (NO three.js). registry fallback 체인 탐색 +
                            # existence-aware fallback(hasExpression 술어 주입). resolve()는 항상
                            # non-null ResolvedEmotion — 미등록/chain 소진 시 terminal "neutral".
                            # intensity clamp/warn, transition_ms default 250.
                            # unit-tested (tests/renderer/emotion-resolver.test.ts).
      motion-controller.ts  # pure motion state machine (NO three.js). resolve/variant-pick/clamp,
                            # request(interrupt/queue/ignore), finish(oneshot→return), commit/current.
                            # unit-tested (tests/renderer/motion-controller.test.ts).
    io/
      chat-client.ts        # Responses API SSE parser — express + text stream (F6)
      tts-pipeline.ts       # text stream→queue→sentence-split→TTS(:8092)→ordered playback→lipsync (F4)
      stt-vad.ts            # VAD(@ricky0123/vad-web)→STT(:5517) (F3)
    dispatcher/
      event-bus.ts          # priority queue (event-dispatcher.md §4)
      dispatcher.ts         # classify → guardrail → route (event-dispatcher.md §5/§7)
      guardrails.ts         # DND / debounce / rate-limit (event-dispatcher.md §6)
    ambient/tier1.ts      # blink / idle sway / breath (backend-independent, F5 / §8)
    config/load.ts        # configs/*.json load + validate (fail-loud) + SecretProvider (F8)
    config/store.ts       # reactive snapshot + polling hot-reload (subscribe / onError) (F8)
    config/index.ts       # config barrel
    styles.css
  src-tauri/
    tauri.conf.json       # transparent · always-on-top pet window. identifier com.yui.desktop.
                          # macOSPrivateApi=true (required for transparency) → Cargo tauri feature macos-private-api pair.
                          # ⚠ security.csp=null (dev convenience). TODO: harden before OSS.
    Cargo.toml            # tauri features=["macos-private-api"]
    src/
      lib.rs                # run() — Tauri Builder. mod os_event_watcher.
      main.rs
      os_event_watcher.rs   # OS API access stub: active app / OS idle / fullscreen / camera →
                            # tauri://event "os_event" emit (event-dispatcher.md §1/§3.3/§10). Actual calls in M1.
  docs/                   # design source of truth (see "Key Decision Pointers" below)
```

> Most `src/` modules are **build-passing placeholders** (type exports + signatures + TODOs) — feature implementation starts at M1+.
> **Implemented (feat/add_motion):** `renderer/motion-controller.ts` (pure state machine, unit-tested) + `renderer/index.ts` `playMotion` (#5) GPU path (screenshot-verified via `motion-preview.html`).
> **Implemented (feat/emotion-expression #6):** `renderer/emotion-resolver.ts` (pure, existence-aware fallback, unit-tested) + `renderer/index.ts` `setEmotion` per-frame crossfade before vrm.update, hold-on-null, dev motion-preview EMOTION section.

## Hermes Integration Summary

All transport layers use the **OpenAI-compatible API** (concept.md §1). The three base URLs are **separate processes** (swappable via config):

- **chat → Hermes `/v1/responses` (`localhost:8643`, SSH tunnel).** `previous_response_id` server-side state + Responses event streaming. Fallback: `/v1/chat/completions`.
- **STT → `localhost:5517` `/audio/transcriptions`** (independent ASR, unrelated to Hermes).
- **TTS → `localhost:8092` `/audio/speech`** (independent TTS, unrelated to Hermes).

**Control signal transport = server-side `express` tool-call** (D-TRANSPORT):
Among `function_call` items in the `/v1/responses` stream, **name == `express`** has arguments =
`{ emotion?, motion?, should_speak? }`. **Speech text is a separate assistant text stream, not a tool-call**
(`response.output_text.delta`, D-SPEECH). Both `express` and `emotion` are **optional** — turns without them maintain motion idle + previous expression. ⚠ `function_call` is excluded from the final `output[]`, so it must be captured **during streaming** (at `...arguments.done`). SSE format source: `docs/openai_response_sdk/sse-event-format.md`.

**`tool_status`** is derived by the client observing `function_call` items from Hermes native tools (web_search/terminal/browser etc.) — not `express`. **`rich_content`** is P2 — MVP renders speech text as inline markdown.

## Key Decision Pointers (docs/)

- **`docs/contract.md`** — **source of truth** for TS types. §1 Emotion / §2 Motion / §3 Control envelope / §4 Input context / §Endpoint. `src/contract/types.ts` is derived from here. Schema changes start here.
- **`docs/prd.md`** — F1~F9 + **decision log D-*** (§5): D-TRANSPORT / D-SPEECH / D-TTS-PIPELINE / D-EMOTION-DUAL. Milestones M0~M4 (§6).
- **`docs/event-dispatcher.md`** — component boundary (§1), source triggers (§3), event bus (§4), routing (§5), guardrails (§6), backend callers B1~B5 (§7), tier1 ambient (§8), Rust↔Webview handoff (§10).
- **`docs/concept.md`** — big picture + non-goals (§5, Hermes delegation list).
- **`docs/alignment-report.md`** — Phase 0 cross-check record (V1~V8 verification, OI decisions).
- **`docs/openai_response_sdk/`** — Hermes Responses SSE event format (basis for chat-client parsing).

## Build / Run

```bash
pnpm install            # install dependencies
pnpm dev                # Vite dev server (port 1420) — browser only (no shell)
pnpm tauri dev          # Tauri app (transparent pet window) — pnpm dev auto-started via beforeDevCommand
pnpm build              # tsc (type check) + vite build → dist/
pnpm test               # vitest run — TS unit/integration (test files excluded from production tsc)
pnpm test:watch         # vitest watch mode
pnpm tauri build        # native bundle
pnpm tauri info         # toolchain/version info
cd src-tauri && cargo check   # Rust compile check
cd src-tauri && cargo test    # Rust unit tests (os_event IPC serialization contract etc.)
```

> Rendering/UI verified via screenshot in browser with `pnpm dev` (AI visual loop); native window layer separated in Tauri.

**Test structure:** Harness is **vitest** (TS) + **cargo test** (Rust), E2E is future **playwright** (`docs/event-dispatcher.tests.md`). TS tests are co-located at `src/**/*.test.ts` + scenarios at `tests/`. Tests that lock artifacts/contracts take priority — `configs/*.json` · `express_tool.schema.json` conformance, dispatcher TC-01~15 are queued as `it.todo` in `tests/dispatcher/scenarios.test.ts`. CI (`.github/workflows/ci.yml`) runs `pnpm test` + `cargo test` on every PR.

> **Worktree verification:** a fresh `git worktree` has no `node_modules` and no gitignored VRM assets. Motion VRMA assets (`public/motions/*.vrma`) are **git-tracked** — no symlink needed. Only the VRM model (`resources/vrms/carlotta.vrm`, gitignored) requires a symlink: `ln -s ../YUI/node_modules node_modules`, `ln -s ../../YUI/resources/vrms resources/vrms`. Run dev on an alt port (`npm run dev -- --port {random_port}`; 1420 is held by the main checkout via `strictPort`).

## Anti-patterns (do not do)

- **No brain in the client.** Judgment (whether/what to speak) · persona state · mode branching belongs to the backend. Client is firing + render only.
- **No inline control tags.** Do not embed emotion/motion as inline tokens like `[happy]` inside speech text — streaming token splits break them. Control goes only through `express` tool-call arguments.
- **No unverified assumptions.** Do not make decisions with "probably this" — consult docs (contract/prd/event-dispatcher/alignment) first. If not in docs, cross-check with web/context7 then record in docs first. (Precedent: an unverified assumption in Phase 0 flipped an endpoint — alignment-report §2.)
- **No invented emotion_tts_prefix tokens.** The prefix format must be confirmed with the user at TTS implementation time (D-EMOTION-DUAL, currently TBD).
- **No hardcoding.** Endpoints/models/VRM paths/motion sets go in `configs/`. API keys at OSS stage go in the OS keychain.
- **No over-implementation.** At scaffold/placeholder stage, the goal is a passing build. Features belong in their respective milestone.
