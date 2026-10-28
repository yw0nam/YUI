# factorio

Bridges the Factorio game to the backend agent. It polls the [coop-agent game mod](game-mod/) over RCON, caches game events, and posts an `urgent` signal to the YUI client when a wake-kind event happens. Runs **host-native** — RCON is a loopback console on the machine running Factorio.

The backend agent's companion skill for this MCP server is [`skills/factorio-companion/SKILL.md`](skills/factorio-companion/SKILL.md).

## Run

Factorio must run with RCON enabled in the game's own `config.ini`:

```ini
[other]
local-rcon-socket=127.0.0.1:27015
local-rcon-password=<a password you choose>
```

The MCP server only reads those two keys. It never writes `config.ini`.

```bash
cd plugins/factorio
cp config.toml.example config.toml
uv sync
uv run factorio-mcp --transport http --host 127.0.0.1 --port 9003
```

`FACTORIO_CONFIG_TOML` points the MCP server at another config file. Without it, the MCP server reads `plugins/factorio/config.toml`; when that file is absent, it uses the defaults below and the standard macOS `config.ini` path.

The plugin's [`.mcp.json`](.mcp.json) points the backend agent at `http://127.0.0.1:9003/mcp`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `config_ini` | `~/Library/Application Support/factorio/config/config.ini` | Factorio's own config file. RCON host, port, and password come from it. |
| `signals_url` | `http://127.0.0.1:8770/signals` | The YUI client's loopback signals ingress. |
| `wake.kinds` | `chat`, `queue_idle`, `job_failed`, `stopped`, `body_died`, `player_died`, `rocket_launched` | Event kinds that ring the doorbell. Every other kind only enters the cache. Add an opt-in kind to wake on it: `job_done`, `research_finished`, `attack_started`, `attack_ended`, `body_respawned`, `idle_changed`, `player_joined`, `player_left`, `snapshot_summary`, `body_threat` (an enemy came within the body's safe radius), `body_damaged` (an enemy damaged the body). |
| `wake.coalesce_ms` | `2000` | Quiet period after the first wake event before one doorbell is posted. |
| `outcome_log` | `outcome.jsonl` beside `config.toml` | JSONL log. Each line's `type` is `event`, `tool`, `doorbell`, `history_gap`, `session_reset`, or `backend_lag`. |

The MCP server polls `events_since` every second. The cache holds the newest 5000 events. A rollback, a history gap, and a map change each recover the cursors; the next doorbell carries `reset: true`.

## Safety boundary (operator responsibility)

- **RCON credentials come from the game's own `config.ini`.** The MCP server reads `local-rcon-socket` and `local-rcon-password` and never edits the file.
- **Loopback only.** RCON stays on `127.0.0.1`, and the MCP server binds `127.0.0.1:9003`. There is no transport auth: any local process that reaches the port can call the tools.
- **The game is the authority.** The MCP server reports what the game mod says and sends the agent's `say` and `ping` calls. It holds no game logic.
- **The tools can speak in game chat and place map pings.** They cannot touch the filesystem, launch processes, or change game settings.

Reach the MCP server from the remote agent through an SSH reverse tunnel to port `9003`.

## Tools

The MCP server talks to the coop-agent game mod, which answers `/coop-rpc <json>` over RCON.

| Tool | Description |
|---|---|
| `factorio_status()` | Game mod version, map id, newest event sequence, tick, and host state |
| `factorio_events(since_seq=None, limit=200)` | Cached events after `since_seq` (exclusive). `None` starts at the unread cursor; a value above it is clamped down, a value below it re-reads. Returns `{events, next_seq, more}` with a contiguous page of at most 200 |
| `factorio_snapshot(sections=None)` | State snapshot of the factory; omit `sections` for every section |
| `factorio_find(area=None, around=None, name=None, type=None, limit=50)` | Find entities by name, type, area, or near the host player |
| `factorio_inspect(unit_number)` | Read one entity by its unit number |
| `factorio_recipe(name)` | Read one recipe by name |
| `factorio_say(text)` | Say one line in game chat under the body's name |
| `factorio_ping(pos, text)` | Ping a map position with a text label |
| `factorio_jobs()` | Every job record the game mod holds, oldest first |
| `factorio_jobs_enqueue(jobs)` | Queue 1 to 8 jobs in the order given; each job is `{kind, args, timeout_ticks?}`. Returns the assigned `ids`. The game mod validates the kind and the args and answers `bad_request` with the field at fault |
| `factorio_jobs_cancel(id: int \| "all")` | Cancel one queued or running job by integer id, or every job with `all`. A cancel fires no event |
| `factorio_idle(mode, pos=None)` | Set the idle mode `follow` or `stay`; `stay` takes an optional `pos` and otherwise stands at the body's position. Lifts the stop latch |
| `factorio_stop()` | Stop the body's walking, mining, and crafting and latch it stopped. A job enqueue or `factorio_idle` lifts the latch |

A game-mod refusal raises a tool error carrying the game's error code and message, such as `too_large`, `rate_limited`, or `history_gap`. An `id_conflict` reply raises a tool error and is never re-sent under a new id.

## Behaviour

The MCP server polls `events_since{seq, limit: 200}` every second, looping until a page comes back short. Every event enters a 5000-event cache and the JSONL outcome log at `outcome_log`. An event whose kind is in `wake.kinds` rings the doorbell: after `wake.coalesce_ms`, the MCP server posts one group to `signals_url` with `delivery: "urgent"`, `source: "factorio"`, and `event_type: "game.wake"`. The group carries `pending_from_seq` (the oldest event the agent has not read), `pending_to_seq` (the newest cached event), and `reset`; its `note` is the newest unread chat line verbatim, otherwise the unread wake kinds. One post is in flight at a time. A non-2xx response backs off from 5 s to 300 s and retries the same range; unread wake events post once more 300 s after the last 2xx, once per unread range. When the agent has read every wake event by the time a post is due, nothing is posted.

A `history_gap` reply rewinds the poll cursor to `oldest_seq - 1`. A rollback on the same map (`head_seq` below the poll cursor) rewinds both cursors and drops cached events above `head_seq`. A different map id, or `stale_session` from any op, makes the MCP server call `status`, adopt the new map, move both cursors to `status.seq`, and clear the cache. The last two set `reset: true` on the next doorbell. Otherwise both cursors only move forward. When the poll and a tool meet the same map change, the first recovery adopts the map and the later one leaves the cursors and the cache as they are. A rollback and a map change each write `queue_length` from `status.queue.length` in their `session_reset` outcome line; `queue_length` is `null` when the status carries no queue.

The default wake kinds are `chat`, `queue_idle`, `job_failed`, `stopped`, `body_died`, `player_died`, and `rocket_launched`. These opt-in kinds stay cached and do not wake unless `config.toml` lists them: `job_done`, `research_finished`, `attack_started`, `attack_ended`, `body_respawned`, `idle_changed`, `player_joined`, `player_left`, `snapshot_summary`, `body_threat` (an enemy came within the body's safe radius), `body_damaged` (an enemy damaged the body).

A call whose reply is lost is re-sent with the same id once `status` confirms the map; the game mod replays a stored write reply. An `id_conflict` reply means the id already ran a write with different arguments: the call ends with a tool error and is never re-sent under a new id.

## Test

```bash
cd plugins/factorio && uv run pytest
```

The tests run against a fake loopback RCON server and a fake signals endpoint. No Factorio install is needed. The game mod's own tests live in [`game-mod/tests`](game-mod/tests/) and track their own `pyproject.toml`, so the `python` CI job runs them too.
