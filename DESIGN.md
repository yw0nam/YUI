---
name: YUI
description: Embodied desktop VRM companion — invisible-by-default UI, warm-when-present.
colors:
  accent: "oklch(0.68 0.15 62)"
  accent-soft: "oklch(0.68 0.15 62 / 0.45)"
  accent-faint: "oklch(0.68 0.15 62 / 0.16)"
  accent-ink: "oklch(0.45 0.12 60)"
  text: "oklch(0.27 0.02 60)"
  text-dim: "oklch(0.4 0.02 60)"
  text-mute: "oklch(0.46 0.02 60)"
  ink: "oklch(0.22 0.01 70)"
  scrim: "oklch(0.985 0.008 85 / 0.85)"
  scrim-strong: "oklch(0.99 0.006 85 / 0.92)"
  edge: "oklch(0.35 0.03 60 / 0.14)"
  edge-strong: "oklch(0.35 0.03 60 / 0.24)"
  panel-bg: "oklch(0.975 0.006 85)"
  group-bg: "oklch(0.995 0.004 85 / 0.75)"
  hover: "oklch(0.3 0.03 60 / 0.05)"
  selected: "oklch(0.3 0.03 60 / 0.08)"
  field: "oklch(0.995 0.004 85)"
  track: "oklch(0.5 0.01 70 / 0.3)"
  knob: "oklch(0.99 0.004 85)"
  knob-shadow: "oklch(0.2 0.03 60 / 0.25)"
  danger: "oklch(0.45 0.13 35)"
  danger-soft: "oklch(0.45 0.13 35 / 0.45)"
  danger-faint: "oklch(0.45 0.13 35 / 0.14)"
  ok: "oklch(0.42 0.12 150)"
  ok-soft: "oklch(0.42 0.12 150 / 0.4)"
colors_hearth:
  accent: "oklch(0.8 0.13 75)"
  accent-soft: "oklch(0.8 0.13 75 / 0.45)"
  accent-faint: "oklch(0.8 0.13 75 / 0.16)"
  accent-ink: "oklch(0.85 0.11 75)"
  text: "oklch(0.95 0.012 80)"
  text-dim: "oklch(0.78 0.016 75)"
  text-mute: "oklch(0.66 0.014 72)"
  ink: "oklch(0.22 0.01 70)"
  scrim: "oklch(0.2 0.014 70 / 0.8)"
  scrim-strong: "oklch(0.18 0.014 70 / 0.9)"
  edge: "oklch(0.97 0.01 80 / 0.1)"
  edge-strong: "oklch(0.97 0.01 80 / 0.16)"
  panel-bg: "oklch(0.16 0.014 70)"
  group-bg: "oklch(0.97 0.01 80 / 0.035)"
  hover: "oklch(0.97 0.01 80 / 0.06)"
  selected: "oklch(0.97 0.01 80 / 0.11)"
  field: "oklch(0.13 0.012 70 / 0.8)"
  track: "oklch(0.5 0.01 70 / 0.35)"
  knob: "oklch(0.96 0.01 80)"
  knob-shadow: "oklch(0.1 0.01 70 / 0.5)"
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
# No spacing group: no spacing custom property exists in the src/ CSS, and component padding is written as literal values.
components:
  speech-bubble:
    backgroundColor: "{colors.scrim}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "26px 20px 30px"
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
    backgroundColor: "{colors.group-bg}"
    rounded: "{rounded.group}"
    padding: "0.625rem 0.875rem"
---

# Design System: YUI

The canonical token source is [`src/ui/tokens.css`](src/ui/tokens.css); the frontmatter above mirrors it. `colors` holds the Dawn values and `colors_hearth` the Hearth values of the same keys. Doctrine: OKLCH only, never `#000`/`#fff`, every neutral micro-tinted toward warm amber (hue 60–85).

## 1. Overview

**Creative North Star: "The Hearthlight"**

YUI's interface is the glow of a fireplace: it burns warmly in a corner of the room without stealing the gaze. The character owns the stage; the chrome lights up only when it has something to say, then recedes. Color is near-achromatic neutral, warmth carried by a single point of amber. Type is a warm humanist sans; motion is feedback, never choreography. The whole system's purpose is to *step back*.

The glow comes in two themes, and the app follows the OS appearance until the user picks one. **Dawn** is the light theme: warm frosted paper over the desktop, dark ink on it, the blur keeping it readable over any window. **Hearth** is the dark theme: the dying embers, a dark scrim under light warm text.

Every surface floats over an arbitrary desktop background in a transparent, always-on-top window, so each must be legible against any backdrop without a heavy container. The surfaces that ever appear (speech bubble, text input, status pill, delegation chip, signal chips, message window, boot-failure notice) are the system's entirety and its signature.

This system explicitly rejects the bottom-right SaaS chatbot widget (Intercom/Drift), the messenger chat list (Discord/Slack/KakaoTalk), and the pushy speech bubbles of the old desktop mascot (Clippy). YUI is not a widget, not a messenger, not a mascot.

