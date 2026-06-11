# Perch-fall sequence — design

When a perched character leaves its window (`user.window_sit_exit` while a perch target is
set), the character does not snap to idle — it **falls**: the transparent pet window descends
to the current monitor's work-area bottom under gravity while the character plays a falling
loop, lands, sulks, and settles back to `idle`.

Like the perch itself (`docs/window-sit-drop.md`) this is **client-firing, backend-bypassed**
(tier1): no agent call, no geometry in the `ControlEnvelope`. The renderer owns the whole
sequence.

## Hand-off

`user.window_sit_exit` (re-drag released off a window, perch-loss poll, dev exit) reaches the
dispatcher, which clears the perch via the client-only `setPerchTarget(null)` seam. In the
renderer, if the character was perched:

- **Fall sequence attached** (Tauri — `attachFallSequence(mover, reducedMotion)` runs at
  bootstrap): `setPerchTarget(null)` starts the sequence instead of re-fitting the camera and
  playing idle. The sequence owns both the motion channel and the framing restore.
- **Not attached** (plain-browser dev, no window mover): instant idle — restore framing,
  `playMotion(null)`.

## State machine

`createFallSequence` (`src/renderer/fall-sequence.ts`) is fully dependency-injected — no
three.js / Tauri / DOM — so the machine is unit-tested with fakes. `start()` is idempotent
while a sequence is active.

| Phase | Motion | What happens |
|---|---|---|
| `detaching` | — | capture the preemption generation; resolve work area + window geometry (1 s per-probe deadline) |
| `falling` | `falling` (loop) | gravity integrator steps the window Y down each frame |
| `landing` | `landing` (oneshot) | played to natural completion |
| `reacting` | `suneru` (oneshot) | sulk, played to natural completion |
| `idle` | `null` | framing restored, idle baseline resumes |
| `cancelled` | — | takeover owns the character; no further transitions, no forced idle |

While active the sequence is the **sole `playMotion` driver** — it never relies on motion
priority to protect itself. Implicit idle-returns (motion `null` directives) are no-ops while
the sequence is active (same suppression as the perch hold, `perch-hold.ts`); explicit motions
take over and cancel the sequence via preemption.

## Geometry

All units are logical px / points (the perch coordinate chain).

- **Work area**: Rust command `get_work_area_for_window` (`src-tauri/src/drag.rs`) returns
  the work area (Dock / menu bar excluded) of the monitor the pet window currently sits on,
  converted from physical px to logical px (`work_area_to_logical`).
- **Feet line**: `measureFeetPx()` projects the live posed bounding box's lowest point to a
  feet-from-window-top distance, frozen **once** at fall start. Fallback when no VRM /
  projection: the window height (feet at the bottom edge).
- **Target**: `computeTargetY` (`fall-geometry.ts`) puts the feet on the work-area bottom
  line — `targetWinY = workBottom − feetPx` — then clamps the window inside the work area
  (literal port of the Rust `clamp_to_work_area`). A non-positive fall distance (already
  at/below the landing) skips the plunge and goes straight to land + react.
- **X**: the window's real X is preserved (clamped into the work area) on every step.

## Plunge

`createFallIntegrator` (`fall-integrator.ts`) is a true integrator (`v += g·dt; y += v·dt`)
with a terminal-velocity clamp and a hard max-duration cap that snaps to the target.
Constants live in `fall-config.ts`: gravity 3200 px/s², terminal velocity 2800 px/s, cap
1.2 s. `dt` comes from the renderer's per-frame tick hook, so the integrator is deterministic
under a fake clock.

Y is computed every frame, but an IPC `setPosition` is issued only when the accumulated delta
is ≥ 1 logical px AND ≥ 1/30 s has elapsed AND no previous call is still in flight (~30 Hz
cap). The landing hand-off is synchronous on integrator completion — never chained off an IPC
resolve.

## Cancellation & staleness

- **Preemption (push)**: any motion supersession while active — user re-grab (`drag`), an
  explicit directive motion, VRM dispose — fires the `motion-preemption.ts` callback and
  cancels the sequence: tick hook unregistered, pending finish-waits dropped, **no forced
  idle** (the takeover owns the character).
- **Generation (pull)**: a monotonic counter captured at start and re-checked after every
  async hop, so a stale `setPosition` / probe resolve can't act after a cancel or a newer
  sequence.
- The sequence's own motion plays go through a fall-driven channel that skips preemption
  notification — its transitions are not takeovers.
- `whenMotionFinished` (`motion-finish-waiters.ts`) resolves on **natural** mixer finish
  only; a consumed finish skips the motion controller's auto-swap (the sequence owns the
  follow-up), a cut/replaced clip never settles a waiter, and every teardown drops pending
  waits unsettled.
- `restoreFraming` (camera re-fit out of the perch zoom) runs **exactly once per sequence**:
  on idle entry, on the idle fallback, or on cancel of an active sequence.

## Reduced motion / degradation

- **`prefers-reduced-motion`** (read once at attach): no animated plunge — a single
  `setPosition` snap to the target, then landing → suneru as usual.
- **Any geometry failure** — missing mover, probe error/throw, 1 s timeout, `setPosition`
  rejection on the reduced-motion snap — falls back to the instant-idle path (framing restore
  + `playMotion(null)`): exactly the no-fall behavior.

## Module map

| Module | Role |
|---|---|
| `src/renderer/fall-sequence.ts` | state machine (DI, unit-tested with fakes) |
| `src/renderer/fall-geometry.ts` | pure target/clamp math |
| `src/renderer/fall-integrator.ts` | gravity integrator |
| `src/renderer/fall-config.ts` | tuning constants + motion ids |
| `src/renderer/motion-preemption.ts` | supersession notify + generation counter |
| `src/renderer/motion-finish-waiters.ts` | id-keyed natural-finish waits |
| `src/renderer/index.ts` | wiring: `attachFallSequence`, `measureFeetPx`, fall-driven motion channel, idle-return suppression |
| `src/main.ts` | Tauri `WindowMover` (`setPosition` / `getWorkArea` / `getWindowGeom`), reduced-motion read |
| `src-tauri/src/drag.rs` | `get_work_area_for_window` command + DPI/clamp helpers |

Motions `falling` / `landing` / `suneru` are catalogued in `docs/motions.md`; all three are
`broker_publish: false` — the fall is a client mechanic, never agent-selected.
