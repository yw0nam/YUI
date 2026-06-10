# Window-sit drop — design

Drag the pet window and release it over another window; the character perches on that
window's **top edge** — seat pinned to the edge line, torso above it, legs hanging over the
window's content. The perch holds (pose-cycling `window_sit`) until interrupted; releasing over
no window leaves the character in `idle`.

This is **client-firing, backend-bypassed** (tier1): the client decides *when* a perch candidate
occurs (drop over a window) and renders it locally. No brain, no agent call — consistent with
firing ≠ judgment.

## Behavior

- **Trigger**: drag-release where the character's **seat point** lands over an on-screen foreign
  window. The hit-test target is the seat, not the cursor — the user grabs the character, so what
  matters is where the character ends up.
- **Perch shape**: seat sits on the target window's **top edge**; horizontal position stays where
  the user dropped it. The character extends above the edge (torso/head) and below it (legs).
- **Hold**: `window_sit` is a `kind:"state"` pose-cycling perch (8 sit variants) that blends seamlessly
  between variants (`cycle_dwell_ms: 0`, `fade_ms: 700` crossfade — no frozen hold); each clip sits
  differently, so the perch **re-aligns the seat to the edge on each variant swap**.
- **Hold semantics**: the perch is a held state — emotion-only directives and implicit idle-returns do
  NOT end it. Only an explicit `window_sit_exit` (re-drag elsewhere or off a window) or a
  higher-priority motion (drag p80 > window_sit p55) ends the perch, returning the character to `idle`.
- **No window under the drop**: no perch — return to `idle`.
- **Exit**: dragging the character again, or any higher-priority motion (drag p80 > window_sit p55),
  interrupts the perch; afterwards the character returns to `idle` (auto-resume of the perch is out of
  scope — see Boundary).

## Trigger — what counts as "on a window"

Reference point = the **seat anchor** S (live `hips` bone + `SEAT_DROP`, projected to global screen
points). Cursor position is irrelevant — the user grabs the character, so the seat is what must land on
a window. A drop perches iff S falls in a target window's **top-edge catch zone**:

```
horizontal:  W.left − mX ≤ S.x ≤ W.right + mX
vertical:    W.top  − U  ≤ S.y ≤ W.top  + D
```

