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
  parts under `scripts/body/`, one file per op under `scripts/ops/`).
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
  `ingredients`, `products`, `machines`, `losses`, a `find` result, and an
  empty map for `inventories`, `fluids` and `science.*.packs`.
- An absent key is null for `host`, `recipe`, `status`, `research.current`,
  a `find` entry's `unit_number`, and a recipe part's `amount`, `amount_min`,
  `amount_max` and `probability`, which depend on the part's type.

The host is the connected admin with the lowest player index; `status.host`,
`find{around:"player"}` and `chat` events all mean that player.

Any call with a non-nil `player_index` (a player's console) is refused with
`e:"not_console"` and runs nothing. `status` needs no `map_id`; every other op
must carry the `map_id` from the last `status` or gets `e:"stale_session"`.
The write ops (`say`, `ping`, `stop`) remember every reply of theirs that ran,
refusals and `op_error` included, for the last 256 ids of the map: the same
`id` with the same arguments replays the stored reply, and the same `id` with
different arguments gets `e:"id_conflict"`. Read ops re-run on a retry.
Replies over 65536 bytes are replaced with `e:"too_large"` and `r.bytes`.

## Ops

| op | args | result |
| --- | --- | --- |
| `status` | — | `{mod_version, map_id, seq, tick, host\|null, body, stopped}`; `body` is `{alive:false}`, or `{alive:true, position, health, inventory:[{name, count}]}` with the main inventory's top 10 by count (ties by name) |
| `events_since` | `seq`, `limit` (≤ 200, default 200) | `{map_id, head_seq, events}`; a seq behind the ring answers `e:"history_gap"`, `r:{oldest_seq}` |
| `snapshot` | `sections`? (power, science, research, evolution, pollution) | production and consumption per electric network in W (one-minute average), science packs consumed per minute over 1 and 10 min, research and queue, evolution, pollution total |
| `find` | `area` (≤ 64×64) or `around:"player"`, `name`/`type`?, `limit`? (≤ 200, default 100) | `[{unit_number, name, type, position, gps, owner}]`; seen unit numbers are indexed for `inspect` |
| `inspect` | `unit_number` | status, recipe (crafting machines), `inventories` as `{<inventory name>: get_contents()}` with one entry per non-empty inventory, fluids; the entity resolves through the last 4096 units `find` and `inspect` returned |
| `recipe` | `name` | ingredients, products, energy, machines that can craft it |
| `say` | `text` (≤ 200 UTF-8 characters; else `e:"too_long"`, and `e:"bad_request"` for a non-string, empty or invalid text) | `{}`; prefixed with the body name from the `coop-agent-body-name` setting, at most 6 per 60 s else `e:"rate_limited"` |
| `ping` | `pos {x,y}`, `text` (≤ 60 UTF-8 characters, refused like `say`'s) | `{tag_id}`; a chart tag that a sweep destroys after 10 min, plus a `[gps]` chat line |
| `stop` | — | `{}`; the same stop as the hotkey (see § Body) |

Event kinds on the ring of 2000 (`{seq, tick, kind, data}`, monotonic seq per
map): `chat{player, text}` — the host's chat lines only, never commands —
`player_joined{player}`, `player_left{player}`, `player_died{player}`,
`research_finished{name}`, `rocket_launched{}`, `attack_started{cell, enemies,
defenders}`, `attack_ended{cell, duration_s, losses:[{name,count}]}`,
`snapshot_summary` every 3600 ticks, and the body's `body_died{}`,
`body_respawned{}` and `stopped{}`. Attack grouping keys damage by surface
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
  `body.set_status(deps, text)`, `Standing by` at first. The render object lives in `storage.body.label`;
  only its text is rewritten when the line changes.

Changes to coop-agent's color, name and enabled settings apply at once; a new prototype
applies from the next spawn.

| setting (runtime-global) | type | default |
| --- | --- | --- |
| `coop-agent-body-name` | string | `Buddy` |
| `coop-agent-body-enabled` | bool | `false` |
| `coop-agent-body-prototype` | string | `character` |
| `coop-agent-body-color` | `orange`, `red`, `yellow`, `green`, `cyan`, `blue`, `purple`, `white` | `orange` |

## Safety

- The mod reads the map and speaks when told to. It builds nothing and
  destroys nothing; the one entity it spawns is the body, and only while the
  body setting is on.
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
stop latch, the respawn timer, the status-line text and the body colors. The
headless suite runs with `--probe` and pins, on a seed-42 map: `status` → `events_since` → `say`, write-op replay and
`id_conflict`, `find` → `inspect` on a chest and an assembler, `snapshot`
power in W and the research queue, `recipe` for iron-gear-wheel, `ping` with
its chart tag, a save reload that answers the saved `head_seq` after a
later event, and the body: spawned within 60 ticks and 3 tiles of the dev host
with the starter kit, `stop` with its event and label, death with the items in
the corpse and an empty respawn 1800 ticks later, and removal when disabled.

### Checked on the owner's GUI game

A headless server has no player, so chat is checked by hand: with the mod
loaded, the host types `hello` in chat and `events_since` returns
`{"seq":<n>,"tick":<t>,"kind":"chat","data":{"player":"<host name>","text":"hello"}}`;
typing `/help` adds no event.
