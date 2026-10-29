# Install

YUI is the body: it renders a VRM character, runs it as a desktop pet, and holds the I/O surfaces. The brain and the voice services are separate processes: a backend agent, TTS, and STT. YUI points at them through `configs/endpoints.json` or the settings window (right-click the character → **All settings…** → **Connection** page).

A coding agent runs the install for you, you download a build from the Releases page, or you build from source.

## With a coding agent

Paste this into any coding agent (Claude Code, Codex, OpenCode, Cursor):

```text
Install https://github.com/yw0nam/YUI following https://raw.githubusercontent.com/yw0nam/YUI/main/docs/guide/install.md
```

The agent follows [Install with a coding agent](install.md), the instruction set for the install.

## From the Releases page

Each release on the [Releases page](https://github.com/yw0nam/YUI/releases) carries a build for both supported platforms.

| Platform | Download |
|---|---|
| macOS, Apple Silicon | `.dmg` |
| Windows, x64 | `.msi` or `-setup.exe` |

CI builds the Windows bundles, and they are tested on Windows.

The macOS build is signed ad hoc, without a Developer ID certificate, so macOS refuses the first launch. Allow the app once under System Settings → Privacy & Security → **Open Anyway**.

A release build carries no key from the environment. Enter the chat, TTS, and STT keys in the settings window, on the **Connection** page, which stores them on the device ([Connect a backend](connect-a-backend.md)).

## From source

A coding agent can run these steps and the service wiring for you from [Install with a coding agent](install.md).

### What you need

One VRM model, and one ships in the repo (`resources/vrms/Sendagaya_Shino.vrm`). Everything else is optional: an unset service keeps its feature off, and you can wire it any time later from the in-app panel.

| Component | Status | Without it |
|---|---|---|
| VRM model | **Bundled**; bring your own optional | Not applicable |
| Chat backend (`chat_base_url`) | Optional | Character appears and idles; a chat turn answers with an inline "Backend not configured" pointer to **Connection** |
| Chat API key | Optional | Only needed when the endpoint enforces one; set in the panel or `.env.local` |
| TTS | Optional | Speech bubble works; no audio output |
| STT | Optional | Text input works; no voice input |
| Screenshot context | Optional | Agent receives no screen context |
| Plugins (`plugins/`) | Optional | No plugin capabilities, such as the Factorio game bridge |

### Prerequisites

- Node.js + [pnpm](https://pnpm.io/)
- Rust + the [Tauri v2 toolchain](https://v2.tauri.app/start/prerequisites/)

### Install and launch

```bash
pnpm install
pnpm tauri dev        # transparent desktop-pet window on port 1420 (recommended)
pnpm tauri:dev        # same window on an auto-picked free port, so worktrees run side by side
pnpm dev              # browser-only, no Tauri shell
pnpm build            # production build
```

### Chat auth key

If your chat endpoint requires a key, either paste it into the panel's Chat key field or copy `.env.example` to `.env.local` and set `VITE_YUI_CHAT_KEY`. The key set in the panel wins; `.env.local` (gitignored) is the fallback used when the panel field is empty. It is read at build time, so restart the dev server after editing it. This fallback applies to dev runs (`pnpm dev`, `pnpm tauri:dev`) only. A release build carries no key from the environment, and release users enter their keys in the panel's Connection tab, which stores them on the device.

```bash
cp .env.example .env.local
# then edit .env.local and set VITE_YUI_CHAT_KEY=<your-key>
```

## Your own character

The bundled `Sendagaya_Shino.vrm` is what `configs/avatar.json` → `vrm_url` loads by default. To use another VRM 1.0 model:

- **In the Tauri app**: open the panel's VRM section and import the file with the OS picker. The file is copied into the app data directory and added to the model list; nothing in the repo changes.
- **From the repo (`pnpm dev` or `pnpm tauri dev`)**: drop the file into `resources/vrms/` (gitignored except the bundled default; Vite serves `/vrms/*` from there) and point `configs/avatar.json` at it: set `vrm_url` to `/vrms/<file>.vrm` and add a matching entry to `available` (`{ "id", "label", "url", "source": "bundled" }`; `id` is limited to `[A-Za-z0-9._-]`).

Per-model framing (`framing.margin` and `framing.fov`) and the hit-test alpha threshold (`hit_test.alpha_threshold`) live in `configs/avatar.json`.
Every tunable section in that file is required, because the client reads each value from it and fails the load naming any key the file leaves out.

## Platform notes

- **Idle watching works on both.** `os_idle_ms` polling is implemented on both macOS and Windows, so idle-triggered and co-working proactive cues fire on either platform.
- **macOS TCC grants.** The optional screenshot context feature requires Screen Recording permission. Grant it in System Settings → Privacy & Security.

## Next

- [Connect a backend](connect-a-backend.md): one OpenAI key, a local model on Ollama or LM Studio, or an agent.
- [Voice in and out](voice.md): TTS, STT, and the key reference for `configs/endpoints.json`.
