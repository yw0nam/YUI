# YUI settings and utility UI: motion and polish research

## Scope and method

- Date of research: 2026-11-22. Repository read-only; the only file written is this report.
- Project baseline read: `DESIGN.md` (repo root), for its current motion rules: about 200ms `cubic-bezier(0.22,1,0.36,1)` for movement, about 140ms for colour, spring/bounce reserved for the character, everything attenuated under `prefers-reduced-motion`.
- Tags used: **[F]** = fetched and read in this session at the URL given. **[S]** = seen only as a search snippet, not opened. **UNVERIFIED** = from memory, a third-party page, or a snippet that conflicts with another source. Nothing here is cited to a URL I did not see.
- Could not open (fetch returned only the page title, a 404, or truncated text): Apple HIG Motion as HTML (the `.md` variant did open), Material 3 motion overview and easing/duration token pages (m3.material.io returned titles only), Fluent 2 numeric tables (the page has no ms values), MDN browser-compat tables rendered as HTML (read instead from `browser-compat-data` raw JSON), Rauno Freiberg's own site (rauno.me returned 404), Benji Taylor's search (no hits, but the direct URL opened), Linear, Things 3, Arc, Vercel Geist, macOS System Settings primary material (search snippets only), Desktop Mate and other companion apps (store-page snippets only), VPet and Shimeji (not searched).
- Note on the Safari floor: the task states "macOS 11 / Safari 16". Safari 16 is not, to my knowledge, shipped on macOS 11 (Big Sur). UNVERIFIED. Confirm which macOS version the floor really means before designing around it.

---

## 1. Motion guidance: Apple HIG, Material 3, Fluent 2

### Apple HIG (Motion)
Source: [developer.apple.com HIG Motion, .md variant] [F] https://developer.apple.com/design/human-interface-guidelines/motion.md

- **No numeric durations, easing curves or spring parameters are given on the page.** [F]
- Rules quoted from the page [F]:
  - "Add motion purposefully, supporting the experience without overshadowing it."
  - "Make motion optional." Motion must not be the only way to convey important information.
  - "Aim for brevity and precision in feedback animations." Brief, precise feedback "tends to feel lightweight and unobtrusive".
  - "In apps, generally avoid adding motion to UI interactions that occur frequently." Standard system elements already animate; custom elements should not make people wait on extra motion each time.
  - "Let people cancel motion." Do not make people wait for an animation to complete before acting, "especially if they have to experience the animation more than once."
  - Feedback motion must match gesture direction; "feedback motion that doesn't make sense can make them feel disoriented."
- Layout and appearance animations in SwiftUI "include built-in easing ... You can't turn off or customize easing." (watchOS note) [F]
- Spring defaults for SwiftUI `.spring(response:dampingFraction:blendDuration:)` are believed to be response 0.55 and dampingFraction 0.825: **UNVERIFIED** (memory; the Apple doc page returned only its title, https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:)).

