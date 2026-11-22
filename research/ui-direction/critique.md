# Critique: settings, quick card, Threads and unified windows

Taken on 2026-11-22 against main at `3b42a456`.

**Inputs**

- Rung 1 headless screenshots of the settings window: 11 tabs in Dawn and Hearth, plus scrolled views, a search state and a 470px width. Plugins is a conditional page and does not mount in the browser build.
- The committed vrt references for the quick card and the Threads view, which render blank in the browser build.
- A unified-window browser shot.
- The `impeccable` detector.
- CSS counts measured with `git grep` (the commands are under Evidence).

## Design health (Nielsen, 0-4)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Most state changes land instantly, with no transition to show what changed. |
| 2 | Match with the real world | 3 | The copy is plain and warm. The preset header's "default is shown in main." reads like a status dump. |
| 3 | User control and freedom | 3 | Reset and Cancel paths exist. |
| 4 | Consistency and standards | 2 | Rail tooltips sometimes repeat the label and sometimes describe the page. Pills, tiles and links mix button vocabularies. |
| 5 | Error prevention | 3 | Locked rows carry a reason. |
| 6 | Recognition over recall | 3 | Search shows a match count per page. |
| 7 | Flexibility and efficiency | 3 | Search and keyboard paths exist. |
| 8 | Aesthetic and minimalist design | 2 | The design is flat and uniform. It has no depth cues and no character presence. |
| 9 | Error recovery | 3 | Errors are inline and come with an action. |
| 10 | Help and documentation | 3 | Help guide rows, notes and foot lines exist. |
| | **Total** | **28/40** | Solid structure with a weak surface. |

## Anti-patterns verdict

**LLM assessment.** Nothing reads as AI-made. There are no gradient text, side stripes, card grids or glass. The problem is the opposite: the surface is so restrained that every page looks the same. It is warm grey on warm grey with one amber switch.

**Detector.** It found 1 finding in `src/ui/quick-controls` (`--fast`): `layout-transition` at `sections/session/session-section.css:61`. That is a meter fill whose width is the value being animated, with a reduced-motion override, so it is a false positive. The root HTML files are empty shells and say nothing.

## What works

- **Structure.** Titled sections hold borderless groups with Hairline-split rows. Every page shares one predictable grammar, and the search and scope lines support it.
- **Restraint with the accent.** Amber appears only on the switches, the Connect pill and links. Both themes are legible.
- **Copy.** Sub-lines say what a control does in the user's terms ("Checks in on a repeating schedule if you've been quiet at work").

## Priority issues

1. **[P1] Instant state changes.** These all land with no transition:
   - page change in the rail
   - the selection in a segment (Less · Normal · More)
   - fold open and close
   - the quick card's tiles and confirm
   - the Threads list and pane changes

   The quick card has 1 transition rule in its one CSS file. The Threads window has 2 across 10 files. Feedback carries the feeling of "alive", so the windows read as static forms.

   *Fix:* a small motion vocabulary covering a sliding segment indicator, a switch knob with easing, fold height and opacity, a page crossfade or slide, list enter and exit, and press feedback.

   *Command:* `/impeccable animate`.

2. **[P1] The preset header wastes the top fifth of the window and reads as debug text.** On a 640px-tall window the header takes 260px (screenshot). Under the character chip, two loose lines sit with no grouping: "default is shown in main." and "No one rated yet". The character is the protagonist, but here she is a 56px flat colour disc.

   *Fix:* make the header one composed identity strip. Show the portrait or photo larger, the name, the transport and window state, and the relation line as one unit with clear hierarchy. Fold the status sentences into it.

   *Command:* `/impeccable layout`, then `/impeccable delight`.

3. **[P2] The rail tooltip duplicates the label and covers the next item.** `tab-rail.ts:38` sets `data-tip` whenever the label shows, and `tipKey` defaults to `tabs.<id>`, the label itself. Hovering Together shows a "Together" bubble over Listening and bubble. Proactive alone uses a description ("Rules for when YUI speaks up first").

   *Fix:* show no tooltip in the wide rail, or show the description consistently and place it to the right of the rail.

   *Command:* `/impeccable clarify`.

4. **[P2] Flat depth and a uniform rhythm.** In Dawn, the group surface sits a few lightness steps from the page. Every group has the same padding and corners, section titles differ from row labels only by size, and the scope line is body-sized. Long pages (Persona overflows by 954px, Proactive by 704px) become an undifferentiated scroll.

   *Fix:*
   - a second neutral layer for the rail and header
   - a faint inner highlight or edge on groups
   - more step between the page title, section and row
   - varied spacing between sections and inside groups

   *Command:* `/impeccable layout`, then `/impeccable typeset`.

5. **[P2] The quick card and Threads controls lack affordance.**
   - The quick card's Turn off is bare text with the weight of a label.
   - The Threads answer choices ("1 Three times", "2 Five times") look like plain text, not choices.
   - Send sits disabled in grey next to an empty field with no hint of what enables it.

   *Fix:* give choices a pressable shape and hover and press states. Give Turn off a danger-text button treatment. Show Send's enabling condition.

   *Command:* `/impeccable polish`.

## Persona red flags

- **The owner (daily user, power user).**
  - Every settings visit starts with 260px of header before any control.
  - A page change gives no sense of place.
  - The hover tooltip pops over the item they were about to click.
- **A first-timer arriving from Quick start.**
  - The character they chose has no face in settings, only a coloured disc and "default".
  - Nothing celebrates a confirmed key beyond a done line. That is the peak moment of the first-run journey, and it is flat.

## Minor observations

- Proactive's speak-up note runs three lines at body size. A shorter lead with the detail folded in would read faster.
- The text-size sample card ("Want to look now, or sort it out together tonight?") is the one place the character's voice shows. It deserves the speech-bubble treatment, not a bordered box.
- The unified window is already compact and clear. Its chip, input focus ring and shadow are the most finished surface.

## Questions

- What if the settings window opened on her, a portrait and a line in her voice, before the controls?
- Can every control's state change be felt in under 200ms without anyone noticing a single animation?
- Does each page need its own accent moment, or does one signature colour per character carry it (the otaku research's top pattern)?

## Evidence

- `git grep -hE 'transition(-property)?:' -- '<dir>/*.css' | grep -v 'transition: none' | wc -l`, run per directory, and the same pattern with `animation`:
  - quick-controls: 39 transitions and 16 animations in 34 files
  - quick-card: 1 and 0 in 1 file
  - threads/window: 2 and 1 in 10 files
  - unified: 2 and 2 in 2 files
- Screenshots: `critique-shots/` (Rung 1 `headless-shot.mjs` at 760x640 on `pnpm exec vite --port 1446`), plus the committed vrt references.
- The detector: `node detect.mjs --json [--fast] <target>`.
