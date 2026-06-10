# YUI — Product Reference

> Predecessor: [`concept.md`](./concept.md) (big-picture). Contract source of truth: [`contract.md`](./contract.md).

---

## 1. Product summary

**YUI** is the embodied frontend (**head**) for the Hermes Agent (brain, a separate backend). It renders a VRM character on the desktop in a transparent, always-on-top window, forwards the user's text, voice, and screen context to the backend, and expresses the backend's responses through facial expression, motion, lipsync, chat text, and TTS. The brain — judgment, persona, memory, tool calling, agent loop, speech decisions — lives entirely in the backend. The client is "sensor + renderer + desktop-pet shell."

**Core separation principle:** `firing ≠ judgment` — the client only observes *when a candidate event occurs*; *whether and what to say* is decided by the backend. There is no `should_speak` gate: silence is expressed by the backend sending no/empty speech text.

**Stack:** Tauri (Rust shell) + three.js + `@pixiv/three-vrm`. The browser render path enables screenshot-based automated visual verification of character state.

**Target users:**
- **Primary:** the author — a personal desktop companion alongside coding and writing.
- **Secondary:** technical users who run their own VRM and OpenAI-compatible LLM backend. Endpoints, VRM, and motion sets are config-swappable; nothing is hardcoded.

---

## 2. Non-goals

The client never holds a brain. The following are out of scope for the client and belong to the backend (or are excluded entirely):

- Judgment, persona/relationship state, long-term memory, tool calling, search, agent loop, speech decisions.
- Mode-branching logic (chat/assistant/pet). The client renders state only; it does not decide modes.
- Phoneme/viseme lipsync — amplitude-based lipsync is used.
- Multiple characters — single character only.
- Clipboard capture.

---

## 3. Features

### F1 — VRM render

Loads a VRM model from a config path and renders it. Hot-swaps to a new model when the configured VRM path changes, without an app restart. Drives BlendShape/expression and VRMA motion; spring bones remain stable during drag and motion playback.

Camera framing fits the full body (head to feet), front-facing and centered. The renderer measures the model bounding box on load, hot-swap, and window resize, deriving camera distance and `lookAt` so models of different heights stay framed. Framing knobs live in `configs/avatar.json` (`framing { margin, fov }`).

### F2 — Emotion expression

Renders 10 emotions: `neutral`, `happy`, `angry`, `sad`, `relaxed`, `surprised`, `thinking`, `curious`, `sleepy`, `embarrassed`. Each emotion maps to a VRM expression via `configs/emotion_registry.json` with an existence-aware fallback chain (`EmotionResolver`, pure, no three.js): each fallback candidate is accepted only if the current VRM actually has that expression, terminating at `neutral`. The resolver is rebuilt on every VRM hot-swap.

`setEmotion(null)` is a no-op (holds the prior expression); only an explicit `{id:"neutral"}` transitions to neutral. Reactivity (transition begins on the next frame) and `transition_ms` (interpolation duration, default 250) are independent axes. Expression weight is lerped per frame just before `vrm.update`, composing cleanly with tier-1 keys such as `blink`.

### F3 — Motion playback

Plays VRMA clips through a pure-state-machine `MotionController` with `AnimationMixer` crossfades. Motion registry: `configs/motions.json`. VRMA assets live in `public/motions/` and are served at `/motions/<id>.vrma`.

Registered motions: `idle` (ambient baseline, 13-variant random pool, looping), `drag`, `happy`, `laugh`, `embarrassed`, `sheepish`, `calm`, `peek`, `sleeping`, `sit`, `window_sit` (held state, 8-variant pool cycling every 4 s), and `dance` (13-variant random pool). A logical motion id with a `variants[]` pool selects a clip per play via `variant_policy` (`random` or `sequential`); entries without variants use a single `vrma_path`. Oneshot motions play once (`LoopOnce` + clamp) then return to the idle baseline.

### F4 — Ambient layer (Tier 1)

