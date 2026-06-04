---
name: YUI
description: Embodied desktop VRM companion — invisible-by-default UI, warm-when-present.
---

<!-- SEED: re-run /impeccable document once there's code (chat bubble, input, tool-status) to capture the actual tokens and components. -->

# Design System: YUI

## 1. Overview

**Creative North Star: "The Hearthlight"**

YUI's UI is like the dying embers of a fireplace. It burns warmly in a corner of the room without stealing the gaze. The character owns the stage; the interface only lights up briefly when it has something to say, then recedes back into darkness. Colors are nearly achromatic neutral, and warmth is carried by a single point of amber. The font is a warm humanist sans; motion is only subtle feedback. This system's purpose is to *step back*.

The UI floats over an arbitrary desktop background in a transparent, always-on-top window. Every surface must therefore be *readable against any backdrop* without heavy containers. Only three surfaces ever appear — the speech bubble, the text input, and the tool-status indicator. These three are the system's entirety and signature.

What this system explicitly rejects: bottom-right SaaS chatbot widgets (Intercom/Drift-style), messenger chat lists (Discord/Slack), the pushy speech bubbles of old desktop mascots (Clippy). YUI is not a widget, not a messenger, not a mascot.

**Key Characteristics:**
- Invisible-by-default: UI is absent at rest; the character/desktop fills the stage.
- Warm-when-present: when it appears, small amber warmth + humanist warmth.
- Legible-on-anything: readable on any background in a transparent window via self-contrast.
- Calm motion: subtle feedback transitions, no choreography, respect reduced-motion.

## 2. Colors

Near-achromatic warm neutral, with a single point of amber carrying warmth. (Restrained strategy)

> SEED: exact values to be confirmed at implementation time. OKLCH direction only (project doctrine = OKLCH, no `#000`/`#fff`, all neutrals micro-tinted with brand hue).

### Primary
- **Hearth Amber** (`oklch(~78% 0.12 ~70)`, exact value `[confirmed at implementation]`): The sole accent responsible for warmth. Used only in *moments* — active input border, speech onset signal, hover feedback. ≤10% of any surface.

### Neutral
- **Warm Ink** (`oklch(~22% 0.01 ~70)`, `[confirmed at implementation]`): Body text. Not pure black — micro-tinted with amber hue.
- **Warm Ash** (`oklch(~60% 0.008 ~70)`): Labels · timestamps · secondary text.
- **Scrim** (`oklch(~20% 0.01 ~70 / 0.55~0.7)`): Semi-transparent backdrop for floating surfaces like speech bubbles. The key to legibility on any background (see Float in §4).

### Named Rules
**The 10% Warmth Rule.** Hearth Amber must occupy ≤10% of any screen. Scarcity is warmth — once common, it reads as branding and breaks invisible-by-default.

**The Legible-on-Anything Rule.** Every surface that carries text has *self-contrast* (scrim/backdrop). Legibility does not depend on the desktop background.

## 3. Typography

**Display/Body Font:** Single humanist sans `[to be selected at implementation — not geometric; humanist, warm, slightly rounded]`
**Label Font:** Small tracking variant of the same family (no separate mono — avoids tool-like feel)

**Character:** Warm, slightly rounded humanist sans. Crisp at small sizes (bubbles · labels), not cold or mechanical.

### Hierarchy
- **Display** (`[weight ~600]`, `clamp` `[confirmed]`): Rare moments only — character name etc.
- **Title** (`~600`, `~1.0rem`): Emphasis inside speech bubbles, tool result headings.
- **Body** (`~400`, `~0.95rem`, line-height `~1.5`): Speech text. Conversational short bursts — narrow column fitted to bubble width, not wide document width (65–75ch).
- **Label** (`~500`, `~0.75rem`, light uppercase tracking): Tool status ("Searching…"), timestamps.

### Named Rules
**The Speech-First Rule.** Body type is optimized for short conversational bursts inside speech bubbles. Do not import document layout rules (long line length, dense columns).

## 4. Elevation

The default is flat. Depth is created not by stacking shadows but by a single *soft ambient shadow layer* on the one floating surface. In a transparent window, shadows are a functional device that separates UI from the arbitrary background — not decoration.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 32px oklch(0% 0 0 / ~0.28)`, `[confirmed]`): Single layer for floating surfaces like speech bubbles and tooltips. No game-HUD neon glow or hard drop shadows.

### Named Rules
**The Float Rule.** UI surfaces float above the desktop with exactly one soft ambient shadow. Multiple shadows · hard drop shadows · neon glows are prohibited.

## 6. Do's and Don'ts

> SEED: once components (speech bubble · input · tool-status) exist, fill in section 5 Components and regenerate in scan mode.

### Do:
- **Do** micro-tint all neutrals with amber hue (chroma ~0.005–0.01). No `#000`/`#fff`; use OKLCH.
- **Do** keep Hearth Amber ≤10%, used only in *moments* (active input · speech signal · hover).
- **Do** give floating surfaces a self-scrim (semi-transparent backdrop) for legibility on any background — but *only where legibility is needed* (speech bubble), not decorative.
- **Do** make motion Responsive: smooth enter/exit + feedback. Ease-out exponential curve. Quietly attenuate transitions under `prefers-reduced-motion`.
- **Do** keep it flat; add Float shadow only when a surface lifts.

### Don't:
- **Don't** make it look like a **SaaS chatbot widget** (bordered card, gradient accent, generic widget tone).
- **Don't** stack chat lists · message rows · channel chrome like a **messenger app** (Discord/Slack/KakaoTalk).
- **Don't** use pushy, garish speech bubbles like an **old desktop mascot** (Clippy). The opposite of non-intrusive.
- **Don't** overuse decorative glassmorphism. Frosted backdrop is purposeful *only for legibility in one speech bubble* — otherwise skip it.
- **Don't** use side-stripe borders (color lines >1px on left/right), gradient text (`background-clip:text`), identical card grids, or modal-first patterns.
- **Don't** use amber as a fill — warmth is a point, not a plane (10% Warmth Rule).
