# Install with a coding agent

Paste this into any coding agent (Claude Code, Codex, OpenCode, Cursor):

```text
Install https://github.com/yw0nam/YUI following https://raw.githubusercontent.com/yw0nam/YUI/main/docs/guide/install.md
```

The rest of this page is the instruction set for that agent.

## Instructions for the agent

Take the user from nothing to a checkout that runs with `pnpm tauri dev`. Ask the user only for what the machine cannot tell you. Every step ends on a checkable state; do not report done before step 4 passes.

### 1. Prerequisites

Run `git --version`, `pnpm -v`, `rustc -V`, `cargo -V`. On macOS also run `xcode-select -p`; on Windows, Tauri needs the MSVC build tools and WebView2 ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

For each missing tool, ask the user before installing it:

| Missing | Install |
|---|---|
| pnpm | `npm install -g pnpm`, or follow https://pnpm.io/installation when Node is missing too |
| Rust and cargo | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh -s -- -y`, then `source "$HOME/.cargo/env"` |
| Xcode Command Line Tools (macOS) | The user runs `xcode-select --install` and accepts the system dialog |

Done when every command above prints a version or a path.

### 2. Clone

If the current directory is already a YUI checkout, use it. Otherwise clone into a directory the user names, defaulting to `~/YUI`:

```bash
git clone https://github.com/yw0nam/YUI ~/YUI && cd ~/YUI
pnpm install
```

Done when `pnpm install` exits 0 and `resources/vrms/Sendagaya_Shino.vrm` exists. That file is the bundled default character and the only hard requirement.

### 3. Backend (optional)

Ask once: "Do you want to connect a chat backend, TTS, or STT now, or set them later in the app (right-click the character → Connection)?" On "later", go to step 4.

Otherwise collect what the user has. Every URL starts with `http://` or `https://`; the config validator rejects anything else at launch, and the window shows an error card that names the file and the key.

| Value | Where it goes |
|---|---|
| Chat base URL and model id | `configs/endpoints.json` → `chat_base_url`, `chat_model`. In the `chat_completions` and `responses` modes the URL is the API root including `/v1` (`http://localhost:8643/v1`). In `push` mode it is the WebSocket base without `/v1` (`http://localhost:8646`) |
| Chat protocol | `chat_api`: pick by who keeps the conversation history: keep `chat_completions` (the client sends the history) for any tool-calling OpenAI-compatible endpoint, `responses` (the server keeps it) for a backend agent on the Responses API, `push` for a backend that speaks the [push transport](../reference/push-transport.md) |
| Chat API key | `.env.local` → `VITE_YUI_CHAT_KEY` |
| Expression Broker MCP URL | Skip it. `broker_base_url` is deprecated and is removed in v0.6.0; the client declares its tools on the request |
| TTS provider, URL, model, speaker, key | `tts_provider` (`irodori` or `openai`), `tts_base_url` without `/v1` (`http://localhost:8088` for Irodori, `https://api.openai.com` for OpenAI), `tts_model` (`irodori-tts`, or `gpt-4o-mini-tts` for OpenAI), `tts_speaker`, `.env.local` → `VITE_YUI_TTS_KEY` |
| STT URL, model, key | `stt_base_url` with `/v1` (`http://localhost:5517/v1`), `stt_model`, `.env.local` → `VITE_YUI_STT_KEY` |

Create `.env.local` with `cp -n .env.example .env.local` and set only the keys the user gave. The `VITE_YUI_*_KEY` values in it apply to dev runs only; a release build carries no key and reads the keys entered in the Connection tab. Merge the answered keys into `configs/endpoints.json` and leave the rest out; an unset URL keeps that feature off. `pnpm tauri dev` reloads `configs/` on change; a change to `.env.local` needs a restart.

Done when this exits 0 and every value the user gave is in place:

```bash
node -e 'const c=JSON.parse(require("fs").readFileSync("configs/endpoints.json","utf8"));for(const k of Object.keys(c).filter(k=>k.endsWith("_url")))if(c[k]!==""&&!/^https?:\/\//.test(c[k]))process.exit(1)'
```

### 4. Verify

`pnpm build` exits 0.

Report to the user:

1. The paths written, never a key value.
2. What was skipped, with the place to set it later: right-click the character → Connection.
3. The launch command, run from the checkout: `pnpm tauri dev`. The first run compiles the Rust side for several minutes, then opens a transparent window with the character. With no backend she idles, and a chat turn answers with a pointer to the Connection tab.
4. The optional services (TTS, STT, backend agents) are covered in the [install and wiring guide](getting-started.md).
