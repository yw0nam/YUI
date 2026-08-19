# YUI

Embodied desktop-pet frontend (the head) for the Hermes agent (the brain): it renders a VRM character, fires candidate events at the backend, and performs whatever the backend sends back. Judgment lives in the backend, so the language here is about _firing_ and _performing_, never about deciding what to say. This glossary is the canonical vocabulary; issue titles, test names, and proposals use these terms.

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
One backend round trip, from the moment the dispatcher admits a trigger until the reply's audio has drained. A local reaction that never reaches the brain is not a Turn. See ADR-0001.
_Avoid_: request, exchange, interaction

**Trigger**:
The event that makes a turn a candidate — typed text, a voice segment, a physical poke, a schedule tick. Carried as one of `user`, `schedule`, `proactive`, `agent`, `signals`. Firing a trigger is not a decision to speak.
_Avoid_: intent, command, prompt

**Guardrails**:
The gate a trigger passes before it becomes a turn: cooldown, do-not-disturb, debounce, rate limit. It answers whether to _bother_ the brain, never what the brain should say.
_Avoid_: filter, policy, throttle

**Tier**:
How a trigger is routed. Tier 1 is performed locally with no backend call; tiers 2 and 3 become turns.

**Trigger cue**:
Metadata about a schedule/proactive firing source (label, user-authored context, timing), forwarded client→brain. Includes built-in touch/gesture cues.
_Avoid_: bare "cue"

**Express cue**:
The one-way `generate_express` instruction, brain→client: emotion, motion, a TTS voice-tag (`emotion_text`), and a free-text voice direction (`caption`) carried out-of-band, streamed per beat and applied when the sentence it belongs to starts playing. Never inline markup inside speech text.
_Avoid_: bare "cue", expression command, tag, control token

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
The character's current physical state: `sitting`, `peeking`, or `dragging`. Absent while idle. Sent to the brain as context.
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
A floating piece of chrome the character speaks or listens through (speech bubble, tool-status chip, text input, voice indicator) that appears only when it has something to show, then recedes.
_Avoid_: widget, overlay, panel

**Signals**:
A burst of events from an external producer POSTed to the `/signals` ingress, flushed as one turn.

**Mod**:
A standalone MCP server the brain uses (avatar, browser-cdp, desktop-control, shell-sandbox). Not part of the app runtime.
