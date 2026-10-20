# factorio

Bridges the Factorio game to the backend agent. It polls the [coop-agent game mod](game-mod/) over RCON, caches game events, and posts a `live` signal to the YUI client when a wake-kind event happens. Runs **host-native** — RCON is a loopback console on the machine running Factorio.

The backend agent's companion skill for this Mod is [`integrations/skills/factorio-companion/SKILL.md`](../../integrations/skills/factorio-companion/SKILL.md).

## Run

Factorio must run with RCON enabled in the game's own `config.ini`:

```ini
[other]
local-rcon-socket=127.0.0.1:27015
local-rcon-password=<a password you choose>
```

The Mod only reads those two keys. It never writes `config.ini`.

```bash
cd Mods/factorio
cp config.toml.example config.toml
uv sync
uv run factorio-mcp --transport http --host 127.0.0.1 --port 9003
```

`FACTORIO_CONFIG_TOML` points the Mod at another config file. Without it, the Mod reads `Mods/factorio/config.toml`; when that file is absent, it uses the defaults below and the standard macOS `config.ini` path.

## Config

| Key | Default | Meaning |
|---|---|---|
| `config_ini` | `~/Library/Application Support/factorio/config/config.ini` | Factorio's own config file. RCON host, port, and password come from it. |
| `signals_url` | `http://127.0.0.1:8770/signals` | The YUI client's loopback signals ingress. |
| `wake.kinds` | `chat`, `queue_idle`, `job_failed`, `stopped`, `body_died`, `player_died`, `rocket_launched` | Event kinds that ring the doorbell. Every other kind only enters the cache. Add an opt-in kind to wake on it: `job_done`, `research_finished`, `attack_started`, `attack_ended`, `body_damaged`, `body_threat`, `body_respawned`, `idle_changed`, `player_joined`, `player_left`, `snapshot_summary`. |
| `wake.coalesce_ms` | `2000` | Quiet period after the first wake event before one doorbell is posted. |
| `outcome_log` | `outcome.jsonl` beside `config.toml` | JSONL log. Each line's `type` is `event`, `tool`, `doorbell`, `history_gap`, `session_reset`, or `backend_lag`. |

The Mod polls `events_since` every second. The cache holds the newest 5000 events. A rollback, a history gap, and a map change each recover the cursors; the next doorbell carries `reset: true`. See [the Mods reference](../../docs/reference/mods.md#factorio) for the full behaviour.

## Safety boundary (operator responsibility)

- **RCON credentials come from the game's own `config.ini`.** The Mod reads `local-rcon-socket` and `local-rcon-password` and never edits the file.
- **Loopback only.** RCON stays on `127.0.0.1`, and the MCP server binds `127.0.0.1:9003`. There is no transport auth: any local process that reaches the port can call the tools.
- **The game is the authority.** The Mod reports what the game mod says and sends the agent's `say` and `ping` calls. It holds no game logic.
- **The tools can speak in game chat and place map pings.** They cannot touch the filesystem, launch processes, or change game settings.

Reach the Mod from the remote agent through the [router](../router/) (`http://localhost:8080/factorio/mcp`) or an SSH reverse tunnel to port `9003`.

## Tools

| Tool | Description |
|---|---|
| `factorio_status()` | Game mod version, map id, newest event sequence, tick, and host state |
| `factorio_events(since_seq=None, limit=200)` | Cached events after `since_seq` (exclusive). Defaults to the unread cursor; a value above it is clamped down, a value below it re-reads. Returns `{events, next_seq, more}` |
| `factorio_snapshot(sections=None)` | State snapshot of the factory; omit `sections` for every section |
| `factorio_find(area=None, around=None, name=None, type=None, limit=50)` | Find entities by name, type, area, or near the host player |
| `factorio_inspect(unit_number)` | Read one entity by its unit number |
| `factorio_recipe(name)` | Read one recipe by name |
| `factorio_say(text)` | Say one line in game chat under the body's name |
| `factorio_ping(pos, text)` | Ping a map position with a text label |
| `factorio_jobs()` | Every job record the game mod holds, oldest first |
| `factorio_jobs_enqueue(jobs)` | Queue 1 to 8 jobs; returns the assigned ids |
| `factorio_jobs_cancel(id)` | Cancel one job by id, or every job with `all` |
| `factorio_idle(mode, pos=None)` | Set the idle mode `follow` or `stay`; `stay` takes an optional position |
| `factorio_stop()` | Stop the body's walking, mining, and crafting |

A game-mod refusal raises a tool error carrying the game's error code and message, such as `too_large`, `rate_limited`, or `history_gap`. An `id_conflict` reply raises a tool error and is never re-sent under a new id.

## Test

```bash
cd Mods/factorio && uv run pytest
```

The tests run against a fake loopback RCON server and a fake signals endpoint. No Factorio install is needed.
