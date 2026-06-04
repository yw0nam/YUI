# Product

## Register

product

## Users

Personal use first (currently the developer), with future OSS release in mind.

Usage context: in front of a computer all day. The YUI character **lives on the desktop** as a transparent, always-on-top overlay — not an app you open a separate window for, but a presence living in a corner of your workspace.

Job-to-be-done: a companion that is alive beside you. A character you can talk to via text and voice, that notices screen context, and occasionally initiates conversation. The brain (judgment · memory · tools · persona) is handled by the Hermes backend; YUI handles only the **head** (rendering + sensing + I/O surfaces).

## Product Purpose

Embodied frontend (head) for Hermes Agent (brain). Renders a VRM character as a desktop pet, senses input (text · voice · screen), speaks via TTS + lipsync, displays chat/tool-status, and *fires* proactive triggers — but **all judgment is delegated to the backend** (`firing ≠ judgment`).

Success looks like: **the UI stays out of the way and the character feels alive.** The user is not *operating* a chat app — they are *with* a character.

## Brand Personality

Three words: **warm · present · unobtrusive**.

The character is the source of personality. The UI chrome's job is to **step back**. Nearly invisible at rest (character owns the stage); surfaces only when strictly needed (speech bubble · tool-status · input), and when it does, it is warm and characterful. Emotional goal: not a tool — **a living presence beside you**.

Core tone in one line: **invisible-by-default, warm-when-present.**

## Anti-references

- **Enterprise SaaS chatbot widget** (Intercom/Drift-style): bottom-right bubble widget, bordered card, gradient accent, generic SaaS tone. YUI is not a widget.
- **Messenger app** (Discord/Slack/KakaoTalk): chat list · message rows · channel chrome. YUI does not manage a conversation log.
- **Old desktop mascot** (Clippy/Office Assistant): tacky, pushy speech bubbles, gag-style interruptions. The exact opposite of non-intrusive.

(Game HUD / sci-fi overlay aesthetic is not a rejection target — neutrally allowed.)

## Design Principles

1. **Character is protagonist, UI is backstage staff.** Chrome recedes by default and only appears when it has something to say, then steps back again. (invisible-by-default)
2. **Warm when present.** When UI surfaces (speech bubble · tool-status · input), be characterful and warm — never like an enterprise widget. (warm-when-present)
3. **`firing ≠ judgment` in the UI too.** The client only *renders* the state the backend has determined. The UI does not invent persona · mode · opinions. Surfaces reflect backend signals; they do not fabricate them.
4. **Legible on anything.** The UI floats over an arbitrary desktop background in a transparent window. Every surface must be legible on any backdrop without heavy containers.
5. **Calm by default, respectful of attention.** Ambient liveliness is subtle; respect reduced-motion; do not steal attention (rate-limit · DND awareness). A companion does not nag.

## Accessibility & Inclusion

- **Confirmed requirement — respect reduced-motion:** Tier 1 ambient (blink/sway/breathing) and UI transitions run at all times, so they must quietly attenuate under OS `prefers-reduced-motion` (prevents motion sickness / distraction).
- **Current scope = personal minimum.** Beyond the above, basic-level only. **To be reinforced at OSS stage (deferred but acknowledged):** Do not rely solely on color for emotion/tool-status (color-blind safe); high-contrast text on arbitrary backgrounds (WCAG contrast). Currently deferred.
