# Motion catalog

Human-readable map of every motion id in [`configs/motions.json`](https://github.com/yw0nam/YUI/blob/main/configs/motions.json) — what it looks like, its playback policy, and the source clip it was extracted from. Keep this in sync with the registry.

- **Sources**: clips come from three origins.
  - **[Mate Engine](https://github.com/shinyflvre/Mate-Engine)** (Shiny) — the bulk set, extracted from the Unity project (`Assets/MATE ENGINE - Animations/…`) to `.vrma` via the `unity-cli exec → YuiExport.YuiVrmaExport.ExportBatch` pipeline (30 FPS, T-pose reference, model-independent retarget). Used under Mate Engine's non-commercial terms — attribution to Shiny required; commercial use needs separate permission.
  - **[necocoya — EmoteSet_Free_v130](https://booth.pm/ja/items/1065089)** — `sulk` only (Unity Humanoid `06_suneru`, 拗ね = sulk/pout). Attribution to necocoya required; modification/conversion and bundling-with-credit are permitted, standalone resale of the raw file is prohibited.
  - **[もいらんど — thinking](https://booth.pm/ja/items/5562384)** — `thinking` only. A purchased licensed asset kept at `public/purchased_motions/thinking.vrma`, gitignored and never committed to a public repository (see [`public/purchased_motions/AGENTS.md`](https://github.com/yw0nam/YUI/blob/main/public/purchased_motions/AGENTS.md)). When the file is absent locally, the renderer falls back to `idle`.
  - **[Mixamo](https://www.mixamo.com/)** — `walk` ("Walking", in-place), `falling` ("Falling"), `landing` ("Falling To Landing"), and the climb set `climb_up` ("Climbing UP"), `climb_up_done` ("Climbing_UP_done"), `climb_down` ("Climbing Down Wall"), `climb_down_landing` ("Climbing Down_landing"). Royalty-free under the Mixamo terms; converted to `.vrma` through the Mate-Engine `YuiExport.YuiVrmaExport` pipeline (30 FPS) with a with-skin (bind-pose) source avatar; the fall pair and the climb set are exported from the "Maria WProp J J Ong" character.
- Durations are the source clip length.
- **Pools**: `idle`, `idle_lively`, `window_sit`, `dance` are single registry entries with a `variants[]` list and `variant_policy: "random"` — each trigger plays a random variant (immediate-repeat avoided). The character-facing id is the pool id; individual variant files are not separate registry entries.
- **Triggers**: AI via `generate_express` `motion_id` plays any broker-published oneshot/pool; `idle` is the ambient baseline; `drag` is the reactive pickup; `head_pat` loops while a press is held on the head region; `window_sit` is a held state engaged by a dev trigger; `thinking` is a client-played TTFT latency affordance (loops from the start of a backend turn until the response speech begins); `walk` is the ambient floor stroll, played by the client's walk scheduler while the OS window translates along the work-area bottom; `falling` and `landing` are the fall chain, played by the client when a drag release leaves the character mid-air and the window drops to the work-area floor; `climb_up`, `climb_up_done`, `climb_down` and `climb_down_landing` are the climb chain, played by the client's climb scheduler while the OS window travels up or down a foreign window's side edge.
- **Broker publication** (`broker_publish`, default `true`): a `false` entry stays renderable locally but is kept out of the agent-facing broker vocabulary, so the agent never selects it. The broker-published, agent-selectable set is `happy, laugh, embarrassed, sheepish, calm, sleeping, idle_lively, dance, sulk`. Excluded from the broker: `idle` (ambient baseline, auto-played), `drag` (`kind: reactive` pickup), `head_pat` (`kind: reactive` pat loop), `peek` and `window_sit` (`broker_publish: false`, client-held perch states), `thinking` (`broker_publish: false`, client-played TTFT affordance), `walk` (`kind: reactive` + `broker_publish: false`, client-scheduled ambient stroll), `falling`, `landing` (`broker_publish: false`, the client-owned fall chain), and `climb_up`, `climb_up_done`, `climb_down`, `climb_down_landing` (`broker_publish: false`, the client-owned climb chain).
- **Idle selection**: each `idle` variant carries an on/off switch in the Character tab. The selection is a localStorage overlay (`yui.idle_motions`, the disabled set keyed by variant file path) — `configs/motions.json` is never written. The ambient cycle picks only from the enabled variants and re-reads the selection on every rotation, so a change lands after the playing variant finishes its cycle. The pool's `vrma_path` (`calm.vrma`) is the fallback baseline and cannot be disabled.
- **Expression selection**: each broker-published motion carries an on/off switch in the Character tab, grouped by category. The selection is a localStorage overlay (`yui.express_motions`, the disabled set keyed by motion id) — `configs/motions.json` is never written. It narrows the vocabulary published to the broker and the `motion_id` enum of the Chat-Completions `generate_express` tool; turning every motion off drops `motion_id` from that schema. It is a vocabulary filter, not a render gate: a cue naming a deselected motion still plays.
- **Vertical root lock** (`root_lock_y`, default `false`): the loader strips a clip's baked horizontal root drift from every entry, but leaves vertical travel alone because that is the bob. A `true` entry also has its end-to-end vertical travel removed, subtracted linearly across the clip's own time span: the bob survives as the deviation from that line, the last key lands back on the first so a loop no longer snaps at the seam, and the removed travel is reported per clip as metres. Set on the four climb clips, whose rise and fall *is* the movement — the OS window supplies exactly the travel the clip lost, so it never plays twice. The flag rides in the clip-cache key, so two entries sharing one `.vrma` can disagree on it.
- **Missing-clip fallback**: any motion whose clip fails to load (missing or invalid `.vrma` for the live VRM — e.g. a gitignored purchased motion absent locally) recovers to `idle`. The renderer force-commits `idle` so the failed id never pins controller state or blocks a later idle by priority.

## Naming convention

A motion id is named for the emotion or state it expresses, with a few patterns:

- **Default — `{emotion}`**: the bare emotion or state — `happy`, `laugh`, `embarrassed`, `sheepish`, `calm`.
- **Indexed — `{emotion}_NN`**: when several clips express the same id, suffix a zero-padded number (`idle_01`, `dance_13`, `sit_01`).
- **Descriptive exception**: motions whose action or pose is itself the clearest identifier keep that descriptive name instead of an emotion label — `idle`, `drag`, `head_pat`, `peek`, `window_sit`, `sleeping`, `thinking`, `walk`, `climb_up`, `climb_down`, `dance`.

## Top-level motions

| id | kind | loop | description | source clip | ~len |
|---|---|---|---|---|---|
| `idle` | ambient | yes (cycle) | Calm ambient baseline — random pool of `calm.vrma` and the three calmest idle variants (see below). `pingpong: true` with `loop_cycles: [1, 3]`: each variant plays forward↔reverse a random 1–3 round trips, then rotates to a fresh variant. | PET_POSE / PET_IDLE / PET_MISC | — |
| `idle_lively` | oneshot | no | Broker-published random lively-fidget pool (see below). Plays one variant once, then returns to the prior stable motion. | PET_IDLE / UPDATE_2 | — |
| `drag` | reactive | yes | Pickup reaction while the window is being dragged. `broker_publish: false`. | PET_MISC/PET_DRAGGING | — |
| `head_pat` | reactive | yes | Head-pat reaction, held for as long as the press stays on the head region. `pingpong: true` (single variant): plays forward↔reverse continuously until the release clears it. `broker_publish: false`. Reuses `idle_10.vrma` as the pat loop. | PET_IDLE/PET_IDLE_10 | 11.0s |
| `falling` | reactive | yes | Falling loop, held for the whole descent after a drag release lands mid-air. `broker_publish: false`. | Mixamo "Falling" | 11.4s |
| `landing` | oneshot | no | Touchdown at the end of a fall, then settle. `broker_publish: false`. | Mixamo "Falling To Landing" | 1.1s |
| `climb_up` | reactive | yes | Wall-climb loop held for the length of an ascent. `root_lock_y: true`: the clip's ~0.84 m rise per cycle comes out of the hips and goes into the window, so the VRM climbs in place at scene origin while the OS window rises along the chosen window edge and the root yaws ±90° toward the wall. The window is paced at that travel divided by the loaded clip's own duration, so the hands do not slide. `broker_publish: false`. | Mixamo "Climbing UP" | 2.97s |
| `climb_up_done` | oneshot | no | Pull-over onto the ledge that ends an ascent. `root_lock_y: true`: the window rises the clip's own ~1.41 m linearly over its length, leaving the feet on the window's top edge. `broker_publish: false`. | Mixamo "Climbing_UP_done" | 3.8s |
| `climb_down` | reactive | yes | Wall-descent loop held for the length of a descent, `root_lock_y: true` and paced at the clip's own ~1.05 m per cycle. It also covers the step off the ledge: the clip crossfades in over a 400 ms linear slide down the wall. `broker_publish: false`. | Mixamo "Climbing Down Wall" | 2.0s |
| `climb_down_landing` | oneshot | no | Touchdown at the end of a descent. `root_lock_y: true`: the window drops the clip's own ~0.24 m linearly over its length onto the work-area floor. `broker_publish: false`. | Mixamo "Climbing Down_landing" | 1.38s |
| `happy` | oneshot | no | Happy reaction. | PET_MISC/PET_HAPPY | — |
| `laugh` | oneshot | no | Laughing reaction. | PET_MISC/PET_LAUGHING | — |
| `embarrassed` | oneshot | no | Strongly embarrassed; shy finger-point gesture. | PET_MISC/PET_SHY_POINT | — |
| `sheepish` | oneshot | no | Sheepish/awkward standing gesture; one hand raised to the head/hair. | PET_POSE/PET_POSE_2 | 6.8s |
| `calm` | oneshot | no | Calm standing gesture; hands folded together in front. | PET_POSE/PET_POSE_3 | 5.0s |
| `peek` | state | yes (cycle) | Held while side-perched; the hips stay pinned inside the app-window edge so the clip's walk-away never leaves frame, and the clip mirrors on its configured side. `crossfade_loop: true`: the clip clamps on its last frame and crossfades back to frame 0 (`fade_ms: 700`) each loop, hiding the wrap seam. `broker_publish: false`. | PET_HIDING/PET_HIDE | 14.0s |
| `sleeping` | oneshot | yes | Lies down on the floor on her side — sleeping. Drops the hips low (off a feet-anchored frame). | PET_SLEEPING/PET_SLEEPING | 35.2s |
| `thinking` | state | yes | Looping thinking pose — client-played TTFT latency affordance; loops from the start of a backend turn until the response speech begins. `pingpong: true` (single variant): plays forward↔reverse continuously, seam-free at the turnaround, until interrupted. Priority 50 (above `idle`, below `window_sit` perch and reactive emotes). `broker_publish: false`. Purchased asset at `public/purchased_motions/thinking.vrma`; falls back to `idle` when absent. | もいらんど thinking | — |
| `sulk` | oneshot | no | Sulk/pout (拗ね) emotion gesture. | necocoya EmoteSet_Free_v130 / `06_suneru` | 4.2s |
| `walk` | reactive | yes | In-place walk cycle (39 keyframes at 30 FPS) held for the length of an ambient stroll. The VRM stays at scene origin while the OS window translates along the work-area bottom and the root yaws ±90° toward the travel direction; the window is paced at 1.34 m of stride per cycle, divided by the loaded clip's own duration, so the feet do not slide. Priority 45 (above `idle`, below `thinking` and the emote oneshots, which end the stroll by taking the clip). `kind: reactive` keeps it out of the return target a finishing oneshot resumes, so a stroll cut short never leaves the character walking on the spot. `broker_publish: false`. | Mixamo Walking | 1.27s |
| `window_sit` | state | yes | Held window-perch (see below). Plays a sit variant, `pingpong: true` with `loop_cycles: [1, 3]` (forward↔reverse a random 1–3 round trips), crossfades to a different variant, repeats until interrupted. `broker_publish: false`. Engaged by a dev trigger. | PET_SITTING/* | — |
| `dance` | oneshot | no | Random dance pool (see below). | PET_DANCING/* | — |

> `sheepish` and `calm` are **standing gestures**, not sitting.

## `idle` variants (ambient baseline pool)

4 variants.

| variant file | description | source clip | ~len |
|---|---|---|---|
| calm.vrma | Calm standing gesture; hands folded together in front. | PET_POSE/PET_POSE_3 | 5.0s |
| idle_01.vrma | Standing, hands framed together at the chest, slight turn — playful. | PET_MISC/HoverReaction | 2.5s |
| idle_04.vrma | Standing, 3/4 turn, one hand raised to touch her hair — coy. | UPDATE_2/PET_IDLE_UPDATE2_03 | 11.4s |
| idle_12.vrma | Standing, weight shifted onto one hip, subtle head tilt and knowing smile — sultry calm. | PET_IDLE/PET_IDLE_12 | 3.5s |

## `idle_lively` variants (oneshot, random)

10 variants.

| variant file | description | source clip | ~len |
|---|---|---|---|
| idle_02.vrma | Standing, arm lifts to the chin then crosses at the chest, cape swirling — energetic. | UPDATE_2/PET_IDLE_UPDATE2_01 | 16.5s |
| idle_03.vrma | Standing, one arm raised high in an open-palm wave — cheerful greeting. | UPDATE_2/PET_IDLE_UPDATE2_02 | 13.2s |
| idle_05.vrma | Standing, both arms thrown overhead in a big stretch, cape flaring wide — energetic. | UPDATE_2/PET_IDLE_UPDATE2_04 | 12.0s |
| idle_06.vrma | Standing, quick half-turn with a leg cross and hip dip, hair swinging out — playful twirl. | PET_IDLE/PET_IDLE_6 | 5.7s |
| idle_07.vrma | Standing, glancing back over the shoulder with one hand raised in a small wave, hair swept aside — flirty. | PET_IDLE/PET_IDLE_7 | 9.3s |
| idle_08.vrma | Standing, arms sweep open wide then settle back at sides, sleeves fluttering — breezy sway. | PET_IDLE/PET_IDLE_8 | 6.0s |
| idle_09.vrma | Hands on hips, confident smirk, quick turn sends hair whipping to the side — playful, sassy. | PET_IDLE/PET_IDLE_9 | 10.0s |
| idle_10.vrma | Side turn, hair caught in a windswept flick, hands settle clasped behind the back — coy, flirty. | PET_IDLE/PET_IDLE_10 | 11.0s |
| idle_11.vrma | Standing, hands raised to shoulder height with fingers curled like claws, playful jab — feisty. | PET_IDLE/PET_IDLE_11 | 4.1s |
| idle_13.vrma | Standing, glances back over the shoulder then leans in with hip cocked — flirty tease. | PET_IDLE/PET_IDLE_13 | 4.1s |

## `window_sit` variants (random)

8 variants — a mix of floor sits and edge/perch sits. All lower the hips when seated. `window_sit` is a looping held state that ping-pongs each variant forward↔reverse a random 1–3 round trips (`loop_cycles: [1, 3]`), then crossfades to a different variant over `fade_ms: 700` with no settled-frame dwell (`cycle_dwell_ms: 0`).

| variant file | description | source clip | ~len |
|---|---|---|---|
| sit_01.vrma | Floor sit, legs folded to one side, one hand supporting — elegant. | PET_SITTING/ME_02/PET_SIT_01 | 3.2s |
| sit_02.vrma | Sits upright on an edge, knees together — best for window-perch. | PET_SITTING/ME_02/PET_SIT_02 | 6.5s |
| sit_03.vrma | Sideways floor sit, hand to chin — cute. | PET_SITTING/ME_02/PET_SIT_03 | 6.5s |
| sit_04.vrma | Edge sit, knees together, hands resting on lap — demure. | PET_SITTING/ME_02/PET_SIT_04 | 2.0s |
| sit_05.vrma | Cross-legged floor sit, one hand to the head — relaxed/casual. | PET_SITTING/ME_02/PET_SIT_05 | 4.0s |
| sit_07.vrma | Knees-apart floor sit, hands between the legs — casual. | PET_SITTING/ME_02/PET_SIT_07 | 8.0s |
| suwari1.vrma | Compact floor sit, knees drawn up. | PET_SITTING/ME_02/suwari1 | 3.2s |
| suwari3.vrma | Floor sit leaning back, one hand propped behind — relaxed. | PET_SITTING/ME_02/suwari3 | 2.9s |

## `dance` variants (oneshot, random)

13 variants, ranging from short gestures (~1.3s) to full routines (~27s).

| variant file | description | source clip | ~len |
|---|---|---|---|
| dance_01.vrma | Energetic — both arms spread, scarf flowing. | PET_DANCING/PET_DANCING | 14.2s |
| dance_02.vrma | Short — hands at the waist. | PET_DANCING/PET_DANCING_2 | 1.3s |
| dance_03.vrma | One hand reaching out to the side, legs apart. | PET_DANCING/PET_DANCING_3 | 3.9s |
| dance_04.vrma | Idol-style — hands in fists near the chest. | PET_DANCING/PET_DANCING_4 | 2.3s |
| dance_05.vrma | Subtle hand gesture. | PET_DANCING/PET_DANCING_5 | 1.7s |
| dance_06.vrma | Weight-shift step, one arm crossed to chest. | PET_DANCING/PET_DANCING_6 | 2.4s |
| dance_07.vrma | Medium routine (calmer). | PET_DANCING/PET_DANCING_7 | 5.0s |
| dance_08.vrma | One arm extended, scarf flaring dramatically. | PET_DANCING/PET_DANCING_8 | 2.4s |
| dance_09.vrma | Raised hand / wave-like move. | PET_DANCING/PET_DANCING_9 | 4.5s |
| dance_10.vrma | Long full routine, expressive. | PET_DANCING/PET_DANCING_10 | 21.8s |
| dance_11.vrma | Longest — full routine with spins. | PET_DANCING/PET_DANCING_11 | 27.4s |
| dance_12.vrma | Gentle, cute. | PET_DANCING/PET_DANCING_12 | 6.3s |
| dance_13.vrma | Celebratory — both arms raised in a V. | PET_DANCING/PET_DANCING_13 | 19.6s |
