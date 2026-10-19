# Factorio game mod — coop-agent

Observation and RPC transport for a remote co-play agent on a Factorio 2.0
server. `coop-agent` is the in-game mod; `probe-mod` is a dev-only companion
that measures how a playerless character mines, crafts, revives ghosts and
spills items; `tests/` runs the Lua modules under lupa (Lua 5.2, the game's
version) and the whole stack against a real headless server.

No judgment lives here: the mod fires events and answers read/talk ops. What
the agent does with them is the backend's business.

## Layout

- `coop-agent/` — the mod, loadable as a folder. `control.lua` is wiring only;
  every concern lives under `scripts/` (`rpc` framing, `ring` event storage,
  `storage` tables and the event push, `events` handlers, `attack` cell
  grouping, `unit_index`, `map_id`, one file per op under `scripts/ops/`).
  Pure modules take their dependencies (`storage`, `game.tick`, `rcon.print`,
  `helpers.table_to_json`/`json_to_table`) through an injected `deps` table.
- `probe-mod/` — dev-only, never shipped. One command, `/coop-probe <name>`,
  runs one probe and prints its JSON result over RCON. Poll a running probe
  until `state == "done"`; a finished probe clears itself, so the next call
  re-runs it.
- `tests/` — a uv project: lupa units for the pure modules, plus
  `tests/test_headless.py` which drives a real headless server over RCON.
- `scripts/headless.sh` — creates a fresh save with an isolated `--mod-directory`
  (symlinks to the mod folders) and starts the server with RCON on 127.0.0.1.
  The game config lives inside the given workdir; the owner's real game data
  (`~/Library/Application Support/factorio/`) is never touched.

## Run

```bash
FACTORIO_BIN="/path/to/factorio" bash scripts/headless.sh [--probe] <workdir>
# prints save=, port=, password=, pid=, then ready when RCON answers
```

Talk to the server over RCON with one command:

```
/coop-rpc {"v":1,"id":"<id>","op":"<op>","args":{...},"map_id":"<from status>"}
```

Exactly one JSON reply comes back per call:
`{"v":1,"id":...,"ok":true,"r":...}` or
`{"v":1,"id":...,"ok":false,"e":"<code>","m":...}`. The envelope `id` is a
string or explicit `null`. Factorio's JSON encoder cannot emit `null` or an
empty array, so consumers read two shapes accordingly:

- `{}` is an empty list for `events`, `power`, `research.queue`,
  `ingredients`, `products`, `machines`, `losses`, a `find` result, and an
  empty map for `inventories`, `fluids` and `science.*.packs`.
- An absent key is null for `host`, `recipe`, `status`, `research.current`
  and a `find` entry's `unit_number`.

Any call with a non-nil `player_index` (a player's console) is refused with
`e:"not_console"` and runs nothing. `status` needs no `map_id`; every other op
must carry the `map_id` from the last `status` or gets `e:"stale_session"`.
The write ops (`say`, `ping`) remember every reply of theirs that ran,
refusals and `op_error` included, for the last 256 ids of the map: the same
`id` with the same arguments replays the stored reply, and the same `id` with
different arguments gets `e:"id_conflict"`. Read ops re-run on a retry.
Replies over 65536 bytes are replaced with `e:"too_large"` and `r.bytes`.

## Ops

| op | args | result |
| --- | --- | --- |
| `status` | — | `{mod_version, map_id, seq, tick, host\|null}` |
| `events_since` | `seq`, `limit` (≤ 200, default 200) | `{map_id, head_seq, events}`; a seq behind the ring answers `e:"history_gap"`, `r:{oldest_seq}` |
| `snapshot` | `sections`? (power, science, research, evolution, pollution) | power per electric network, science per minute over 1 and 10 min, research and queue, evolution, pollution total |
| `find` | `area` (≤ 64×64) or `around:"player"`, `name`/`type`?, `limit`? (≤ 200, default 100) | `[{unit_number, name, type, position, gps, owner}]`; seen unit numbers are indexed for `inspect` |
| `inspect` | `unit_number` | status, recipe (crafting machines), `inventories` as `{<inventory name>: get_contents()}` with one entry per non-empty inventory, fluids; the entity resolves through the last 4096 units `find` and `inspect` returned |
| `recipe` | `name` | ingredients, products, energy, machines that can craft it |
| `say` | `text` (≤ 200 UTF-8 characters) | `{}`; prefixed with the body name from the `coop-agent-body-name` setting, at most 6 per 60 s else `e:"rate_limited"` |
| `ping` | `pos {x,y}`, `text` (≤ 60 UTF-8 characters) | `{tag_id}`; a chart tag that a sweep destroys after 10 min, plus a `[gps]` chat line |

Event kinds on the ring of 2000 (`{seq, tick, kind, data}`, monotonic seq per
map): `chat{player, text}` — admin console lines only, never commands —
`player_joined{player}`, `player_left{player}`, `player_died{player}`,
`research_finished{name}`, `rocket_launched{}`, `attack_started{cell, enemies,
defenders}`, `attack_ended{cell, duration_s, losses:[{name,count}]}` and
`snapshot_summary` every 3600 ticks. Attack grouping keys damage by surface
and 64-tile cell: a hit counts when a player-force entity takes damage from a
hostile force (the event's `force`, else the cause's force), and `losses`
counts player-force entities a hostile force killed. A cell closes 600 ticks
after its last damage.

All mutable state lives in `storage`; the unit index drops units with invalid
entities every 3600 ticks. `on_load` rebuilds nothing; handlers and
`on_nth_tick` are registered at the `control.lua` root. No `os`, no wall
clock, no unseeded random — the map id uses `game.create_random_generator`
seeded from the map seed plus the init tick, once at `on_init`.

## Safety

- The mod reads the map and speaks when told to. It builds nothing, destroys
  nothing and spawns no entities of its own.
- `/coop-rpc` refuses every call that did not come from the console (RCON or
  the server console); a player cannot run ops or forge replies.
- Replies are capped at 64 KiB, so no op can flood an RCON client.
- `probe-mod` builds throwaway entities (a character, ore, a chest ghost,
  spilled coal) and is for throwaway saves only — it ships nowhere.

## Tests

```bash
cd tests
uv sync
uv run pytest -q                              # lupa units; headless test skips
FACTORIO_BIN="/path/to/factorio" uv run pytest -q tests/test_headless.py
uv run ruff format --check . && uv run ruff check .
```

The lupa units pin the RPC framing, idempotency, the ring, attack grouping,
`say`/`ping` limits, the unit index and the chat filter. The headless suite
pins, on a seed-42 map: `status` → `events_since` → `say`, write-op replay and
`id_conflict`, `find` → `inspect` on a chest and an assembler, and a save
reload that answers the saved `head_seq` after a later event.

### Checked on the owner's GUI game

A headless server has no player, so chat is checked by hand: with the mod
loaded, the host (an admin) types `hello` in chat and `events_since` returns
`{"seq":<n>,"tick":<t>,"kind":"chat","data":{"player":"<host name>","text":"hello"}}`;
typing `/help` adds no event.
