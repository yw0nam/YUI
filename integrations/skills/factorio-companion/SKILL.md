---
name: factorio-companion
description: "Play Factorio with the owner as a companion body: read the game through the `factorio` Mod tools, queue walk, follow, mine, and deliver jobs, and speak in the owner's own game chat. Use this whenever the owner plays Factorio with the coop-agent game mod loaded, asks for a resource run, a follow, a stop, or a question about their factory, or asks to set up or debug the YUI Factorio companion."
license: PolyForm-Noncommercial-1.0.0
---

# factorio-companion

YUI drives one body inside the owner's Factorio game. The owner hosts the game and chats with you. This skill calls them the owner. The body walks, follows, mines, and delivers. The game mod and its tools call the owner the host.

The game mod runs a job. It never decides what to do next. You plan, queue jobs, and speak.

## 1. When to use

Use this skill when both conditions hold:

1. You are the backend of YUI.
2. The owner plays Factorio with the Mod `Mods/factorio` running.

The Mod speaks to the game over RCON and posts a `urgent` signal to YUI when a wake event arrives.

## 2. Setup for the owner

The agent reads these steps aloud or pastes them. The agent never edits `config.ini` or the owner's game data.

1. Copy the folder `Mods/factorio/game-mod/coop-agent` into Factorio's `mods` folder. On macOS that folder is `~/Library/Application Support/factorio/mods`.
2. Open Factorio's `config.ini`. Remove the `;` at the start of these two lines, and set a random password:

   ```ini
   local-rcon-socket=127.0.0.1:27015
   local-rcon-password=<random>
   ```

3. Save the file. Start Factorio and host the save from Multiplayer → Host. RCON applies when the owner launches a multiplayer server from the menu, as the `config.ini` comment states.
4. Switch on the game mod setting Body enabled in Factorio's mod settings. The change applies at once.
5. Switch on YUI Settings → Proactive → Watchers → External signals. Start YUI again. The setting applies at the next launch.
6. Start the Mod:

   ```bash
   cd Mods/factorio
   cp config.toml.example config.toml
   uv sync
   uv run factorio-mcp --transport http --host 127.0.0.1 --port 9003
   ```

7. Start the router:

   ```bash
   cd Mods/router && uv run mods-router --host 127.0.0.1 --port 8080
   ```

   Add `http://localhost:8080/factorio/mcp` as a tool source. The router already carries the `factorio` route to port 9003.
8. Install this skill where your backend reads skills, and give the platform that serves YUI the right to read skills. The backend's own integration notes under `integrations/` name the folder and the setting.

The Mod reads `local-rcon-socket` and `local-rcon-password` from `config.ini`. It never writes that file.

`config.toml` holds the signals URL and the wake kinds. `FACTORIO_CONFIG_TOML` points the Mod at another config file.

## 3. Reading the game

A wake posts one signal group. The envelope holds these values:

| Field | Value |
|---|---|
| `source` | `factorio` |
| `event_type` | `game.wake` |
| `delivery` | `urgent` |

The group carries `pending_from_seq`, `pending_to_seq`, `note`, and `reset`.

Read the events in this order:

1. Call `factorio_events` with `since_seq` equal to `pending_from_seq - 1`. The tool reads after `since_seq`, so this call includes the oldest unread event.
2. Read the page. When `more` is true, call `factorio_events` again with `since_seq` equal to `next_seq`.
3. Stop when `more` is false.

Read the page before you plan, even when `note` already shows the chat text. The note holds one line. The page holds the events around it.

`reset` means the map or the save changed. Forget the previous game state. Call `factorio_status` and `factorio_snapshot` again before you plan. Call `factorio_jobs` as well: the queue may be gone.

`note` holds the newest unread chat line as text, or the names of the unread wake kinds. It tells you why the doorbell rang.

### Event kinds

| Kind | `data` | Meaning | Wake |
|---|---|---|---|
| `chat` | `{player, text}` | The owner types a chat line. Only the host's chat lines arrive, never commands. | default |
| `player_joined` | `{player}` | A player joins the game. | opt-in |
| `player_left` | `{player}` | A player leaves the game. | opt-in |
| `player_died` | `{player}` | A player dies. | default |
| `research_finished` | `{name}` | A research finishes. | opt-in |
| `rocket_launched` | none | A rocket launches. | default |
| `attack_started` | `{cell, enemies, defenders}` | Enemies attack one map cell. | opt-in |
| `attack_ended` | `{cell, duration_s, losses}` | That attack ends. `losses` is a list of `{name, count}`. | opt-in |
| `snapshot_summary` | `{power, science, evolution, pollution}` | The game writes its periodic summary, once every 3600 ticks. | opt-in |
| `body_died` | none | The body dies. Its items stay in the corpse. | default |
| `body_respawned` | none | The body is back after death. | opt-in |
| `stopped` | none | The stop latch is on. | default |
| `body_threat` | `{distance}` | An enemy comes within the body's safe radius. `distance` is in whole tiles. | opt-in |
| `body_damaged` | `{health}` | An enemy damages the body. `health` is the health left. | opt-in |
| `job_done` | `{id, kind}` | One body job finishes. | opt-in |
| `job_failed` | `{id, kind, reason}` | One body job fails. The queue is now empty. | default |
| `queue_idle` | `{last_job_id}` | The last job finishes and no job is queued. | default |
| `idle_changed` | `{mode}` | The idle mode changes. | opt-in |

