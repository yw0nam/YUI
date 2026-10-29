# Configuration

YUI reads its settings from `configs/*.json` at boot, and a dev run can also read keys from `.env.local`. The settings window overrides those files and stores each value on the device, and it never writes to the checked-in files.

## Services

Every address in the bundled `configs/endpoints.json` is unset, and an unset address turns its feature off. Every service address comes from this file or from the settings window.

| Service | Key | Without it |
| --- | --- | --- |
| Chat backend | `chat_base_url` | The character appears and idles. A chat turn answers "Backend not configured" and points at **Connection**. |
| Chat API key | **Chat API key** field | Only needed when the endpoint enforces one. |
| TTS | `tts_base_url` | The speech bubble works, but there is no audio. |
| STT | `stt_base_url` | Text input works, but there is no voice input. |
| Screenshot context | **Attach screenshot** switch | The agent receives no screen context. |
| Plugins | the `plugins/` folder | No plugin capabilities, such as the Factorio game bridge. |

## Chat

`configs/endpoints.json` holds these keys.

| Key | Shipped default | Purpose |
| --- | --- | --- |
| `chat_api` | `chat_completions` | Chat protocol: `chat_completions`, `responses`, or `push`. When the key is absent, the client behaves as `responses` |
| `chat_base_url` | unset | In `chat_completions` and `responses` modes, the API root including `/v1`, to which the client appends `/chat/completions` or `/responses`. In push mode, the WebSocket base without `/v1`, where the client opens `<chat_base_url>/ws` |
| `chat_model` | unset | Model ID sent to the backend |
| `chat_model_context_window` | `200000` | Token window: what Responses mode displays, and the length the client-side transcript is trimmed to in Chat Completions mode |
| `chat_instructions` | expression prompt | System-level nudge on how to use `generate_express`; appended to the card and sent as `instructions` on Responses or as the first system message on Chat Completions |