**Key Characteristics:**
- Invisible-by-default: chrome is absent at rest; the character and desktop fill the stage.
- Warm-when-present: when a surface appears, a small amber warmth meets humanist warmth.
- Legible-on-anything: readable over any background through self-contrast, not the backdrop.
- Calm motion: feedback transitions and one slow float on the speech bubble, no choreography, quietly attenuated under reduced-motion.

## 2. Colors

Near-achromatic warm neutral with a single point of amber, in two themes the user picks in General → Appearance: Dawn, Hearth, or Follow system, which takes Hearth when the OS appearance is dark. The theme is the `data-theme` attribute on each window's root; `:root` holds Dawn and `:root[data-theme="hearth"]` holds Hearth in `src/ui/tokens.css`. All hues anchor to warm amber (hue 60–85).

Components name a colour by its role, never by a value. Each role below has one token, a Dawn value and a Hearth value.

| Role | Token | Dawn | Hearth |
|---|---|---|---|
| Surface | `--yui-scrim` | `oklch(0.985 0.008 85 / 0.85)` | `oklch(0.2 0.014 70 / 0.8)` |
| Plate | `--yui-scrim-strong` | `oklch(0.99 0.006 85 / 0.92)` | `oklch(0.18 0.014 70 / 0.9)` |
| Text | `--yui-text` | `oklch(0.27 0.02 60)` | `oklch(0.95 0.012 80)` |
| Text dim | `--yui-text-dim` | `oklch(0.4 0.02 60)` | `oklch(0.78 0.016 75)` |
| Text mute | `--yui-text-mute` | `oklch(0.46 0.02 60)` | `oklch(0.66 0.014 72)` |
| Hairline | `--yui-edge` | `oklch(0.35 0.03 60 / 0.14)` | `oklch(0.97 0.01 80 / 0.1)` |
| Hairline strong | `--yui-edge-strong` | `oklch(0.35 0.03 60 / 0.24)` | `oklch(0.97 0.01 80 / 0.16)` |
| Amber | `--yui-accent` | `oklch(0.68 0.15 62)` (Dawn Amber) | `oklch(0.8 0.13 75)` (Hearth Amber) |
| Amber soft | `--yui-accent-soft` | `/ 0.45` of Amber | `/ 0.45` of Amber |
| Amber faint | `--yui-accent-faint` | `/ 0.16` of Amber | `/ 0.16` of Amber |
| Amber ink | `--yui-accent-ink` | `oklch(0.45 0.12 60)` | `oklch(0.85 0.11 75)` |
| Ink | `--yui-ink` | `oklch(0.22 0.01 70)` | `oklch(0.22 0.01 70)` |
| Danger | `--yui-danger` | `oklch(0.45 0.13 35)` | `oklch(0.77 0.11 35)` |
| Danger soft, faint | `--yui-danger-soft`, `--yui-danger-faint` | `/ 0.45`, `/ 0.14` of Danger | `/ 0.45`, `/ 0.14` of Danger |
| Ok | `--yui-ok` | `oklch(0.42 0.12 150)` | `oklch(0.82 0.14 150)` |
| Ok soft | `--yui-ok-soft` | `/ 0.4` of Ok | `/ 0.4` of Ok |

### Roles

- **Surface**: the semi-transparent backdrop under every floating surface.
- **Plate**: the denser variant under the text input and the small-label chips (the status pill, the name plate), sharpening their definition.
- **Text**: primary body and speech text on a floating surface; warm, not pure black or white.
- **Text dim**: labels, the status pill, secondary text.
- **Text mute**: disabled text, hints, eyebrows, placeholders.
- **Hairline**: the thin edge that holds a surface outline against the backdrop; the strong variant marks hover and dividers that need more weight.
- **Amber**: the sole accent and the only carrier of warmth, as a border, ring, caret, underline or dot. Used in *moments* only: active input border, speech onset caret, focus and hover, the message window's waiting glow (the input border while thinking, the bubble border while responding) and the close end of a relation glyph. The soft and faint variants carry focus rings and underlines.
- **Amber ink**: the same hue deepened (Dawn) or lifted (Hearth) so amber holds contrast as text or an icon on a Surface: links on hover and focus, the History page's character name, the status pill's fix link, the speech action link.
- **Ink**: dark text for the count on the folded delegation chip's amber badge, in both themes. Body text on a floating surface stays Text.
- **Danger**: undo, failure messaging, the failed-delegation dot and the hostile end of a relation glyph. Hue 35 keeps it clear of the amber accent; soft and faint variants match the accent pattern.
- **Ok**: the status pill's tool-done check and the finished-delegation dot. Hue 150 keeps it clear of both Amber and Danger; the soft variant carries the connected ring in the settings panel.

### Panel tokens

The settings window's panel and the switch use these tokens beyond the roles above.