Backend-independent idle life: blink, idle sway, breath, and look-around. Runs from app start without a backend connection and does not stop during conversation (amplitude lipsync overrides only the mouth while speaking).

### F5 — Chat I/O

Calls Hermes at `/v1/responses` (OpenAI-compatible streaming) via the official `openai` npm SDK with a thin adapter; SSE framing, chunking, and abort are owned by the SDK. Assistant speech text arrives as the `response.output_text.delta` stream and renders token-by-token in the chat UI. Markdown (links, images) in speech text renders inline.

In the Tauri webview, requests use `@tauri-apps/plugin-http` `fetch` injected into the SDK so they egress through the Rust side without an `Origin` header. The dev (Vite) environment uses the global fetch via the Vite proxy. Environment is detected by the presence of `globalThis.__TAURI_INTERNALS__`.

### F6 — STT input

Voice input via VAD (Silero + ONNX, `@ricky0123/vad-web`): detects speech start/end, records, and posts audio to `/audio/transcriptions` for transcription, then sends the text to the backend. Voice mode is an explicit toggle.

### F7 — TTS output and lipsync

Provider-switchable TTS selected by `tts_provider`:
- `irodori` (default) — `irodori_base_url` (`localhost:8091`) `/synthesize`, reference-voice based (not OpenAI-compatible); per-speaker voices in the `irodori_voices` registry, chosen by `irodori_speaker`.
- `openai` — OpenAI-compatible `/audio/speech` at `tts_base_url` (`localhost:8092`).

The pipeline buffers the streaming speech text, detects sentence boundaries, calls the TTS provider per sentence, and plays the resulting wav while preserving original sentence order even if responses arrive out of order. Amplitude-based lipsync drives the mouth BlendShape from the playing wav's amplitude. The mouth-open gain is a runtime slider (0.5×–4.0×, default 2.0×, persisted at `yui.lipsync`) with live VRM preview while dragging.

### F8 — Control transport (`generate_express`)

Non-verbal control signals arrive as server-side `generate_express` tool-calls in the `/v1/responses` stream. The client parses `function_call` items whose name is `generate_express`; `function_call` items are excluded from final `output[]`, so they are captured during streaming. Arguments are flat: `{ emotion_id?, motion_id?, emotion_text? }`. There is no speech gate (`should_speak`).

`generate_express` and its fields are optional — a turn without it holds the prior expression and idle motion. When `motion_id` is omitted, the client may derive a oneshot gesture from the emotion transition. `emotion_text` is a per-provider TTS voice-control tag prepended only to the TTS sentence text and never shown in the chat UI; for irodori it is an emoji-tag set (repeating or combining emoji intensifies the cue).

### F9 — Expression Broker (MCP publish)

YUI publishes the renderable emotion / motion / `emotion_text` vocabulary it can actually render to the Expression Broker MCP (`broker_base_url`, `localhost:3201/mcp`, streamable-http) on boot, VRM hot-swap, and broker reconnect, using `update_*` (WRITER role). The Hermes agent reads the valid vocabulary from the broker and calls `generate_express` within it. The `emotion_text` gate is provider-conditional: irodori ⇒ `enum` mode (only emoji-table keys allowed; unregistered values dropped with a warning, never blocking speech), openai-compatible/fishspeech ⇒ `free` mode (pass-through). When the broker is down, YUI degrades best-effort: publish is skipped and boot is not blocked. Publish is skipped entirely if `broker_base_url` is unset.

### F10 — Tauri shell

Transparent, always-on-top, borderless window across macOS and Windows. The character can be grabbed and dragged via native Rust drag, following the cursor and staying where released. Captures screenshots for context attachment. A Rust `os_event_watcher` emits OS signals (idle, active app, fullscreen).

### F11 — Input context and screenshot

Every backend request carries `{ active_app, window_title, timestamp }`. A screenshot toggle, when ON, attaches the captured monitor as image content to each conversation. Source selection is by monitor index.

### F12 — Event dispatcher

