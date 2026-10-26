# YUI — Design Context

Before any UI/visual work, read [`PRODUCT.md`](../../PRODUCT.md) + [`DESIGN.md`](../../DESIGN.md). The impeccable skill (`/impeccable`) uses these as its canonical source.

> **Workflow (mandatory):** ① Review existing UI surfaces (`src/ui/`, `DESIGN.md`, `PRODUCT.md`) to align style and patterns, ② Propose the UI structure/layout to the user in text for confirmation, ③ Create a **standalone mock HTML** for visual approval, then ④ Proceed to implementation.

- **Register:** `product` — design serves the character, not marketing.
- **Core tone:** **invisible-by-default, warm-when-present.**
- **5 principles:** ① character is protagonist ② warm when present ③ render state only, no invention ④ legible on anything (transparent window) ⑤ calm, non-intrusive (respect reduced-motion).
- **Prohibited:** SaaS chatbot widget / messenger UI / retro mascot speech bubbles / decorative glass / gradient text.

## Space budgets

A string or line added to these surfaces is measured in the mock before the spec.

- **Speech bubble:** capped by `--yui-bubble-max-h` (`src/ui/tokens.css`), 34vh or 204 px in a 600 px window. A new line is laid out beside the longest common reply (four lines). Over the cap, the bubble pins to its end and the top fade hides the first line.
- **Chip column:** starts at `calc(50% + 3.5rem)` (`src/ui/surfaces/surfaces.css`), so a chip label has 144 px in the default 400 px pet window. A label is measured at 12 px; a longer one clips at the window edge.

## Outside references

Pattern lookups for UI work are [component.gallery](https://component.gallery) (component conventions across design systems) and [styles.refero.design](https://styles.refero.design) (DESIGN.md-style systems). Gradient-button packs, 3D icon sets, hand-drawn illustration packs, and spring/bounce motion presets stay out: [`DESIGN.md`](../../DESIGN.md) § Don'ts keeps the UI flat and quiet with amber as a point. A third-party asset enters the repo with its source and license recorded beside it, as `resources/vrms/Sendagaya_Shino.PROVENANCE.md` does.
