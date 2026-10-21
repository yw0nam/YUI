# YUI

Embodied desktop-pet frontend (the body) for the selected backend agent (the brain): it renders a VRM character, fires candidate events at the backend, and performs whatever the backend sends back. Judgment lives in the backend, so the language here is about _firing_ and _performing_, never about deciding what to say. This glossary is the canonical vocabulary; issue titles, test names, and proposals use these terms.

## Language

### Split of responsibility

**Body**:
YUI itself — VRM rendering, sensing, and I/O surfaces. Holds no judgment.
_Avoid_: head, client-side brain, frontend agent

**Brain**:
The selected backend — judgment, persona, memory, and the agent loop.
_Avoid_: server, LLM (as a component name)

**Firing**:
Client-side detection that a candidate event occurred and a turn should be sent.
_Avoid_: triggering judgment, deciding to speak

**Judgment**:
The brain's decision whether and what to speak. Silence is expressed as empty speech text or the bare `[SILENT]` token, never a client-side gate.

### Turn lifecycle

**Turn**:
One backend round trip, from the moment the dispatcher admits a trigger until the reply's audio has drained. A local reaction that never reaches the brain is not a Turn.
_Avoid_: request, exchange, interaction

**Trigger**:
The event that makes a turn a candidate — typed text, a voice segment, a physical poke, a schedule tick. Carried as one of `user`, `schedule`, `proactive`, `agent`, `signals`, `milestone`. Firing a trigger is not a decision to speak.
_Avoid_: intent, command, prompt

**Guardrails**:
The gate a trigger passes before it becomes a turn: cooldown, do-not-disturb, debounce, rate limit. It answers whether to _bother_ the brain, never what the brain should say.
_Avoid_: filter, policy, throttle

**Tier**:
How a trigger is routed. Tier 1 is performed locally with no backend call; tier 2 becomes a turn.

**Trigger cue**:
Metadata about a schedule/proactive firing source (label, user-authored context, timing), forwarded client→brain. Includes built-in touch/gesture cues.
_Avoid_: bare "cue"

**Express cue**:
The one-way `generate_express` instruction, brain→client: emotion, motion, a TTS voice-tag (`emotion_text`), and a free-text voice direction (`caption`) carried out-of-band, streamed per beat and applied when the sentence it belongs to starts playing. Never inline markup inside speech text.
_Avoid_: bare "cue", expression command, tag, control token

**Reflex turn**:
A gesture-fired turn (head pat, drag-held, window-sit, peek, drop, touch) that skips the thinking filler — immediate reaction, no deliberative pause.

**Background marker**:
The placeholder user-content text on turns with no real user utterance.

**Client context**:
The per-turn JSON block of environment + trigger state the client injects ahead of the utterance.

**Expression Broker**:
The MCP where the body publishes its renderable emotion/motion/emotion_text vocabulary; the brain reads it to know what it can cue. Deprecated: removed in v0.6.0. Use client-declared tools.
_Avoid_: bare "broker", message broker

### Presence & body

**Posture**:
The character's current physical state: `standing`, `sitting`, `peeking`, `dragging`, `walking`, `climbing`, or `lying`. Sent to the brain as context on the `body:` line.
_Avoid_: state, pose, stance

**Perch**:
The character resting on a foreign window's edge; the supporting window is reported as `perched_on`.

**Ambient (Tier 1)**:
Backend-independent idle life — blink, sway, breath. Runs always; attenuates under reduced-motion.

**Filler**:
A short client-side utterance covering the silence between a firing and the brain's first speech. It is stagecraft, not thinking, and never influences what is said.
_Avoid_: thinking, placeholder, stall

### Surfaces & periphery

**Surface**:
A floating piece of chrome the character speaks or listens through (speech bubble, status pill, text input) that appears only when it has something to show, then recedes.
_Avoid_: widget, overlay, panel

**Signals**:
A burst of events from an external producer POSTed to the `/signals` ingress, flushed as one turn.

**Mod**:
A standalone MCP server the brain uses (avatar, browser-cdp, desktop-control, shell-sandbox). Not part of the app runtime.

### Configuration

**Tunable**:
A numeric or enum knob the client reads at boot (peek distances, jump gravity, gaze curve, attachment caps). Its one home is `configs/*.json`; the validator requires the section and the consuming module reads the validated value.
_Avoid_: default constant, fallback value, code-side default

**Preset**:
A named bundle of per-character client state: the backend connection and chat id, the TTS voice, the conversation history, the VRM selection, and the filler phrases. One preset is active at a time; the built-in default preset keeps the unprefixed storage keys. Everything else is device-wide and shared by every preset.
_Avoid_: profile, character (for this bundle)

**Task space**:
An ego lite tab workspace the `browser` tool works in, named `yui-<presetId>`: one per preset, so one per pet window. It outlives a call, the browser switch going off, the window, and the app, and the user closes it in ego lite. ego lite's "YUI" browser profile is where those spaces run, and it is not a Preset.
_Avoid_: tab group, browser session

**Bound pet window**:
A pet window opened for one preset by label `pet-<id>` and URL query `preset=<id>`. Its per-preset keys resolve under that preset (`yui.<id>.*`; the built-in default keeps the unprefixed keys) and it keeps the preset while `main`, the window without the query, follows the active one. It opens its own settings window `settings-<id>` and message window `message-<id>`, which resolve the same preset's keys and close when it closes or its preset leaves the registry. `yui.windows` is the device-wide list of ids the user wants open, and each of the three windows holds its live key `yui.live-window.<label>` from boot until it closes; the registry refuses to remove or activate a preset while any of the three is live, and `main` clears keys whose window no longer exists at boot.
_Avoid_: secondary window, companion window, extra window, sub-window
