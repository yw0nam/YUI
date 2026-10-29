# Voice in and out

Speech out and speech in are separate optional services. YUI points at both through `configs/endpoints.json` or the Connection page of the settings window, and the voice itself is picked on the **Voice** page.

## Voice output (TTS, optional)

Without TTS, YUI displays text in the speech bubble but produces no audio. `tts_provider` names the engine at `tts_base_url`: `irodori` (the shipped default), `openai`, or `fish`. Each provider has its own endpoint shape and decides how the cue's `emotion_text` and `caption` ride in the request and where the voice list comes from. The `emotion_text` vocabulary is in [TTS Emotion](tts-emotion/). The **Provider** select in the Connection tab's TTS section sets the provider and fills in its server URL and default model.

If the server requires auth, set `VITE_YUI_TTS_KEY` in `.env.local`. YUI sends it as `Authorization: Bearer`. Like all key fallbacks this applies to dev runs only; a release build reads the key entered in the Connection tab.

### Irodori

[Irodori TTS Server](https://github.com/Aratako/Irodori-TTS-Server) is the reference deployment. Follow that repo's README to run it (default port 8088). YUI prepends the emoji `emotion_text` tag to the spoken text and sends `caption` as `irodori.caption`.

**Caveat: Irodori serves Japanese only.** When using it, instruct your backend agent to respond in Japanese.

In `configs/endpoints.json`:
```json
"tts_provider": "irodori",
"tts_base_url": "http://localhost:8088",
"tts_model": "irodori-tts",
"tts_speaker": "<voice-id>"
```

`tts_model` must match the name the server is configured under, or the server answers 400.

The TTS server is the source of truth for the available voice IDs (`GET /v1/audio/voices`), and YUI ships no bundled catalog. The panel's voice section lists them; `tts_speaker` picks the one used until you choose another there. Voices live in the server's `voices/` directory, and the panel uploads imported reference clips with `POST`/`PUT /v1/audio/voices` and removes them with `DELETE /v1/audio/voices/{voice_id}`. When the server lists no voice a local clip was imported under, the voice list refresh uploads that clip again.

### OpenAI

1. Create a key at [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. In the Connection tab's TTS section, pick **OpenAI** as the provider. The server URL becomes `https://api.openai.com` and the model `gpt-4o-mini-tts`.
3. Paste the key into the TTS API key field.

The voice section lists OpenAI's 13 built-in voices: `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, `cedar`. Importing, deleting, and re-uploading voices is off for this provider. YUI sends the spoken text as `input` and joins `emotion_text` and `caption` into `instructions`. The `tts-1` and `tts-1-hd` models ignore `instructions` and speak only `alloy`, `ash`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, and `shimmer`.

### Fish

Fish Audio is a hosted service. Sign in at [https://fish.audio/](https://fish.audio/), create an API key, pick **Fish Audio** as the provider in the Connection tab's TTS section (the server URL becomes `https://api.fish.audio` and the model `s2.1-pro-free`), and paste the key into the TTS API key field.

The model field takes any S2-family model id (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`, `drama-3-preview`); an unknown id falls back to `s2.1-pro` on Fish's side.

The voice section lists the models in your Fish account (`GET /model?self=true`) by their titles. Importing an audio file uploads it as a voice model (`POST /model`, fast training) and selects the model Fish creates; deleting a voice removes the model from your account. A voice from Fish's public library that is not in your list can still be used: paste its voice id, or its voice page URL such as `https://fish.audio/m/<id>`, into the field under the voice list and it becomes the active voice. Deleting a pasted voice only takes it off the list. Imported and pasted voices belong to the provider they were added under, so they are listed only while that provider is selected.

YUI sends the spoken text as `text` to `POST <tts_base_url>/v1/tts` and the model as a `model` HTTP header. `emotion_text` and `caption` each ride as their own `[...]` bracket ahead of the sentence (S2 inline direction).

## Voice input (STT, optional)

Without STT, text input still works. VAD (Silero + ONNX) runs client-side; STT sends segmented audio to a transcription server.

Serve any OpenAI-compatible transcription server at the configured URL, then set:
```json
"stt_base_url": "http://localhost:5517/v1"
```

YUI sends audio to `<stt_base_url>/audio/transcriptions`. If the server requires auth, set `VITE_YUI_STT_KEY` in `.env.local` (dev runs; a release build reads the key entered on the Listening and bubble page), and YUI sends it as `Authorization: Bearer`. A hosted API such as Groq also needs a model: set `stt_model` in `configs/endpoints.json` (for example `"stt_model": "whisper-large-v3-turbo"`) or in the Connection tab's STT model field, which overrides the file. To fix the spoken language, set `stt_language` the same way; the Connection tab's STT language field suggests Auto, English, and Japanese and takes any other ISO-639-1 code.

## Wire it all together: `configs/endpoints.json`

YUI ships with no service addresses: every URL in the bundled `configs/endpoints.json` is unset, and an unset URL means that feature is off. STT and TTS stay quiet, and a chat turn with no `chat_base_url` answers with an inline "Backend not configured" error pointing at **Connection**.

Point YUI at your services by editing `configs/endpoints.json` or using the in-app Endpoint settings panel, which persists overrides to local storage and leaves the bundled file untouched.

Key reference:

| Key | Shipped default | Purpose |
|---|---|---|
| `chat_api` | `chat_completions` | Chat protocol: `"chat_completions"` (client-declared `generate_express`, any tool-calling endpoint), `"responses"` (backend agent honoring the expression contract), or `"push"` (one WebSocket, see [push transport](../reference/push-transport.md)) |
| `chat_base_url` | unset | In `chat_completions` and `responses` modes, the API root including `/v1`, to which the client appends `/chat/completions` or `/responses`. In push mode, the WebSocket base without `/v1`, where the client opens `<chat_base_url>/ws` |
| `chat_model` | unset | Model ID sent to the backend |
| `chat_model_context_window` | `200000` | Token window: display in Responses mode, and the trim length of the client-side transcript in Chat Completions mode |
| `chat_instructions` | expression prompt | System-level nudge on how to use `generate_express`; appended to the card, sent as `instructions` (Responses) or the first system message (Chat Completions) |
| `stt_base_url` | unset | STT server base URL |
| `stt_model` | unset | `model` sent to the STT server; omitted when unset |
| `stt_language` | unset | `language` sent to the STT server, an ISO-639-1 code such as `ja`; omitted when unset or `auto`, and the server detects the language |
| `tts_provider` | `irodori` | TTS engine at `tts_base_url`: `irodori`, `openai`, or `fish` |
| `tts_base_url` | unset | TTS server root without `/v1` |
| `tts_model` | `irodori-tts` | Model sent to the TTS server: the request's `model` field for Irodori and OpenAI (it must match the server's configured name), or a `model` HTTP header for Fish (an S2-family id) |
| `tts_speaker` | unset | Default voice id, until another is picked in the panel |
| `tts_max_inflight` | `3` | Concurrent TTS synthesis requests |

All service addresses come from this file or the in-app overrides.