The default wake kinds are `chat`, `queue_idle`, `job_failed`, `stopped`, `body_died`, `player_died`, and `rocket_launched`. The other kinds wake only when `wake.kinds` in `Mods/factorio/config.toml` lists them: `job_done`, `research_finished`, `attack_started`, `attack_ended`, `body_respawned`, `idle_changed`, `player_joined`, `player_left`, `snapshot_summary`, `body_threat`, and `body_damaged`.

Every kind enters the cache. Read a cached kind with `factorio_events` on the next wake.

A `job_failed` with reason `no_item` also carries `item`, `count`, and `held`. A `deliver` failure with reason `target_full` also carries `removed` and `spilled`.

## 4. The game, in plain words

Factorio puts one engineer on an alien planet. The engineer mines resources and builds machines. The machines turn ore into parts, and the parts into more machines. Biters attack the factory and the engineer. The goal is to launch a rocket.

The early loop:

1. The owner mines coal, iron ore, copper ore, and stone by hand.
2. Stone furnaces smelt ore into plates. Coal is the fuel.
3. Iron plates and copper plates feed the assemblers.
4. Assemblers turn plates into gears, circuits, belts, inserters, and drills.
5. Drills and belts then replace hand mining.

Never state a recipe amount, a mining time, or a machine speed from memory. Read it with `factorio_recipe`, `factorio_inspect`, or `factorio_snapshot`.

### What the body can do

- Walk to a point or to an entity.
- Follow the owner.
- Stay in place.
- Mine resources, trees, and rocks.
- Mine an entity that the owner marked for deconstruction.
- Leave items on the ground for the owner.

### What the body cannot do

- Build.
- Craft.
- Fight.
- Mine a host-built entity that is not marked for deconstruction.
- Mine a resource that needs a fluid.
- Take items from the owner's chests without a mark.
- Touch the owner's inventory.
- Teleport.

## 5. Tools

| Tool | Use |
|---|---|
| `factorio_status()` | Read the game mod version, map id, newest event sequence, tick, host state, and body state. |
| `factorio_events(since_seq=None, limit=200)` | Read the cached events after `since_seq`, up to 200 per page. |
| `factorio_snapshot(sections=None)` | Read the factory state for power, science, research, evolution, and pollution. |
| `factorio_find(area=None, around=None, name=None, type=None, limit=50)` | Find entities by name, type, area, or near the owner. |
| `factorio_inspect(unit_number)` | Read one entity by its unit number. |
| `factorio_recipe(name)` | Read one recipe: ingredients, products, energy, and the machines that make it. |
| `factorio_say(text)` | Say one line in game chat under the body's name. |
| `factorio_ping(pos, text)` | Ping one map position with a text label. |
| `factorio_jobs()` | Read every job record the game mod holds, oldest first. |
| `factorio_jobs_enqueue(jobs: [{kind, args, timeout_ticks?}])` | Queue 1 to 8 jobs in the order given. Returns the assigned ids. |
| `factorio_jobs_cancel(id: int \| "all")` | Cancel one queued or running job by integer id, or every job with `all`. |
| `factorio_idle(mode, pos=None)` | Set the idle mode `follow` or `stay`. `stay` takes an optional position. |
| `factorio_stop()` | Stop the body's walking, mining, and crafting. |

A `bad_request` error carries the game mod's message naming the job index and the field: fix the arguments and call again. A refused call queues nothing. Keep at most 4 jobs queued.

### Job kinds

| Kind | Arguments | Ends `done` when | Default `timeout_ticks` |
|---|---|---|---|
| `walk_to` | `pos {x, y}`, or `entity` (a `unit_number` from `factorio_find` or `factorio_inspect`), and `radius` above 0 | The body is within `radius` of the position, or of the entity's position at the job's start. | 3600 |
| `wait` | `ticks` above 0 | `ticks` pass. | its `ticks` |
| `follow` | `ticks` above 0 | `ticks` pass, walking toward the owner. | its `ticks` |
| `mine` | `name` (an item), `count` (1 to 1000), and an optional `entity` | The body holds `count` more `name` than at the job's start. | set when the job starts: 3600 + `count` × the first target's mining ticks × 3, at most 36000 |
| `deliver` | `item`, `count` (1 to 1000) | The body leaves `count` of `item` spilled on the far side of the owner and steps back. | 3600 |