| Token | Dawn | Hearth |
|---|---|---|
| `--yui-panel-bg` | `oklch(0.975 0.006 85)` | `oklch(0.16 0.014 70)` |
| `--yui-group-bg` | `oklch(0.995 0.004 85 / 0.75)` | `oklch(0.97 0.01 80 / 0.035)` |
| `--yui-hover` | `oklch(0.3 0.03 60 / 0.05)` | `oklch(0.97 0.01 80 / 0.06)` |
| `--yui-selected` | `oklch(0.3 0.03 60 / 0.08)` | `oklch(0.97 0.01 80 / 0.11)` |
| `--yui-field` | `oklch(0.995 0.004 85)` | `oklch(0.13 0.012 70 / 0.8)` |
| `--yui-track` | `oklch(0.5 0.01 70 / 0.3)` | `oklch(0.5 0.01 70 / 0.35)` |
| `--yui-knob` | `oklch(0.99 0.004 85)` | `oklch(0.96 0.01 80)` |
| `--yui-knob-shadow` | `oklch(0.2 0.03 60 / 0.25)` | `oklch(0.1 0.01 70 / 0.5)` |
| `--yui-avatar-l` / `--yui-avatar-c` | `0.5` / `0.12` | `0.78` / `0.12` |
| `--yui-crop-stage` / `--yui-crop-shade` / `--yui-crop-ring` | `oklch(0.32 0.005 250)` / `oklch(0.15 0.01 70 / 0.62)` / `oklch(0.99 0.004 85 / 0.9)` | the same: a photo is judged on one neutral ground in either theme |

### Named Rules
**The 10% Warmth Rule.** Amber occupies ≤10% of any surface. Scarcity is the warmth; once common it reads as branding and breaks invisible-by-default.

**The Legible-on-Anything Rule.** Every text-bearing surface owns its contrast through its surface material. In Dawn that is light glass (0.85 alpha) plus the bubble's blur under dark ink. In Hearth it is a dark scrim (0.8, Plate 0.9) under light text. The Dawn values of Text, Text dim, Text mute, Amber ink, Danger and Ok hold at least 4.5:1 over the Surface composited on a white and on a black desktop window and are chosen for that; Hearth keeps its settled values, whose Text mute reads 3.1:1 over a white window. Legibility never depends on the desktop background.

## 3. Typography

**Display / Body / Label Font:** Pretendard JP Variable, bundled with the app as a single variable file (`public/fonts/PretendardJPVariable.woff2`) covering Korean, Japanese and Latin; weights 400/500/600 only.

**Character:** one warm, slightly rounded humanist family carries everything. No separate mono, which would read tool-like. Crisp at small sizes (bubbles, labels), never cold or mechanical.

### Hierarchy
- **Display** (weight ~600): rare moments only, such as a character name.
- **Title** (~600, ~1.0rem): emphasis inside a speech bubble, tool-result headings.
- **Body** (~400, ~0.95rem, line-height ~1.5, ~1.75 in the speech bubble): speech text, set as short conversational bursts in a narrow column fitted to bubble width, not document width.
- **Label** (~500, ~0.75rem, light uppercase tracking ~0.02em): tool status ("Searching…"), timestamps.

### Panel scale
Panels (quick-controls, settings) set text in five fixed steps (`--yui-fs-*` in tokens.css):
- **Caption** (11px): units, footnotes.
- **Sub** (12px): row descriptions, chip labels.
- **Body** (13px): row labels, field text.
- **Head** (14px): section titles.
- **Title** (20px): page title.
- **Speech** (0.95rem, `--yui-fs-speech`): bubble and composer text, outside the panel scale on purpose.

### Named Rules
**The Speech-First Rule.** Body type is tuned for short conversational bursts inside a bubble. Document layout rules (long measure, dense columns) are never imported.

## 4. Elevation

Flat by default. Depth comes from a single soft ambient shadow on the one floating surface. In a transparent window a shadow is a functional separator between the UI and an arbitrary backdrop, never decoration.

### Shadow Vocabulary
- **Float** (`--yui-float`): the single ambient layer under every floating surface. Dawn `box-shadow: 0 10px 30px oklch(0.2 0.03 60 / 0.22)`, Hearth `box-shadow: 0 8px 32px oklch(0.12 0.02 70 / 0.4)`. No neon glow, no hard drop shadow.
- **Text Shadow** (`--yui-text-shadow`): exists in Hearth only, `text-shadow: 0 1px 2px oklch(0.1 0.01 70 / 0.55)`, and is `none` in Dawn. The unified chat window and the boot-failure notice wear it. The speech bubble, the text input, the name plate, the status pill and the delegation chip take their contrast from the Surface or Plate alone.

### Named Rules
**The Float Rule.** A surface floats with exactly one soft ambient shadow. Multiple shadows, hard drop shadows, and neon glows are forbidden.

## 5. Components

Surfaces are absent at rest and transition in over ~200ms (`--yui-dur`) on an ease-out exponential curve (`cubic-bezier(0.22, 1, 0.36, 1)`), ~140ms (`--yui-dur-fast`) for color shifts; under `prefers-reduced-motion` the slide and scale drop to an opacity-only fade. Implemented CSS lives in `src/ui/`.