Both **`charH` (the character's current on-screen pixel height) and the window rect are measured at
runtime**, never hardcoded — so the zone adapts as the VRM scales/zooms and as windows resize:
- `charH` = live projected head→feet pixel height (same projection infra as the seat anchor), recomputed
  each evaluation, so it tracks zoom/scale.
- window rect = `kCGWindowBounds` at the drop instant (validated live in the U0 spike).

The band is **character-relative** so the catch feels identical at any size; window size sets the
horizontal extent. Locked defaults (tunable constants): `U = 0.28·charH`, `D = 0.23·charH`,
`mX = 0.00·W.width`. On a hit, S.y snaps to exactly `W.top` (character-internal offset) and S.x is kept;
the **topmost** window wins when several overlap.

## Coordinate chain

The perch is one geometry problem: put the character's **seat point** on the target window's
**top-edge line**. Five coordinate spaces, transformed in order:

| # | Space | Origin / unit | Source |
|---|---|---|---|
| 1 | World | metres, three.js | live `hips` bone |
| 2 | NDC | [-1,1] | `camera.project()` |
| 3 | Pet-window CSS px | top-left, CSS px | NDC remap (`project-anchor.ts`), canvas = `mount.clientW/H` |
| 4 | Global screen physical px | top-left, physical px | `outerPosition()` + CSS·`scaleFactor` |
| 5 | Target window rect | top-left, **points** | `CGWindowBounds` |

**Seat point (space 1→3).** The seat anchor is the live `hips` bone world position plus a single
anatomical down-offset `SEAT_DROP`, projected to pet-window CSS px with the existing NDC→pixel remap
(`projectFeetAnchor`'s math, retargeted from feet to hips). It is read **after `mixer.update(dt)`**, so
it reflects the pose actually on screen for the current variant. The static load-time `modelBox`
(idle pose) is **not** used — it is wrong for a sitting pose.

**Per-clip accuracy.** Because the seat anchor is the *live* bone of the *current* variant, each of the
8 sit clips reports its own true seat position with no per-clip constants. `SEAT_DROP` is a single
anatomical constant (hips-bone-centre → buttock-contact), valid across clips because a seated pelvis is
roughly upright.

**Everything resolves to points (validated, U0 spike).** The cursor release point (`CGEventGetLocation`)
and `CGWindowBounds` were confirmed on real hardware to share one space — **global, top-left origin,
points** — with no Retina 2× mismatch. Pet-window CSS px is logical px = points. So the only conversion
is the pet window's `outerPosition()` (physical) → points: `winOriginPts = outerPositionPhys ÷ scaleFactor`.

**Seat → global (space 3→4).** `seatGlobalPts = winOriginPts + seatCss` (`petPxToGlobalPoints`). Compared
directly against the target window rect (already points) — no further conversion.

**Alignment.** Solve for the character offset that makes `seatGlobalPts.y == W.top`, keeping x at the drop
position. Applied via the **character-internal vertical offset** lever (below), recomputed on each variant
swap.

## Alignment lever — character-internal offset

The pet window is fully transparent except the character, so *moving the window* and *moving the
character within a fixed window* are **visually identical**. The perch uses the **character offset**:
the window stays put, and a three.js vertical offset (camera / `vrm.scene.position.y`) shifts the
character so the seat lands on the edge line.

- **Smooth**: frame-accurate, no OS-level window jumps on each 4s swap.
- **Constraint**: offsetting the character up can push head/feet out of the 600px window. When perched,
  apply a slight zoom-out (increase fit distance) so the seat-pinned pose stays fully framed. The exact
  headroom is an empirical tuning value (see Validation).

## Trigger & event flow

```
drag (OS-native start_dragging)
  └─ release detected (Rust: poll CGEventSourceButtonState until down→up, 10s timeout)
       └─ emit window_drop_release { point }            (validated: gates 1 & 2 green)
            └─ client computes seatGlobalPts + charH (live), invokes list_windows()  (Rust, CGWindowList)
                 └─ JS picks topmost window where inCatchZone(seat, win, charH)
                      ├─ hit → bus.push tier1 user.window_sit_drop { target_rect }
                      │     └─ dispatcher tier1 → renderer: play window_sit + setPerchTarget(rect)
                      │          └─ renderer aligns seat→edge (char offset); re-aligns on each swap
                      └─ no hit → bus.push user.window_sit_exit → idle
```

- **Drop detection** (Rust, validated): `start_dragging()` is OS-modal and swallows the release from the
  webview, so an `NSEvent` mouse-up monitor is unreliable. A short-lived thread **polls
  `CGEventSourceButtonState`** until the left button goes down→up (10s safety timeout), then reads
  `CGEventGetLocation` and emits `window_drop_release { point }`. Proven on real hardware.
- **Window list + catch-zone select**: the trigger is a top-edge **catch zone** (a band that extends
  *above* the window top), so a point-in-rect hit-test is insufficient — the U-band lies outside the
  window's bounds. Rust `list_windows()` enumerates on-screen windows (front-to-back, points; excludes
  YUI's own pid, the desktop/wallpaper, the menu bar) via `CGWindowListCopyWindowInfo`; **the client**
  computes the live seat + `charH` and selects the **topmost** window satisfying
  `inCatchZone` (`perch-geometry.ts`). All catch-zone logic stays in the tested JS module.
- **Geometry routing**: the target rect is a **client-only rendering concern** and is **not** added to
  the backend-facing `ControlEnvelope`. The dispatcher plays `window_sit` (unchanged directive) and
  separately hands the rect to the renderer via a client-only `setPerchTarget(rect | null)` seam. This
  keeps the agent contract clean (no geometry in the brain's vocabulary).
- **Re-alignment**: the renderer owns the perch loop. On each `window_sit` variant swap it re-derives
  the live seat anchor and re-solves the offset, so the seat stays glued to the edge across all poses.

## Contract & module touchpoints

- **New geometry types** (`src/contract/types.ts`): `ScreenRect { x, y, width, height }` and a
  `PerchTarget { rect: ScreenRect; edge: "top" }` (room for other edges later). Client-only — not part
  of the agent `generate_express` surface.
- **Bus**: new event `user.window_sit_drop` (priority 0, `user.` prefix, tier1, `dnd_override`) carrying
  `payload: { target_window_rect, drop_point }`. `user.window_sit_exit` is reused for leave/interrupt.
- **Producer wiring**: `OsContext` is read-only today. A client-only producer translates the Rust
  release/hit-test event into the `user.window_sit_drop` / `user.window_sit_exit` bus envelopes (the
  missing Rust→bus link).
- **Renderer**: a `setPerchTarget(target | null)` seam + the seat-anchor/offset solver + per-swap
  re-align hook in the existing `window_sit` cycle path.
- **Rust**: `find_window_at_point` command; the `leftMouseUp` release monitor; a payload struct + emit.
- **Dev mock**: extend the `__yui_windowSit` DEV hook with `drop(rect)` so the perch+geometry path is
  exercisable without a real drag during unit/preview work.

## Empirical validation gates

Position math breaks at unit/space seams. Each is validated against the real app before it is trusted:

1. **🔴 Drop detection** — does the `leftMouseUp` monitor fire after `start_dragging()` with a usable
   release point? If not, the whole trigger is redesigned. **Spike this first, before building on it.**
2. **CGWindowBounds units & origin** — confirm points vs px and top-left origin by reading a window of
   known size/position.
3. **Pet-window mapping** — confirm `mount.clientW/H` equals the window content size and the content
   origin equals the window origin (no decorations, no CSS inset).
4. **DPR vs scale** — confirm renderer `devicePixelRatio` equals Tauri `scaleFactor`, including on a
   second display with a different scale.
5. **Hips as seat proxy** — confirm `hips + SEAT_DROP` reads as the buttock-contact across all 8 sit
   clips; tune `SEAT_DROP`.
6. **Multi-monitor origin** — confirm `CGWindowList` global origin and Tauri position origin agree
   across displays (global vs per-display offsets).

## Build plan — TDD units

Pure logic is unit-tested first (test → feat, separate commits); GL/OS seams are spiked and verified
manually.

| Unit | Scope | Test surface |
|---|---|---|
| U1 seat-anchor math | world hips (+`SEAT_DROP`) + camera + canvas → pet-window px | pure fn, vitest |
| U2 alignment solver | seatGlobal + target edge + drop-x → character offset | pure fn, vitest |
| U3 unit conversion | points ↔ physical, per-display scale | pure fn, vitest |
| U4 window selection | window-rect list + point → chosen window (filters) | pure fn, `cargo test` |
| U5 contract + dispatcher | `user.window_sit_drop` → `window_sit` + `setPerchTarget` | vitest |
| U6 Rust hit-test command | `find_window_at_point` wiring around U4 | `cargo test` + manual |
| U7 Rust release monitor | `leftMouseUp` after `start_dragging` | spike + manual (gate 1) |
| U8 renderer wiring | apply offset from `setPerchTarget`; re-align on swap | preview + manual (GL) |

Integration: human drag-drop onto a real window, observed via `screencapture` (the character window is
filtered out of computer-use screenshots; OS-level capture sees it).

## Boundary

**In scope (v2):** drop detection → top-edge perch → per-swap seat re-align (macOS).

**Deferred:**
- **Follow on move / occlusion** — re-aligning when the *target* window is moved/resized/closed while
  perched (v3); when another window covers (occludes) the perched window, the character is not yet
  re-evaluated or detached (occlusion-aware re-perch/detach is v3, same class as follow-on-move).
- **Dedicated loopable perch clips** (#127) — remove the per-swap re-sit and the zoom-out headroom need.
- **Windows parity** — the hit-test and release monitor are macOS-specific.
- **Per-personality perch filter** (#130).
