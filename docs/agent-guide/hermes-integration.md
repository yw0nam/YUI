# YUI — Hermes Integration

Chat and STT use the **OpenAI-compatible API**; TTS depends on `tts_provider` (irodori is not OpenAI-compatible) and the broker is an MCP. Separate processes, all swappable via config:

- **chat → Hermes Agent** `localhost:8643` `/v1/responses`
- **STT →** `localhost:5517` `/audio/transcriptions`
- **TTS →** provider-selected via `tts_provider` (default `irodori`): `irodori` → irodori_TTS `irodori_base_url` (`localhost:8091`) `/synthesize` (NOT OpenAI-compatible, reference-voice based, per-speaker voices in `irodori_voices`); `openai` → OpenAI-compatible `/audio/speech` at `tts_base_url` (`localhost:8092`)
- **Expression Broker** (config-driven) `broker_base_url` (`localhost:3201/mcp`, streamable-http MCP) — YUI publishes renderable emotion/motion/emotion_text vocabulary, the agent reads it (publish skipped if unset)

**Control signals** are delivered as server-side `generate_express` tool-calls in the `/v1/responses` stream. Arguments are flat: `{ emotion_id?, motion_id?, emotion_text? }` — no `should_speak` (**D-NO-SPEAK-GATE**); `emotion_text` is a per-provider TTS voice tag whose renderable vocabulary is published by the Expression Broker (irodori = emoji set, openai-compatible/fishspeech = free text), which the agent learns via the broker. Speech text is a separate assistant text stream (`response.output_text.delta`). `function_call` items are excluded from final `output[]` — must be captured during streaming. The renderable emotion/motion vocabulary is brokered by the Expression Broker MCP; the `generate_express` cue contract handed to the backend agent lives in [`docs/backend_agent_broker_interaction.md`](../backend_agent_broker_interaction.md).
