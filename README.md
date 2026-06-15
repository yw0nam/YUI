# YUI

> Embodied VRM frontend (head) for the Hermes Agent (brain).

## What it is

YUI is a VRM desktop-pet that renders the persona supplied by the Hermes Agent
backend. It is the **head** — VRM character rendering, desktop-pet behavior, and
I/O surfaces (text · voice · screen) — while all judgment, persona, memory, and
the agent loop are delegated to Hermes (the **brain**). Its UI is
invisible-by-default and warm-when-present (see [`PRODUCT.md`](PRODUCT.md)): the
character owns the stage, and chrome surfaces only when it has something to say,
then steps back.

## Architecture

The head/brain split rests on one principle: **firing ≠ judgment**. The client
*fires* candidate events (timer · idle-watcher · OS-event-watcher · user input);
the backend decides whether and what to speak. Silence is simply empty speech
text, and the client renders whatever text arrives — no brain lives in the
client.

Control signals ride server-side `generate_express` tool-calls on the
`/v1/responses` stream, with flat arguments `{ emotion_id?, motion_id?,
emotion_text? }` (`emotion_text` is a per-provider TTS voice tag whose
renderable vocabulary is published by the Expression Broker — emoji set for
irodori, free text for openai-compatible/fishspeech — which the agent learns
via the broker). Speech
text flows as a separate assistant text stream (`response.output_text.delta`),
not inside the tool-call. The renderable emotion/motion vocabulary is brokered
by the Expression Broker MCP; the `generate_express` cue contract handed to the
backend agent lives in [`docs/backend_agent_broker_interaction.md`](docs/backend_agent_broker_interaction.md).

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | 2.11.x |
| Build / dev server | Vite (dev port `YUI_DEV_PORT`, default **1420**; auto-port launchers per worktree) | 8.x |
| Language | TypeScript (bundler mode, `noEmit`) | 6.x |
| Render | three.js | 0.180.x |
| VRM / motion | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| Voice | `@ricky0123/vad-web` (Silero + ONNX) | 0.0.x |

## Hermes integration

Chat and STT use the OpenAI-compatible API; TTS and the Expression Broker
depend on the selected provider. All are separate, config-swappable processes:

- **chat → Hermes Agent** — `localhost:8643` `/v1/responses`
- **STT** — `localhost:5517` `/audio/transcriptions`
- **TTS** — provider-selected via `tts_provider` (default `irodori`):
  - `irodori` — irodori_TTS at `irodori_base_url` (`localhost:8091`) `/synthesize`,
    not OpenAI-compatible, reference-voice based (per-speaker voices in `irodori_voices`)
  - `openai` — OpenAI-compatible `/audio/speech` at `tts_base_url` (`localhost:8092`)
- **Expression Broker** (config-driven) — `broker_base_url` (`localhost:3201/mcp`,
  streamable-http MCP); YUI publishes the renderable emotion/motion/emotion_text
  vocabulary, the agent reads it (publish skipped if unset)

The client calls STT and TTS directly (they do not route through Hermes). The
base URLs all live in `configs/endpoints.json` — no hardcoding.

## Project structure

```
YUI/
  index.html              # Vite entry
  vite.config.ts          # dev port YUI_DEV_PORT|1420, strictPort, host 127.0.0.1
  scripts/                # Dev launchers: dev-port.mjs (resolver) + tauri-dev.mjs / dev-auto.mjs (auto-port)
  configs/                # Runtime-loaded config (endpoints, emotion + motion registries, avatar, per-provider emotion_text vocab)
  public/motions/         # VRMA motion assets
  src/
    main.ts               # Bootstrap wiring
    contract/             # TS contract types — source of truth
    renderer/             # three.js + VRM (load, emotion resolver, motion controller, lipsync)
    io/                   # chat-client, tts-pipeline, stt-vad, os-context, screenshot, broker-client, irodori-synth
    dispatcher/           # Event bus + classify → route spine
    ambient/              # Tier-1 blink / sway / breath (backend-independent)
    config/               # Config load + validate + reactive store + hot-reload
    ui/                   # Interaction surfaces (speech bubble, input, tool-status)
  src-tauri/
    src/
      lib.rs main.rs      # Tauri app + IPC
      drag.rs             # OS-native window drag
      screenshot.rs       # Monitor capture
      os_event_watcher/   # mod · macos · windows — active app / idle / fullscreen polling
  docs/                   # Backend-handoff contract + human-facing catalogs
```