### Speech bubble
The primary floating surface (`surfaces.css`), built in three layers: a positioning wrapper that places, lifts and fades it, a float layer inside the wrapper, and a frame that holds the box and what rides its edges. The box is a Surface panel with no tail and no hard border: Text at the speech size and line-height 1.75 on Surface, gently curved (14px), at least 132px tall (never past the height cap) with 26px of room above the text and 30px below it, a single Float shadow, and the system's *only* sanctioned frosted backdrop (`blur(10px) saturate(1.1)`, for legibility). Under `prefers-reduced-transparency` the frost drops and the box takes Plate. The bubble is bottom-anchored at 16% over the character's lower band so the face stays unobscured and a fixed `min(34ch, 78%)` wide, so what rides the box's edges never moves with its text; the box is height-capped at 34vh, scrolls inside, and fades its top once it overflows. A line's own line breaks show. Inline links wear an Amber-soft underline that ignites to full Amber on hover/focus, the link text taking Amber ink.

Speech types out. Each sentence types over its audio's duration from the moment its audio starts; a sentence with no audio (voice off, a failed synthesis, a muted remainder, a line that starts while an earlier line still plays) types at 40 ms per character in every script. A blinking Amber caret follows the typing, and the box's Hairline swells to Amber-soft while it runs. A click on the box shows the rest of the line at once and leaves the voice playing; the box is its own pointer target while the rest of the bubble passes pointers through to the character. When the line has finished, an Amber-ink ▼ at the box's bottom-right corner nudges 3px on a 1.4 s loop; it marks the end only and pages nothing. While the box shows, the whole dialogue floats, a 3px rise and fall over 6 s. Under `prefers-reduced-motion` the line appears whole, nothing floats or nudges, and the border holds steady.

The name plate rides the box's top-left edge, half over it, in both modes: a 30px Plate chip with a Hairline edge and one Float shadow, carrying the character's face (its photo, else a dot in its hue) at 20px, the name, a 6px state dot and the state label. Beside the character it shows with the bubble, reads responding while speech streams and thinking while a turn runs, and has no dock button and no drag. A Backlog pill rides the box's bottom-left edge, half over it, mirroring the plate (Plate, a Hairline edge, Text dim at the sub size); it opens the current session's earlier lines in a Plate panel above the box: the user's under "You" and the character's under its name, at the body size in Text dim, oldest first, scrolling inside 12em and opening at the newest, under a Text-mute title at the caption size. The pill hides while the session has no earlier line. The bubble holds while the backlog is open, and every hide closes it. Older sessions stay in the settings History page.

A turn the user started opens the bubble at once with the user's message quoted on its first line: Text-mute text a step under the speech size, led by a "You" label in Text dim at weight 600 (a mic glyph marks a spoken turn), clamped to two lines with an ellipsis and closed by a Hairline when anything follows it. The reply types in below it, the reasoning disclosure sits between them, and the bubble holds through the turn's filler and takes its dwell once the turn settles; the line hides with the bubble. A turn that fails before any reply drops the line and puts the message back into the composer beside the inline error. A turn the character started carries no quoted line. Two 1.5rem round buttons ride the top edge outside the box, the pop-out (arrows-out icon) and the dismiss (cross icon): Plate, a Hairline edge, one Float shadow and 0.75rem icons at stroke 2. They sit clear of the text and hold still while the box scrolls. They stay invisible until hovered or focused, and because the bubble passes pointers through for character drag, the buttons are their own pointer targets. Under the speech text the box carries one optional action button — an in-place fix such as Open Connection on an unconfigured backend — styled as an inline link: Text on an Amber-soft underline that ignites to full Amber, with the text taking Amber ink, on hover and keyboard focus, and a pointer target of its own. While it shows, the bubble holds past its dwell and the dismiss button stays visible as its exit; the action leaves when the speech does. When "keep bubble until dismissed" is on the bubble never fades, and the buttons stay half-lit as its only exit.

### Text input
A slim field summoned by hotkey or the quick-controls Type a message button, sliding up from the bottom (`surfaces.css`). Plate, 12px corners, and a transparent inner field set at the speech size with a Text-mute placeholder. The field is multi-line. It starts at one line and grows with its content, up to six lines in the character window (growing upward, the bubble lifting with it) and twelve in the message window, then scrolls inside; Enter sends and clears the field, and Shift+Enter breaks the line. Attach, pop-out and send sit on the last line as three equal 2.125rem round icon buttons (paperclip, arrows-out, arrow-up; 1.05rem icons at stroke 1.5): transparent and Text-mute at rest, Amber ink on Amber faint on hover, and pressing in to 94% while clicked. The pop-out, between the field and send, moves speech and the typing session into the message window. While a turn runs, send becomes stop, a filled rounded square in Amber on Amber faint, and the field dims. At rest the border is a Hairline; on `:focus-within` it ignites to an Amber border plus an Amber-soft ring, the design's signature warmth moment. Submit failure shows a Danger inline message, never a side-stripe.

