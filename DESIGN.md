---
name: YUI
description: Embodied desktop VRM companion — invisible-by-default UI, warm-when-present.
---

# Design System: YUI

The canonical token source is [`src/ui/tokens.css`](src/ui/tokens.css). Every value below mirrors that file. Doctrine: OKLCH only · no `#000`/`#fff` · all neutrals micro-tinted with the warm amber hue (~70–80°).

## 1. Overview

**Creative North Star: "The Hearthlight"**

YUI's UI is like the dying embers of a fireplace. It burns warmly in a corner of the room without stealing the gaze. The character owns the stage; the interface only lights up briefly when it has something to say, then recedes back into darkness. Colors are nearly achromatic neutral, and warmth is carried by a single point of amber. The font is a warm humanist sans; motion is only subtle feedback. This system's purpose is to *step back*.

The UI floats over an arbitrary desktop background in a transparent, always-on-top window. Every surface must therefore be *readable against any backdrop* without heavy containers. The surfaces that appear — speech bubble, text input, tool-status/quick-controls, capture and voice indicators — are the system's entirety and signature.

What this system explicitly rejects: bottom-right SaaS chatbot widgets (Intercom/Drift-style), messenger chat lists (Discord/Slack), the pushy speech bubbles of old desktop mascots (Clippy). YUI is not a widget, not a messenger, not a mascot.

**Key Characteristics:**
- Invisible-by-default: UI is absent at rest; the character/desktop fills the stage.
- Warm-when-present: when it appears, small amber warmth + humanist warmth.
- Legible-on-anything: readable on any background in a transparent window via self-contrast.
- Calm motion: subtle feedback transitions, no choreography, respect reduced-motion.

## 2. Colors

Near-achromatic warm neutral, with a single point of amber carrying warmth. All hues anchor to warm amber (~70–80°).

**Surface model: dark scrim + light warm text.** YUI floats over an arbitrary desktop in a transparent window, so a light surface with dark ink disappears against a white IDE. The robust answer is a subtitle: a semi-transparent dark scrim, light warm text, and a self-shadow. Floating surfaces use the light `--yui-text` family on the `--yui-scrim` family. The dark `--yui-ink` is retained only as a light-context token and is not used on floating surfaces.

### Accent — Hearth Amber
The sole accent responsible for warmth. Used only in *moments* — active input border, speech onset signal, focus/hover. ≤10% of any surface.
- `--yui-accent`: `oklch(0.8 0.13 75)`
- `--yui-accent-soft`: `oklch(0.8 0.13 75 / 0.45)`
- `--yui-accent-faint`: `oklch(0.8 0.13 75 / 0.16)`

### Text (on floating dark scrim)
Light warm neutrals, micro-tinted amber — not pure white.
- `--yui-text`: `oklch(0.95 0.012 80)` — body speech
- `--yui-text-dim`: `oklch(0.78 0.016 75)` — labels, tool status, secondary
- `--yui-text-mute`: `oklch(0.66 0.014 72)` — disabled, hints, eyebrow

### Surface (Scrim)
Semi-transparent dark backdrop for floating surfaces (speech bubble, chips). The key to legibility on any background (see Float in §4).
- `--yui-scrim`: `oklch(0.21 0.014 70 / 0.64)`
- `--yui-scrim-strong`: `oklch(0.19 0.014 70 / 0.82)` — where a surface must read more sharply, e.g. input
- `--yui-edge`: `oklch(0.97 0.01 80 / 0.1)` — hairline that holds a surface outline on dark backdrops
- `--yui-edge-strong`: `oklch(0.97 0.01 80 / 0.16)` — hover-emphasis hairline

### Light-context ink
Retained for light contexts; not used on floating surfaces.
- `--yui-ink`: `oklch(0.22 0.01 70)`

### Danger
Restrained warm-red for undo/failure messaging only. Hue 35 keeps it from clashing with amber.
- `--yui-danger`: `oklch(0.77 0.11 35)`
- `--yui-danger-soft`: `oklch(0.77 0.11 35 / 0.45)`
- `--yui-danger-faint`: `oklch(0.77 0.11 35 / 0.14)`

### Named Rules
**The 10% Warmth Rule.** Hearth Amber must occupy ≤10% of any screen. Scarcity is warmth — once common, it reads as branding and breaks invisible-by-default.

**The Legible-on-Anything Rule.** Every surface that carries text has *self-contrast* (dark scrim + light text + self-shadow). Legibility does not depend on the desktop background.

## 3. Typography

A single warm humanist sans carries display, body, and label — no separate mono, which would read tool-like. Crisp at small sizes (bubbles, labels), not cold or mechanical.

