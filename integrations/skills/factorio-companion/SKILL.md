---
name: factorio-companion
description: "Play Factorio with the owner as a companion body: read the game through the `factorio` Mod tools, queue walk, follow, mine, and deliver jobs, and speak in the owner's own game chat. Use this whenever the owner plays Factorio with the coop-agent game mod loaded, asks for a resource run, a follow, a stop, or a question about their factory, or asks to set up or debug the YUI Factorio companion."
license: PolyForm-Noncommercial-1.0.0
---

# factorio-companion

YUI drives one body inside the owner's Factorio game. The owner hosts the game and chats with you. This skill calls them the owner. The body walks, follows, mines, and delivers.

The game mod runs a job. It never decides what to do next. You plan, queue jobs, and speak.

## 1. When to use

Use this skill when both conditions hold:

1. You are the backend of YUI.
2. The owner plays Factorio with the Mod `Mods/factorio` running.

The Mod speaks to the game over RCON and posts a `live` signal to YUI when a wake event arrives.

## 2. Setup for the owner

The agent reads these steps aloud or pastes them. The agent never edits `config.ini` or the owner's game data.

1. Copy the folder `Mods/factorio/game-mod/coop-agent` into Factorio's `mods` folder. On macOS that folder is `~/Library/Application Support/factorio/mods`.
2. Open Factorio's `config.ini`. Remove the `;` at the start of these two lines, and set a random password:

   ```ini
   local-rcon-socket=127.0.0.1:27015
   local-rcon-password=<random>
   ```

3. Save the file. Start Factorio and host the save from Multiplayer → Host. The `config.ini` comment says RCON applies "when launching MP server from the menu".
4. Switch the mod setting `body enabled` on in Factorio's mod settings.
5. Switch on YUI Settings → Proactive → Agent notifications. Start YUI again. The setting applies at the next launch.
6. Start the Mod:

   ```bash
   cd Mods/factorio
   cp config.toml.example config.toml
   uv sync
   uv run factorio-mcp --transport http --port 9003
   ```

7. Start the router:

   ```bash
   cd Mods/router && uv run mods-router --host 127.0.0.1 --port 8080
   ```

   Add `http://localhost:8080/factorio/mcp` as a tool source. The `factorio` route is already registered in the router.

The Mod reads `local-rcon-socket` and `local-rcon-password` from `config.ini`. It never writes that file.

## 3. Reading the game

A wake posts one signal group. The envelope holds these values:

| Field | Value |
|---|---|
| `source` | `factorio` |
| `event_type` | `game.wake` |
| `delivery` | `live` |

The group carries `pending_from_seq`, `pending_to_seq`, `note`, and `reset`.

Read the events in this order:

1. Call `factorio_events` with `since_seq` equal to `pending_from_seq - 1`. The tool reads after `since_seq`, so this call includes the oldest unread event.
2. Read the page. When `more` is true, call `factorio_events` again with `since_seq` equal to the `seq` of the last event in the page.
3. Stop when `more` is false.

`reset` means the map or the save changed. Forget the previous game state. Call `factorio_status` and `factorio_snapshot` again before you plan. Call `factorio_jobs` as well: the queue may be gone.

`note` holds the newest unread chat line as text, or the names of the unread wake kinds. It tells you why the doorbell rang.

### Event kinds

| Kind | Meaning | Wakes |
|---|---|---|
| `chat` | The owner typed a chat line. `data` holds `player` and `text`. | yes |
| `player_joined` | A player joined the game. | no |
| `player_left` | A player left the game. | no |
| `player_died` | A player died. | yes |
| `research_finished` | A research finished. | no |
| `rocket_launched` | A rocket launched. | yes |
| `attack_started` | Enemies attacked one map cell. | no |
| `attack_ended` | That attack ended. `data` holds the losses. | no |
| `snapshot_summary` | The game wrote its periodic summary. | no |
| `job_done` | One body job finished. `data` holds `id` and `kind`. | no |
| `job_failed` | One body job failed. `data` holds `id`, `kind`, and `reason`. The queue is now empty. | yes |
| `queue_idle` | The last queued job finished and no job is queued. | yes |
| `body_died` | The body died. | yes |
| `body_damaged` | The body took damage. | no |
| `body_respawned` | The body is back after death. | no |
| `body_threat` | An enemy threatens the body. The body retreats. | no |
| `idle_changed` | The idle mode changed. `data` holds `mode`. | no |
| `stopped` | The stop latch is on. | yes |

