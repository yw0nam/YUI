# YUI — Hermes Integration

Chat io has two protocol modes, selected by `chat_api` in `configs/endpoints.json`: `responses` (default), described below, routes to a backend agent such as Hermes over the OpenAI Responses API. `chat_completions` connects over the Chat Completions API to a backend agent honoring the same expression contract — broker-dependent exactly like `responses`, since the client declares no `generate_express` tool of its own and runs no client-side tool-call loop; the backend agent reads the broker via `get_ids` and emits cues as `generate_express` tool-calls in the stream either way. The only client-side deltas are the transport and threading the conversation transcript locally instead of via `previous_response_id`. The rest of this doc covers `responses` mode.

Chat and STT use the **OpenAI-compatible API**; TTS depends on `tts_provider` (irodori is not OpenAI-compatible) and the broker is an MCP. Separate processes, all swappable via config:

- **chat → Hermes Agent** `localhost:8643` `/v1/responses`
- **STT →** `localhost:5517` `/v1/audio/transcriptions`
- **TTS →** provider-selected via `tts_provider` (default `irodori`): `irodori` → irodori_TTS `irodori_base_url` (`localhost:8091`) `/synthesize` (NOT OpenAI-compatible, reference-voice based, per-speaker voices in `irodori_voices`); `openai` → OpenAI-compatible `/v1/audio/speech` at `tts_base_url` (`localhost:8092`)
- **Expression Broker** (config-driven) `broker_base_url` (`localhost:3201/mcp`, streamable-http MCP) — YUI publishes renderable emotion/motion/emotion_text vocabulary, the agent reads it (publish skipped if unset)

**Auth.** Each OpenAI-compatible call carries `Authorization: Bearer` from a key resolved through `SecretProvider` — a runtime settings override, else the `.env.local` fallback: chat `VITE_YUI_CHAT_KEY`, STT `VITE_YUI_STT_KEY`, openai TTS `VITE_YUI_TTS_KEY`. An empty key sends no header. irodori is self-serving and takes no key.

**Control signals** are delivered as server-side `generate_express` tool-calls in the `/v1/responses` stream. Arguments are flat: `{ emotion_id?, motion_id?, emotion_text? }`; `emotion_text` is a per-provider TTS voice tag whose renderable vocabulary is published by the Expression Broker (irodori = emoji set, openai-compatible/fishspeech = free text), which the agent learns via the broker. Speech text is a separate assistant text stream (`response.output_text.delta`). `function_call` items are excluded from final `output[]` — must be captured during streaming. The renderable emotion/motion vocabulary is brokered by the Expression Broker MCP; the `generate_express` cue contract handed to the backend agent lives in [`docs/reference/backend-contract.md`](../reference/backend-contract.md).
