# YUI — Install and Wiring Guide

YUI is the frontend (head): VRM character rendering, desktop-pet behavior, and I/O surfaces. The brain and voice services — backend agent, broker, TTS, STT — run as separate, config-swappable processes that YUI points at via `configs/endpoints.json`.

## Required vs Optional

| Component | Status | What breaks without it |
|---|---|---|
| YUI app (`pnpm tauri dev`) | **Required** | — |
| VRM model in `resources/vrms/` | **Required** | Character fails to load |
| Expression MCP Broker | **Required** | Agent cannot read YUI's vocabulary; expression/motion calls may be out of range |
| Backend agent | **Required** | No chat, no character speech |
| `.env.local` + `VITE_YUI_CHAT_KEY` | **Required** | Chat auth absent |
| `configs/endpoints.json` wiring | **Required** | Services unreachable |
| TTS (OpenAI-compatible) | Optional | Speech bubble works; no audio output |
| STT | Optional | Text input works; no voice input |
| Screenshot context | Optional | Agent receives no screen context |
| Mods (`Mods/`) | Optional | No desktop-control or other Mod capabilities |

Stand up every required component first; add the optional ones when you want voice or extended capabilities.

YUI selects the chat protocol with the `chat_api` key in `configs/endpoints.json`: **Responses mode** (`"responses"`) needs the Expression MCP Broker and a backend agent, as above — the agent reads the broker via `get_ids` and emits cues as `generate_express` tool-calls. **Chat Completions mode** (`"chat_completions"`, the default) declares `generate_express` from the client side with the vocabulary already baked into its schema, so a plain OpenAI-compatible endpoint drives expression on its own; the client also keeps the transcript itself, trimmed to `chat_model_context_window`, instead of relying on `previous_response_id`. See [section 4](#4-chat-protocol--backend-agent-responses-or-chat-completions) for both paths.

---

## 1. Run YUI itself

### Prerequisites

- Node.js + [pnpm](https://pnpm.io/)
- Rust + the [Tauri v2 toolchain](https://v2.tauri.app/start/prerequisites/)

### Install and launch

```bash
pnpm install
pnpm tauri dev        # transparent desktop-pet window (recommended)
pnpm dev              # browser-only, no Tauri shell
pnpm build            # production build
```

### Chat auth key

Copy `.env.example` to `.env.local` and set `VITE_YUI_CHAT_KEY` to the API key your backend agent expects. This file is gitignored — a fresh checkout must provide it.

```bash
cp .env.example .env.local
# then edit .env.local and set VITE_YUI_CHAT_KEY=<your-key>
```

> See the README [Getting started](https://github.com/yw0nam/YUI/blob/main/README.md#getting-started) and [Runtime assets](https://github.com/yw0nam/YUI/blob/main/README.md#runtime-assets) sections for VRM placement and worktree setup.

---

## 2. VRM Placement

Drop a VRM 1.0 model into `resources/vrms/` (filename pattern: `*.vrm`). This directory is gitignored — a fresh checkout must provide its own model.

```
resources/vrms/your-model.vrm
```

Vite serves `/vrms/*` from `resources/vrms/`. Without a model the character 404s on load. Per-model framing (margin, FOV) and hit-test alpha threshold are configured in `configs/avatar.json`.

---

## 3. Expression MCP Broker

The broker publishes YUI's renderable emotion/motion/`emotion_text` vocabulary so the backend agent learns what the body can express at runtime. Publish is best-effort and silently skipped if `broker_base_url` is unset.

1. Install and serve the broker from [https://github.com/yw0nam/tts_express_broker](https://github.com/yw0nam/tts_express_broker).
2. The broker listens by default at `http://localhost:3201/mcp` (streamable-http MCP).
3. In `configs/endpoints.json`, set:
   ```json
   "broker_base_url": "http://localhost:3201/mcp"
   ```

---

## 4. Chat Protocol — Backend Agent (Responses or Chat Completions)

YUI supports two chat protocols, selected by the `chat_api` key in `configs/endpoints.json`.

### Option A — Responses mode (`"chat_api": "responses"`)

YUI is compatible with any backend served over the OpenAI Responses API (`/v1/responses`). The [Hermes Agent](https://github.com/nousresearch/hermes-agent) gateway is recommended.

1. Stand up your backend agent, ensuring it serves the OpenAI Responses API.
2. Install the Expression MCP broker (step 3) **into the backend agent** so it can call `generate_express` and read the published vocabulary.
3. Hand the agent the cue contract so it understands how to drive the character:
   - With Hermes: create a profile, add `docs/reference/client-context.md` to that profile's context, and instruct it to remember the contract.
   - With other agents: include the contents of `docs/reference/client-context.md` in the system prompt or context.
4. In `configs/endpoints.json`, set:
   ```json
   "chat_api": "responses",
   "chat_base_url": "http://localhost:8643/v1",
   "chat_endpoint": "/v1/responses",
   "chat_model": "<your-model-id>",
   "chat_model_context_window": 200000
   ```

### Option B — Chat Completions mode (`"chat_api": "chat_completions"`, default)

Connects over the Chat Completions API to any endpoint whose model supports tool calling — OpenAI, ollama, LM Studio, vLLM, groq, OpenRouter, and other OpenAI-compatible Chat Completions endpoints all work. The client declares `generate_express` on every request with its emotion and motion ids already in the schema, executes the calls it gets back, and returns the results, so a plain model endpoint drives expression with no broker and no contract handed to it. A backend agent that owns `generate_express` itself keeps working too: its call plays the same cue. The client also keeps the transcript itself (`localStorage`), trimmed each turn to fit `chat_model_context_window`, instead of relying on `previous_response_id`.

1. Stand up the endpoint — a bare OpenAI-compatible server is enough; a backend agent works as well.
2. Install the Expression MCP broker (step 3) **into the backend agent** when one is in play and you want it to read the published vocabulary — a bare model endpoint needs neither the broker nor step 3.
3. Hand a backend agent the cue contract — same as Option A step 3.
4. In `configs/endpoints.json`, set:
   ```json
   "chat_api": "chat_completions",
   "chat_base_url": "<your OpenAI-compatible endpoint base URL>",
   "chat_model": "<model id served by that endpoint>",
   "chat_model_context_window": 200000
   ```
5. Provide a real API key for that endpoint — set `VITE_YUI_CHAT_KEY` in `.env.local`, or use the in-app Chat key field.
6. Reasoning effort (set in the in-app agent settings) maps to the Chat Completions `reasoning_effort` parameter.

`generate_express` tool-call deltas are parsed from the `chat.completion.chunk` stream as they arrive and the cue plays at that moment. A model that stops on its cue calls without speaking gets the tool results back and re-requests, so the turn still reaches speech — up to three round trips. A model that speaks alongside its cues finishes in one request. See [CC mode transport](../reference/client-context.md#cc-mode-transport-chat-completions) for the wire shape.

---

## 5. TTS — Voice Output (optional)

Without TTS, YUI displays text in the speech bubble but produces no audio. Any server implementing the OpenAI `/v1/audio/speech` endpoint works.

The reference deployment is the Irodori TTS OpenAI-compatible server — it also understands the emoji `emotion_text` tags inline in the spoken text:

```bash
uv run --no-sync python -m irodori_openai_tts --host 0.0.0.0 --port 8088
```

**Caveat: Irodori serves Japanese only.** When using it, instruct your backend agent to respond in Japanese.

In `configs/endpoints.json`:
```json
"tts_base_url": "http://localhost:8088",
"tts_model": "irodori-tts",
"tts_speaker": "<voice-id>"
```

`tts_model` must match the name the server is configured under, or the server answers 400.

The TTS server is the source of truth for the available voice IDs (`GET /v1/audio/voices`) — YUI ships no bundled catalog. The panel's voice section lists them; `tts_speaker` picks the one used until you choose another there. Voices live in the server's `voices/` directory, and importing a reference clip from the panel copies it into app-data and uploads it to `/v1/audio/voices`.

If the server requires auth, set `VITE_YUI_TTS_KEY` in `.env.local` — YUI sends it as `Authorization: Bearer`.

---

## 6. STT — Voice Input (optional)

Without STT, text input still works. VAD (Silero + ONNX) runs client-side; STT sends segmented audio to a transcription server.

Serve any OpenAI-compatible transcription server at the configured URL, then set:
```json
"stt_base_url": "http://localhost:5517/v1"
```

YUI sends audio to `<stt_base_url>/audio/transcriptions`. If the server requires auth, set `VITE_YUI_STT_KEY` in `.env.local` — YUI sends it as `Authorization: Bearer`.

---

## 7. Wire It All Together — `configs/endpoints.json`

YUI ships with no service addresses: the bundled `configs/endpoints.json` carries only the protocol-shape defaults, and every URL is unset. An unset URL means that feature is off — STT, TTS, and the expression broker stay quiet, and a chat turn with no `chat_base_url` answers with an inline "Backend not configured" error pointing at Settings → Advanced.

After standing up the services above, point YUI at them by editing `configs/endpoints.json`. You can also override individual keys via the in-app Endpoint settings panel, which persists to local storage and leaves the bundled file untouched.

Key reference:

| Key | Shipped default | Purpose |
|---|---|---|
| `chat_api` | `chat_completions` | Chat protocol: `"responses"` (backend agent honoring the expression contract) or `"chat_completions"` (client-declared `generate_express`, any tool-calling endpoint) |
| `chat_base_url` | unset | Chat endpoint base URL (Responses API root or Chat Completions endpoint, per `chat_api`) |
| `chat_endpoint` | unset | Responses API path (Responses mode only) |
| `chat_model` | unset | Model ID sent to the backend |
| `chat_model_context_window` | `200000` | Token window — display in Responses mode; also trims the client-side transcript in Chat Completions mode |
| `stt_base_url` | unset | STT server base URL |
| `tts_base_url` | unset | OpenAI-compatible TTS server |
| `tts_model` | `irodori-tts` | `model` sent to the TTS server; must match its configured name |
| `tts_speaker` | unset | Default voice id, until another is picked in the panel |
| `broker_base_url` | unset | Expression broker MCP URL |

No values are hardcoded in the application — all service addresses come from this file.

---

## 8. Platform Notes

- **Idle watching works on both.** `os_idle_ms` polling is implemented on both macOS and Windows, so idle-triggered and co-working proactive cues fire on either platform.
- **macOS TCC grants.** The optional screenshot context feature and the `desktop_control` Mod (if used) require Screen Recording permission. App control via the `desktop_control` Mod additionally requires Automation / Apple Events permission. Grant these in System Settings → Privacy & Security.