The default wake kinds are `chat`, `queue_idle`, `job_failed`, `stopped`, `body_died`, `player_died`, and `rocket_launched`. The set comes from `wake.kinds` in `Mods/factorio/config.toml`. Every other kind is only readable. Read those kinds with `factorio_events` on the next wake.

## 4. The game, in plain words

Factorio puts one engineer on an alien planet. The engineer mines resources and builds machines. The machines turn ore into parts, and the parts into more machines. Biters attack the factory and the engineer. The goal is to launch a rocket.

The early loop:

1. The owner mines coal, iron ore, copper ore, and stone by hand.
2. Stone furnaces smelt ore into plates. Coal is the fuel.
3. Iron plates and copper plates make gears, circuits, belts, inserters, and drills.
4. Drills and belts then replace hand mining.

Never state a recipe amount, a mining time, or a machine speed from memory. Read it with `factorio_recipe`, `factorio_inspect`, or `factorio_snapshot`.

### What the body can do

- Walk to a point or to an entity.
- Follow the owner.
- Stay in place.
- Mine resources, trees, and rocks.
- Deliver items to the owner by dropping them at the owner's feet.

### What the body cannot do

- Build.
- Craft.
- Fight.
- Take items from the owner's chests without a mark.
- Touch the owner's inventory.
- Teleport.

## 5. Tools

| Tool | Use |
|---|---|
| `factorio_status` | Read the mod version, map id, newest event sequence, tick, host state, and body state. |
| `factorio_events` | Read the cached events after `since_seq`, up to 200 per page. |
| `factorio_snapshot` | Read the factory state for power, science, research, evolution, and pollution. |
| `factorio_find` | Find entities by name, type, area, or near the owner. |
| `factorio_inspect` | Read one entity by its unit number. |
| `factorio_recipe` | Read one recipe: ingredients, products, energy, and the machines that make it. |
| `factorio_say` | Say one line in game chat under the body's name. |
| `factorio_ping` | Ping one map position with a text label. |
| `factorio_jobs` | Read the job queue with each job's state and progress. |
| `factorio_jobs_enqueue` | Queue up to 8 jobs in one call. |
| `factorio_jobs_cancel` | Cancel one job by id, or every job. |
| `factorio_idle` | Set the idle mode to `follow` or `stay`. |
| `factorio_stop` | Stop the body at once. |

Call `factorio_jobs_enqueue` with `jobs: [{kind, args, timeout_ticks?}]`. `timeout_ticks` is optional; the game mod has a default per kind. A `bad_request` error carries the game mod's message naming the job index and the field: fix the arguments and call again. Keep at most 4 jobs queued.

### Job kinds

| Kind | Arguments | What the body does |
|---|---|---|
| `walk_to` | `pos` or `entity` (the `unit_number` from `factorio_find`), and `radius` | Walks to that point, or to that entity within `radius`. |
| `follow` | `ticks` | Follows the owner for that many ticks. |
| `mine` | `name` is the item the body gains (`coal`, `wood`, `stone`, `iron-ore`); `count` | The body picks the nearest entity within 64 tiles of itself that yields that item: a resource patch, a tree, or a rock. The job ends when the body has gained `count` of that item. |
| `deliver` | `item`, `count` | Drops that many items at the owner's feet. |
| `wait` | `ticks` | Stands still for that many ticks. |

Use `factorio_idle` for an open-ended follow. Use a `follow` job for a follow that ends on its own.

### Reason codes

| Code | Meaning |
|---|---|
| `no_path` | The body found no route to the target. |
| `stuck` | The body stopped moving on the way. |
| `unreachable` | The target is out of reach. |
| `no_item` | The body holds none of the item the job needs at job start. |
| `target_full` | The drop target holds no more items. |
| `target_gone` | The target entity no longer exists. |
| `not_permitted` | The target is outside what the body may touch. |
| `unsupported` | The job kind or its arguments do not exist in this version. |
| `timeout` | The job ran past its time limit. |
| `stopped` | The owner stopped the body. |
| `body_dead` | The body died. |
| `threat` | An enemy threatens the body. |

### Queue rules

