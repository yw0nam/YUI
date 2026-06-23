<div align="center">

# YUI

**A VRM desktop companion that borrows its mind from a real agent.**

*Invisible by default, warm when present.*

[![CI](https://github.com/yw0nam/YUI/actions/workflows/ci.yml/badge.svg)](https://github.com/yw0nam/YUI/actions/workflows/ci.yml)
![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![three.js](https://img.shields.io/badge/three.js-000000?logo=three.js&logoColor=white)

<img src="docs/public/yui-hero.png" alt="YUI — a VRM character living on the desktop as a transparent, always-on-top overlay, with speech bubble, settings panel, and input bar" width="820">

</div>

## What it is

YUI is a VRM character that lives on your desktop — it renders the body, the
voice, and the on-screen surfaces, and it leaves the thinking to a backend.
It does not ship an embedded model. Instead it talks to the
[Hermes Agent](docs/guide/getting-started.md) (or any backend that speaks the OpenAI Responses
API and honors YUI's expression contract), so the character is exactly as
capable as the agent behind it.

The character owns the screen; chrome stays out of the way and only appears when
there is something to show, then steps back.

## Features

**Agent**
- Plugs into any OpenAI Responses-API backend — no fixed embedded model
- Emotion, motion, and voice cues arrive as structured `generate_express`
  tool-calls on the response stream, never as inline tags in the text
- The Expression Broker (MCP) tells the backend which emotions, motions, and
  voice tags this body can actually perform

**Voice & chat**
- Speech input — Silero VAD + ONNX segment your voice, then an
  OpenAI-compatible endpoint transcribes it
- Speech output — sentence-queued TTS with ordered playback and per-sentence
  voice cues
- Amplitude lipsync drives the mouth from audio, with a user gain slider
- Streaming, markdown-rendered speech bubble that fades in only when she speaks

**Desktop pet**
- Sits on the top edge of a window and detaches when the window moves, closes,
  or gets covered
- OS-native dragging on a transparent, always-on-top, multi-monitor overlay
- Idle liveliness — blink, sway, breathing, and look-around run locally even
  with no backend connected, and respect `prefers-reduced-motion`
- Reads OS context (active app, idle time, fullscreen, optional screenshot) and
  feeds it to the agent each turn

**Rendering & motion**
- VRM 1.0 with hot-swap and GPU cleanup, via three.js + `@pixiv/three-vrm`
- 10 emotions and 15 motions, with a fallback chain for models that lack an
  expression
- Idle and sit cycle through pools of motion clips with smooth transitions
- Camera auto-frames the avatar, with wheel zoom and a pull-back when perched

**Platform**
- UI in English, 日本語, and 한국어, with a persisted locale
- Endpoints, models, VRM paths, and motion sets all live in `configs/` — nothing
  is hardcoded
- macOS-first: full OS-event watching on macOS; Windows is partial
  (`os_idle_ms` is unavailable)

## How it works

YUI is the body; the backend is the mind. The client never decides *what* to
say — it renders whatever text arrives, and silence is just empty text. What the
client does is notice moments worth reacting to (you typing, going idle, an app
coming to focus) and hand them to the agent, which decides whether and how to
respond.

Cues ride alongside the reply. Speech comes through as a normal assistant text
stream, while emotion, motion, and voice tags arrive as `generate_express`
tool-calls with flat arguments `{ emotion_id?, motion_id?, emotion_text? }`.
`emotion_text` is a per-provider TTS voice tag whose vocabulary the Expression
Broker publishes so the agent knows what it can ask for. The full cue contract
handed to the backend lives in [`docs/reference/backend-contract.md`](docs/reference/backend-contract.md).

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | 2.11.x |
| Build / dev server | Vite | 8.x |
| Language | TypeScript | 6.x |
| Render | three.js | 0.180.x |
| VRM / motion | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| Voice | `@ricky0123/vad-web` (Silero + ONNX) | 0.0.x |

## Getting started

**Prerequisites**

- Node + [pnpm](https://pnpm.io/)
- Rust + the [Tauri v2](https://v2.tauri.app/start/prerequisites/) toolchain

**Commands**

```bash
pnpm install
pnpm dev                    # Vite dev server (port 1420), browser only
pnpm tauri dev              # Tauri app (port 1420), transparent pet window
pnpm dev:auto               # browser only, auto-picks a free port from 1420 up
pnpm tauri:dev              # Tauri app, auto-port — lets worktrees run side by side
pnpm build                  # tsc + vite build
pnpm test                   # vitest run
cd src-tauri && cargo test  # Rust unit tests
```

**Runtime assets.** The VRM model (`resources/vrms/*.vrm`) and `.env.local`
(`VITE_YUI_CHAT_KEY`) are gitignored, so a fresh checkout has to supply them —
link or copy them from an existing checkout before running. Without the VRM the
model 404s; without `.env.local` chat auth is absent.

For the backend services and full wiring, see [`docs/guide/getting-started.md`](docs/guide/getting-started.md).

## Backend wiring

Chat and STT use the OpenAI-compatible API; TTS and the Expression Broker depend
on the selected provider. Each is a separate, config-swappable process, and all
base URLs live in `configs/endpoints.json`.

- **Chat → Hermes Agent** — `localhost:8643` `/v1/responses`
- **STT** — `localhost:5517` `/audio/transcriptions`
- **TTS** — selected via `tts_provider` (default `irodori`):
  - `irodori` — irodori_TTS at `localhost:8091` `/synthesize`, reference-voice
    based (per-speaker voices in `irodori_voices`)
  - `openai` — OpenAI-compatible `/audio/speech` at `localhost:8092`
- **Expression Broker** — `localhost:3201/mcp` (streamable-http MCP); YUI
  publishes its emotion/motion/voice vocabulary for the agent to read (skipped
  if unset)

The client calls STT and TTS directly — they do not route through Hermes.

## Project layout

```
YUI/
  configs/                # Runtime config: endpoints, emotion + motion registries, avatar, voice vocab
  public/motions/         # VRMA motion assets
  src/
    contract/             # TS contract types — source of truth
    renderer/             # three.js + VRM: load, emotion resolver, motion controller, lipsync
    io/                   # chat, tts, stt, os-context, screenshot, broker, irodori synth
    dispatcher/           # Event bus + classify → route
    ambient/              # Local idle liveliness (blink / sway / breath)
    config/               # Config load, validate, hot-reload
    ui/                   # Speech bubble, input, tool-status surfaces
  src-tauri/src/
    drag.rs               # OS-native window drag
    screenshot.rs         # Monitor capture
    os_event_watcher/     # Active app / idle / fullscreen polling (macos · windows)
  docs/                   # Backend contract + human-facing catalogs
  Mods/                   # Standalone MCP servers, independent of the app
```

Optional standalone **Mods** — independent MCP servers that extend the backend
agent (e.g. `desktop_control` for macOS screen capture and app launch/quit) —
live under [`Mods/`](Mods/README.md), separate from the app runtime.

## Logs

Frontend and Rust logs merge into one file via `tauri-plugin-log`. Frontend
lines come from `src/logger.ts` (`[YUI][namespace] …`); Rust lines use the `log`
crate.

- **Dev** — `<repo>/logs/` (gitignored). Tail with `tail -f logs/*.log`.
- **Release (macOS)** — `~/Library/Logs/com.yui.desktop/`.

Default level is `debug` in dev and `warn` in release; override the frontend
level with `VITE_YUI_LOG_LEVEL` (`debug` · `info` · `warn` · `error`).

## Documentation

- [`AGENTS.md`](AGENTS.md) — contributor guide (work rules, roster, layout)
- [`PRODUCT.md`](PRODUCT.md) / [`DESIGN.md`](DESIGN.md) — product register + design system
- [`docs/guide/getting-started.md`](docs/guide/getting-started.md) — install and wiring (broker · agent · TTS · STT · VRM)
- [`docs/reference/backend-contract.md`](docs/reference/backend-contract.md) — the `generate_express` cue contract
- [`docs/reference/motions.md`](docs/reference/motions.md) — motion catalog
- [`docs/reference/tts-emotion/`](docs/reference/tts-emotion/) — per-provider `emotion_text` voice tags
- [`docs/reference/logging.md`](docs/reference/logging.md) — logging convention
- [`src/contract/types.ts`](src/contract/types.ts) — TS contract shapes
- [`CHANGELOG.md`](CHANGELOG.md) — landed work

## Credits

The motion assets (`public/motions/*.vrma`) come from three sources.

Most clips are extracted from the
[Mate Engine](https://github.com/shinyflvre/Mate-Engine) project by Shiny, used
under Mate Engine's non-commercial terms: free for personal, study, and
non-revenue use with attribution to Shiny; commercial use requires separate
permission from Shiny.

The `sulk` clip (`suneru.vrma`) is from necocoya's
[EmoteSet_Free_v130](https://booth.pm/ja/items/1065089) (Unity Humanoid
`06_suneru`, 拗ね = sulk/pout), attribution to necocoya. Modification, conversion,
and bundling-with-credit are permitted; standalone resale of the raw file is
prohibited.

The `falling` and `landing` clips (`falling_loop.vrma`, `landing.vrma`) are
original works authored in Blender by the project author.