### Message window
A separate always-on-top window (`message-window.css`) holding the speech bubble and the text input when the surfaces are popped out of the character window. 340px wide, anchored by its top-left corner and grown downward by its content: a name-plate handle, then the bubble, then the input. The plate is the bubble's name plate, here also the window's drag handle, with a hover-revealed dock button (arrows-in icon) that docks the surfaces back into the character window. The dot reads three states: idle — Text mute and dim, no label; thinking, a turn running with no speech streaming — a "Thinking" label on the plate, the dot breathing Text dim, and the input border slowly swelling to Amber with an Amber-soft ring; responding, speech streaming — a "Responding" label, the dot pulsing Amber, and the bubble border slowly swelling to Amber-soft. Under reduced motion nothing animates and the borders hold steady. The bubble tucks up under the plate's row so the plate rides the box's top-left edge and floats with it, except while the delegation list or the backlog is open; the box is height-capped at twelve lines in this window and keeps the frost, the caret, the scroll cap and the dismiss button on its top edge that it wears in the character window. Docked mode is the character-window layout, whose pop-out button beside the dismiss button pops the surfaces back out. The status pill stays with the character in both modes; the delegation chip follows the surfaces, riding the plate's row as a separate pill to its right while popped out and leaving the character window bare. The plate's row holds the plate and the delegation chip only.

The backend's reasoning shows in the message window alone, as a disclosure under the quoted line at the top of the bubble's box: a Text-mute "Reasoning" summary at the sub size, weight 500, with a chevron that turns a quarter when open, over the text at the body size in Text dim behind a 2px Hairline-strong rule, clipped at six lines and scrolling, with a blinking text cursor while it streams. Its cursor gives way to the speech caret once the reply streams. The disclosure stays closed, also while the reasoning streams: the first reasoning of a turn shows the bubble with the summary even before any speech, holding off the previous reply's dwell until the reasoning ends, and a click on the summary opens it. It closes once the reply lands. When the reasoning ends with no speech streaming or waiting on playback, the bubble takes the usual dwell (or the keep-until-dismissed hold), and hides at once when nothing is left to show, as after a stop mid-reasoning. Only the start of a reasoning stream reveals the bubble, so a dismissed bubble stays down for the rest of that reasoning.

### Unified chat window
A frameless, transparent, always-on-top window (`unified-window.css`) holding one 340px column, shown while the Unified chat switch is on and two or more presets are open. The window takes the column's height and stays where it was dragged. Top to bottom: the cast row, one dialogue box, then the composer, 8px apart.

The cast row is the window's drag handle. Each open preset has a cast chip: a 28px Plate pill with a Hairline edge and one Float shadow, carrying the preset's 22px face (its photo, else a dot in a hue taken from its id), the name at the sub size (600) and a 6px state dot. Idle, the dot is Text mute at 55%; thinking, it breathes Text dim; talking, it pulses Amber and the chip's edge turns Amber-soft. The hue's lightness and chroma are `--yui-avatar-l` and `--yui-avatar-c` (Dawn 0.5 / 0.12, Hearth 0.78 / 0.12). The chips wrap to a second row when they do not fit. A 28px round × at the row's end, in the same material, closes the window and turns the Unified chat switch off.

The box is the message window's dialogue box in flow, and takes no room while it has nothing to show. Its name plate names the character whose line is showing. Lines play one at a time: a character's line waits until the line before it has finished typing, and a window opened mid-line shows from the next line. The user's quote leads with "You → name" or "You → everyone". The backlog lists the current session's lines of every open character, each led by its speaker or "You → name".

The composer is the message window's field without the attach button, under a row of recipient chips: one per open preset (an 18px face and the name) and one for everyone, 28px pills on Plate with a Hairline edge and Text dim at the sub size (500). The checked chip is where Enter sends; it takes an Amber-soft edge on Amber faint with Text. Typing `@` opens a list above the chips, in flow so the window grows to hold it: each open preset with its 14px face, then `@everyone` with its sub-line, the active row on the Selected fill. While any turn runs, send becomes stop, and stop ends every character's turn. Speech goes where Enter sends and its quote carries the mic glyph; speech that arrives while a send runs lands in the field, unsent, and with barge-in on, starting to speak ends every character's turn as stop does. A routed turn that fails shows its error under the field, with its fix action. While the window shows, every character's chat lines go here: the message windows hide, and each character's Separate message window row is locked with a Text-mute reason ("Off while the unified chat window shows"). Notices without a speaker stay in the character's own bubble.

### Status pill
One pill at the top edge of the character window (`chips/status-pill.css`) carries the three tells above the character: screen capture, voice input and the backend's running tool. It is centred at 4.5% from the top, 1.75rem tall and pill-shaped, with a Plate background, a Hairline edge, one Float shadow, Text dim label text at the sub size and weight 500, and 0.9rem line icons at stroke 1.5. It enters and leaves with an opacity fade and a 6px drift over `--yui-dur`.

