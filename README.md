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
It does not ship an embedded model. It plugs into a backend agent that speaks
the OpenAI Responses API (the
[Hermes Agent](https://github.com/nousresearch/hermes-agent), or any
compatible backend) honoring YUI's expression contract, or, in Chat Completions
mode, into any OpenAI-compatible endpoint whose model supports tool calling —
so the character is exactly as capable as whatever sits behind that connection.

The character owns the screen; chrome stays out of the way and only appears when
there is something to show, then steps back.

## Features

**Agent**
- Two chat protocols, selected by `chat_api` in `configs/endpoints.json`: a
  backend agent honoring YUI's expression contract over the OpenAI Responses
  API, or any tool-calling OpenAI-compatible Chat Completions endpoint — no
  fixed embedded model
- Emotion, motion, and voice cues arrive as structured `generate_express`
  tool-calls, never as inline tags in the text — Responses mode carries them
  today; Chat Completions mode streams speech text without cues
- YUI publishes its emotion/motion/voice vocabulary to the Expression Broker
  (MCP) in both chat modes, write-only and gated only on `broker_base_url`;
  a backend agent reads it back via `get_ids` and emits cues as
  `generate_express` tool-calls
- In Chat Completions mode YUI declares `generate_express` itself, with that
  same vocabulary in the tool schema, runs the call locally and returns the
  result — expression on a bare model endpoint, no broker required

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
- Reads OS-wide idle time and an optional user-toggled screenshot and feeds
  them to the agent each turn; the frontmost app/window is a pull tool the
  agent calls via the `desktop_control` Mod, not a per-turn push

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
Broker publishes so the agent knows what it can ask for. This is carried in
full over Responses mode today; see [Backend wiring](#backend-wiring) for how
it differs by chat protocol and backend. The full cue contract handed to the
backend lives in [`docs/reference/client-context.md`](docs/reference/client-context.md).

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
pnpm setup                  # interactive config: endpoints.json + .env.local, prereq + VRM check
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

- **Chat protocol** — selected via `chat_api` (default `chat_completions`):
  - `responses` — routes to a backend agent (Hermes recommended) at
    `localhost:8643` `/v1/responses`
  - `chat_completions` — connects over the Chat Completions API to any
    tool-calling OpenAI-compatible endpoint; the client declares
    `generate_express` with its own vocabulary, executes the call and returns
    the result, and keeps the conversation transcript client-side (no
    `previous_response_id`), trimmed to `chat_model_context_window`

  | Mode | Speech text | `generate_express` cues |
  |---|---|---|
  | `responses` | yes | yes — the backend agent emits them as function-call items |
  | `chat_completions` | yes | yes — the client declares the tool, runs it, and returns the result |

  Backend capability still varies: a plain OpenAI-compatible server (e.g.
  vLLM) speaks standard Chat Completions tool-call streaming, while the
  Hermes api-server's `/v1/chat/completions` never surfaces tool calls — it
  emits a custom `hermes.tool.progress` telemetry event with no arguments
  instead. With Hermes, use `responses` mode for cues.
- **STT** — `localhost:5517` `/v1/audio/transcriptions`
- **TTS** — selected via `tts_provider` (default `openai`):
  - `irodori` — irodori_TTS at `localhost:8091` `/synthesize`, reference-voice
    based; the irodori server itself is the source of truth for the speaker
    list (`GET /voices`) — users add their own via the panel's import button
  - `openai` — OpenAI-compatible `/v1/audio/speech` at `localhost:8092`
- **Expression Broker** — `localhost:3201/mcp` (streamable-http MCP); YUI
  publishes its emotion/motion/voice vocabulary here in both chat modes,
  gated only on `broker_base_url` (skipped if unset) — the backend agent
  behind either endpoint reads it back via `get_ids`

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
    os_event_watcher/     # Idle-tick polling (macos · windows)
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

- [`AGENTS.md`](AGENTS.md) — project orientation (architecture, core principle, doc index); development work rules and the delegation model live in the `yui-dev-workflow` skill
- [`PRODUCT.md`](PRODUCT.md) / [`DESIGN.md`](DESIGN.md) — product register + design system
- [`docs/guide/getting-started.md`](docs/guide/getting-started.md) — install and wiring (broker · agent · TTS · STT · VRM)
- [`docs/reference/client-context.md`](docs/reference/client-context.md) — the `generate_express` cue contract
- [`docs/reference/motions.md`](docs/reference/motions.md) — motion catalog
- [`docs/reference/tts-emotion/`](docs/reference/tts-emotion/) — per-provider `emotion_text` voice tags
- [`docs/reference/logging.md`](docs/reference/logging.md) — logging convention
- [`src/contract/types.ts`](src/contract/types.ts) — TS contract shapes

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

The bundled default VRM model
(`resources/vrms/Sendagaya_Shino.vrm`) is **Sendagaya Shino**, originally by
[pixiv Inc.](https://vroid.pixiv.help/hc/en-us/articles/360013482714) (VRoid
Project, CC0), converted to VRM 1.0 by
[Coatie](https://hub.vroid.com/en/characters/4593660874193246717). Neither
license requires attribution — see
[`resources/vrms/Sendagaya_Shino.PROVENANCE.md`](resources/vrms/Sendagaya_Shino.PROVENANCE.md)
for the full notice.

## License

YUI's source code is licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE) — free for noncommercial use,
modification, and redistribution with attribution. **Commercial use requires
permission from the author** (https://github.com/yw0nam).

The bundled motion assets (`public/motions/*.vrma`) are **not** covered by this
license; each follows its original author's terms — see [Credits](#credits) above.
