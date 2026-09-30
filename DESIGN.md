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
  scrim: "oklch(0.2 0.014 70 / 0.8)"
  scrim-strong: "oklch(0.18 0.014 70 / 0.9)"
  edge: "oklch(0.97 0.01 80 / 0.1)"
  edge-strong: "oklch(0.97 0.01 80 / 0.16)"
  ink: "oklch(0.22 0.01 70)"
  danger: "oklch(0.77 0.11 35)"
  danger-soft: "oklch(0.77 0.11 35 / 0.45)"
  danger-faint: "oklch(0.77 0.11 35 / 0.14)"
  ok: "oklch(0.82 0.14 150)"
  ok-soft: "oklch(0.82 0.14 150 / 0.4)"
typography:
  display:
    fontFamily: '"Pretendard JP Variable", system-ui, -apple-system, Segoe UI, sans-serif'
    fontWeight: 600
  title:
    fontFamily: '"Pretendard JP Variable", system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: "1.0rem"
    fontWeight: 600
  body:
    fontFamily: '"Pretendard JP Variable", system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Pretendard JP Variable", system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.02em"
rounded:
  md: "14px"
  input: "12px"
  chip: "999px"
  row: "10px"
  img: "10px"
  group: "12px"
  control: "8px"
  pill: "999px"
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
  status-pill:
    backgroundColor: "{colors.scrim-strong}"
    textColor: "{colors.text-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    height: "1.75rem"
    padding: "0 0.7rem"
  settings-row:
    backgroundColor: "oklch(0.97 0.01 80 / 0.035)"
    rounded: "{rounded.group}"
    padding: "0.625rem 0.875rem"
---

# Design System: YUI

The canonical token source is [`src/ui/tokens.css`](src/ui/tokens.css); the frontmatter above mirrors it. Doctrine: OKLCH only, never `#000`/`#fff`, every neutral micro-tinted toward warm amber (~72°).

## 1. Overview

**Creative North Star: "The Hearthlight"**

YUI's interface is the dying embers of a fireplace: it burns warmly in a corner of the room without stealing the gaze. The character owns the stage; the chrome lights up only when it has something to say, then recedes into the dark. Color is near-achromatic neutral, warmth carried by a single point of amber. Type is a warm humanist sans; motion is feedback, never choreography. The whole system's purpose is to *step back*.

Every surface floats over an arbitrary desktop background in a transparent, always-on-top window, so each must be legible against any backdrop without a heavy container. The surfaces that ever appear (speech bubble, text input, status pill, delegation chip, message window, boot-failure notice) are the system's entirety and its signature.

This system explicitly rejects the bottom-right SaaS chatbot widget (Intercom/Drift), the messenger chat list (Discord/Slack/KakaoTalk), and the pushy speech bubbles of the old desktop mascot (Clippy). YUI is not a widget, not a messenger, not a mascot.

**Key Characteristics:**
- Invisible-by-default: chrome is absent at rest; the character and desktop fill the stage.
- Warm-when-present: when a surface appears, a small amber warmth meets humanist warmth.
- Legible-on-anything: readable over any background through self-contrast, not the backdrop.
- Calm motion: feedback transitions only, no choreography, quietly attenuated under reduced-motion.

## 2. Colors

Near-achromatic warm neutral with a single point of amber. The model is **dark scrim + light warm text**: a light surface with dark ink vanishes against a white IDE, so surfaces read like a subtitle: a semi-transparent dark scrim, dense enough to hold its contrast over a white window, under light warm text. All hues anchor to warm amber (~72°).

### Primary
- **Hearth Amber** (`oklch(0.8 0.13 75)`): the sole accent and the only carrier of warmth. Used in *moments* only: active input border, speech onset caret, focus and hover, and the message window's waiting glow — the input border while thinking, the bubble border while responding. A soft (`/ 0.45`) and faint (`/ 0.16`) variant carry focus rings and underlines.