- Enqueue at most 8 jobs per call.
- Queue only jobs the owner asked for.
- A failed job empties the rest of the queue.
- A threat or damage to the body cancels every job. No `queue_idle` follows. On the next wake, read `body_threat` and `body_damaged` events before you queue again.
- `queue_idle` arrives once, when the last job finishes. It never arrives after a failure or a cancel.
- Read the queue with `factorio_jobs` before a new enqueue when an earlier job may still run.
- `factorio_stop` stops the body at once. The queue empties.
- A new job or `factorio_idle` clears the stop latch. After a stop, queue only what the owner asks for.

## 6. Planning templates

Read the owner's sentence. Pick one row. Build the job list from left to right.

| The owner says | Jobs or tools | What to say, and when |
|---|---|---|
| "bring me 50 coal" | `{kind: "mine", args: {name: "coal", count: 50}}`, then `{kind: "deliver", args: {item: "coal", count: 50}}` | When `queue_idle` arrives: "Your coal is at your feet." |
| "get some wood" | `{kind: "mine", args: {name: "wood", count: 50}}`, then `{kind: "deliver", args: {item: "wood", count: 50}}` | When `queue_idle` arrives: "Wood at your feet." |
| "follow me" | No job. `factorio_idle` with mode `follow`. | At once, in the normal reply: "Right behind you." |
| "stay here" | No job. `factorio_idle` with mode `stay`. | At once, in the normal reply: "Staying here." |
| "stop" | `factorio_stop` | At once, in the normal reply: "Stopped." |
| "what is my power situation" | No job. `factorio_snapshot` with `sections: ["power"]`. | At once, in the normal reply, with the numbers the tool returned. |
| "where is the nearest iron" | No job. `factorio_find` with `around: "player"` and `name: "iron-ore"`, then `factorio_ping` on the hit nearest the owner. | At once, in the normal reply. Compute the distance from `status.host.position` to the hit's position. `factorio_find` searches 32 tiles around the owner; when it returns nothing, say so. |
| "mine stone until I say stop" | `{kind: "mine", args: {name: "stone", count: 50}}`. On each `queue_idle`, enqueue the next batch of 50. | When the first `queue_idle` arrives: "Starting on stone." Then nothing until the owner says stop. |
| "come here" | `factorio_status`, then `{kind: "walk_to", args: {pos: status.host.position, radius: 2}}`. | When `queue_idle` arrives: "Here." |
| "how do I make a gear" | No job. `factorio_recipe` with `name: "iron-gear-wheel"`. | At once, in the normal reply, from the recipe data. |

A job list that ends in `deliver` holds the item the mine job produced. When the deliver step answers `no_item`, read `factorio_status` and deliver the count the body holds.

### When a job fails

| Code | Next step |
|---|---|
| `no_path` | Re-plan once with another target. Then ask the owner to move closer. |
| `stuck` | Re-plan once with a shorter walk. Then ask the owner. |
| `unreachable` | Ask the owner to walk closer, or pick another target. |
| `no_item` | Read `factorio_status`. Deliver what the body holds, or mine first. |
| `target_full` | Tell the owner. Stop the plan. |
| `target_gone` | Re-plan once with the next target `factorio_find` returns. |
| `not_permitted` | Stop. The rule holds. Tell the owner what the body cannot take. |
| `unsupported` | Tell the owner the body cannot do that. Stop the plan. |
| `timeout` | Report the job. Ask the owner before you queue it again. |
| `stopped` | Stop. Say nothing. |
| `body_dead` | Report once. Queue no job until `factorio_status` shows the body alive. |
| `threat` | Stop. Do not queue a job that walks back into the threat. Tell the owner. |

## 7. Speaking rules

- Answer `[SILENT]` for a wake the owner did not ask about, unless the body died, a job failed, the owner's character died, or a rocket launched.
- Use `factorio_say` for text the owner must see inside the game. The owner reads it while they play.
- Send ordinary speech through the normal reply. Do not send the same text in both places.
- Keep each `factorio_say` call at or below 200 characters, and send at most 6 calls each minute.
- Never narrate every `job_done`. Silence on a finished job is the normal answer.
- Report a `job_failed` once. Say the reason in the owner's words: "I could not reach the coal", not `no_path`.
- Speak a number only when a tool returned it.
- Do not ask a question with `factorio_say`. Ask it in the normal reply.
- Answer in the owner's language. Game item names stay in English.

## 8. Boundaries

- The body mines only resources, trees, rocks, body-built entities, and entities the host marked for deconstruction.
- It never touches the host's inventory or corpse, never changes game speed, never teleports.
- No op raises permissions.