A client-side event dispatcher collects events from timer, idle-watcher, OS-event-watcher, and user-input sources onto a single bus, then runs `classify → guardrails → backend-caller`. Tier-1 events are consumed locally; Tier-2/3 events are packaged and sent to the backend. Tier-2/3 firing is gated by guardrails (`configs/guardrails.json`): per-window caps `tier2_max` 12, `tier3_max` 2, `overall_max` 26 over a 60-minute window, with a 5-minute cooldown and per-source debounce. DND suppresses proactive firing when the active app is on the blocklist or the OS is in do-not-disturb.

### F13 — Co-working proactivity (Tier 2)

The `proactive.cowork` source consumes the Rust idle tick and, while the user is present (OS idle ≤ `present_max_idle_ms`, default 60 s), fires a `proactive.cowork` (tier2) candidate every cadence (`interval_ms`, default 10 min; `configs/sources.json`). A proactive toggle (`proactive-settings`, default ON, persisted at `yui.proactive`) gates firing at the source — OFF means zero Tier-2/3 proactive firing while Tier-1 ambient is unaffected. Firing is only firing: whether and what to say is the backend's decision (silence = no speech text). Co-working depends on the OS idle signal; macOS provides it, and on Windows `os_idle_ms` is `null` so co-working is inert.

### F14 — Session continuity

The client owns a single Hermes session id — a client-minted UUID persisted at `yui.session_id` and sent on every `/v1/responses` request as the `X-Hermes-Session-Id` header. It survives restarts and never expires; the transcript lives server-side. "Start fresh" clears the id and mints a new UUID on the next turn.

When context grows, the client rotates to a continuation session at a safe turn boundary via `POST {chat_base_url origin}/api/sessions/{id}/compress`. Triggers: idle resume, token threshold (`chat_model_context_window × compact_threshold_ratio`, with `compact_resume_ratio` hysteresis), and window blur. Compaction is a blocking maintenance window: the dispatcher enters `compacting`, queue-gates new turns, disables input, plays a `thinking` cue, and bounds the call by `compact_timeout_ms`. Any failure (skip/error/timeout/non-2xx) preserves the current id. The client owns only invocation and session boundaries; the actual compaction and memory live in Hermes.

### F15 — Settings UI

Per-user settings, persisted in localStorage and exposed in the settings surface, cover: endpoints; agent request shaping (`reasoning.effort` as `default · low · medium · high`, where `default` omits the parameter; `instructions` override, falling back to `EndpointsConfig.chat_instructions` when empty; persisted at `yui.agent`); lipsync mouth gain; screenshot; camera/framing; proactive toggle; speaker selection; and VRM toggles.

### F16 — Config (file-based, hot-reloadable)

Runtime configuration lives in `configs/` (no hardcoding): `endpoints.json` (chat/stt/tts base URLs, `tts_provider`, `irodori_*`, `broker_base_url`), `emotion_registry.json`, `motions.json`, `avatar.json`, `emotion_text/<provider>.json`, `guardrails.json`, and `sources.json`. VRM, motion registry, and proactivity parameters hot-reload on file change.

---

## 4. Backend dependencies (Hermes)

YUI requires the backend to provide:

1. **OpenAI-compatible chat** — `/v1/responses` streaming, with assistant speech as the `response.output_text.delta` text stream.
2. **`generate_express` tool (optional non-verbal channel)** — an OpenAI-compatible backend that exposes `generate_express(...)` tool-calls in the stream when emotion/motion/`emotion_text` direction is wanted. It is optional; turns without it are handled by the client as idle.
3. **Silence as no speech text** — when the backend chooses not to speak, it emits no assistant text; the client skips speech for empty text. No `should_speak` flag.
4. **STT endpoint** — `/audio/transcriptions` (OpenAI-compatible), served separately from Hermes.
5. **TTS provider endpoint** — the provider selected by `tts_provider` (irodori `/synthesize` or OpenAI-compatible `/audio/speech`), served separately.
6. **Image input handling** — vision routing when a screenshot is attached as image content.
7. **Optional Expression Broker MCP** — reads YUI's published renderable vocabulary and constrains `generate_express` to it.