### Neutral
- **Speech White** (`oklch(0.95 0.012 80)`): primary body/speech text on a floating surface; warm, not pure white.
- **Ash** (`oklch(0.78 0.016 75)`): labels, the status pill, secondary text.
- **Muted Ash** (`oklch(0.66 0.014 72)`): disabled text, hints, eyebrows.
- **Scrim** (`oklch(0.2 0.014 70 / 0.8)`): the semi-transparent dark backdrop under every floating surface; a stronger variant (`oklch(0.18 0.014 70 / 0.9)`) sharpens the text input and the small-label chips (the status pill).
- **Hairline** (`oklch(0.97 0.01 80 / 0.1)`, hover `/ 0.16`): the thin edge that holds a surface outline against a dark backdrop.
- **Warm Ink** (`oklch(0.22 0.01 70)`, `--yui-ink`): dark text for light contexts and for the count on the folded delegation chip's amber badge. Body text on a floating surface stays light.

### Functional
- **Ember Red** (`oklch(0.77 0.11 35)`, `--yui-danger`): undo, failure messaging and the failed-delegation dot. Hue 35 keeps it clear of the amber accent; soft and faint variants match the accent pattern.
- **Ok Green** (`oklch(0.82 0.14 150)`, `--yui-ok`): the status pill's tool-done check and the finished-delegation dot. Hue 150 keeps it clear of both the amber accent and Ember Red; the soft variant (`--yui-ok-soft`, `/ 0.4`) carries the connected ring in the settings panel.

### Named Rules
**The 10% Warmth Rule.** Hearth Amber occupies ≤10% of any surface. Scarcity is the warmth; once common it reads as branding and breaks invisible-by-default.

**The Legible-on-Anything Rule.** Every text-bearing surface owns its contrast (dark scrim + light text). The scrim's alpha (0.8, strong 0.9) carries that contrast by itself on the speech bubble, the text input, the name plate and the status pill. Legibility never depends on the desktop background.

## 3. Typography

**Display / Body / Label Font:** Pretendard JP Variable, bundled with the app as a single variable file (`public/fonts/PretendardJPVariable.woff2`) covering Korean, Japanese and Latin; weights 400/500/600 only.

**Character:** one warm, slightly rounded humanist family carries everything. No separate mono, which would read tool-like. Crisp at small sizes (bubbles, labels), never cold or mechanical.

### Hierarchy
- **Display** (weight ~600): rare moments only, such as a character name.
- **Title** (~600, ~1.0rem): emphasis inside a speech bubble, tool-result headings.
- **Body** (~400, ~0.95rem, line-height ~1.5): speech text, set as short conversational bursts in a narrow column fitted to bubble width, not document width.
- **Label** (~500, ~0.75rem, light uppercase tracking ~0.02em): tool status ("Searching…"), timestamps.

### Panel scale
Panels (quick-controls, settings) set text in five fixed steps (`--yui-fs-*` in tokens.css):
- **Caption** (11px): units, footnotes.
- **Sub** (12px): row descriptions, chip labels.
- **Body** (13px): row labels, field text.
- **Head** (14px): section titles.
- **Title** (20px): tab title.
- **Speech** (0.95rem, `--yui-fs-speech`): bubble and composer text, outside the panel scale on purpose.

### Named Rules
**The Speech-First Rule.** Body type is tuned for short conversational bursts inside a bubble. Document layout rules (long measure, dense columns) are never imported.

## 4. Elevation

