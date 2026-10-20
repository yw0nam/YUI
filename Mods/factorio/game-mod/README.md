# Factorio game mod — coop-agent

Observation, RPC transport and a playerless body for a remote co-play agent
on a Factorio 2.0 server. `coop-agent` is the in-game mod; `probe-mod` is a
dev-only companion that measures how a playerless character mines, crafts,
revives ghosts and spills items, and fakes a host for headless tests;
`tests/` runs the Lua modules under lupa (Lua 5.2, the game's
version) and the whole stack against a real headless server.

No judgment lives here: the mod fires events, answers read/talk ops and keeps
the body alive. What the agent does with them is the backend's business.

## Layout

- `coop-agent/` — the mod, loadable as a folder. `control.lua` is wiring only;
  every concern lives under `scripts/` (`rpc` framing, `ring` event storage,
  `storage` tables and the event push, `events` handlers, `attack` cell
  grouping, `host`, `unit_index`, `text` checks, `map_id`, `body` with its
  parts under `scripts/body/`, the `jobs` queue with one file per job kind
  under `scripts/jobs/`, the path `walker`, the `idle` modes, one file per op
  under `scripts/ops/`).
  `data.lua` holds the stop hotkey; `settings.lua` the mod settings.
  Pure modules take their dependencies (`storage`, `game.tick`, `rcon.print`,
  `helpers.table_to_json`/`json_to_table`) through an injected `deps` table.
- `probe-mod/` — dev-only, never shipped. One command, `/coop-probe <name>`,
  runs one probe and prints its JSON result over RCON. Poll a running probe
  until `state == "done"`; a finished probe clears itself, so the next call
  re-runs it.
- `tests/` — a uv project: lupa units for the pure modules, plus
  `tests/test_headless.py` which drives a real headless server over RCON.
- `scripts/headless.sh` — creates a fresh save (or takes `--save <path>`) with
  an isolated `--mod-directory` (symlinks to the mod folders) and starts the
  server with RCON on 127.0.0.1.
  The game config lives inside the given workdir; the owner's real game data
  (`~/Library/Application Support/factorio/`) is never touched.

## Run

```bash
FACTORIO_BIN="/path/to/factorio" bash scripts/headless.sh [--probe] [--save <path>] <workdir>
# prints save=, port=, password=, pid=, then ready when RCON answers
```

Talk to the server over RCON with one command:

```
/coop-rpc {"v":1,"id":"<id>","op":"<op>","args":{...},"map_id":"<from status>"}
```

Exactly one JSON reply comes back per call:
`{"v":1,"id":...,"ok":true,"r":...}` or
`{"v":1,"id":...,"ok":false,"e":"<code>","m":"<message>"}`; `m` is a string
on every error reply. The envelope `id` is a string or explicit `null`. Factorio's JSON encoder cannot emit `null` or an
empty array, so consumers read two shapes accordingly:

- `{}` is an empty list for `events`, `power`, `research.queue`,
  `ingredients`, `products`, `machines`, `losses`, a `find` or `jobs` result,
  and an empty map for `inventories`, `fluids` and `science.*.packs`.
- An absent key is null for `host`, `recipe`, `status`, `research.current`,
  a `find` entry's `unit_number`, a recipe part's `amount`, `amount_min`,
  `amount_max` and `probability`, which depend on the part's type,
  `status.queue.running`, `status.idle`'s `pos`, and a job record's `progress`, `reason` and
  `started_tick`, and a queued `mine` record's `timeout_ticks`.

The host is the connected admin with the lowest player index; `status.host`,
`find{around:"player"}` and `chat` events all mean that player.

