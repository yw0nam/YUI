# YUI — Install and Wiring Guide

YUI is the frontend (head): VRM character rendering, desktop-pet behavior, and I/O surfaces. The brain and voice services — backend agent, broker, TTS, STT — run as separate, config-swappable processes that YUI points at via `configs/endpoints.json` or the in-app panel (right-click the character → **Advanced**).

## What you need

One VRM model — and one ships in the repo (`resources/vrms/Sendagaya_Shino.vrm`). Everything else is optional: an unset service simply keeps its feature off, and you can wire it any time later from the in-app panel.

| Component | Status | Without it |
|---|---|---|
| VRM model | **Bundled** — bring your own optional (§2) | — |
| Chat backend (`chat_base_url`) | Optional | Character appears and idles; a chat turn answers with an inline "Backend not configured" pointer to **Advanced** |
| Chat API key | Optional | Only needed when the endpoint enforces one; set in the panel or `.env.local` |
| Expression MCP Broker | Optional — Responses mode with a backend agent | Chat Completions mode bakes the vocabulary into the client-declared tool, no broker involved |
| TTS | Optional | Speech bubble works; no audio output |
| STT | Optional | Text input works; no voice input |
| Screenshot context | Optional | Agent receives no screen context |
| Mods (`Mods/`) | Optional | No desktop-control or other Mod capabilities |

---

## 1. Run YUI itself

With Claude Code: open the repo and type `/yui-install` — the `yui-install` skill runs sections 1–2 and 7 interactively and verifies the build. The rest of this page is the manual path and the reference for the external services.

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

If your chat endpoint requires a key, either paste it into the panel's Chat key field or copy `.env.example` to `.env.local` and set `VITE_YUI_CHAT_KEY`. The key set in the panel wins; `.env.local` (gitignored) is the fallback used when the panel field is empty. It is read at build time, so restart the dev server after editing it.

```bash
cp .env.example .env.local
# then edit .env.local and set VITE_YUI_CHAT_KEY=<your-key>
```

---

## 2. VRM model (bring your own, optional)

The bundled `Sendagaya_Shino.vrm` is what `configs/avatar.json` → `vrm_url` loads by default. To use another VRM 1.0 model:

- **In the Tauri app** — open the panel's VRM section and import the file with the OS picker. The file is copied into the app data directory and added to the model list; nothing in the repo changes.
- **From the repo (`pnpm dev` or `pnpm tauri dev`)** — drop the file into `resources/vrms/` (gitignored except the bundled default; Vite serves `/vrms/*` from there) and point `configs/avatar.json` at it: set `vrm_url` to `/vrms/<file>.vrm` and add a matching entry to `available` (`{ "id", "label", "url", "source": "bundled" }`; `id` is limited to `[A-Za-z0-9._-]`).

Per-model framing (`framing.margin`, `framing.fov`) and the hit-test alpha threshold (`hit_test.alpha_threshold`) live in `configs/avatar.json`.

---

## 3. Chat backend

YUI supports two chat protocols, selected by `chat_api` in `configs/endpoints.json`. The shipped file sets `chat_completions`; if the key is removed the client behaves as `responses`.

### Option A — Chat Completions mode (`"chat_api": "chat_completions"`, shipped default)

Any tool-calling OpenAI-compatible `/v1/chat/completions` endpoint drives expression on its own: the client declares `generate_express` with the emotion/motion/voice vocabulary baked into the tool schema, runs the call locally, returns the result, and keeps the conversation transcript client-side (no `previous_response_id`), trimmed to `chat_model_context_window`.

1. Stand up (or pick) a Chat Completions endpoint.
2. In `configs/endpoints.json`, set:
   ```json
   "chat_api": "chat_completions",
   "chat_base_url": "<your OpenAI-compatible endpoint base URL>",
   "chat_model": "<model id served by that endpoint>",
   "chat_model_context_window": 200000
   ```
3. Provide the endpoint's API key if it needs one (§1 Chat auth key).