Flat by default. Depth comes from a single soft ambient shadow on the one floating surface. In a transparent window a shadow is a functional separator between the UI and an arbitrary backdrop, never decoration.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 32px oklch(0.12 0.02 70 / 0.4)`): the single ambient layer under every floating surface. No neon glow, no hard drop shadow.
- **Text Shadow** (`text-shadow: 0 1px 2px oklch(0.1 0.01 70 / 0.55)`): worn by the settings panel and the boot-failure notice. The speech bubble, the text input, the name plate, the status pill and the delegation chip take their contrast from the scrim alone.

### Named Rules
**The Float Rule.** A surface floats with exactly one soft ambient shadow. Multiple shadows, hard drop shadows, and neon glows are forbidden.

## 5. Components

Surfaces are absent at rest and transition in over ~200ms (`--yui-dur`) on an ease-out exponential curve (`cubic-bezier(0.22, 1, 0.36, 1)`), ~140ms (`--yui-dur-fast`) for color shifts; under `prefers-reduced-motion` the slide and scale drop to an opacity-only fade. Implemented CSS lives in `src/ui/`.

### Speech bubble
The primary floating surface (`surfaces.css`), built as a positioning wrapper around a box. The wrapper places, lifts and fades the bubble. The box is a scrim panel with no tail and no hard border: light Speech White text at the speech size on Scrim, gently curved (14px), a single Float shadow, and the system's *only* sanctioned frosted backdrop (`blur(10px) saturate(1.1)`, for legibility). Under `prefers-reduced-transparency` the frost drops and the box takes Strong Scrim. The bubble is bottom-anchored at 16% over the character's lower band so the face stays unobscured and width-capped at `min(34ch, 78%)`; the box is height-capped at 34vh, scrolls inside, and fades its top once it overflows. A blinking amber caret (`oklch(0.8 0.13 75)`) marks streaming onset; inline links wear an amber-soft underline that ignites to full amber on hover/focus. Two 1.5rem round buttons ride the top edge outside the box, the pop-out (arrows-out icon) and the dismiss (cross icon): Strong Scrim, a hairline edge, one Float shadow and 0.75rem icons at stroke 2. They sit clear of the text and hold still while the box scrolls. They stay invisible until hovered or focused, and because the bubble passes pointers through for character drag, the buttons are their own pointer targets. When "keep bubble until dismissed" is on the bubble never fades, and the buttons stay half-lit as its only exit.

### Text input
A slim field summoned by hotkey or the quick-controls Type a message button, sliding up from the bottom (`surfaces.css`). Strong Scrim, 12px corners, and a transparent inner field set at the speech size with a Muted-Ash placeholder. The field is multi-line. It starts at one line and grows with its content, up to six lines in the character window (growing upward, the bubble lifting with it) and twelve in the message window, then scrolls inside; Enter sends and Shift+Enter breaks the line. Attach, pop-out and send sit on the last line as three equal 2.125rem round icon buttons (paperclip, arrows-out, arrow-up; 1.05rem icons at stroke 1.5): transparent and Muted-Ash at rest, Hearth Amber on amber-faint on hover, and pressing in to 94% while clicked. The pop-out, between the field and send, moves speech and the typing session into the message window. While a turn runs, send becomes stop, a filled rounded square in Hearth Amber on amber-faint, and the field dims. At rest the border is a hairline; on `:focus-within` it ignites to a Hearth Amber border plus an amber-soft ring, the design's signature warmth moment. Submit failure shows an Ember Red inline message, never a side-stripe.

### Message window
A separate always-on-top window (`message-window.css`) holding the speech bubble and the text input when the surfaces are popped out of the character window. 340px wide, anchored by its top-left corner and grown downward by its content: a name-plate handle, then the bubble, then the input. The plate is a Strong-Scrim chip carrying a state dot, the name and the state label at the sub size, and a hover-revealed dock button (arrows-in icon) that docks the surfaces back into the character window. The dot reads three states: idle — Muted-Ash and dim, no label; thinking, a turn running with no speech streaming — a "Thinking" label on the plate, the dot breathing Ash, and the input border slowly swelling to Hearth Amber with an amber-soft ring; responding, speech streaming — a "Responding" label, the dot pulsing Hearth Amber, and the bubble border slowly swelling to amber-soft. Under reduced motion nothing animates and the borders hold steady. The bubble hangs on the plate's left edge with its top-left corner pressed to 6px, height-capped at twelve lines in this window, and keeps the frost, the caret, the scroll cap and the dismiss button on its top edge that it wears in the character window. Docked mode is the character-window layout, whose pop-out button beside the dismiss button pops the surfaces back out. The status pill stays with the character in both modes; the delegation chip follows the surfaces, riding the plate's row as a separate pill to its right while popped out and leaving the character window bare. The plate's row holds the plate and the delegation chip only.

The backend's reasoning shows in the message window alone, as a disclosure at the top of the bubble's box: a Muted-Ash "Reasoning" summary at the sub size, weight 500, with a chevron that turns a quarter when open, over the text at the body size in Ash behind a 2px Hairline-strong rule, clipped at six lines and scrolling, with a blinking text cursor while it streams. Its cursor gives way to the speech caret once the reply streams. The disclosure opens on the first reasoning of a turn and shows the bubble even before any speech, holding off the previous reply's dwell until the reasoning ends. It closes once the reply lands, and the summary toggles it at any time. When the reasoning ends with no speech streaming or waiting on playback, the bubble takes the usual dwell (or the keep-until-dismissed hold), and hides at once when nothing is left to show, as after a stop mid-reasoning. Only the start of a reasoning stream reveals the bubble, so a dismissed bubble stays down for the rest of that reasoning.

### Status pill
One pill at the top edge of the character window (`chips/status-pill.css`) carries the three tells above the character: screen capture, voice input and the backend's running tool. It is centred at 4.5% from the top, 1.75rem tall and pill-shaped, with a Strong-Scrim background, a hairline edge, one Float shadow, Ash label text at the sub size and weight 500, and 0.9rem line icons at stroke 1.5. It enters and leaves with an opacity fade and a 6px drift over `--yui-dur`.

The pill shows while capture is on, voice input is live or a tool runs, and leaves once all three settle. With capture on and nothing else, it holds the capture icon alone, with a steady Hearth Amber point on the icon's corner as the always-on privacy cue; clicking the icon opens the settings panel. While voice input is live, a mic icon follows, then a hairline separator, a dot and the voice state as the label. The dot pulses Hearth Amber while listening and transcribing, holds full amber with a 2px amber-soft ring once a turn fires, and turns Ember Red on error. In the one error the settings panel can resolve, an unconfigured backend, the label becomes an inline link: the reason under a Hearth-Amber-soft underline and a trailing Muted-Ash gear glyph, both igniting to full Hearth Amber on hover and keyboard focus, and a click anywhere on the pill opens the settings panel's Connection tab.

While the backend runs a tool, the tool's label takes the segment and the dot pulses Ash, keeping amber out of work. The mic icon stays and turns Ember Red itself when voice input is in error. At completion the dot solidifies into an Ok Green checkmark and holds 1.5 s with the tool's label, then the segment falls back to the voice state or the pill leaves. The capture icon, and the whole pill while it shows the voice fix, take pointer events; everywhere else clicks pass through to the character. Under reduced motion nothing pulses and the pill fades in place, and the label and dot colour carry every state.

### Boot-failure notice
A dismissible floating notice (`boot-error.css`) shown when config or VRM loading fails and the transparent window would otherwise stay blank. Strong Scrim, Speech White guidance, and a single Float shadow preserve the legible-on-anything doctrine; a danger-colored uppercase title names the failure, and a quiet dismiss button removes the notice.

### Settings row + switch
The settings panel (`quick-controls.css`) is a tab rail beside a column of sections. The rail is 10rem with text labels. A panel narrower than 30rem (the pet window's popover, the settings window near its 380px minimum) turns the rail into 3rem of icons, each tab named by its `aria-label` and tooltip, and a row's control wrapped under its label spans the row. Each tab opens with a 1.25rem title (600, letter-spacing -0.015em). A section is a 0.875rem title (600) with an optional control or state text at its right, an optional Muted-Ash note, and one or more groups. A group is one borderless surface (`--yui-group-bg`, 12px corners) whose rows are split by a hairline. A row is at least 3rem tall with 0.625rem × 0.875rem padding: a 0.8125rem label (500) over a 0.75rem Muted-Ash sub-line on the left, its control on the right. An add row closes its group with a plus and a text button. Selection is neutral: the selected tab and the checked segment cell take the `--yui-selected` fill with Speech White text at 600, and a checked radio tick fills with Speech White. The switch (2.25rem track) is the one control that keeps amber, calm and grey when off and a full Hearth Amber track with the knob slid right when on (`aria-checked="true"`). Fields sit on `--yui-field` with a transparent edge at rest, a hairline on hover, and a Hearth Amber border plus an amber-soft ring on focus. A focused button shows a 2px amber-soft ring. The filler's extra phrases are the panel's one disclosure, closed by default.

### Type dropdown (`yui-select`)
A custom-styled `<select>` (`quick-controls/sections/endpoints-section.css`) used as the per-service type and provider picker in the Connection tab's sections. OS chrome is stripped (`appearance:none`) for a `--yui-field` fill with a transparent edge, `--yui-radius-control` corners, and an inline amber-free chevron data-URI. Hover adds a hairline, and `:focus-visible` ignites a Hearth Amber border plus an amber-soft ring (the same warmth moment as the text input). A `--single` variant for inert one-option sections drops the chevron and the hover hairline, dims the text to Ash, and shows a default cursor.

### Session history accordion
The settings panel's History tab (`quick-controls/sections/history-section.css`), a read-only record. The sessions are rows of one group. Each collapsed row carries its start time, the first thing you said (ellipsized) and its message count. The current session sits at the top, open by default, and older ones expand in place on click (`aria-expanded`). An open session's start time turns 600 and its messages read as a script beneath it: a three-column row per message (speaker · text · time) where YUI's name is the only Hearth Amber in the list. A Muted-Ash footnote on retention and local-only storage follows the group, and the start-fresh row sits in its own group below.

### Delegation list
The backend's delegated work as rows (`chips/delegation-rows.css`), shared by the chip's popover beside the avatar and the Session section of the settings panel's General tab. Each row is a dot, an ellipsized title and a tabular-nums time: the dot is Hearth Amber while the work runs, Ok Green once it finished, Ember Red when it failed and Muted Ash when the outcome cannot be verified; the time reads the elapsed minutes while running and "Done · 4m ago", "Failed · 4m ago" or "Outcome unverified · 4m ago" after. The character window's popover pins its right edge 8px inside the window's right edge, so the full list stays inside the window at any window width. In the Session section the rows list the client's persisted history as a stacked row of the section's group under the context readout, and a finished row that carries a summary is a chevron disclosure (`aria-expanded`) opening the worker's summary and "Took 12m" underneath; the popover's rows never open.

### Named Rules
**The One-Pulse Rule.** Of the status dots in the character window, only the status pill's dot pulses. The capture point and the delegation chip's dot hold still, and their state reads from colour and label.

## 6. Do's and Don'ts

### Do:
- **Do** micro-tint every neutral toward amber (chroma ~0.005–0.016) in OKLCH; never `#000`/`#fff`.
- **Do** keep Hearth Amber ≤10% of a surface, ignited only in *moments* (active input, speech onset, hover, the message window's waiting glow).
- **Do** give a floating surface its own dark scrim plus light text for legibility on any background, and only where legibility is needed (the speech bubble), never decoratively.
- **Do** keep motion Responsive: smooth enter/exit and feedback on an ease-out exponential curve, attenuated under `prefers-reduced-motion`.
- **Do** stay flat, adding the single Float shadow only when a surface lifts.
- **Do** lay the settings panel out as titled sections of borderless groups with hairline-split rows, and keep its selection neutral. Amber stays on switches, focus and hover.
- **Do** keep controls off the text: the bubble's buttons ride its top edge, outside the scrolling box.
- **Do** let the scrim's alpha carry contrast on the bubble, the text input, the name plate and the status pill, and trade the bubble's frost for Strong Scrim under `prefers-reduced-transparency`.

### Don't:
- **Don't** look like an **enterprise SaaS chatbot widget** (bordered card, gradient accent, generic widget tone).
- **Don't** stack chat lists, message rows, or channel chrome like a **messenger app** (Discord/Slack/KakaoTalk) on the character's stage; the past conversation is readable only inside the settings panel's History tab, and never becomes a second place to talk.
- **Don't** use pushy, garish speech bubbles like an **old desktop mascot** (Clippy), the exact opposite of non-intrusive.
- **Don't** overuse glassmorphism: the frosted backdrop is purposeful in the one speech bubble only, otherwise skip it.
- **Don't** use colored side-stripe borders (an accent or status color line >1px on one edge), gradient text (`background-clip: text`), identical card grids, or modal-first patterns.
- **Don't** put uppercase or letter-spaced eyebrow labels, per-row bordered cards, or dashed add buttons in the settings panel.
- **Don't** use amber as a fill: warmth is a point, not a plane (the 10% Warmth Rule). The one fill is the count badge on the folded delegation chip, a 1rem dot sized as a point so a pending count stays visible over any desktop.
