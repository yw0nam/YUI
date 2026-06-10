# Motion catalog

Human-readable map of every motion id in [`configs/motions.json`](../configs/motions.json) — what it looks like, its playback policy, and the source clip it was extracted from. Keep this in sync when motions are added/renamed.

- **Source**: all clips were extracted from the Mate-Engine Unity project (`Assets/MATE ENGINE - Animations/…`) to `.vrma` via the `unity-cli exec → YuiExport.YuiVrmaExport.ExportBatch` pipeline (30 FPS, T-pose reference, model-independent retarget). Durations are the source clip length.
- **Pools**: `idle`, `sit`, `dance` are single registry entries with a `variants[]` list and `variant_policy: "random"` — each trigger plays a random variant (immediate-repeat avoided). The character-facing id is the pool id (`sit`, `dance`); individual variant files are not separate registry entries.
- **Triggers** (current): AI via `generate_express` `motion_id` plays any oneshot/pool; `idle` is the ambient baseline; `drag` is the reactive pickup. Window-sit-on-drop (reactive) is tracked in #131; per-personality filtering of these pools in #130.

## Top-level motions

| id | kind | loop | description | source clip | ~len |
|---|---|---|---|---|---|
| `idle` | ambient | yes (cycle) | Ambient baseline — random idle variant pool (see below). | PET_IDLE / PET_MISC | — |
| `drag` | reactive | yes | Pickup reaction while the window is being dragged. | PET_MISC/PET_DRAGGING | — |
| `happy` | oneshot | no | Happy reaction. | PET_MISC/PET_HAPPY | — |
| `laughing` | oneshot | no | Laughing reaction. | PET_MISC/PET_LAUGHING | — |
| `embarrassed` | oneshot | no | Strongly embarrassed; shy finger-point gesture. | PET_MISC/PET_SHY_POINT | — |
| `sheepish` | oneshot | no | Sheepish/awkward; one hand raised to the head/hair. | PET_POSE/PET_POSE_2 | 6.8s |
| `calm` | oneshot | no | Calm; standing, hands folded together in front. | PET_POSE/PET_POSE_3 | 5.0s |
| `peek` | oneshot | no | Standing, 3/4 turn; one hand covering the mouth — shy peek. | PET_HIDING/PET_HIDE | 14.0s |
| `sleeping` | oneshot | yes | Lies down on the floor on her side — sleeping. Drops the hips low (off a feet-anchored frame). | PET_SLEEPING/PET_SLEEPING | 35.2s |
| `sit` | oneshot | no | Random sit pool (see below). Currently returns to idle; held window-sit is #131. | PET_SITTING/* | — |
| `dance` | oneshot | no | Random dance pool (see below). | PET_DANCING/* | — |

> Note: `sheepish` and `calm` are **standing gestures**, not sitting.

## `idle` variants (ambient, random)

13 variants. `idle_01`–`05` are the original pool; `idle_06`–`13` were added from `PET_IDLE`. (Identity: `idle_01` = HoverReaction; `idle_02`–`05` = PET_IDLE_UPDATE2_01–04.)

| variant file | source clip | ~len |
|---|---|---|
| idle_01.vrma | PET_MISC/HoverReaction | 2.5s |
| idle_02.vrma | UPDATE_2/PET_IDLE_UPDATE2_01 | 16.5s |
| idle_03.vrma | UPDATE_2/PET_IDLE_UPDATE2_02 | 13.2s |
| idle_04.vrma | UPDATE_2/PET_IDLE_UPDATE2_03 | 11.4s |
| idle_05.vrma | UPDATE_2/PET_IDLE_UPDATE2_04 | 12.0s |
| idle_06.vrma | PET_IDLE/PET_IDLE_6 | 5.7s |
| idle_07.vrma | PET_IDLE/PET_IDLE_7 | 9.3s |
| idle_08.vrma | PET_IDLE/PET_IDLE_8 | 6.0s |
| idle_09.vrma | PET_IDLE/PET_IDLE_9 | 10.0s |
| idle_10.vrma | PET_IDLE/PET_IDLE_10 | 11.0s |
| idle_11.vrma | PET_IDLE/PET_IDLE_11 | 4.1s |
| idle_12.vrma | PET_IDLE/PET_IDLE_12 | 3.5s |
| idle_13.vrma | PET_IDLE/PET_IDLE_13 | 4.1s |

## `sit` variants (oneshot, random)

8 variants — a mix of floor sits and edge/perch sits. All lower the hips when seated.

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

**Excluded (extracted but not in the pool):** `PET_SIT_06` (side recline/lounge, not a sit), `sit 1` (2.3s broken/clamped transition), `BETA_PET_WINDOW_LAY` / `WINDOW_LAY_8/9/10` (window-edge perch — reserved for the window-sit trigger #131), `PET_SITTING_DEMO` & `BETA_PET_WINDOW_LAY_2–7` (empty stubs).

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

## Extracted but not yet registered

| clips | intended use | status |
|---|---|---|
| PET_POSE/PET_POSE_1 | Standing pose gesture — both hands clasped near chest/chin. | extracted, not registered |
| PET_POSE/PET_POSE_4 | Standing pose gesture — hand at forehead (salute / peering). | extracted, not registered |
| PET_INTRO / PET_INTRO_START / _LOOP / _END | Spawn/appear sequence on app launch. | staged, needs sequencing wiring |
| WINDOW_LAY_8 / 9 / 10, BETA_PET_WINDOW_LAY | Window-edge perch pool for the window-sit trigger. | reserved for #131 |
