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
the backend decides whether and what to speak. There is **no `should_speak`
flag** (D-NO-SPEAK-GATE) — silence is simply empty speech text, and the client
renders whatever text arrives.

Control signals ride server-side `generate_express` tool-calls on the
`/v1/responses` stream, with flat arguments `{ emotion_id?, motion_id?,
emotion_text? }` (`emotion_text` is a free-text FishSpeech voice tag). Speech
text flows as a separate assistant text stream (`response.output_text.delta`),
not inside the tool-call. The renderable emotion/motion vocabulary is brokered
by the Expression Broker MCP (see [`docs/expression-broker-mcp.md`](docs/expression-broker-mcp.md)).

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | 2.11.x |
| Build / dev server | Vite (port **1420** fixed) | 8.x |
| Language | TypeScript (bundler mode, `noEmit`) | 6.x |
| Render | three.js | 0.180.x |
| VRM / motion | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| Voice | `@ricky0123/vad-web` (Silero + ONNX) | 0.0.x |

## Hermes integration

All transport uses the OpenAI-compatible API across three separate,
config-swappable processes:

- **chat → Hermes Agent** — `localhost:8643` `/v1/responses`
- **STT** — `localhost:5517` `/audio/transcriptions`
- **TTS** — `localhost:8092` `/audio/speech`

The client calls STT and TTS directly (they do not route through Hermes). All
three base URLs live in `configs/endpoints.json` — no hardcoding.

## Project structure

```
YUI/
  index.html              # Vite entry
  vite.config.ts          # port 1420, strictPort, host 127.0.0.1
  configs/                # Runtime-loaded config (endpoints, emotion/motion registry, express tool schema)
  public/motions/         # VRMA motion assets
  src/
    main.ts               # Bootstrap wiring
    contract/             # TS types from docs/contract.md
    renderer/             # three.js + VRM (load, emotion resolver, motion controller, lipsync)
    io/                   # chat-client, tts-pipeline, stt-vad, os-context, screenshot, transports
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
  docs/                   # Design + contract source of truth
```

## Getting started

### Prerequisites

- Node + [pnpm](https://pnpm.io/)
- Rust + the [Tauri v2](https://v2.tauri.app/start/prerequisites/) toolchain

### Commands

```bash
pnpm install
pnpm dev                    # Vite dev server (port 1420) — browser only
pnpm tauri dev              # Tauri app (transparent pet window)
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
- [`docs/concept.md`](docs/concept.md) — big picture + non-goals
- [`docs/prd.md`](docs/prd.md) — features + decision log + milestones
- [`docs/contract.md`](docs/contract.md) — YUI ↔ Hermes contract (emotion · motion · control envelope · input context · endpoints)
- [`docs/event-dispatcher.md`](docs/event-dispatcher.md) — dispatcher component design
- [`docs/expression-broker-mcp.md`](docs/expression-broker-mcp.md) — Expression Broker MCP
- [`CHANGELOG.md`](CHANGELOG.md) — landed work

## Status

Pre-alpha — render + I/O + dispatcher spine landed; proactivity (Tier 2) in progress.
