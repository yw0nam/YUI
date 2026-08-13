---
name: YUI
description: Embodied desktop VRM companion — invisible-by-default UI, warm-when-present.
colors:
  accent: "oklch(0.8 0.13 75)"
  accent-soft: "oklch(0.8 0.13 75 / 0.45)"
  accent-faint: "oklch(0.8 0.13 75 / 0.16)"
  text: "oklch(0.95 0.012 80)"
  text-dim: "oklch(0.78 0.016 75)"
  text-mute: "oklch(0.66 0.014 72)"
  scrim: "oklch(0.21 0.014 70 / 0.64)"
  scrim-strong: "oklch(0.19 0.014 70 / 0.82)"
  edge: "oklch(0.97 0.01 80 / 0.1)"
  edge-strong: "oklch(0.97 0.01 80 / 0.16)"
  ink: "oklch(0.22 0.01 70)"
  danger: "oklch(0.77 0.11 35)"
  danger-soft: "oklch(0.77 0.11 35 / 0.45)"
  danger-faint: "oklch(0.77 0.11 35 / 0.14)"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontWeight: 600
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0rem"
    fontWeight: 600
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.02em"
rounded:
  md: "14px"
  input: "12px"
  chip: "999px"
  row: "10px"
  img: "10px"
components:
  speech-bubble:
    backgroundColor: "{colors.scrim}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.7rem 0.95rem"
  text-input:
    backgroundColor: "{colors.scrim-strong}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    padding: "0.55rem 0.7rem"
  tool-status:
    backgroundColor: "{colors.scrim-strong}"
    textColor: "{colors.text-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "0.28rem 0.7rem"
  voice-indicator:
    backgroundColor: "{colors.scrim-strong}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.chip}"
    padding: "0.3rem 0.64rem"
  capture-indicator:
    backgroundColor: "{colors.scrim-strong}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.chip}"
    padding: "0.3rem 0.66rem"
  settings-row:
    rounded: "{rounded.row}"
    padding: "0.5rem 0.55rem"
---

# Design System: YUI

The canonical token source is [`src/ui/tokens.css`](src/ui/tokens.css); the frontmatter above mirrors it. Doctrine: OKLCH only, never `#000`/`#fff`, every neutral micro-tinted toward warm amber (~72°).

## 1. Overview

**Creative North Star: "The Hearthlight"**

YUI's interface is the dying embers of a fireplace: it burns warmly in a corner of the room without stealing the gaze. The character owns the stage; the chrome lights up only when it has something to say, then recedes into the dark. Color is near-achromatic neutral, warmth carried by a single point of amber. Type is a warm humanist sans; motion is feedback, never choreography. The whole system's purpose is to *step back*.

Every surface floats over an arbitrary desktop background in a transparent, always-on-top window, so each must be legible against any backdrop without a heavy container. The surfaces that ever appear (speech bubble, text input, tool-status chip, capture and voice indicators, boot-failure notice) are the system's entirety and its signature.

This system explicitly rejects the bottom-right SaaS chatbot widget (Intercom/Drift), the messenger chat list (Discord/Slack/KakaoTalk), and the pushy speech bubbles of the old desktop mascot (Clippy). YUI is not a widget, not a messenger, not a mascot.

**Key Characteristics:**
- Invisible-by-default: chrome is absent at rest; the character and desktop fill the stage.
- Warm-when-present: when a surface appears, a small amber warmth meets humanist warmth.
- Legible-on-anything: readable over any background through self-contrast, not the backdrop.
- Calm motion: feedback transitions only, no choreography, quietly attenuated under reduced-motion.

## 2. Colors

Near-achromatic warm neutral with a single point of amber. The model is **dark scrim + light warm text**: a light surface with dark ink vanishes against a white IDE, so surfaces read like a subtitle, a semi-transparent dark scrim under light warm text with its own shadow. All hues anchor to warm amber (~72°).

### Primary
- **Hearth Amber** (`oklch(0.8 0.13 75)`): the sole accent and the only carrier of warmth. Used in *moments* only: active input border, speech onset caret, focus and hover. A soft (`/ 0.45`) and faint (`/ 0.16`) variant carry focus rings and underlines.

