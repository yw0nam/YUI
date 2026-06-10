# YUI — Concept

YUI is the embodied frontend (**head**) for the Hermes Agent (**brain**): VRM
character rendering, desktop-pet behavior, and I/O surfaces. The brain — MCP,
tool calling, search, long-term memory, persona/relationship state, and the
agent loop — lives in the backend.

**Core split:** `firing ≠ judgment`. The client owns *firing* — detecting when a
candidate event occurs. The backend owns *judgment* — whether and what to speak.
There is no `should_speak` flag (D-NO-SPEAK-GATE); silence is expressed as no/empty
speech text, and the client renders whatever text arrives. No brain, persona
state, or mode-branching lives in the client.

---

## 1. Architecture principles

- **Communication.** Chat and STT use the OpenAI-compatible API; TTS is
  provider-switchable (irodori is not OpenAI-compatible). The Expression Broker
  is an MCP. All are separate, config-swappable processes.
  - chat → `/v1/responses`
  - STT → `/audio/transcriptions`
  - TTS → provider-selected (irodori `/synthesize` or openai-compatible `/audio/speech`)
  - vision input → chat image content
- **No brain in the client** — rendering and I/O surfaces only.
- **Config-driven** — endpoints, models, VRM paths, and motion sets live in
  `configs/`, never hardcoded.
- **Stack** — web rendering (three.js + `@pixiv/three-vrm`) inside a Tauri shell.
  Rendering/UI is screenshot-verifiable in the browser; the native window layer
  is isolated in Tauri.

---

## 2. Feature surfaces

### A. VRM rendering
- VRM model load with hot-swap via config.
- VRMA motion playback from a prebuilt motion set.
- Expression/pose control (BlendShape/expression) mapped from backend emotion signals.
- Spring-bone physics.

### B. Desktop shell / pet behavior (Tauri layer)
- Transparent, always-on-top window.
- Per-region hit-test — the character silhouette is interactive, transparent
  area is click-through (pass-through), so dragging and click-through coexist.
- Drag to reposition.
- OS-native window drag, multi-monitor capture, click/pet reactions.

### C. Input (client = sensor)
- Text input.
- Voice input → STT (`/audio/transcriptions`), gated by VAD (Silero + ONNX) for
  recording start/end detection.
- Screen context: active app, window title, time → sent to the backend.
- Screenshot capture → vision input for the backend.

### D. Output / presentation (backend signal → render)
- Text response (speech bubble / chat UI).
- Voice output → TTS + amplitude-based lipsync (WebAudio amplitude drives the
  mouth blendshape).
- Emotion signal → VRM expression change.
- Motion trigger → designated VRMA playback.
- Tool-status display and rich content (images · links · cards).
- Ambient animation layer (Tier 1) — blink / idle sway / breath / look-around.
  Always on, backend-independent (no network).

### E. Communication / protocol (the contract)
- OpenAI-compatible streaming with turn-bound control signals (emotion/motion)
  as structured output — never inline text tags.
- Client-side event loop / dispatcher with sources: timer · idle-watcher ·
  OS-event-watcher · user-input. It only fires triggers; judgment is delegated.

```
sources: timer / idle-watcher / OS-event-watcher / user-input
   → event bus
   → dispatcher (classify → guardrails → route)
        ├ Tier 1 → local animation (no backend)
        └ Tier 2·3 → context packaging → backend call → render
```

### F. Settings / customization
- Config-file based: API endpoints/keys, models, VRM path, motion set.
- A settings toggle gates proactive (Tier 2/3) firing, default ON.

### G. Modes
- Chat · assistant · pet personas coexist in one character. Persona/mode state is
  the backend's concern. The client fires mode-transition triggers and displays
  the current mode; it holds no mode-branching logic.

---

## 3. Proactivity — 3-tier routing

| Tier | Content | firing | judgment / content |
|------|---------|--------|--------------------|
| **1 — ambient liveliness** | blink, idle sway, breath, look-around | client | client (no backend) |
| **2 — light utterance** | co-working remarks, time-of-day greetings | client (cowork/timer/watcher) | backend (persona-aware) |
| **3 — contextual intervention** | proactive suggestion after sensing | client (sensing) | backend |

- **Co-working trigger (Tier 2).** While the user is present (OS idle ≤
  `present_max_idle_ms`, default 60s), the client fires `proactive.cowork` on a
  cadence (`interval_ms`, default 10 min) — a "working alongside you" model. It
  only fires; whether and what to say is the backend's judgment (silence = no
  text emitted).
- **Proactive toggle.** An on/off switch gates Tier 2/3 firing at the source
  (default ON). It does not touch Tier 1 ambient, which is an always-on,
  backend-independent layer.
- **OS idle dependency.** Co-working relies on the Rust `os_event_watcher`
  presence signal. `os_idle_ms` is null on Windows, so co-working is inert there.
- **Guardrails.** Tier 2/3 firing passes rate-limit + debounce + DND (focus
  detection) guards before reaching the backend-caller.
- **Tier 2 silence.** The backend expresses "not speaking now" by emitting no
  assistant text (D-NO-SPEAK-GATE, contract §3); to express only a face it sends
  emotion via `generate_express`. Client-side rate-limit/debounce/DND are the
  runaway safety net (firing is client-owned).

---

## 4. The contract

The client ↔ Hermes contract (see [`contract.md`](contract.md)):

- **Emotion vocabulary** — backend emotion enum ↔ client VRM expression registry,
  with existence-aware fallback (`configs/emotion_registry.json`).
- **Motion registry** — backend motion ID ↔ client VRMA mapping
  (`configs/motions.json`, catalog in [`motions.md`](motions.md)).
- **Control signal envelope** — emotion/motion/emotion_text carried in the
  `generate_express` tool-call. No `should_speak` (D-NO-SPEAK-GATE).
- **Input context schema** — sensor data (active app, window title, time,
  screenshot) the client sends to the backend.
- **Session continuity** — `X-Hermes-Session-Id` plus token-threshold compaction.

---

## 5. Non-goals (delegated to Hermes)

- MCP / tool calling
- search
- long-term memory + relationship/persona state
- agent loop
- proactivity **judgment** (whether to speak · content)

The client renders/displays those results. Trigger **firing · sourcing** is the
client's responsibility.

---

## 6. References

- **Amica** (semperai/amica, MIT) — three-vrm + Tauri + OpenAI-compatible chat. Structural reference.
- **ChatVRM** (pixiv) — simpler starting point.
- **Desktop Homunculus** (not-elm/desktop-homunculus, MIT) — native window behavior (sitting on windows) reference.
