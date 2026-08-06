# YUI

The embodied frontend for the Hermes agent: it renders a VRM character, fires candidate events at the
backend, and performs whatever the backend sends back. Judgment lives in the backend, so the language
here is about *firing* and *performing*, never about deciding what to say.

## Language

### Turn

**Turn**:
One backend round trip, from the moment the dispatcher admits a trigger until the reply's audio has
drained. A local reaction that never reaches the backend is not a Turn.
_Avoid_: request, exchange, interaction

**Trigger**:
An event that makes a Turn a candidate — typed text, a voice segment, a physical poke, a schedule tick.
Firing a Trigger is not a decision to speak.
_Avoid_: intent, command, prompt

**Guardrails**:
The gate a Trigger passes before it becomes a Turn: do-not-disturb, debounce, rate limit. It answers
whether to *bother* the backend, never what the backend should say.
_Avoid_: filter, policy, throttle

**Tier**:
How a Trigger is routed. Tier 1 is performed locally with no backend call; tiers 2 and 3 become Turns.

### Performance

**Express cue**:
An emotion and motion instruction the backend streams per beat, applied when the sentence it belongs to
starts playing. Never inline markup inside speech text.
_Avoid_: tag, control token, directive

**Filler**:
A short client-side utterance that covers the silence before the backend's first speech arrives. It is
stagecraft, not thinking, and it never influences what is said.
_Avoid_: thinking, placeholder, stall

**Surface**:
A piece of chrome the character speaks or listens through — the speech bubble, the text input, the tool
chip, the voice indicator.
_Avoid_: widget, overlay, panel

**Posture**:
The character's current physical situation: dragging, sitting on a window edge, peeking from a screen
edge, or idle. Sent to the backend as context.
_Avoid_: state, pose, stance