`mine.name` is the item the body gains. With `entity`, that entity is the first target. Without it, the body takes the nearest entity within 64 tiles of itself that yields `name`.

A `mine` target is a resource, a tree, a rock, or an entity that the owner marked for deconstruction. A host-built entity is never a target unless the owner marked it for deconstruction. A resource that needs a fluid is never a target.

`deliver` leaves the pile on the ground on the far side of the owner. The pile carries the `to_be_looted` flag. The body then steps back to 6 tiles from the owner. A `deliver` with fewer than `count` of `item` fails at its start with `no_item`.

A job that ends `done` fires `job_done`. When nothing is queued after it, `queue_idle` follows.

### Reason codes

| Code | Meaning |
|---|---|
| `no_path` | The 6th path request fails. |
| `stuck` | 600 ticks without movement on a route. |
| `target_gone` | The `walk_to` entity no longer exists; no `mine` target is within 64 tiles, the named `entity` no longer exists, or a second `mine` target disappears. |
| `no_item` | The body holds fewer than `count` of `item`, checked at the `deliver` start and again at the spill. |
| `not_permitted` | The named `mine` `entity` is not an allowed target that yields `name`. |
| `unreachable` | The named `mine` `entity` is more than 64 tiles from the body. |
| `unsupported` | The named `mine` `entity` needs a fluid to mine; also a job kind whose start sets no `timeout_ticks`. |
| `target_full` | `mine`: the body has no room for `name`. `deliver`: the spill falls short, with `{removed, spilled}` in the failure detail. |
| `timeout` | `timeout_ticks` elapses since the job's start. |
| `threat` | An enemy is within the safe radius of the `walk_to` or `mine` target at the job's start, or of a replacement `mine` target, or near the job's route. Also on the running job when the body check or enemy damage ends the queue, and on the queued jobs it cancels. |
| `stopped` | The stop latch is on or no host is connected; also on jobs cancelled before any starts. |
| `body_dead` | There is no live body; also on jobs cancelled before any starts. |
| `cancelled` | `factorio_jobs_cancel`, or an earlier job of the queue fails. |

### Queue rules

- Enqueue 1 to 8 jobs per call. Keep at most 4 queued.
- The queue holds at most 16 records. A call that would put more than 16 jobs in `queued` or `running` is refused.
- One job runs at a time. The next queued job starts on the tick after one ends.
- A job that ends `failed` fires one `job_failed` and cancels every queued job with `reason: "cancelled"`. A failure empties the queue, and `queue_idle` arrives only after a `done` with an empty queue.
- `factorio_jobs_cancel` fires no event.
- Queue only jobs the owner asked for.
- Read the queue with `factorio_jobs` before a new enqueue when an earlier job may still run.

### Idle, stop, and threats

- `factorio_idle(mode: "follow")` follows the owner. `factorio_idle(mode: "stay")` stands at the body's position, or walks once to the position given in `pos`.
- The follow keeps the body 10 to 15 tiles from the owner. Beyond a 64-tile leash the body stops and the status line reads `Waiting for <host>`.
- After three failed follow steps the body waits 600 ticks. The status line reads `Waiting for <host>`.
- While no `factorio_idle` call is in force, a change of the Idle start mode setting changes the idle mode at once. The change does not lift the stop latch.
- `factorio_stop()` stops the body at once and latches it stopped. The first stop fires `stopped`.
- A new job or `factorio_idle` lifts the stop latch.
- Idle never runs while the stop latch is on or a threat holds the body.
- Idle runs only while no job is queued or running. When `factorio_jobs` shows a queued or running job, call `factorio_jobs_cancel` with id `"all"` before `factorio_idle`.
- An enemy within the safe radius of the body empties the queue: the running job fails `threat`, and the queued jobs are cancelled with `threat`. No `queue_idle` follows. The first sighting fires `body_threat`.
- The body retreats toward the owner and ends within 5 tiles of them.
- `body_damaged` fires at most once per 300 ticks. Each one empties the queue the same way.
- `body_threat` and `body_damaged` are opt-in for the wake. Read both on the next wake before you queue again.
- While a threat holds the body, the queue starts no job and idle does nothing. Jobs queued meanwhile wait.
- Jobs and idle resume only after 600 quiet ticks from the end of the retreat. A new sighting before that ends the queue again.
- The Safe radius setting (`coop-agent-safe-radius`) is 48 tiles by default.

## 6. Planning templates

Read the owner's sentence. Pick one row. Build the job list from left to right.

The rows below answer a request in game chat. That answer goes to game chat and to the desktop. A request through another channel gets the desktop answer alone, with no `factorio_say` line.