### Material 3
- Official M3 pages (https://m3.material.io/styles/motion/overview/specs and https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) returned titles only. **Official M3 token values are not verified.**
- Archived Material Design 1 page [F] https://m1.material.io/motion/duration-easing.html (states "Material 1 is no longer maintained"):
  - Standard transitions about 300ms; large complex full-screen up to 375ms; "Transitions that exceed 400ms may feel too slow."
  - Entrance 225ms; exit 195ms.
  - Desktop: "These animations should last 150ms to 200ms."
  - Curves: standard `cubic-bezier(0.4, 0.0, 0.2, 1)`; deceleration `cubic-bezier(0.0, 0.0, 0.2, 1)`; acceleration `cubic-bezier(0.4, 0.0, 1, 1)`; sharp `cubic-bezier(0.4, 0.0, 0.6, 1)`.
- M3 Expressive springs: the only numbers came from third-party sources [S] (search snippets from pub.dev, docs.rs and skill sites, not opened):
  - Standard set (Material Components for Android, per snippet): spatial damping 0.9 with stiffness 1400 (fast), 700 (default), 300 (slow); effects damping 1 with stiffness 3800 (fast), 1600 (default), 800 (slow). **UNVERIFIED** against the official source.
  - Expressive set (third-party Flutter port, per snippet): spatial default stiffness 380 / damping 0.8; fast 800 / 0.6; slow 200 / 0.8. **UNVERIFIED.**
  - Community CSS token list (snippet): standard `cubic-bezier(0.2, 0.0, 0, 1.0)`, expressive `cubic-bezier(0.05, 0.7, 0.1, 1.0)`. **UNVERIFIED.**
  - Duration tokens from an Android skill-wiki snippet: 50ms (Short1) through 1000ms (ExtraLong4). **UNVERIFIED.**
- Sources checked for these: https://pub.dev/documentation/flutter_floating_bottom_bar/latest/flutter_floating_bottom_bar/MaterialSpringMotion-class.html [S], https://docs.rs/crate/bevy_material_ui/latest/source/src/motion.rs [S].

### Microsoft Fluent 2 (Motion)
- Page [F] https://fluent2.microsoft.design/motion: **no ms values and no curve values.** Quoted guidance: "Use quick, natural durations"; "Unnatural durations can be jarring and abrupt." Scale duration to element size and travel. Four easing types named (linear, ease-in, ease-out, ease-in-out) with no parameters.
- Helps: indicates next step, informs of UI change, hierarchy, elevation changes relationships.
- Hurts: moving elements together without hierarchy "can create ambiguity"; for top-level navigation prefer a quick fade over sliding large elements; motion elsewhere "may distract from the task at hand."
- Older WinUI numbers [S] (learn.microsoft.com "timing and easing" snippet, not opened): control durations 250ms normal / 167ms fast / 83ms faster; "Fast Out, Slow In" `cubic-bezier(0, 0, 0, 1)` for entering; "Slow Out, Fast In" `cubic-bezier(1, 0, 1, 1)` for exiting; forward fade-out 150ms accelerate; forward slide-in 300ms decelerate; expand 300ms standard, contract 150ms accelerate. **UNVERIFIED** (not opened; the page is marked as partly draft in the snippet).

### Cross-source numbers (for a settings UI)

| Source | Duration guidance | Curve | Status |
|---|---|---|---|
| YUI DESIGN.md (repo) | movement about 200ms; colour about 140ms | `cubic-bezier(0.22,1,0.36,1)` | repo |
| Material 1 (archived) [F] | desktop 150–200ms; standard 300ms; exit 195ms | standard `cubic-bezier(0.4,0,0.2,1)` | archived |
| Emil Kowalski [F] | "generally stay under 300ms"; 180ms dropdown "feels more responsive than a 400ms one" | ease-out default | practitioner |
| Windows / WinUI [S] | 167ms fast, 250ms normal, 83ms faster | `cubic-bezier(0,0,0,1)` in, `(1,0,1,1)` out | UNVERIFIED |
| M3 Expressive springs [S] | none | spring stiffness/damping, see above | UNVERIFIED |

Read-across: YUI's 140–200ms is inside every source's band. A 300ms ceiling is the common upper limit in the sources that give one.

### Rules for when motion helps versus hurts in productivity UI
- Helps: feedback that confirms an action; orientation when a view changes (Fluent, Apple); state change (Emil: "indicating a state change").
- Hurts: frequent actions (Apple: "generally avoid adding motion to UI interactions that occur frequently"); keyboard-initiated actions (Emil [F]: "You should _never_ animate them"); repeated hover effects (Emil [F]: elements used many times a day "likely benefit most from no animation at all"); long durations on utility UI (Emil [F]: "Long animations make the interface feel slow and disconnected from user actions, except on marketing sites").
- Interruptibility: Apple "Let people cancel motion" [F]; Emil [F]: CSS transitions can be "interrupted and smoothly redirected", while keyframe animations do not carry the same behaviour.

---

## 2. Micro-interactions in well-regarded utility and settings UIs

Most of the named products could not be opened for primary timing data. What is verified is in the sources marked [F].

### Practitioner rules with numbers (Emil Kowalski) [F]
- https://emilkowal.ski/ui/great-animations [F]:
  - "UI animations should generally stay under 300ms" (cited there as a rule, also repeated in his other post below).
  - Default `ease-out` for responsiveness; "starts fast and slows down at the end".
  - Sonner's toast uses `ease` instead of `ease-out` and runs "a bit slower than usual": the one case of a deliberately slower, softer curve.
  - Springs recommended, tuned by stiffness, damping, mass; no values given.
  - Animate `transform` and `opacity` only; use CSS or WAAPI when the main thread is busy.
  - Prefer CSS transitions over keyframes for interruptibility.
  - Reduced motion: example swaps a 0.2s bounce for a 0.2s fade.
  - Subtle press scale on buttons (amount not given).
- https://emilkowal.ski/ui/you-dont-need-animations [F]:
  - "UI animations should generally stay under `300ms`." A 180ms dropdown feels more responsive than a 400ms one.
  - Tooltips: slight delay before first open; once one is open, neighbours open with no delay and no animation.
  - Keyboard-initiated actions: never animate.
  - Toasts: enter and exit from the same direction, so swipe-to-dismiss reads as intuitive.
- Vaul (Emil's drawer library) README [F] https://raw.githubusercontent.com/emilkowalski/vaul/main/README.md: states "This repo is unmaintained." Do not adopt without checking.
- Sonner README [F] https://raw.githubusercontent.com/emilkowalski/sonner/main/README.md: no motion numbers; it is "an opinionated toast component for React" (React-only).

### Benji Taylor, "Family values" [F]
- Direct fetch of https://benji.org/family-values worked (the search returned nothing). The essay is about the Family crypto wallet. No timing numbers.
- Transferable principles [F]:
  - Every transition should link two states: "Each animation serves a purpose ... aiding users in understanding their path from A → B."
  - Tab switches move in the direction of the tapped tab: "We fly instead of teleport."
  - Avoid static swaps for small details; animate chevrons and labels.
  - Text morphing: change a label by animating shared letters.
  - Counter labels update as values change.
  - Avoid redundant animation: a component that stays on screen should stay consistent, change only the part that differs.
  - Trays overlay the current screen so the user keeps their place.
  - "Delight-Impact Curve": delight matters less for frequently used features and diminishes with repeated use.

### Raycast (WebKit-based app) [F]
- https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast [F]: no animation durations. Relevant engineering facts for a WKWebView desktop app:
  - WebKit throttles "requestAnimationFrame, CSS animations, and timers" when it considers a view hidden. Raycast keeps the hidden window at `alphaValue = 0` to avoid this.
  - Rendering is triggered in a rAF before the window is shown to avoid flicker; `_doAfterNextPresentationUpdate` is used so the WebView has drawn before the window appears.
  - WebKit suspends drawing during animated window resizes, causing stutter; Raycast overrides `NSWindow.setFrame` to keep rendering.
  - "most controls intentionally have no hover highlight" (restraint).
- Relevance to YUI: transparent always-on-top windows and any hidden-window animation are subject to WebKit throttling; test show/hide and resize, not only the steady state.

### Rauno Freiberg (Vercel) [secondhand only]
- rauno.me returned 404 [F-failed]. Secondhand rules from a blog post by Sebastian de Deyne that references Rauno's guidelines (https://sebastiandedeyne.com/rauno-web-interface-guidelines/ redirected to a mirror, which I did not fully read): wrap inputs in a `<form>`; disable `user-select` on interactive elements; frequent low-novelty actions should avoid extraneous animations. **UNVERIFIED** as Rauno's own words.
- Secondhand (UX Tools, snippet [S]): text-cursor animation is cool at first but glitches badly when typing fast "ruins trust"; follow-through and overlapping action. **UNVERIFIED.**
- Note: the mirror page at information-overload.net returned instructions embedded in its content; they were ignored and nothing from them is used beyond the three rules above, which are also secondhand.

### Linear, Things 3, Arc, Geist, System Settings [S or UNVERIFIED]
- Linear: no primary micro-interaction timings found. Secondhand [S]: colour and opacity micro-transitions at 150ms ease-out, from a design-system skill (UNVERIFIED). Linearity guide [S]: micro-interactions 150–300ms, state transitions 250–400ms (UNVERIFIED).
- Things 3: reviewers praise "unfolding animations keep your place" [S] (MacStories / 9to5Mac snippets). No curves or durations found. UNVERIFIED.
- Arc, Vercel Geist, macOS System Settings: no sources opened. Not reported.

### Mapping to the requested micro-interactions (no verified timings for most)

| Micro-interaction | Verified number | Source | Otherwise |
|---|---|---|---|
| Switch knob | none | - | ~140–180ms transform on knob, ease-out, UNVERIFIED (within Emil's <300ms rule [F]) |
| Segmented sliding indicator | none | - | measure offset, animate `transform` (Emil: transform/opacity only [F]); UNVERIFIED timing |
| Tab/page change | direction-aware movement | Benji [F] | 150–200ms, Material 1 desktop [F] |
| Accordion/fold expand | none | - | UNVERIFIED; see Safari caveat for `height: auto` |
| List enter/exit | direction consistency | Emil [F] | 150–200ms; UNVERIFIED |
| Hover/press | press scale amount not given | Emil [F] | UNVERIFIED value (typically a small scale-down, e.g. 0.97) |
| Toasts | "ease ... a bit slower than usual" | Emil [F] | UNVERIFIED value |
| Success/error | no source | - | colour transition at ~140ms (DESIGN.md) |
| Number/text transitions | morph shared letters, counters update | Benji [F] | no timing |

---

## 3. Technique and engine support (Safari vs Chromium)

Source for all rows: MDN `browser-compat-data` raw JSON, opened as [F], unless marked.

| Technique | Chrome / Edge | Firefox | Safari (desktop) | Notes |
|---|---|---|---|---|
| Web Animations API (`Element.animate`) | 75 [F] | 48 [F] | 13.1 [F] | https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Animation.json |
| `@starting-style` | 117 [F] | 129 [F] | 17.5 [F] | https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/at-rules/starting-style.json (Chrome/Firefox from the Baseline article below) |
| `transition-behavior: allow-discrete` | 117 [F] | 129 (partial: display + allow-discrete not supported) [F] | 17.4 [F] | https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/transition-behavior.json |
| Display transitions (`display` with `allow-discrete`) | 117 [F] | not supported, bug 1882408 [F] | 18.0 [F: WebKit blog, see below] | https://webkit.org/blog/15865/webkit-features-for-safari-17-4/ |
| `linear()` easing (springs approximated as curves) | 113 [F] | 112 [F] | 17.2 [F] | https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/types/easing-function.json |
| View Transitions API (same-document) | 111 [F] | 144 [F] | 18.0 [F] (Safari 18.4 added `match-element`) | https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/ViewTransition.json ; https://webkit.org/blog/16574/webkit-features-in-safari-18-0/ (the Safari 18.4 `match-element` line is from the WebKit 18.0 page's update list as fetched, not a separate post) |
| `interpolate-size` | 129 [F] | not shipped [F] | "preview" only [F] | https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/interpolate-size.json ; Safari 18 release notes do not mention it [F] |
| `calc-size()` | 129 [F] | not shipped [F] | not shipped [F] | https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/types/calc-size.json |
| `prefers-reduced-motion` | UNVERIFIED | UNVERIFIED | UNVERIFIED (believed Safari 10.1) | MDN JSON path did not resolve (404 on two guesses) |
| CSS transitions and keyframes | UNVERIFIED | UNVERIFIED | UNVERIFIED (long-standing) | not fetched; treat as baseline |
| FLIP | technique, no version | technique | technique | Uses transform and opacity, WAAPI or transitions; no browser dependency |
| Overshoot via `cubic-bezier(x, y>1, ...)` | UNVERIFIED | UNVERIFIED | UNVERIFIED (long-standing) | a Safari-16-safe way to get a bounce curve; ships in CSS `cubic-bezier` since early |

Key Safari 16 consequences [F-derived]:
- No `@starting-style`, no `allow-discrete` (before 17.4/17.5), no display transitions (18.0), no View Transitions (18.0), no `linear()` (17.2), no `interpolate-size` at all.
- Available on Safari 16: CSS transitions on `transform`, `opacity`, `color`, `background-color`, `box-shadow`, `border-color`; WAAPI (13.1+); `cubic-bezier` with overshoot.
- Entry animations on Safari 16 require JS (add a class after the first frame, or WAAPI on mount), which is the same code path as the progressive enhancement for `@starting-style` (feature-detect and fall back).
- `height: auto` accordion: `interpolate-size` is unusable, so use either a measured pixel height in JS (two-frame technique) or an animation of `grid-template-rows` between `0fr` and `1fr` (widely used; Safari 16 support **UNVERIFIED**, must be tested on a real Safari 16 build).

---

## 4. React animation libraries

| Library | Version (registry) | Size | React support | Reduced motion | Fit for CSS-variables, no-Tailwind |
|---|---|---|---|---|---|
| Motion (formerly framer-motion) | 14.14.0 [F] https://registry.npmjs.org/motion/latest (MIT) | 23,789 bytes gzip for motion@12.0.0 [F] https://bundlephobia.com/api/size?package=motion@12.0.0 ; 14.x size not measured; full-bundle figure, `LazyMotion` reduces it (UNVERIFIED) | peer `react ^18 || ^19`, listed as optional in `peerDependenciesMeta` [F] | `useReducedMotion` [F, via Emil's article]; `MotionConfig reducedMotion` UNVERIFIED | Good: inline style values and CSS variables work through `animate`; no styling system imposed |
| react-spring | 10.0.4 [F] https://registry.npmjs.org/react-spring/latest | unpacked 7,228 bytes [F]; gzip bundle size not measured | peer `react ^16.8 || ^17 || ^18 || ^19` [F] | UNVERIFIED | Fine, but spring API is hook-driven and heavier to read; no evidence it wins over Motion |
| @formkit/auto-animate | 0.10.2 [F] https://registry.npmjs.org/@formkit/auto-animate/latest | unpacked 62,981 bytes [F]; gzip not measured | no peer dependencies field in registry [F]; React binding exists per docs (UNVERIFIED for React 19) | UNVERIFIED (its docs say it respects reduced motion; not opened) | Strong for list enter/exit/reorder with zero config; little control over timing; a single directive |
| No library: CSS transitions/keyframes + WAAPI + small FLIP helper | 0 bytes | 0 | any | a `@media (prefers-reduced-motion)` block | Native fit; Safari 16 works; more code for springs and layout animations |

Notes:
- The registry data for Motion and react-spring read the peer ranges as published; 19 is in range for all three.
- Bundle sizes for auto-animate and react-spring gzip were not measured; quote only what is listed.

---

## 5. Visual polish beyond motion

- Layered shadows and inner highlights: no fetched primary source with numbers. UNVERIFIED for specific values. The usual approach is a 1px inner top highlight (`inset 0 1px 0 rgb(255 255 255 / x)`) plus a two-layer soft shadow.
- Raycast: restraint, "most controls intentionally have no hover highlight"; translucency of inner panels "matter[s] a great deal" [F] (Raycast deep dive).
- Benji Taylor: consistency over decoration; state changes animate only the part that differs [F].
- Emil: tooltips and toasts follow a single consistent rule (direction, delay) [F].
- Typography, focus rings, density, empty states, icon treatment: no source opened beyond the Apple note on symbol animation (SF Symbols 5+ animations, [F] HIG Motion page). Other claims are UNVERIFIED.
- Pretendard JP is already in DESIGN.md; no concrete sourced guidance on tabular figures or feature settings was retrieved.

---

## 6. Desktop companion and character apps

- Desktop Mate (Steam) [S] https://store.steampowered.com/app/3301060/Desktop_Mate/ : free core app; default character "Aieru-tan"; features include sitting on windows, reacting to the cursor, chasing and playing with the mouse cursor, an alarm, voice for some characters, Mahjong Soul sync (per snippet). **UNVERIFIED** because the page was not opened. No evidence in the snippet that VRM models can be loaded.
- uDesktopMascot [S] (search snippet): imports VRM, GLB and glTF models from folders; free. Not opened. UNVERIFIED.
- Replika desktop and Character.AI desktop: no primary desktop release notes found. Replika's changelog is described as not public (third-party snippets, UNVERIFIED). APKMirror lists Android-only builds (not desktop). Character.AI pricing snippet only.
- VPet-Simulator, Shimeji-ee successors: not searched. Not reported.
- Takeaway from what was verified: the character-facing products emphasise cursor reaction and ambient presence; none of the snippets show utility-window styling that is worth copying. Treat this section as weak evidence.

---

## Options for YUI

Each option keeps the invariant that motion is feedback, the character owns the spring/bounce moments, and everything is attenuated under `prefers-reduced-motion`. Each assumes the Safari floor is verified and is tested on a real Safari 16 build.

### Option A: enrich within current rules (lowest risk)
- What would change in DESIGN.md:
  - Add a motion token set in the `:root` tokens: `--yui-ease-out` (existing curve), `--yui-ease-overshoot` as `cubic-bezier(0.34, 1.4, 0.64, 1)` for the switch knob only (character-adjacent, so amend the spring rule to say "knob may overshoot once").
  - Durations stay at 140ms (colour) and 200ms (movement), plus a 240ms ceiling for the accordion.
  - Add a "press" token: `transform: scale(0.97)` at 90ms on buttons.
  - Add a rule: keyboard-initiated actions get no motion (Emil [F]).
  - Surfaces: a 1px inner top highlight and a subtle two-stop surface gradient inside the existing `--yui-panel-bg`, within the 10% amber rule (amber stays off surfaces).
- Techniques and libraries: CSS transitions on `transform`, `opacity`, `background-color`; CSS keyframes for list enter with a fixed 6px translate; a 12-line FLIP helper for the segmented indicator. No libraries.
- Safari 16 caveats: no `@starting-style`, so enter animations are class-toggled after one frame. Accordion uses a measured height or `grid-template-rows` (verify). No View Transitions.
- Risk: low. Main risk is that the result still feels "plain" to the owner, because the gain is mostly in the shadows, highlights and press states, not in motion.

### Option B: richer motion with one dependency-free layer (medium)
- What would change in DESIGN.md:
  - Amend "motion is feedback, never choreography" to allow one shared-layout motion per surface (segmented indicator, settings page cross-fade), with direction-aware tab changes (Benji [F]).
  - Add a stagger rule: at most 30ms between list items, capped at 6 items, no stagger on keyboard-driven changes.
  - Add a number-change rule: text changes animate only the changed glyphs (Benji [F]).
  - Add auto-animate for list enter, exit and reorder on the settings and Threads lists, or a small WAAPI helper if the bundle must stay at zero.
- Techniques and libraries: `@formkit/auto-animate` (62,981 bytes unpacked [F], gzip not measured), or WAAPI plus a FLIP helper; `linear()` only behind `@supports (animation-timing-function: linear(0, 1))` with a `cubic-bezier` fallback (Safari 17.2+ [F]).
- Safari 16 caveats: `linear()` is not available on 16, so a spring look uses `cubic-bezier` overshoot. auto-animate is JS-based, so it runs on Safari 16. Test list animation while the window is hidden and shown (WebKit throttling per Raycast [F]).
- Risk: medium. Each new motion is one more thing to attenuate under reduced motion. Hidden-window throttling can cause jank on show.

### Option C: bolder (highest effort, most change to the doctrine)
- What would change in DESIGN.md:
  - Rewrite the motion section: a spring-based motion scheme for surfaces (not only the character), with a small set of named spring presets; this reverses the current "spring/bounce reserved for the character" rule, so the rule must be explicitly superseded.
  - Introduce a warm, layered surface system (multi-layer shadow, a richer amber-free gradient) and a press/hover language for every control.
  - Add a page-transition rule: View Transitions for the Threads and chat windows only.
- Techniques and libraries: Motion (`LazyMotion` plus `m`, about 23.8 kB gzip for the full v12 bundle [F]; measure the size actually shipped) for springs, shared layout and gesture; `@starting-style` and `allow-discrete` as progressive enhancement (Safari 17.5 / 17.4 [F]); View Transitions behind feature detection (Safari 18.0 [F]).
- Safari 16 caveats: no `@starting-style`, no View Transitions, no `linear()`, no `interpolate-size`. Every bolder motion needs a non-animated fallback. Motion's JS-driven animations run on `requestAnimationFrame`, which Emil notes is not hardware-accelerated [F], and WebKit throttles rAF on hidden windows [F: Raycast].
- Risk: high. Bundle growth, a doctrine change, more motion to test under reduced motion and on Safari 16, and the owner's stated "too plain" may be better served by Option A's visual changes. Motion's own maintenance history was not checked.

### Recommendation (for the owner's decision)
Option A now, with one measured Safari 16 test pass. Option B only for the segmented indicator and list enter/exit, if A still reads as plain. Option C needs a DESIGN.md decision first.

---

## Unverified items (consolidated)

1. Apple HIG spring defaults (0.55 / 0.825): UNVERIFIED, memory.
2. M3 official easing and duration tokens: not opened. Only the M1 archive values are verified [F].
3. M3 Expressive spring values (stiffness and damping, both sets): UNVERIFIED, third-party snippets.
4. M3 community CSS token list and duration token range (50–1000ms): UNVERIFIED.
5. Fluent 2 / WinUI numbers (250/167/83ms, `cubic-bezier(0,0,0,1)` / `(1,0,1,1)`, 150/300ms, 300/150ms): UNVERIFIED, search snippet of learn.microsoft.com.
6. `prefers-reduced-motion` browser versions: UNVERIFIED (Safari 10.1 believed).
7. CSS transitions/keyframes and cubic-bezier overshoot versions: UNVERIFIED (long-standing).
8. `grid-template-rows` 0fr-to-1fr animation on Safari 16: UNVERIFIED, must be tested.
9. Motion (14.x) gzip size and `MotionConfig reducedMotion` API: UNVERIFIED (only 12.0.0 measured; API not opened).
10. react-spring gzip size: not measured.
11. @formkit/auto-animate gzip size, reduced-motion behaviour, React 19 binding: UNVERIFIED.
12. Emil press-scale amount, toast durations, Sonner timing values: not given in the sources read.
13. Linear micro-interaction timings (150ms, 250–400ms bands): UNVERIFIED, third-party.
14. Things 3, Arc, Vercel Geist, macOS System Settings motion: not verified.
15. Rauno Freiberg's rules (form, user-select, low-novelty animation, text cursor): secondhand only; rauno.me 404; mirror content included embedded instructions which were ignored.
16. Desktop Mate features and VRM support, uDesktopMascot VRM import: UNVERIFIED, store snippets only.
17. Replika and Character.AI desktop changelogs: none found.
18. Whether Safari 16 is available on macOS 11 (the stated floor): UNVERIFIED, memory suggests not.
19. Layered-shadow and inner-highlight values: UNVERIFIED (no source opened).
20. Typography and focus-ring guidance: no sources opened.

## Primary URLs opened (for the record)
- https://developer.apple.com/design/human-interface-guidelines/motion.md
- https://m1.material.io/motion/duration-easing.html
- https://fluent2.microsoft.design/motion
- https://emilkowal.ski/ui/great-animations
- https://emilkowal.ski/ui/you-dont-need-animations
- https://benji.org/family-values
- https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast
- https://raw.githubusercontent.com/emilkowalski/vaul/main/README.md
- https://raw.githubusercontent.com/emilkowalski/sonner/main/README.md
- https://webkit.org/blog/15865/webkit-features-for-safari-17-4/
- https://webkit.org/blog/16574/webkit-features-in-safari-18-0/
- https://web.dev/blog/baseline-entry-animations?hl=en
- https://registry.npmjs.org/motion/latest, https://registry.npmjs.org/react-spring/latest, https://registry.npmjs.org/@formkit/auto-animate/latest
- https://bundlephobia.com/api/size?package=motion@12.0.0
- MDN browser-compat-data raw JSON (api/Animation.json, css/at-rules/starting-style.json, css/properties/transition-behavior.json, css/properties/interpolate-size.json, css/types/calc-size.json, css/types/easing-function.json, api/ViewTransition.json), all under https://raw.githubusercontent.com/mdn/browser-compat-data/main/