The pill shows while capture is on, voice input is live or a tool runs, and leaves once all three settle. With capture on and nothing else, it holds the capture icon alone, with a steady Amber point on the icon's corner as the always-on privacy cue; clicking the icon opens the settings panel. While voice input is live, a mic icon follows, then a Hairline separator, a dot and the voice state as the label. The dot pulses Amber while listening and transcribing, holds full Amber with a 2px Amber-soft ring once a turn fires, and turns Danger on error. In the one error the settings panel can resolve, an unconfigured backend, the label becomes an inline link: the reason under an Amber-soft underline and a trailing Text-mute gear glyph, the underline igniting to full Amber and the link to Amber ink on hover and keyboard focus, and a click anywhere on the pill opens the settings panel's Connection page. When the backend sent the server's own text for a failed spoken turn, that text takes the label in place of the state word. It stays on one line and ends in an ellipsis where the pill's width runs out, and the pill widens to the window's width less 1.5rem to give it room.

While the backend runs a tool, the tool's label takes the segment and the dot pulses Text dim, keeping amber out of work. The mic icon stays and turns Danger itself when voice input is in error. At completion the dot solidifies into an Ok checkmark and holds 1.5 s with the tool's label, then the segment falls back to the voice state or the pill leaves. The capture icon, and the whole pill while it shows the voice fix, take pointer events; everywhere else clicks pass through to the character. Under reduced motion nothing pulses and the pill fades in place, and the label and dot colour carry every state.

### Boot-failure notice
A dismissible floating notice (`boot-error.css`) shown when config or VRM loading fails and the transparent window would otherwise stay blank. Plate, Text guidance, and a single Float shadow preserve the legible-on-anything doctrine; a Danger uppercase title names the failure, and a quiet dismiss button removes the notice.

### Settings row + switch
The settings panel (`quick-controls.css`, its controls in `controls.css`) is a rail beside a column of sections. The rail is 10rem with text labels: a search field on top, then two titled groups, the edited character's pages (Connection, Voice, Persona, Body, History) under the character's name and every character's pages (Together, Listening and bubble, Permissions, Proactive, Motion and desktop, General) under "Every character", each heading in Text mute at the caption size (600), General pinned to the bottom. While a search is set each rail item shows its match count in Text mute, a page with none dims, and a matching row takes the `--yui-selected` fill. A panel narrower than 30rem (the pet window's popover, the settings window near its 480px minimum) turns the rail into 3rem of icons, each page named by its `aria-label` and tooltip, the headings into one Hairline between the groups, and hides the search field; a row's control wrapped under its label spans the row. Each page opens with a Text-mute scope line, "Only" and the character's name or "Every character", over a 1.25rem title (600, letter-spacing -0.015em). A section is a 0.875rem title (600) with an optional control or state text at its right, an optional Text-mute note, and one or more groups. A group is one borderless surface (`--yui-group-bg`, 12px corners) whose rows are split by a Hairline. A row is at least 3rem tall with 0.625rem × 0.875rem padding: a 0.8125rem label (500) over a 0.75rem Text-mute sub-line on the left, its control on the right. An add row closes its group with a plus and a text button. The General page opens with the Language row, then the Appearance row, then Your name. The Appearance row is a three-position segment (Dawn · Hearth · Follow system) in the same segment control as Language; a choice applies to every open window at once and persists. Selection is neutral: the selected rail item and the checked segment cell take the `--yui-selected` fill with Text at 600, and a checked radio tick fills with Text. The switch (2.25rem track) is the one control that keeps amber, calm and grey when off (`--yui-track`) and a full Amber track with the knob (`--yui-knob`, shadowed in `--yui-knob-shadow`) slid right when on (`aria-checked="true"`). Fields sit on `--yui-field` with a transparent edge at rest, a Hairline on hover, and an Amber border plus an Amber-soft ring on focus. A focused button shows a 2px Amber-soft ring. The Together page carries the Unified chat switch, which lets main open the unified chat window while two or more presets are open, and the Characters list: one row per character with a 28px face, the name over its state in Text mute, and an "On the desktop" switch. Main's switch, and a bound window's own, is locked on; with four on the desktop an off row's switch is disabled and a Text-mute line gives the reason. A control the push transport cannot use stays in place, disabled, with a Text-mute reason under its label and a "Change transport" link in Amber ink. In the settings window the preset row is the character header: one button per character with a 28px face, the name (600) over its transport and window state at the caption size in Text mute; the edited one takes the `--yui-selected` fill, one in no window sits at 55% opacity and stays clickable, and the manage button closes the row. Where a native picker exists, each row of the preset manage list carries a photo button beside rename; it opens the photo dialog, after the picker when the preset has no photo yet. The panel has two disclosures, the filler's More phrases and the card's Advanced fields, each a chevron summary over a group and closed by default.

### Faces and the photo dialog
A preset's face is a circle: its photo, else a dot in a hue taken from its id. A photo shows the square its crop stores, with the preset's hue behind any transparent pixels; a photo with no crop shows centred. One renderer draws every face, at 36px in the Card section, 28px in the character header and the Characters list, 20px on the name plate, and 14px to 22px in the unified chat window.