### Neutral
- **Speech White** (`oklch(0.95 0.012 80)`): primary body/speech text on a floating surface; warm, not pure white.
- **Ash** (`oklch(0.78 0.016 75)`): labels, tool-status, secondary text.
- **Muted Ash** (`oklch(0.66 0.014 72)`): disabled text, hints, eyebrows.
- **Scrim** (`oklch(0.21 0.014 70 / 0.64)`): the semi-transparent dark backdrop under every floating surface; a stronger variant (`oklch(0.19 0.014 70 / 0.82)`) sharpens the text input and the small-label chips (tool-status, capture/voice pills).
- **Hairline** (`oklch(0.97 0.01 80 / 0.1)`, hover `/ 0.16`): the thin edge that holds a surface outline against a dark backdrop.
- **Warm Ink** (`oklch(0.22 0.01 70)`): dark body text, retained for light contexts only; never used on a floating surface.

### Functional
- **Ember Red** (`oklch(0.77 0.11 35)`): undo and failure messaging only. Hue 35 keeps it clear of the amber accent; soft and faint variants match the accent pattern.

### Named Rules
**The 10% Warmth Rule.** Hearth Amber occupies ≤10% of any surface. Scarcity is the warmth; once common it reads as branding and breaks invisible-by-default.

**The Legible-on-Anything Rule.** Every text-bearing surface owns its contrast (dark scrim + light text + self-shadow). Legibility never depends on the desktop background.

## 3. Typography

**Display / Body / Label Font:** a single warm humanist sans (`system-ui, -apple-system, "Segoe UI", sans-serif`, overridable via the runtime `--yui-font`).

**Character:** one warm, slightly rounded humanist family carries everything. No separate mono, which would read tool-like. Crisp at small sizes (bubbles, labels), never cold or mechanical.

### Hierarchy
- **Display** (weight ~600): rare moments only, such as a character name.
- **Title** (~600, ~1.0rem): emphasis inside a speech bubble, tool-result headings.
- **Body** (~400, ~0.95rem, line-height ~1.5): speech text, set as short conversational bursts in a narrow column fitted to bubble width, not document width.
- **Label** (~500, ~0.75rem, light uppercase tracking ~0.02em): tool status ("Searching…"), timestamps.

### Named Rules
**The Speech-First Rule.** Body type is tuned for short conversational bursts inside a bubble. Document layout rules (long measure, dense columns) are never imported.

## 4. Elevation

