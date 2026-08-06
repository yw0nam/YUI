# YUI

Embodied desktop-pet frontend (the head) for the Hermes agent (the brain). This glossary is the canonical vocabulary; issue titles, test names, and proposals use these terms.

## Language

### Split of responsibility

**Head**:
YUI itself — VRM rendering, sensing, and I/O surfaces. Holds no judgment.
_Avoid_: client-side brain, frontend agent

**Brain**:
The Hermes backend — judgment, persona, memory, and the agent loop.
_Avoid_: server, LLM (as a component name)

**Firing**:
Client-side detection that a candidate event occurred and a turn should be sent.
_Avoid_: triggering judgment, deciding to speak

**Judgment**:
The brain's decision whether and what to speak. Silence is expressed as empty speech text, never a client-side gate.

### Turn lifecycle

**Turn**:
One full exchange: a firing sends client context + content to the brain; the reply renders as speech/expression.

**Trigger**:
The reason a turn fired — one of `user`, `schedule`, `proactive`, `agent`, `signals`.

**Trigger cue**:
Metadata about a schedule/proactive firing source (label, user-authored context, timing), forwarded client→brain. Includes built-in touch/gesture cues.
_Avoid_: bare "cue"

**Express cue**:
The one-way `generate_express` instruction, brain→client: emotion, motion, and TTS voice-tag text for the turn.
_Avoid_: bare "cue", expression command

**Reflex turn**:
A gesture-fired turn (drag-held, window-sit, peek) that skips the thinking filler — immediate reaction, no deliberative pause.

**Background marker**:
The placeholder user-content text on turns with no real user utterance.

**Client context**:
The per-turn JSON block of environment + trigger state the client injects ahead of the utterance.

**Expression Broker**:
The MCP where the head publishes its renderable emotion/motion/emotion_text vocabulary; the brain reads it to know what it can cue.
_Avoid_: bare "broker", message broker

### Presence & body

**Posture**:
The character's current physical state: `sitting`, `peeking`, or `dragging`. Absent while idle.

**Perch**:
The character resting on a foreign window's edge; the supporting window is reported as `perched_on`.

**Ambient (Tier 1)**:
Backend-independent idle life — blink, sway, breath. Runs always; attenuates under reduced-motion.

**Filler**:
Brief motion/audio bridging the wait between a firing and the brain's first speech.

### Surfaces & periphery

**Surface**:
A floating UI element (speech bubble, tool-status chip, text input) that appears only when it has something to show, then recedes.

**Guardrails**:
Dispatcher cooldown/suppression rules that rate-limit firings before they become turns.

**Signals**:
A burst of events from an external producer POSTed to the `/signals` ingress, flushed as one turn.

**Mod**:
A standalone MCP server the brain uses (avatar, browser-cdp, desktop-control, shell-sandbox). Not part of the app runtime.