| The owner says | Jobs or tools | Say, when, and where |
|---|---|---|
| "bring me 50 coal" | `factorio_jobs_enqueue` with `{kind: "mine", args: {name: "coal", count: 50}}`, then `{kind: "deliver", args: {item: "coal", count: 50}}` | On `queue_idle`: game chat and desktop. "The coal is on the ground beside you." |
| "get some wood" | `{kind: "mine", args: {name: "wood", count: 50}}`, then `{kind: "deliver", args: {item: "wood", count: 50}}` | On `queue_idle`: game chat and desktop. "The wood is on the ground beside you." |
| "follow me" | `factorio_jobs_cancel(id: "all")` when a job runs, then `factorio_idle(mode: "follow")` | At once: game chat and desktop. "Following." |
| "stay here" | `factorio_jobs_cancel(id: "all")` when a job runs, then `factorio_idle(mode: "stay")` | At once: game chat and desktop. "Staying here." |
| "come back" | `factorio_jobs_cancel(id: "all")` when a job runs, then `factorio_idle(mode: "follow")` | At once: game chat and desktop. "Coming back." |
| "wait here" | `factorio_jobs_cancel(id: "all")` when a job runs, then `factorio_idle(mode: "stay")` | At once: game chat and desktop. "Waiting here." |
| "stop" | `factorio_stop()` | At once: game chat and desktop. "Stopped." |
| "what is my power situation" | `factorio_snapshot(sections: ["power"])` | At once: game chat and desktop, with the numbers the tool returns. |
| "where is the nearest iron" | `factorio_find(around: "player", name: "iron-ore")`, then `factorio_ping` on the hit nearest the owner | At once: game chat and desktop. Give the distance from `status.host.position` to the hit. When the call returns no hit, say so. |
| "mine stone until I say stop" | `{kind: "mine", args: {name: "stone", count: 50}}`. On each `queue_idle`, enqueue the next batch. | At once: game chat and desktop. "Starting on stone." Then silence until the owner speaks. |
| "come here" | `factorio_status()`, then `factorio_find(around: "player", type: "character")`, then `factorio_ping(pos, text)` on the owner's position, then `{kind: "walk_to", args: {pos: status.host.position, radius: 2}}` | On `queue_idle`: game chat and desktop. "Here." |
| "how do I make a gear" | `factorio_recipe(name: "iron-gear-wheel")` | At once: game chat and desktop, from the recipe data. |

In a `mine` then `deliver` list, `deliver.item` is `mine.name` and `deliver.count` is `mine.count`.

### When a job fails

| Code | Next step |
|---|---|
| `no_path` | Re-plan once with another target. Then ask the owner to move closer. Ask in the channel of the request. |
| `stuck` | Re-plan once with a shorter walk. Then ask the owner. Ask in the channel of the request. |
| `target_gone` | Re-plan once with the next target `factorio_find` returns. |
| `no_item` | Read `held` from the failure detail. Deliver that count, or mine first. |
| `not_permitted` | Stop. Tell the owner what the body cannot take. |
| `unreachable` | Ask the owner to walk closer, or pick another target. Ask in the channel of the request. |
| `unsupported` | Tell the owner the body cannot do that. Stop the plan. |
| `target_full` | Tell the owner. Stop the plan. |
| `timeout` | Report the job. Ask the owner before you queue it again. Ask in the channel of the request. |
| `threat` | Stop. Do not queue a job that walks back into the threat. Tell the owner. |
| `stopped` | Stop. Say nothing. |
| `body_dead` | Report once. Queue no job until `factorio_status` shows the body alive. |
| `cancelled` | Read `factorio_jobs`. Stop unless the owner asks for more. |

## 7. Speaking rules

- A request in game chat gets one `factorio_say` line in game chat and the same answer on the desktop. The line speaks under the body's name.
- A request through another channel gets the desktop answer alone.
- Keep each `factorio_say` call at or below 200 characters, and send at most 6 calls each minute.
- Answer `[SILENT]` for a wake the owner did not ask about, unless the body dies, a job fails for a reason other than `stopped`, the owner's character dies, or a rocket launches.
- Never narrate every `job_done`. Silence on a finished job is the normal answer.
- Report a `job_failed` once. Say the reason in the owner's words: "I could not reach the coal", not `no_path`.
- Speak a number only when a tool returns it.
- Answer in the owner's language. Game item names stay in English.

## 8. Boundaries

- The body mines only resources, trees, rocks, and entities the owner marked for deconstruction.
- It never mines a host-built entity without a mark, and never a resource that needs a fluid.
- It never touches the owner's inventory and never teleports.
- The body never attacks. Near an enemy it retreats to the owner.
- The tools cannot edit game files or game settings.
- The MCP server binds `127.0.0.1:9003` and has no transport auth. Any local process that reaches the port can call the tools.
- No op raises permissions.