Flat by default. Depth comes from a single soft ambient shadow on the one floating surface, plus a text self-shadow as insurance against bright backgrounds. In a transparent window a shadow is a functional separator between the UI and an arbitrary backdrop, never decoration.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 32px oklch(0.12 0.02 70 / 0.4)`): the single ambient layer under every floating surface. No neon glow, no hard drop shadow.
- **Text Shadow** (`text-shadow: 0 1px 2px oklch(0.1 0.01 70 / 0.55)`): keeps light text legible over a bright backdrop.

### Named Rules
**The Float Rule.** A surface floats with exactly one soft ambient shadow. Multiple shadows, hard drop shadows, and neon glows are forbidden.

## 5. Components

Surfaces are absent at rest and transition in over ~200ms (`--yui-dur`) on an ease-out exponential curve (`cubic-bezier(0.22, 1, 0.36, 1)`), ~140ms (`--yui-dur-fast`) for color shifts; under `prefers-reduced-motion` the slide and scale drop to an opacity-only fade. Implemented CSS lives in `src/ui/`.

### Speech bubble
The primary floating surface (`surfaces.css`). A scrim panel with no tail and no hard border: light Speech White text on Scrim, gently curved (14px), a single Float shadow, and the system's *only* sanctioned frosted backdrop (`blur(10px)`, for legibility). Bottom-anchored at 16% over the character's lower band so the face stays unobscured, width-capped at `min(34ch, 78%)`, height-capped at 34vh with internal scroll and a top fade once it overflows. A blinking amber caret (`oklch(0.8 0.13 75)`) marks streaming onset; inline links wear an amber-soft underline that ignites to full amber on hover/focus. A small round dismiss button rests in the top-right corner, invisible until hovered — the bubble passes pointers through for character drag, so the button is its own pointer target. When "keep bubble until dismissed" is on the bubble never fades, and the dismiss button stays half-lit as its only exit.

### Text input
A slim field summoned by hotkey, sliding up from the bottom (`surfaces.css`). Stronger scrim (`oklch(0.19 0.014 70 / 0.82)`), 12px corners, transparent inner field. At rest the border is a hairline; on `:focus-within` it ignites to a Hearth Amber border plus an amber-soft ring, the design's signature warmth moment. Submit failure shows an Ember Red inline message, never a side-stripe.

### Tool-status chip
A low-emphasis pill (`surfaces.css`) shown while the backend runs a tool. Pill-shaped (999px), Strong-Scrim background, Ash text, a Float shadow, and a calm opacity dot-pulse (no spinner). Amber stays absent while work is in progress; at completion, the dot solidifies into a Hearth Amber checkmark, warming the finish as a small moment.

### Boot-failure notice
A dismissible floating notice (`boot-error.css`) shown when config or VRM loading fails and the transparent window would otherwise stay blank. Strong Scrim, Speech White guidance, and a single Float shadow preserve the legible-on-anything doctrine; a danger-colored uppercase title names the failure, and a quiet dismiss button removes the notice.

### Settings row + switch
A list row (`quick-controls.css`), 10px corners, 0.5rem padding, with a faint background tint on hover. The label pairs a ~0.95rem name with a ~0.74rem Muted-Ash sub-line. Its switch (2.5rem track) sits calm and grey when off and ignites to a full Hearth Amber track with the knob slid right when on (`aria-checked="true"`); focus shows an amber-soft ring.

### Type dropdown (`yui-select`)
A custom-styled `<select>` (`quick-controls.css`) used as the per-service type picker in the Advanced tab's collapsible sections. OS chrome is stripped (`appearance:none`) for a Strong-Scrim field with a hairline Edge border, `--yui-radius-input` corners, and an inline amber-free chevron data-URI; on `:focus-visible` it ignites to a Hearth Amber border plus an amber-soft ring (the same warmth moment as the text input). A `--single` variant for inert one-option sections drops the chevron, dims the text to Muted-Ash, and shows a default cursor — present for visual consistency, not interaction.

### Session history accordion
The settings panel's History tab (`history-section.css`), a read-only record rather than a chat surface. Each conversation session is one collapsed row carrying its start time, the first thing you said (ellipsized) and its turn count; the current session sits at the top, opened by default inside an amber-faint frame, and older ones expand in place on click (`aria-expanded`). Open sessions read as a script: a three-column row per turn (speaker · text · time) where YUI's name is the only Hearth Amber in the list, over hairline separation and a Muted-Ash footnote on retention and local-only storage.

### Capture & voice indicators
Paired status pills at the top edge (`capture-indicator.css`, `voice-input-indicator.css`). Same pill shape and Strong-Scrim as the tool chip. The capture tell carries an amber pulse dot while the screen is being attached (an always-on privacy cue); the voice tell carries a dot that pulses amber while listening, settles to a steady full Hearth Amber when a turn fires (the label carries the state change), and turns Ember Red on error.

## 6. Do's and Don'ts

### Do:
- **Do** micro-tint every neutral toward amber (chroma ~0.005–0.016) in OKLCH; never `#000`/`#fff`.
- **Do** keep Hearth Amber ≤10% of a surface, ignited only in *moments* (active input, speech onset, hover).
- **Do** give a floating surface its own dark scrim plus light text for legibility on any background, and only where legibility is needed (the speech bubble), never decoratively.
- **Do** keep motion Responsive: smooth enter/exit and feedback on an ease-out exponential curve, attenuated under `prefers-reduced-motion`.
- **Do** stay flat, adding the single Float shadow only when a surface lifts.

### Don't:
- **Don't** look like an **enterprise SaaS chatbot widget** (bordered card, gradient accent, generic widget tone).
- **Don't** stack chat lists, message rows, or channel chrome like a **messenger app** (Discord/Slack/KakaoTalk) on the character's stage; the past conversation is readable only inside the settings panel's History tab, and never becomes a second place to talk.
- **Don't** use pushy, garish speech bubbles like an **old desktop mascot** (Clippy), the exact opposite of non-intrusive.
- **Don't** overuse glassmorphism: the frosted backdrop is purposeful in the one speech bubble only, otherwise skip it.
- **Don't** use side-stripe borders (a color line >1px on an edge), gradient text (`background-clip: text`), identical card grids, or modal-first patterns.
- **Don't** use amber as a fill: warmth is a point, not a plane (the 10% Warmth Rule).