`generate_express` tool-call deltas are parsed from the `chat.completion.chunk` stream as they arrive and the cue plays at that moment. A model that stops on its cue calls without speaking gets the tool results back and re-requests, so the turn still reaches speech — up to three round trips. A model that speaks alongside its cues finishes in one request. See [CC mode transport](../reference/client-context.md#cc-mode-transport-chat-completions) for the wire shape.

Backend capability still varies: a plain OpenAI-compatible server (e.g. vLLM) speaks standard tool-call streaming, while the Hermes api-server's `/v1/chat/completions` never surfaces tool calls. With Hermes, use Responses mode.

### Option B — Responses mode (`"chat_api": "responses"`)

Any backend served over the OpenAI Responses API (`/v1/responses`); the [Hermes Agent](https://github.com/nousresearch/hermes-agent) gateway is recommended. The backend agent reads YUI's vocabulary from the Expression Broker (§4) and emits cues as `generate_express` tool-calls.

1. Stand up the backend agent with the Responses API served.
2. Install the Expression MCP Broker (§4) **into the backend agent** so it can read the published vocabulary.
3. Hand the agent the cue contract so it understands how to drive the character:
   - With Hermes: create a profile, add `docs/reference/client-context.md` to that profile's context, and instruct it to remember the contract.
   - With other agents: include the contents of `docs/reference/client-context.md` in the system prompt or context.
4. In `configs/endpoints.json`, set:
   ```json
   "chat_api": "responses",
   "chat_base_url": "http://localhost:8643/v1",
   "chat_model": "<model id>",
   "broker_base_url": "http://localhost:3201/mcp"
   ```
   The client appends `/responses` to `chat_base_url` itself.

### Reasoning effort

The in-app agent settings expose reasoning effort (`none` · `minimal` · `low` · `medium`). Responses mode sends it as `reasoning.effort`; Chat Completions mode as the top-level `reasoning_effort`.

---

## 4. Expression MCP Broker (optional)

The broker publishes YUI's renderable emotion/motion/`emotion_text` vocabulary so a backend agent learns what the body can express at runtime. YUI publishes in both chat modes whenever `broker_base_url` is set, and silently skips it otherwise; only Responses mode needs the agent to read it back.

1. Install and serve the broker from [https://github.com/yw0nam/tts_express_broker](https://github.com/yw0nam/tts_express_broker).
2. The broker listens by default at `http://localhost:3201/mcp` (streamable-http MCP).
3. In `configs/endpoints.json`, set:
   ```json
   "broker_base_url": "http://localhost:3201/mcp"
   ```

---

## 5. TTS — Voice Output (optional)

Without TTS, YUI displays text in the speech bubble but produces no audio. Any server implementing the OpenAI `/v1/audio/speech` endpoint works.

The reference deployment is [Irodori TTS Server](https://github.com/Aratako/Irodori-TTS-Server) — it also understands the emoji `emotion_text` tags inline in the spoken text. Follow that repo's README to run it (default port 8088).

**Caveat: Irodori serves Japanese only.** When using it, instruct your backend agent to respond in Japanese.

In `configs/endpoints.json`:
```json
"tts_base_url": "http://localhost:8088",
"tts_model": "irodori-tts",
"tts_speaker": "<voice-id>"
```

`tts_model` must match the name the server is configured under, or the server answers 400.

The TTS server is the source of truth for the available voice IDs (`GET /v1/audio/voices`) — YUI ships no bundled catalog. The panel's voice section lists them; `tts_speaker` picks the one used until you choose another there. Voices live in the server's `voices/` directory, and the panel uploads imported reference clips with `POST`/`PUT /v1/audio/voices` and removes them with `DELETE /v1/audio/voices/{voice_id}`.

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

YUI ships with no service addresses: every URL in the bundled `configs/endpoints.json` is unset, and an unset URL means that feature is off — STT, TTS, and the expression broker stay quiet, and a chat turn with no `chat_base_url` answers with an inline "Backend not configured" error pointing at **Advanced**.

Point YUI at your services by editing `configs/endpoints.json` or using the in-app Endpoint settings panel, which persists overrides to local storage and leaves the bundled file untouched.

Key reference:

| Key | Shipped default | Purpose |
|---|---|---|
| `chat_api` | `chat_completions` | Chat protocol: `"chat_completions"` (client-declared `generate_express`, any tool-calling endpoint) or `"responses"` (backend agent honoring the expression contract) |
| `chat_base_url` | unset | Chat endpoint base URL |
| `chat_model` | unset | Model ID sent to the backend |
| `chat_model_context_window` | `200000` | Token window — display in Responses mode; also trims the client-side transcript in Chat Completions mode |
| `chat_instructions` | expression prompt | System-level nudge on how to use `generate_express`; sent as `instructions` (Responses) or a system message (Chat Completions) |
| `stt_base_url` | unset | STT server base URL |
| `tts_base_url` | unset | OpenAI-compatible TTS server |
| `tts_model` | `irodori-tts` | `model` sent to the TTS server; must match its configured name |
| `tts_speaker` | unset | Default voice id, until another is picked in the panel |
| `tts_max_inflight` | `1` | Concurrent TTS synthesis requests |
| `broker_base_url` | unset | Expression broker MCP URL |

All service addresses come from this file or the in-app overrides.

---

## 8. Platform Notes

- **Idle watching works on both.** `os_idle_ms` polling is implemented on both macOS and Windows, so idle-triggered and co-working proactive cues fire on either platform.
- **macOS TCC grants.** The optional screenshot context feature and the `desktop-control` Mod (if used) require Screen Recording permission. App control via the `desktop-control` Mod additionally requires Automation / Apple Events permission. Grant these in System Settings → Privacy & Security.