The photo dialog (`photo-dialog.css`) is a modal on the settings window: Panel background, a Hairline edge, the window's corner radius and one Float shadow, over a backdrop in the crop shade. The title, "Photo for name", sits at the title size (600) with a Text-mute caption hint on its baseline. On the left, a 360px stage on the crop stage colour holds the photo under a 300px circle: a 2px ring in the crop ring colour, the rest of the stage under the crop shade. A drag moves the photo, and the circle always stays covered. Under the stage sit a Zoom slider (1× to 7×, its value in tabular figures) and three pills: Fit the face, Whole photo, and Choose another…. On the right, "Where it shows" lists live previews at 36, 28, 22 and 20px with the place each size appears, in Text dim at the sub size. The foot carries Cancel and Use photo, both pills; Use photo is in Amber ink on an Amber-soft edge. A photo that cannot be read shows a Danger line and disables Use photo. Escape closes the dialog only.

### Type dropdown (`yui-select`)
A custom-styled `<select>` (`quick-controls/connection/endpoints-section.css`) used as the per-service type and provider picker in the Connection page's sections. OS chrome is stripped (`appearance:none`) for a `--yui-field` fill with a transparent edge, `--yui-radius-control` corners, and a chevron data URI in the Text-mute colour (--yui-chevron, one per theme). Hover adds a Hairline, and `:focus-visible` ignites an Amber border plus an Amber-soft ring (the same warmth moment as the text input). A `--single` variant for inert one-option sections drops the chevron and the hover Hairline, dims the text to Text dim, and shows a default cursor. The chat type row shows the short type name over the closed control (a non-interactive overlay on a native select whose own text is transparent) while the open list carries the long names, which say who keeps the conversation history. A description line under the row follows the selection in the Text-mute sub size and fades in over `--yui-dur-fast`; its one inline link wears the speech bubble's treatment, Text on an Amber-soft underline that ignites to full Amber, with the text taking Amber ink, on hover and keyboard focus.

### Session history accordion
The settings panel's History page (`quick-controls/history/history-section.css`), a read-only record. The sessions are rows of one group. Each collapsed row carries its start time, the first thing you said (ellipsized) and its message count. The current session sits at the top, open by default, and older ones expand in place on click (`aria-expanded`). An open session's start time turns 600 and its messages read as a script beneath it: a three-column row per message (speaker · text · time) where YUI's name, in Amber ink, is the only amber in the list. A Text-mute footnote on retention and local-only storage follows the group, and the start-fresh row sits in its own group below.

### Delegation list
The backend's delegated work as rows (`chips/delegation-rows.css`), shared by the chip's popover beside the avatar and the Session section of the settings panel's History page. Each row is a dot, an ellipsized title and a tabular-nums time: the dot is Amber while the work runs, Ok once it finished, Danger when it failed and Text mute when the outcome cannot be verified; the time reads the elapsed minutes while running and "Done · 4m ago", "Failed · 4m ago" or "Outcome unverified · 4m ago" after. The character window's popover pins its right edge 8px inside the window's right edge, so the full list stays inside the window at any window width. In the Session section the rows list the client's persisted history as a stacked row of the section's group under the context readout, and a finished row that carries a summary is a chevron disclosure (`aria-expanded`) opening the worker's summary and "Took 12m" underneath; the popover's rows never open.

### Signal chips
One pill per signal group in the chip column at the avatar's upper right (`chips/signal-chips.css`), above the delegation chip and in its pill family: a dot in the delivery class's colour (a Danger dot with a pulsing halo for urgent, a steady Amber ring for batched), the source in Text, the label in Text mute, and a cross that dismisses it. At most three show, newest first, with a "+N" pill that unfolds the rest in place; past eight the column scrolls inside. A tap opens the group's details sheet under the column, 18rem wide and pinned 8px inside the window's right edge: the source line, the kind, the label, the received time, what YUI said or "Did not speak" in Text-mute italic, and the raw items. One sheet shows at a time and Escape closes it. A batched chip leaves 30 minutes after it arrived; an urgent chip stays until dismissed. A held press folds every signal chip to its dot together with the delegation chip. The urgent dot's halo pulses, not the dot, and the pulse stops under reduced motion.

### Relation glyph and relation line
How a character stands toward the user and toward each other preset, under the preset row of the settings panel (`quick-controls/preset/preset.css`). The relation glyph is five steps on one axis: two 8px × 4px segments each side of a 2px centre notch, the side the sign and the length the strength. Unlit segments sit on `--yui-track`; a lit one fills in Text dim from the notch outward. Only the far ends carry colour: the outer left segment of a hostile relation in Danger and the outer right segment of a close one in Amber. Neutral lights no segment and raises the notch to Text. A target not rated yet lights no segment and keeps the notch Text mute. The number behind the band is never shown on a chip; the Relations section's slider shows it.

The relation line sits under the preset row, after the edit note in the settings window: one pill chip per target the window's preset has rated, the user first as "you" and then the rated presets by strength, close first, each a glyph and the target's name in Text mute at the sub size. The line is one row. A rated target whose preset window is closed, and every chip but "you" past the line's width, folds into a trailing `+N` chip that unfolds the folded chips in place, wrapping the line, and the line stays unfolded until the chip is pressed again. While the Relations switch is off the line is hidden. While this preset has no record, the line holds one Text-mute sentence ("No one rated yet") instead of chips.

