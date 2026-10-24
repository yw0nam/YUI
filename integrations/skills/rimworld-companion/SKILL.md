---
name: rimworld-companion
description: "React to a RimWorld colony as a companion beside the player: read the game's events, tier each one (raid, disease, mental break, death, letter, message) to decide whether to lead with it, mention it, or leave it out, and kibitz by comparing the colony against a stage-by-stage play guide (wealth and raid points, killbox, food, power, mood). Use whenever the user is playing RimWorld, talks about their colony, asks how to play it, or the screen shows the game."
license: PolyForm-Noncommercial-1.0.0
---

# rimworld-companion

The player runs a RimWorld colony while you watch beside them. Every game event gets a
**tier** that says how you treat it, and when you speak you may **kibitz**: one piece of
advice, measured against the stage guide. The reference data covers RimWorld 1.6 with
Royalty, Ideology and Biotech; a def from another DLC or a mod is not in the tables, so
judge it from its letter text.

## Inputs

The skill reads the game on your turns; nothing pushes game events into a turn.

- **Game events** need the game mod [RimEventFeed](https://github.com/yw0nam/RimEventFeed)
  and a backend agent that reads files on the game machine. The mod writes every event as
  a `[RimEventFeed] {json}` line to `Player.log` (macOS
  `~/Library/Logs/Ludeon Studios/RimWorld by Ludeon Studios/Player.log`, Windows
  `%USERPROFILE%\AppData\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Player.log`).
  Each event is `{ "kind", "ticksGame", "sentAtUnixMs", "fields" }`, with kind `letter`,
  `incident`, `mentalBreak`, `mentalState`, `death`, `message` or `command`. Read the
  events whose `sentAtUnixMs` is newer than the last ones you reacted to. Def names
  (`incidentDef`, `letterDef`, `mentalStateDef`, ...) are the same in every game language;
  `label` and `text` are in the player's game language.
- **Pawn fields.** `pawn.isColonist` is true for a free colonist only. A pawn belongs to
  the player when its `faction.loadId` equals a colonist's; the player faction def is
  `PlayerColony` or, in a tribal start, `PlayerTribe`. `pawn.def` is `Human` for people and
  the race def for an animal. A slave is the player's but not a colonist. No field marks a
  prisoner or a bonded animal.
- **Colony state.** On the game machine, the mod's command channel answers `GET colonists`
  (drafted, downed, mental state per free colonist); its README has the token and port.
  The client's `look` tool with `at: screen` returns a screenshot when the player has
  screen capture on and the model reads images; otherwise it answers
  `error: screen capture is off` or `error: unknown tool`. The main screen shows the alerts
  in the bottom-right corner, stockpiles and the defense layout; wealth is in the History
  tab. The player's own words count as state too.

## Steps

1. **Group.** One game event usually arrives as several kinds on the same `ticksGame`: a
   raid is `letter` + `incident`, most mental breaks are `letter` + `mentalState` +
   `mentalBreak`, a colonist's death is `death` + a `Death` letter. Merge the events that
   share a tick and a subject into one group; a non-player pawn's `mentalState` on the tick
   of an incident joins the incident's group. Done when each group names one thing that
   happened.
2. **Tier.** Look up each group in [references/events.md](references/events.md) and apply
   the context rules under the matching table. The group takes the highest tier of its
   members, except where a rule there says one member decides. Done when every group has
   exactly one tier.
3. **Act on the tier.**

   | tier | treatment |
   |---|---|
   | `critical` | Lead the reply with it. The first sentence names the threat and the one action that matters (draft, get indoors, rescue, pause). |
   | `high` | Say it this turn, one point. |
   | `medium` | One clause, when nothing critical or high is in the turn. Otherwise leave it out. |
   | `low` | Leave it out unless the player asks. |
   | `noise` | Leave it out. |

   Leaving an event out means saying nothing about it. When the turn has nothing else to
   answer, the reply is empty or the bare `[SILENT]` token. When the player has allowed you
   to control the game, a `critical` group may also get `POST pause` on the command
   channel; otherwise suggest pausing. Done when every `critical` and `high` group is in
   the reply and no `low` or `noise` group is.
4. **Kibitz.** On a turn that speaks, or when the player asks how the colony is doing,
   place the colony in a stage with [references/stages.md](references/stages.md). Then
   check that stage's checklist and the threat signs in
   [references/threat.md](references/threat.md) against the state you actually hold. Add
   at most one point of advice: the most severe unmet check, with its reason. Done when the
   advice names a check whose failure you can see in the state; a check you cannot see
   becomes a question to the player.

## Voice

- Name colonists by their `label`, and say what happened in the player's language. Def
  names are for lookup.
- A number marked *rule of thumb* in the references is community advice, so present it as
  advice.
- A raid's letter text states its strategy (sappers, siege, breach, drop pods). Read the
  strategy from the text and say whether the player's killbox covers it
  (references/events.md § Raids).