### Hierarchy
- **Display** (~600): rare moments only — character name etc.
- **Title** (~600): emphasis inside speech bubbles, tool result headings.
- **Body** (~400, line-height ~1.5): speech text. Conversational short bursts — a narrow column fitted to bubble width, not wide document width.
- **Label** (~500, light uppercase tracking): tool status ("Searching…"), timestamps.

### Named Rules
**The Speech-First Rule.** Body type is optimized for short conversational bursts inside speech bubbles. Do not import document layout rules (long line length, dense columns).

## 4. Elevation

The default is flat. Depth comes not from stacking shadows but from a single *soft ambient shadow layer* on the floating surface, plus a text self-shadow as legibility insurance against bright backgrounds. In a transparent window, shadows are a functional device that separates UI from the arbitrary background — not decoration.

### Shadow Vocabulary
- **Float** (`--yui-float`): `0 8px 32px oklch(0.12 0.02 70 / 0.4)` — single ambient layer for floating surfaces. No game-HUD neon glow or hard drop shadows.
- **Text shadow** (`--yui-text-shadow`): `0 1px 2px oklch(0.1 0.01 70 / 0.55)` — keeps light text legible over bright backdrops.

### Named Rules
**The Float Rule.** UI surfaces float above the desktop with exactly one soft ambient shadow. Multiple shadows · hard drop shadows · neon glows are prohibited.

## 5. Shape, Layout & Motion

### Shape (radius)
- `--yui-radius`: `14px` — primary surfaces (speech bubble)
- `--yui-radius-input`: `12px` — text input
- `--yui-radius-chip`: `999px` — pill chips / quick-controls
- `--yui-radius-row`: `10px` — list rows
- `--yui-radius-img`: `10px` — embedded imagery

### Speech bubble layout
- `--yui-bubble-bottom`: `16%` — bottom anchor over the character's lower band so the face stays unobscured
- `--yui-bubble-max-h`: `34vh` — long-utterance height cap; overflow scrolls internally

### Motion
Responsive, ease-out exponential (quint). No bounce/elastic. Quietly attenuated under `prefers-reduced-motion`.
- `--yui-ease`: `cubic-bezier(0.22, 1, 0.36, 1)`
- `--yui-dur`: `200ms`
- `--yui-dur-fast`: `140ms`
- `--yui-dwell`: `5000ms` — hold time after an utterance settles

## 6. Components

The implemented surfaces (CSS in `src/ui/`):

- **Speech bubble** (`surfaces.css`) — the primary floating surface: dark scrim, light warm text, single Float shadow, bottom-anchored at `--yui-bubble-bottom`, height-capped at `--yui-bubble-max-h` with internal scroll.
- **Text input** (`surfaces.css`) — `--yui-scrim-strong` backdrop, `--yui-radius-input`, Hearth Amber border only on active focus.
- **Tool status / quick-controls** (`quick-controls.css`) — pill chips (`--yui-radius-chip`) carrying tool-status labels in `--yui-text-dim`.
- **Capture indicator** (`capture-indicator.css`) — transient state cue for screen capture.
- **Voice input indicator** (`voice-input-indicator.css`) — transient state cue for VAD/STT listening.

## 7. Do's and Don'ts

### Do:
- **Do** micro-tint all neutrals with amber hue (chroma ~0.005–0.016). No `#000`/`#fff`; use OKLCH.
- **Do** keep Hearth Amber ≤10%, used only in *moments* (active input · speech signal · hover).
- **Do** give floating surfaces a self-scrim (dark, semi-transparent) plus light text for legibility on any background — but *only where legibility is needed* (speech bubble), not decorative.
- **Do** make motion Responsive: smooth enter/exit + feedback. Ease-out exponential curve. Quietly attenuate transitions under `prefers-reduced-motion`.
- **Do** keep it flat; add the Float shadow only when a surface lifts.

### Don't:
- **Don't** make it look like a **SaaS chatbot widget** (bordered card, gradient accent, generic widget tone).
- **Don't** stack chat lists · message rows · channel chrome like a **messenger app** (Discord/Slack/KakaoTalk).
- **Don't** use pushy, garish speech bubbles like an **old desktop mascot** (Clippy). The opposite of non-intrusive.
- **Don't** overuse decorative glassmorphism. Frosted backdrop is purposeful *only for legibility in one speech bubble* — otherwise skip it.
- **Don't** use side-stripe borders (color lines >1px on left/right), gradient text (`background-clip:text`), identical card grids, or modal-first patterns.
- **Don't** use amber as a fill — warmth is a point, not a plane (10% Warmth Rule).