Hovering or focusing a relation opens the reasons card under it, clamped inside the strip: a card on the panel surface with a Hairline strong edge and one Float shadow, holding "natsume: **warm** to you", an external engine's note in italic Text dim when the record has one, and the last three reasons newest first, each a direction chevron, the reason, and a tabular-nums age (`40min`, `3h`, `2d`). Escape closes the card and leaves the panel open.

The Relations section of the Body page sets the window's preset's relations by hand; the Relations switch is a row of the Together page. Its Text-mute note says the change is logged as set by you, outside the daily cap. Its group holds one row per target: "you" and every other preset, rated rows in the line's order, then a stronger Hairline (`--yui-edge-strong`), then the targets not rated yet in registry order, their glyph at 60%. A row is the glyph and the name over a sub-line (the band word, the last reason or "set by you", and its age; "Not rated yet" for an unrated target), and on the right a −20 to 20 slider with the gain slider's knob over a 2px centre tick, and the value as a signed tabular number (`+9`, `−6`, `0`). The slider's fill grows from the centre: Amber on the positive side, Text dim on the negative side, Danger on the negative side while the band is hostile. Dragging previews the glyph, the band word, the number and the fill; releasing commits the value. A panel narrower than 30rem wraps the slider under the label. While the switch is off the group and the note hide, and one Text-mute sentence says relations are off for every character.

When the window's preset changes a relation, the glyph's new segments grow from the notch, a segment it gives up keeps its colour at 40% for 400ms and then drains, and the target's name flashes to Text and settles over about a second; a newly rated target fades in. Under reduced motion nothing scales: segments, ghosts and the card change by opacity or at once.

### Named Rules
**The One-Pulse Rule.** Of the status dots in the character window, only the status pill's dot pulses, and an urgent signal chip's dot while that chip shows: the signal needs the user now. The capture point and the delegation chip's dot hold still, and their state reads from colour and label.

**The Two-Stroke Rule.** Inline line icons draw at stroke 1.5 when rendered at 0.9rem or larger and at stroke 2 below that, so a 24-viewBox glyph keeps its weight down at 12px.

## 6. Do's and Don'ts

### Do:
- **Do** micro-tint every neutral toward amber (chroma ~0.004–0.02) in OKLCH; never `#000`/`#fff`.
- **Do** keep Amber ≤10% of a surface, ignited only in *moments* (active input, speech onset, hover, the message window's waiting glow).
- **Do** give a floating surface its own material, light glass under dark ink in Dawn and dark scrim under light text in Hearth, and only where legibility is needed (the speech bubble), never decoratively.
- **Do** keep motion Responsive: smooth enter/exit and feedback on an ease-out exponential curve, attenuated under `prefers-reduced-motion`. A pulse that runs on a loop (the status pill's dot, the name plate's breath, the input's ember) reverses on every cycle, so it alone runs `ease-in-out`; every enter, exit and feedback curve stays ease-out.
- **Do** stay flat, adding the single Float shadow only when a surface lifts.
- **Do** lay the settings panel out as titled sections of borderless groups with Hairline-split rows, and keep its selection neutral. Amber stays on switches, focus and hover.
- **Do** keep controls off the text: the bubble's buttons ride its top edge, outside the scrolling box — the one exception is the speech action button, which sits under the text as an inline link, not as chrome.
- **Do** let the Surface's alpha carry contrast on the bubble, the text input, the name plate and the status pill, and trade the bubble's frost for Plate under `prefers-reduced-transparency`.

### Don't:
- **Don't** look like an **enterprise SaaS chatbot widget** (bordered card, gradient accent, generic widget tone).
- **Don't** stack chat lists, message rows, or channel chrome like a **messenger app** (Discord/Slack/KakaoTalk) on the character's stage; on the stage the past shows only as the speech bubble's backlog of the current session, opened on demand; older sessions are readable inside the settings panel's History page and the unified chat window the user switches on, and the stage never becomes a second place to talk.
- **Don't** use pushy, garish speech bubbles like an **old desktop mascot** (Clippy), the exact opposite of non-intrusive.
- **Don't** overuse glassmorphism: the frosted backdrop is purposeful in the one speech bubble only, otherwise skip it.
- **Don't** use colored side-stripe borders (an accent or status color line >1px on one edge), gradient text (`background-clip: text`), identical card grids, or modal-first patterns.
- **Don't** put uppercase or letter-spaced eyebrow labels, per-row bordered cards, or dashed add buttons in the settings panel.
- **Don't** use amber as a fill: warmth is a point, not a plane (the 10% Warmth Rule). The one fill is the count badge on the folded delegation chip, a 1rem dot sized as a point so a pending count stays visible over any desktop.
- **Don't** import decorative asset packs (3D icons, hand-drawn illustrations) or spring/bounce motion presets; icons are inline line glyphs (the Two-Stroke Rule) and motion is ease-out only, the looping pulses named above excepted.