## Getting started

### Prerequisites

- Node + [pnpm](https://pnpm.io/)
- Rust + the [Tauri v2](https://v2.tauri.app/start/prerequisites/) toolchain

### Commands

```bash
pnpm install
pnpm dev                    # Vite dev server (fixed port 1420) — browser only
pnpm tauri dev              # Tauri app (fixed port 1420, transparent pet window)
pnpm dev:auto               # Vite dev server, browser only — auto-picks a free port from 1420 up (or honors YUI_DEV_PORT)
pnpm tauri:dev              # Tauri app — auto-picks a free port from 1420 up (or honors YUI_DEV_PORT); enables concurrent worktrees
pnpm build                  # tsc + vite build
pnpm test                   # vitest run
cd src-tauri && cargo test  # Rust unit tests
```

### Runtime assets

The VRM model (`resources/vrms/*.vrm`) and `.env.local`
(`VITE_YUI_CHAT_KEY`) are gitignored, so a fresh checkout or worktree must
provide them itself — link/copy them from an existing checkout before running.
Vite serves `/vrms/*` from `resources/vrms`; without the VRM the model 404s and
without `.env.local` chat auth is absent.

## Logs

Frontend and Rust logs are merged into a single file via `tauri-plugin-log`.
Frontend lines come from a central logger (`src/logger.ts` —
`createLogger("namespace")`, formatted `[YUI][namespace] …`); Rust lines use the
`log` crate macros. Both streams write to the same file.

- **Dev** (`pnpm tauri dev`) — `<repo>/logs/` (gitignored). Tail with:

  ```bash
  tail -f logs/*.log
  ```

- **Release** (built app, macOS) — `~/Library/Logs/com.yui.desktop/`.

Default level is `debug` in dev and `warn` in release. Override the frontend
level with the `VITE_YUI_LOG_LEVEL` env var (`debug` · `info` · `warn` · `error`).

## Documentation

- [`AGENTS.md`](AGENTS.md) — canonical agent guide (work rules, roster, stack, layout)
- [`PRODUCT.md`](PRODUCT.md) / [`DESIGN.md`](DESIGN.md) — product register + design system
- [`docs/backend_agent_broker_interaction.md`](docs/backend_agent_broker_interaction.md) — `generate_express` cue contract handed to the backend agent
- [`docs/motions.md`](docs/motions.md) — motion catalog (every `configs/motions.json` id, playback policy, source clip)
- [`docs/tts_emotion/`](docs/tts_emotion/) — per-provider `emotion_text` voice-tag vocabulary
- [`docs/logging.md`](docs/logging.md) — logging convention (format, namespaces, levels)
- [`src/contract/types.ts`](src/contract/types.ts) — TS contract shapes (emotion · motion · control envelope · input context · endpoints)
- [`CHANGELOG.md`](CHANGELOG.md) — landed work

## Credits

The motion assets (`public/motions/*.vrma`) come from three sources.

Most clips are extracted from the
[Mate Engine](https://github.com/shinyflvre/Mate-Engine) project by Shiny.
They are used under Mate Engine's non-commercial terms: free for personal,
study, and non-revenue use with attribution to Shiny; commercial use requires
separate permission from Shiny.

The `sulk` clip (`suneru.vrma`) is from necocoya's
[EmoteSet_Free_v130](https://booth.pm/ja/items/1065089) (Unity Humanoid
`06_suneru`, 拗ね = sulk/pout), attribution to necocoya. Modification/conversion
and bundling-with-credit are permitted; standalone resale of the raw file is
prohibited.

The `falling` and `landing` clips (`falling_loop.vrma`, `landing.vrma`) are
original works authored in Blender by the project author.

## Status

YUI renders 10 emotions (existence-aware fallback) and 15 motions (idle, drag,
falling, landing, happy, laugh, embarrassed, sheepish, calm, peek, sleeping,
sulk, sit, window_sit, dance) with a Tier-1 ambient layer
(blink · sway · breath · look-around) and
amplitude-based lipsync. The dispatcher fires Tier-1 ambient client-side and
Tier-2 co-working proactive utterances (presence + 10-min cadence, settings
toggle default ON) through DND/debounce/rate-limit guards to the backend.
Chat, STT, TTS, and the Expression Broker are wired. Co-working is inert on
Windows, where `os_idle_ms` is unavailable.
