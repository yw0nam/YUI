# Threat and defense

How the storyteller sizes threats, and what a defense has to hold at each stage. Each
section ends with **signs**: states you can check, and the point to make when one is true.

## Raid points

```
raid points = (wealth points + pawn points) × threat scale × starting factor × adaptation factor
```

The result is clamped to 35–10,000. Randy then multiplies each event by a random 0.5–1.5.

- **Storyteller wealth** = items + creatures + 0.5 × buildings. Stockpiled silver, gold,
  art, gear and food count in full. Walls, floors, furniture and turrets count at half.
- **Wealth points** (wiki curve; the game computes it in code): 0 up to 14,000 wealth,
  2,400 at 400,000, 3,600 at 700,000, 4,200 at 1,000,000 and above; linear in between.
- **Pawn points** per colonist: 15 up to 10,000 wealth, rising to 140 at 400,000 and 200 at
  1,000,000. A slave counts 0.75, a child up to 0.5, a baby 0. A tame combat animal adds 8 %
  of its combat power.
- **Threat scale** by difficulty: Peaceful 0.1, Community builder 0.3, Adventure story 0.6,
  Strive to survive 1.0, Blood and dust 1.55, Losing is fun 2.2.
- **Starting factor**: 0.7 up to day 10, rising to 1.0 at day 40.
- **Adaptation factor**: 0.8 at the start, 1.0 after about 30 days of colony survival,
  up to about 1.47. Each colonist death drops it (about 30 adaptation days with up to 11
  colonists), so the storyteller eases off after losses.
- **Strategy unlocks**: sieges are possible from 500 points, sappers and breachers from
  700. A colony below 500 points only sees walk-ins and drop pods.

Estimate, for 10 healthy colonists on Strive to survive after day 40: about 1,000 points at
100,000 wealth and about 1,900 at 200,000.

Signs:
- Wealth is growing while armed fighters, armor or turrets are not → the next raids
  outgrow the defense; point at the weakest of the three.
- Raid `points` in an incident are above what the last raid brought → the defense that
  held last time may not hold now.

## Wealth

Because raids follow wealth, idle wealth buys danger and nothing else. The wiki holds that
wealth management only matters on hard difficulties, so raise it only when raids are
outgrowing the defense.

Signs:
- A large stock of silver, gold, art or spare gear that nobody uses → sell it to a trader
  or turn it into defense; it counts in full.
- Expensive floors and furniture in rooms nobody uses → they count at half and add nothing.

## Storytellers

| | big threats | between them |
|---|---|---|
| Cassandra Classic | First around day 11; 1–2 per 4.6-day window, then 6 days off | Every big threat before day 20 is a raid |
| Phoebe Chillax | First around day 13; 1 per 8-day window, then 8 days off | Every big threat before day 20 is a raid |
| Randy Random | Any time; at most 13 days apart | Point sizes vary 0.5–1.5× |

Signs:
- Cassandra or Phoebe, a big threat just ended → the off window is the time to build.
- Randy → keep the defense ready at all times; there is no quiet window.

## Defense by stage

**No killbox yet (early).** Fight at one narrow entrance, from cover, with every colonist
behind sandbags or walls and the enemy in the open. Fall back behind a door when
outnumbered. Melee raiders are met by the best brawler in a one-tile doorway.

**Killbox (from the first year).** A killbox is the funnel in front of the base where
raiders arrive without cover and defenders shoot from cover.
- One entrance, one tile wide, that turns once so raiders cannot shoot down it.
- Fences every second tile with spike traps in the gaps slow the raiders inside the box.
- Double walls at the receiving end, so the defenders' own fire does not open them.
- Turrets on their own power grid, set to hold fire until raiders are in the box.
- Short boxes favor shotguns; long boxes favor accurate mid-range rifles.
- Build the first chokepoint before day 11, when Cassandra can send the first big threat (day 13 on Phoebe).

**What goes around a killbox** and the counter:

| threat | counter |
|---|---|
| Sappers | They dig toward the colony; meet them at the wall they cut |
| Breachers | They blast their own path; kill the breachers at range before the wall |
| Siege | Mortars out of range; snipe the builders, return fire with your own mortars, or attack before they dig in |
| Drop pods on the colony | Draft at once; fight indoors at the landing spot |
| Infestation | Spawns under overhead mountain within 30 tiles of a structure, above −17 °C. Kill every hive. Cold rooms below −8 °C and no dark mountain rooms lower the chance |
| Mech cluster | Dormant until disturbed; never build within 2 tiles. Wake it on your terms with EMP, smoke and mortars. Its buildings are fireproof |
| Psychic ship part | Drone worsens from −12 to −40 mood over 7.5 days; destroy it early |
| Manhunter pack | Everyone indoors; shoot from behind doors; never chase it into the open |
| Mechanoid raid | EMP stuns mechs and their shields; centipedes with inferno cannons or rockets break a killbox |

**Turrets.** The mini-turret (`GunTurrets`) is cheap and short-ranged. The autocannon
(`HeavyTurrets`) hits harder at medium range; the uranium slug turret (`SniperTurret`,
after `MultiAnalyzer`, `HeavyTurrets` and `PrecisionRifling`) hits hardest at long range. The mortar
(`Mortars`) needs no power and reaches across the map, but is inaccurate.

Signs:
- Day 10 or later and no chokepoint → build one entrance before the first raid.
- Raiders reached the kitchen or bedrooms last raid → the base needs a killbox.
- A straight or wide killbox entrance → turn it once and narrow it to one tile.
- Turrets on the main grid → put them on their own grid.
- Overhead mountain inside the base and no hive plan → keep fighters ready for insects.
- A mech cluster on the map and a builder near it → stop building within 2 tiles.

## Sources

Threat scale, starting factor, adaptation, storyteller windows, raid-strategy point
curves and research defs: the RimWorld 1.6.4871 XML (`Difficulties.xml`,
`Storytellers.xml`, `RaidStrategies_*.xml`, `ResearchProjectDefs`). Wealth and pawn point
curves, wealth rules, killbox design, infestation and mech-cluster rules, psychic ship part:
rimworldwiki.com (Raid points, Wealth, Killbox, Infestation, Mechanoid cluster, Psychic
ship, Turrets).