Any call with a non-nil `player_index` (a player's console) is refused with
`e:"not_console"` and runs nothing. `status` needs no `map_id`; every other op
must carry the `map_id` from the last `status` or gets `e:"stale_session"`.
The write ops (`say`, `ping`, `stop`, `jobs_enqueue`, `jobs_cancel`,
`idle_set`) remember every reply of theirs that ran,
refusals and `op_error` included, for the last 256 ids of the map: the same
`id` with the same arguments replays the stored reply, and the same `id` with
different arguments gets `e:"id_conflict"`. Read ops re-run on a retry.
Replies over 65536 bytes are replaced with `e:"too_large"` and `r.bytes`.

## Ops

| op | args | result |
| --- | --- | --- |
| `status` | — | `{mod_version, map_id, seq, tick, host\|null, body, stopped, queue, idle}`; `body` is `{alive:false}`, or `{alive:true, position, health, inventory:[{name, count}]}` with the main inventory's top 10 by count (ties by name); `queue` is `{length, running\|null: {id, kind, progress}}` with `length` the queued and running jobs; `idle` is `{mode, pos}` with `pos` the position a due stay walk aims at |
| `events_since` | `seq`, `limit` (≤ 200, default 200) | `{map_id, head_seq, events}`; a seq behind the ring answers `e:"history_gap"`, `r:{oldest_seq}` |
| `snapshot` | `sections`? (power, science, research, evolution, pollution) | production and consumption per electric network in W (one-minute average), science packs consumed per minute over 1 and 10 min, research and queue, evolution, pollution total |
| `find` | `area` (≤ 64×64) or `around:"player"`, `name`/`type`?, `limit`? (≤ 200, default 100) | `[{unit_number, name, type, position, gps, owner}]`; seen unit numbers are indexed for `inspect` |
| `inspect` | `unit_number` | status, recipe (crafting machines), `inventories` as `{<inventory name>: get_contents()}` with one entry per non-empty inventory, fluids; the entity resolves through the last 4096 units `find` and `inspect` returned |
| `recipe` | `name` | ingredients, products, energy, machines that can craft it |
| `say` | `text` (≤ 200 UTF-8 characters; else `e:"too_long"`, and `e:"bad_request"` for a non-string, empty or invalid text) | `{}`; prefixed with the body name from the `coop-agent-body-name` setting, at most 6 per 60 s else `e:"rate_limited"` |
| `ping` | `pos {x,y}`, `text` (≤ 60 UTF-8 characters, refused like `say`'s) | `{tag_id}`; a chart tag that a sweep destroys after 10 min, plus a `[gps]` chat line |
| `stop` | — | `{}`; the same stop as the hotkey (see § Body) |
| `jobs` | — | every job record the queue holds, oldest first (see § Jobs) |
| `jobs_enqueue` | `jobs: [{kind, args, timeout_ticks?}]` (1 to 8) | `{ids}`, one per job in order; every job of the call is queued or none is (see § Jobs) |
| `jobs_cancel` | `id` or `all: true` | `{}`; cancels that queued or running job, or every one; an `id` with no queued or running job answers `e:"bad_request"` |
| `idle_set` | `mode` (`follow` or `stay`), `pos {x, y}`? | `{}`; sets the idle mode, lifts the stop latch and rings `idle_changed`; `stay` without `pos` stands at the body's position; a refusal answers `e:"bad_request"` naming the field (see § Idle) |

Event kinds on the ring of 2000 (`{seq, tick, kind, data}`, monotonic seq per
map): `chat{player, text}` — the host's chat lines only, never commands —
`player_joined{player}`, `player_left{player}`, `player_died{player}`,
`research_finished{name}`, `rocket_launched{}`, `attack_started{cell, enemies,
defenders}`, `attack_ended{cell, duration_s, losses:[{name,count}]}`,
`snapshot_summary` every 3600 ticks, the body's `body_died{}`,
`body_respawned{}` and `stopped{}`, the queue's `job_done{id, kind}`,
`job_failed{id, kind, reason}` and `queue_idle{last_job_id}`, and idle's
`idle_changed{mode}`. Attack grouping keys damage by surface
and 64-tile cell: a hit counts when a player-force entity takes damage from a
force the player force `is_enemy` with (the event's `force`, else the
cause's force; never neutral or cease-fire forces), and `losses` counts
player-force entities such a force killed. A cell closes 600 ticks
after its last damage.

All mutable state lives in `storage`; the unit index drops units with invalid
entities every 3600 ticks. `on_load` rebuilds nothing; handlers and
`on_nth_tick` are registered at the `control.lua` root. No `os`, no wall
clock, no unseeded random — the map id is the surface seed and the init tick
(`<seed>-<tick>`), made once at `on_init`. `game.create_random_generator(seed)`
is not used: on 2.0.77 its first draw is the same for every seed.

## Body

With `coop-agent-body-enabled` on and a host connected, the mod keeps one
playerless character beside the host; the entity is `storage.body.entity` and
its `unit_number` is `storage.body.unit_number`. A sweep every 60 ticks, and every runtime setting
change, spawns it, respawns it, or removes it.

- **Spawn.** On a free spot within 8 tiles of the host, as the
  `coop-agent-body-prototype` character (a plain `character` when no character
  prototype has that name), painted the `coop-agent-body-color` player color.
  The first spawn on a map receives freeplay's starter items
  (`remote.call("freeplay", "get_created_items")`) when that interface exists.
- **Death.** Items stay in the character corpse; `body_died` fires. 1800 ticks
  later, while the body is enabled and the host is connected, a new body with
  an empty inventory spawns beside the host and `body_respawned` fires.
- **Disable.** Turning the setting off spills every inventory of the live body
  at its feet as `item-on-ground` flagged `to_be_looted`, then removes the
  body; no respawn follows while it stays off.
- **Stop.** The hotkey `coop-agent-stop` (default `CONTROL + SHIFT + Y`, any
  player) and the `stop` op clear the body's walking, mining and crafting
  queue on every call; the first one latches `status.stopped` and fires
  `stopped`. `body.clear_latch(deps)` lifts the latch.
- **Execution gate.** `body.can_act(deps)` is true for a live body, the latch
  off, and a connected host. `body.game_deps()` builds the live `deps`.
- **Status line.** One text above the body, `<body name> · <state>`. The state
  is `…` for 180 ticks after a host chat line, rounded up to the next
  60-tick sweep; else `Stopped` while latched; else `Waiting for <host>`
  while no host is connected; else the text set through
  `body.set_status(deps, text)` — `Following <host>` while a follow job runs —
  `Standing by` at first. The render object lives in `storage.body.label`;
  only its text is rewritten when the line changes.

Changes to coop-agent's color, name and enabled settings apply at once; a new prototype
applies from the next spawn.

| setting (runtime-global) | type | default |
| --- | --- | --- |
| `coop-agent-body-name` | string | `Buddy` |
| `coop-agent-body-enabled` | bool | `false` |
| `coop-agent-body-prototype` | string | `character` |
| `coop-agent-body-color` | `orange`, `red`, `yellow`, `green`, `cyan`, `blue`, `purple`, `white` | `orange` |
| `coop-agent-idle-start` | string (`follow`, `stay`) | `follow` |

## Idle

While no job is queued or running and the execution gate passes, the body idles
in `storage.idle`'s mode; it starts in the `coop-agent-idle-start` mode and
`idle_set` changes it. `follow` keeps the body 10 to 15 tiles from the host
with repeated short walker steps through the one walker: beyond 15 tiles a step
starts and ends within 10 tiles of the host, and a failed step rests 30 ticks.
Beyond a 64-tile leash the body stops and the status line reads `Waiting for
<host>`; back inside the leash it resumes. `stay` walks to its position once —
`idle_set{stay}` without `pos` takes the body's position — then stands until
told otherwise. An enqueue takes the walk from idle, and idle never pre-empts
a running job or runs while the stop latch is on.

## Jobs

The agent drives the body through a FIFO queue in `storage.jobs`. One job
runs at a time; the next queued job starts on the tick after one ends. A job
record is `{id, kind, args, timeout_ticks, state, progress, reason,
started_tick}`, `state` one of `queued`, `running`, `done`, `failed`,
`cancelled`. The queue holds at most 16 records; finished records give way
oldest first, and a `jobs_enqueue` that would put more than 16 jobs in
`queued` or `running` answers `e:"bad_request"`.

`jobs_enqueue` is the one validator of kinds and args. A refused call queues
nothing, ends no job and answers `e:"bad_request"` with `m` naming the job by its
zero-based index and the field, such as `jobs[1].args.radius: number
expected`. `timeout_ticks`, when given, is a positive number; it counts from
the job's start. A successful `jobs_enqueue` lifts the stop latch.

| kind | args | done when | default `timeout_ticks` | `progress` |
| --- | --- | --- | --- | --- |
| `walk_to` | `pos {x, y}` or `entity` (a `unit_number` that `find` or `inspect` returned), `radius` > 0 | the body is within `radius` of the position, or of the entity's position at the job's start | 3600 | `{distance}` in whole tiles to the target |
| `wait` | `ticks` > 0 | `ticks` have elapsed | its `ticks` | `{elapsed}` ticks |
| `follow` | `ticks` > 0 | `ticks` have elapsed, walking toward the host like the idle mode | its `ticks` | `{elapsed}` ticks |
| `mine` | `name` (an item), `count` (integer 1 to 1000), `entity`? (a `unit_number` that `find` or `inspect` returned) | the body holds `count` more `name` than at the job's start | 3600 + `count` × the first target's mining ticks × 3, at most 36000, set when the job starts | `{gained, count, path}`, `path` `native` or `timed` |
| `deliver` | `item`, `count` (an integer, 1 to 1000) | the body walked to within 3 tiles of the host — stepping out to the 3-tile ring first when it stands closer than 2.5 tiles — and `count` of `item` lie spilled on the host's far side as `item-on-ground` flagged `to_be_looted`, and the body stepped back to 6 tiles from the host, or the step-back's 180 ticks ended, or its walk failed | 3600 | — |

- **Ends.** A job that ends `done` fires `job_done`; when nothing is queued
  after it, `queue_idle` follows. A job that ends `failed` fires one
  `job_failed` and cancels every queued job (`reason:"cancelled"`); no
  `queue_idle` follows. `job_failed` carries `{id, kind, reason}` plus the
  fields of its kind's failure detail (`deliver` adds `no_item`
  `{item, count, held}`, checked at the job's start and again at the spill,
  and `target_full` `{removed, spilled}`, whose spilled items stay on
  the ground; `walk_to`, `wait` and `mine` add none). A step-out walk that
  ends without clearing the 2.5-tile spill radius fails the job with the
  walker's reason and leaves the inventory untouched.
  `jobs_cancel` fires no event. Whenever a running job ends, the body stops
  walking, mining and crafting and the status line returns to `Standing by`,
  or reads `Holding: <item> <n>` with the body's count after a `mine` ends
  `done`; while a `walk_to` runs it reads `Walking to <x,y>` or
  `Walking to <entity name>`, while a `mine` runs `Mining <item> <gained>/<count>`,
  and while a `deliver` runs `Holding: <item> <n>` with the count the body holds.
- **Gate.** While a job is queued or running, the runner checks the
  execution gate every tick; with none it does one counter check. A shut
  gate halts the body at once. Its reason is `body_dead` when there is no
  live body, else `stopped` (the stop latch, or no host connected). A
  running job fails with that reason and the rest are cancelled as above;
  when no job has started, every queued job is cancelled with that reason
  and no `job_failed` fires. A `jobs_enqueue` accepted after a stop in the
  same tick still ends the queue that stop halted.
- **Walking.** `walk_to` sends the game's pathfinder one request with the
  body prototype's collision box and mask, the body as the entity to
  ignore, `radius = 2`, gates openable and `pathfind_flags = {cache =
  false}`, and walks the route waypoint by waypoint by setting the body's
  walking direction, re-aimed every 5 ticks. The body never teleports. A failed path
  request (no path, or the pathfinder busy) is retried 30 ticks later, on a
  finer grid from the 2nd failure and finer again from the 4th; the 6th
  failure ends the job. 150 ticks without movement on a route make one new
  request from 2 tiles back along the heading; 600 make the body step 2
  tiles back and end the job.
- **Mining.** A `mine` target is the nearest entity within 64 tiles of the
  body whose mining products include the item `name` and that is a
  resource, a tree, a rock (a `simple-entity` whose prototype has
  `count_as_rock_for_filtered_deconstruction`) or marked for deconstruction;
  any other entity, such as one the host built, is never a target, and
  neither is a resource whose `required_fluid` is set, such as uranium ore.
  With `entity`, that entity is the first target and must be within the same
  64 tiles. The
  body walks to within its resource reach of the target, selects the target
  itself (never another entity at its position, such as a building on an
  ore tile) and mines it by setting `mining_state`. Every 30 ticks the job
  reads the body's count of `name`, its mining progress and its free space.
  A target's mining ticks are `mining_time / (character mining_speed × (1 +
  character_mining_speed_modifier + force manual_mining_speed_modifier)) ×
  60`, rounded: 120 for coal, 66 for `tree-01`, 360 for `huge-rock` on a
  fresh map. No mining progress and no gain for twice the target's mining
  ticks switch the job to the `timed` path for the rest of its run: native
  mining stops and the body calls `mine_entity` on the target once every
  mining ticks. On a resource each call takes one unit of the tile's
  `amount` and returns `false` while the tile remains, so the gain is read
  from the inventory, never from the return value. A target used up by the body's own mining gives way to the
  next nearest; a target that disappears with no gain from it is replaced
  once, and the second such loss ends the job `target_gone`.

| reason | meaning |
| --- | --- |
| `no_path` | the 6th path request failed |
| `stuck` | 600 ticks without movement on a route |
| `target_gone` | the `walk_to` entity no longer exists; no `mine` target within 64 tiles, the named `entity` no longer exists, or a second `mine` target disappeared |
| `not_permitted` | the named `mine` `entity` is not an allowed target that yields `name` |
| `unreachable` | the named `mine` `entity` is more than 64 tiles from the body |
| `unsupported` | the named `mine` `entity` needs a fluid to mine; also a job kind whose start set no `timeout_ticks` |
| `target_full` | the body has no room for `name` |
| `timeout` | `timeout_ticks` elapsed since the job's start |
| `stopped` | the stop latch is on or no host is connected; also on jobs cancelled before any started |
| `body_dead` | there is no live body; also on jobs cancelled before any started |
| `cancelled` | `jobs_cancel`, or an earlier job of the queue failed |

## Safety

- The mod reads the map, speaks, and walks the body and mines with it when
  told to. It builds nothing; the one entity it spawns is the body, and only
  while the body setting is on. The body mines only resources, trees, rocks
  and entities marked for deconstruction.
- `/coop-rpc` refuses every call that did not come from the console (RCON or
  the server console); a player cannot run ops or forge replies.
- Replies are capped at 64 KiB, so no op can flood an RCON client.
- `probe-mod` builds throwaway entities (a character, ore, a chest ghost,
  spilled coal) and is for throwaway saves only — it ships nowhere.

## Development

`probe-mod` registers the remote interface `coop-agent-dev` with
`host_position()` and `set_host_position(x, y)`; `/coop-probe host <x> <y>`
sets it and answers `{"ok":true,"host":{"x":..,"y":..}}`. While that interface
exists, `coop-agent` takes its host from it: a host named `dev-host` at that
position on nauvis, or no host before a position is set. Without `probe-mod`
the host is the connected admin as above.

Only the owning mod may write its settings, so a test changes one from
coop-agent's Lua state:

```
/silent-command __coop-agent__ settings.global["coop-agent-body-enabled"] = {value = true}
```

## Tests

```bash
cd tests
uv sync
uv run pytest -q                              # lupa units; headless test skips
FACTORIO_BIN="/path/to/factorio" uv run pytest -q tests/test_headless.py
uv run ruff format --check . && uv run ruff check .
```

The lupa units pin the RPC framing, idempotency, the ring, attack grouping,
`say`/`ping` limits, the unit index, the chat filter, the execution gate, the
stop latch, the respawn timer, the status-line text and the body colors, and,
over a fake world (`tests/fixtures/world.lua`), the job queue's transitions,
events, reason codes, validation messages, cap, failure detail and idle
cost, the walker's path
request, retries, resolution steps, stale results, stuck handling and hooks,
and idle: the mode switch with its `idle_changed` and `status.idle`, the leash
with its status line, the latch clearing, the gate and the enqueue handover,
and `idle_set` validation, and the `mine` job's target rule, reach, fluid ores, inventory-delta end,
timed fallback, `target_full`, one replaced target, dropped state and
default timeout, the runner's refusal of a start that sets no
`timeout_ticks`, and the deliver job's walk to the host, far-side spill,
step back, `no_item` at start and at the spill, and enqueue validation
against the item prototypes. The
headless suite runs with `--probe` and pins, on a seed-42 map: `status` →
`events_since` → `say`, write-op replay and
`id_conflict`, `find` → `inspect` on a chest and an assembler, `snapshot`
power in W and the research queue, `recipe` for iron-gear-wheel, `ping` with
its chart tag, a save reload that answers the saved `head_seq` after a
later event, the body: spawned within 60 ticks and 3 tiles of the dev host
with the starter kit, `stop` with its event and label, death with the items in
the corpse and an empty respawn 1800 ticks later, and removal when disabled;
and the jobs: a `walk_to` 100 tiles north into a stone-furnace enclosure
whose one way in is a 2-tile gap, a `walk_to` into a closed furnace ring that
ends `no_path`,
`jobs_cancel{all}` and `stop` while walking, and `jobs_enqueue` replay and
`id_conflict`; and idle: a host moved 40 tiles is followed back within 15
tiles in 600 ticks, a host moved 80 tiles leashes the body under
`Buddy · Waiting for dev-host`, `idle_set{stay, pos}` walks once and then
ignores the host, and `idle_set{follow}` lifts the stop latch; and on a
cleared field around a dev host at (0, 200): `mine`
50 coal natively in 50 × 121 ticks within 10 %, 10 wood from three trees,
5 stone from a huge rock, a host furnace refused while unmarked, and a
farther marked furnace mined while the nearer unmarked one stays, and
`target_full` with a full inventory; and `mine{coal, 20}` then `deliver{coal,
20}` beside the dev host: the coal lies spilled on the host's far side as
`to_be_looted` ground items within 3 tiles, the body holds none 60 ticks
after `job_done`, and body, ground and host conservation holds; and
`deliver` with fewer coal than asked fails `no_item` with the body still
holding them. Every scene body starts empty.

On 2.0.77, reading `count_as_rock_for_filtered_deconstruction` on a prototype
that is not a `simple-entity` returns `nil` without an error; the job still
reads it on `simple-entity` prototypes only.

### Checked on the owner's GUI game

A headless server has no player, so chat is checked by hand: with the mod
loaded, the host types `hello` in chat and `events_since` returns
`{"seq":<n>,"tick":<t>,"kind":"chat","data":{"player":"<host name>","text":"hello"}}`;
typing `/help` adds no event.