Who keeps the conversation: the client on Chat Completions, the server on Responses, the backend on push. [Push transport](../reference/push-transport.md#what-each-chat-transport-carries) lists what each transport carries, row by row.

### Chat Completions (Option A)

Any tool-calling OpenAI-compatible `/v1/chat/completions` endpoint drives expression on its own. The client declares `generate_express` with the emotion, motion and voice vocabulary baked into the tool schema, runs the call locally, returns the result, and keeps the transcript client-side, trimmed to `chat_model_context_window`. Any model that calls tools works, such as [`gpt-5-mini`](https://platform.openai.com/docs/models/gpt-5-mini) on OpenAI, [`qwen3`](https://ollama.com/library/qwen3) on Ollama (pull it first with `ollama pull qwen3`), or [`llama-3.3-70b-versatile`](https://console.groq.com/docs/tool-use) on Groq.

1. Stand up or pick a Chat Completions endpoint.
2. In `configs/endpoints.json`, set:

   ```json
   "chat_api": "chat_completions",
   "chat_base_url": "<API root including /v1, e.g. http://localhost:8000/v1>",
   "chat_model": "<model id served by that endpoint>",
   "chat_model_context_window": 200000
   ```

3. Provide the endpoint's API key if it needs one ([Keys](#keys)).

`generate_express` tool-call deltas are accumulated from the `chat.completion.chunk` stream, and each call's cue plays when a chunk carries a `finish_reason` or the stream ends. A model that stops on its cue calls without speaking gets the tool results back and re-requests, so the turn still reaches speech in up to three round trips, while a model that speaks alongside its cues finishes in one request. See [CC mode transport](../reference/client-context.md#cc-mode-transport-chat-completions) and [Tool-call round trip](../reference/client-tools.md#tool-call-round-trip).

### Responses (Option B)

Any backend that serves the OpenAI Responses API (`/v1/responses`). The client declares `generate_express` on every request and runs the call locally. It then sends a follow-up request that re-sends the input items plus the call and its result, so the in-turn round trip does not depend on the server keeping responses. Across turns the client chains on `previous_response_id`. A server that answers 404 for the stored id gets one retry without it, and the conversation context resets.

1. Stand up the backend agent with the Responses API served.
2. Hand the agent the cue contract so it understands how to drive the character:
   - With Hermes: create a profile, add `docs/reference/client-context.md` to that profile's context, and instruct it to remember the contract.
   - With other agents: include the contents of `docs/reference/client-context.md` in the system prompt or context.
3. In `configs/endpoints.json`, set:

   ```json
   "chat_api": "responses",
   "chat_base_url": "http://localhost:8643/v1",
   "chat_model": "<model id>"
   ```

   The client appends `/responses` to `chat_base_url` itself.

Backend capability varies: a plain OpenAI-compatible server such as vLLM speaks standard tool-call streaming, while the Hermes Agent API server never surfaces tool calls, so Hermes drives expression on push only.

### Reasoning effort

The **Reasoning effort** control offers `Default`, `None`, `Minimal`, `Low` and `Medium`, the depth of thought before an answer. `Default`, the starting value, sends no effort, so the model's own default applies, and a model that rejects some values (GPT-OSS rejects `none`) still answers. Any other value is sent: on Responses as `reasoning.effort`, on Chat Completions as the top-level `reasoning_effort`.

The control appears in Chat Completions and Responses modes. On push it stays in place, disabled, with a line under it that says the backend decides how long to think on push. The **Card** section works the same way: its fields stay in place, disabled, with a reason line, because a push backend uses its own persona. **Import card…** and **Export card** stay usable.

## Voice

`configs/endpoints.json` holds these keys.

| Key | Shipped default | Purpose |
| --- | --- | --- |
| `stt_base_url` | unset | STT server base URL |
| `stt_model` | unset | `model` sent to the STT server; omitted when unset |
| `stt_language` | unset | `language` sent to the STT server, an ISO-639-1 code such as `ja`; omitted when unset or `auto`, and the server detects the language |
| `tts_provider` | `irodori` | TTS engine at `tts_base_url`: `irodori`, `openai`, or `fish` |
| `tts_base_url` | unset | TTS server root without `/v1` |
| `tts_model` | `irodori-tts` | Model sent to the TTS server: the request's `model` field for Irodori and OpenAI (it must match the server's configured name), or a `model` HTTP header for Fish (an S2-family id) |
| `tts_speaker` | unset | Default voice id, until another is picked in the panel |
| `tts_max_inflight` | `3` | Concurrent TTS synthesis requests |

Each provider has its own endpoint shape and decides how the cue's `emotion_text` and `caption` ride in the request and where the voice list comes from.

### Irodori

[Irodori TTS Server](https://github.com/Aratako/Irodori-TTS-Server) is the reference deployment. Follow that repo's README to run it (default port 8088). YUI prepends the emoji `emotion_text` tag to the spoken text and sends `caption` as `irodori.caption`. Irodori serves Japanese only, so instruct your backend agent to respond in Japanese.

```json
"tts_provider": "irodori",
"tts_base_url": "http://localhost:8088",
"tts_model": "irodori-tts",
"tts_speaker": "<voice-id>"
```

`tts_model` must match the name the server is configured under, or the server answers 400.

The TTS server decides which voice IDs are available (`GET /v1/audio/voices`), and YUI ships no bundled catalog. The panel's voice section lists them, and `tts_speaker` picks the one used until you choose another there. Voices live in the server's `voices/` directory, and the panel uploads imported reference clips with `POST`/`PUT /v1/audio/voices` and removes them with `DELETE /v1/audio/voices/{voice_id}`. When the server lists no voice that a local clip was imported under, the voice list refresh uploads that clip again.

### OpenAI

1. Create a key at [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. In the Connection page's TTS section, pick **OpenAI** as the provider. The server URL becomes `https://api.openai.com` and the model `gpt-4o-mini-tts`.
3. Paste the key into the **TTS API key** field.

The voice section lists OpenAI's 13 built-in voices: `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, `cedar`. Importing, deleting and re-uploading voices is off for this provider. YUI sends the spoken text as `input` and joins `emotion_text` and `caption` into `instructions`. The `tts-1` and `tts-1-hd` models ignore `instructions` and speak only `alloy`, `ash`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, and `shimmer`.

### Fish Audio

Fish Audio is a hosted service. Sign in at [https://fish.audio/](https://fish.audio/), create an API key, pick **Fish Audio** as the provider in the Connection page's TTS section (the server URL becomes `https://api.fish.audio` and the model `s2.1-pro-free`), and paste the key into the **TTS API key** field.

The model field takes any S2-family model id (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`, `drama-3-preview`). An unknown id falls back to `s2.1-pro` on Fish's side.

The voice section lists the models in your Fish account (`GET /model?self=true`) by their titles. Importing an audio file uploads it as a voice model (`POST /model`, fast training) and selects the model Fish creates, and deleting a voice removes the model from your account. A voice from Fish's public library that is not in your list can still be used: paste its voice id, or its voice page URL such as `https://fish.audio/m/<id>`, into the field under the voice list and it becomes the active voice. Deleting a pasted voice only takes it off the list. Imported and pasted voices belong to the provider they were added under, so they are listed only while that provider is selected.

YUI sends the spoken text as `text` to `POST <tts_base_url>/v1/tts` and the model as a `model` HTTP header. `emotion_text` and `caption` each ride as their own `[...]` bracket ahead of the sentence (S2 inline direction).

### STT

Serve any OpenAI-compatible transcription server at the configured URL, then set:

```json
"stt_base_url": "http://localhost:5517/v1"
```

YUI sends audio to `<stt_base_url>/audio/transcriptions`. If the server requires auth, set `VITE_YUI_STT_KEY` in `.env.local` for a dev run, or the **STT API key** on the **Listening and bubble** page in any build, and YUI sends it as `Authorization: Bearer`. A hosted API such as Groq also needs a model, which you can set as `stt_model` here (for example `"stt_model": "whisper-large-v3-turbo"`) or in the Connection page's **STT model** field, which overrides the file. To fix the spoken language, set `stt_language` the same way. The Connection page's **STT language** field suggests Auto, English, and Japanese and takes any other ISO-639-1 code.

## Keys

`VITE_YUI_*_KEY` values are read from `.env.local`, which is gitignored, and this fallback applies to dev runs only. A release build reads only the keys entered in the settings window.

| Variable | Service | Where the panel field sits |
| --- | --- | --- |
| `VITE_YUI_CHAT_KEY` | Chat | **Connection**, **Chat API key** |
| `VITE_YUI_STT_KEY` | STT | **Listening and bubble**, **STT API key** |
| `VITE_YUI_TTS_KEY` | TTS | **Connection**, **TTS API key** |

The key set in the panel wins, and the environment value is the fallback used when the panel field is empty; YUI sends each key as `Authorization: Bearer`. The environment value is read at build time, so restart the dev server after editing it. Copy `.env.example` to `.env.local` to start.

## Character

`configs/avatar.json` holds the model and its framing.

- `vrm_url` is what the app loads at boot, and the bundled default is `/vrms/Sendagaya_Shino.vrm`.
- `framing.margin` and `framing.fov` set the per-model framing.
- `hit_test.alpha_threshold` sets the hit-test alpha threshold.
- `tap.touch_cue_cooldown_ms` sets the gap between touch cues to the agent; the shipped value is `60000` ms, one cue a minute, shared by every touch region and the head pat.
- Every tunable section in the file is required, because the client reads each value from it and fails the load naming any key the file leaves out.

`available` lists the models the Body page offers. Each entry has `id`, `label`, `url` and `source` (`"bundled"`), and `id` is limited to `[A-Za-z0-9._-]`.

**Add from file…** on the Body page copies the file into the app data directory and adds it to the model list, so nothing in the repo changes. From the repo (`pnpm dev` or `pnpm tauri dev`), drop the file into `resources/vrms/`, which is gitignored except the bundled default, and Vite serves `/vrms/*` from there. Then set `vrm_url` to `/vrms/<file>.vrm` and add a matching `available` entry.

## Hotkeys

`configs/hotkeys.json` holds one key.

| Key | Shipped default | Purpose |
| --- | --- | --- |
| `summon_global` | `CmdOrCtrl+Shift+Y` | OS-wide shortcut: it brings the window forward and opens the text input from any app. An empty string disables it |

If another app holds the shortcut, registration fails and a notice names the accelerator.

## Filler

`configs/filler.json` holds the lines YUI speaks while a reply is pending, the lines for a turn that times out or cannot reach the backend, and the timing between them.

- `gap_ms` (`7000`), `gap_jitter_ms` (`1500`) and `gap_growth` (`2`) space the repeat lines.
- `max_repeats` (`3`) caps the repeats before one long-wait line.
- `long_wait_ms` (`40000`) is the silence before that long-wait line.
- `pools` holds the default lines for each language (`ja`, `en`, `ko`): a first line, repeat lines, a long-wait line, per-tool lines with a `_default`, a timeout line and an unreachable line.

The **Thinking interjections** section of the **Voice** page edits these lists per language, and an empty list uses the default from this file.

## Screen watch

`configs/screen.json` holds the screen-watch timings. The **Screen watch** controls on the **Proactive** page edit them.

| Key | Shipped default | Meaning |
| --- | --- | --- |
| `prev_dwell_ms` | `600000` (10 min) | The departed app must have held the foreground this long for a switch to count |
| `settle_ms` | `90000` (90 s) | The new app must hold the foreground this long before the switch fires |
| `long_session_ms` | `2700000` (45 min) | One app held this long marks a long session, re-marked each period |
| `min_gap_ms` | `300000` (5 min) | Minimum spacing between screen cues |
| `quiet_after_turn_ms` | `180000` (3 min) | No screen cue within this long of a backend turn |
| `recent_cap` | `5` | App switches held during a pause, carried into the next screen turn. `0` holds none |

## Guardrails

`configs/guardrails.json` holds the guardrails: per-source debounce, hourly caps and attachment limits. The **Limits** fields on the **Proactive** page override the caps, and an empty field uses the file.

| Setting | Shipped default | Meaning |
| --- | --- | --- |
| `rate_limit.window_ms` | `3600000` (1 h) | Length of the rolling window every cap counts in |
| `rate_limit.tier2_max` | `24` | Cues per hour: proactive, schedule, agent, signal, milestone and addressed turns together |
| `rate_limit.overall_max` | `40` | Total self-started turns per hour. Crossing it starts the cooldown |
| `rate_limit.urgent_max` | `120` | Urgent signal turns per hour. The cooldown never holds them |
| `rate_limit.cooldown_ms` | `300000` (5 min) | How long every cue is held once `overall_max` is crossed |
| `rate_limit.addressed_chain_max` | `2` | Answers to another character in a row, before you speak again |

The **Proactive gap** on the same page sets the quiet gap after any turn before YUI speaks up on her own, and its default is `600000` ms (10 minutes). It is a device setting, `yui.proactive-pacer-gap`, not a key in this file.

`debounce_ms` holds a per-source window: `5000` for `os_event_watcher`, `0` for `user_input_source`, and `5000` for `screen_watcher`. `attachments` caps one turn at `max_count` `6` images and `max_image_bytes` `5242880` (5 MiB) per image.

## Ingress

The loopback listener takes external signals and the avatar RPC routes.

| Setting | Shipped default | Meaning |
| --- | --- | --- |
| **External signals** | off | Turns the listener on. A change applies at the next launch |
| **Listener port** | `8770` | Port the listener binds on loopback |

Bare paths (`/signals`, `/avatar/state`, `/avatar/perch-targets`, `/avatar/command`, `/relations`) reach the active character in the main window. The `/presets/<id>/` paths reach the pet window bound to preset `<id>`. The route table, the replies and the envelope are in [Signals ingress](../reference/signals-ingress.md).

## Platform notes

- Idle watching works on both platforms. `os_idle_ms` polling is implemented on macOS and Windows, so idle-triggered and co-working proactive cues fire on either.
- Screenshot context needs Screen Recording permission on macOS. Grant it in System Settings → Privacy & Security.
- CI builds the Windows bundles, and they are tested on Windows.
