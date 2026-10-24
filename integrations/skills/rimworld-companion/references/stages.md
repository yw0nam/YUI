# Stage guide

The colony is in the highest stage whose entry signs hold; day counts are only a fallback.
A RimWorld year is 60 days: four seasons of 15 days. Research names are the `defName`s the
research tab lists under their labels; costs are the base cost.

| stage | entry signs |
|---|---|
| Landing | First days; no enclosed bedroom or no research bench yet |
| Early | Everyone sleeps in a bed indoors and food is coming in; `Electricity` not researched |
| Mid | `Electricity` done; a grid with generators runs the base |
| Late | `MultiAnalyzer` done, or the ship track started |

## Landing

Goals: everyone indoors before the first night, food that lasts the first week, a research
bench running.

Checklist:
- One bed per colonist, in an enclosed room (walls and a door all round).
- Sleeping rooms between 16 and 26 °C.
- A cooking spot or stove, and a roofed stockpile for food.
- Food stored and rising, from hunting, foraging or the first crops.
- A research bench with a project queued.
- Work priorities: Doctor, Cook and Grow on the best colonist for each; Haul below
  Construction.

Common mistakes:
- Hauling at priority 1, so nobody builds or cooks.
- A bedroom with a gap in its walls, so colonists sleep "outdoors".
- Food lying unroofed, where it deteriorates.

## Early

Goals: a food chain that survives the first winter, a power source, the first defense.

Checklist:
- A growing zone of rice, potatoes or corn. Rule of thumb: about 25 tiles feed one
  colonist on ordinary soil in a year-round climate; cold winters need more.
- Food days: an adult eats 1.6 nutrition a day (a simple meal is 0.9). Before winter, hold
  enough for the 15-day winter plus a margin (rule of thumb).
- A freezer, or at least a cool stockpile, before summer spoils the food.
- Medicine in stock and a doctor whose Medical skill is the colony's best.
- Research toward `Electricity` (1,600); `PassiveCooler` (400) for an early summer.
- A chokepoint before day 11 (references/threat.md § Defense by stage).
- No colonist below the 20 % major-break line.

Common mistakes:
- One crop and no reserve when blight or a cold snap hits.
- No heating plan when winter arrives.
- A wood-fired generator without a wood supply: it burns about 22 wood a day.
- Cookstoves and electrics left in the rain or near wood, which starts fires.

## Mid

Goals: stable power through the night, better food, comfort, armor, a killbox, and the
first value from prisoners, trade and caravans.

Checklist:
- `Batteries` (400) researched; batteries carry the grid through the night (a battery
  holds 600 Wd).
- `Hydroponics` (700) or fields big enough for the colony; `NutrientPaste` (400) or meals
  that keep up.
- `AirConditioning` (500) and a freezer below 0 °C.
- Bedrooms at least "decent" in impressiveness, a dining room and a recreation room; most
  colonists above the 35 % minor-break line.
- Weapons and armor: `Smithing` (700) and `LongBlades` (400) for melee, `Machining` (1,000)
  → `Gunsmithing` (500) for guns, `FlakArmor` (1,200) for armor; every fighter has a gun and
  a vest or better.
- A killbox, with turrets from `BlowbackOperation` (500) → `GunTurrets` (500).
- A prison only once a room is fully enclosed and holds a bed.
- `MicroelectronicsBasics` (3,000) started: it opens `MultiAnalyzer`, `HeavyTurrets` and
  medicine production.

Common mistakes:
- Too few batteries, so the grid fails each night.
- Hydroponics without reliable power: the plants wither quickly.
- No dining or recreation room, so the whole colony's mood sinks.
- A killbox with a long straight corridor that gives raiders cover.
- Capturing a member of a neutral or allied faction, which turns it hostile.

## Late

Goals: an ending chosen, raid defense keeping up with wealth, the colony stable through
every season.

Checklist:
- `MultiAnalyzer` (4,000) built beside a hi-tech bench.
- `Fabrication` (4,000) and `AdvancedFabrication` (4,000) for components and spacer gear;
  `ReconArmor` (6,000) for the fighters.
- `HeavyTurrets` (1,600) and `Mortars` (2,000) in the defense.
- Ship ending: `ShipBasics` (4,000) after `AdvancedFabrication`, then `ShipReactor`,
  `ShipEngine` (6,000 each), `ShipComputerCore` (3,000), `ShipCryptosleep` (2,800) and
  `ShipSensorCluster` (4,000). The reactor takes 15 days to start and draws raids the whole
  time.
- A food reserve for a full season and more than one food source.
- Royalty, Ideology and Biotech endings (royal ascent, archonexus) arrive as quests;
  weigh them when offered.

Common mistakes:
- Starting the ship reactor before the defense can hold 15 days of raids.
- Treating day count as the threat level; raids follow wealth.
- Caravans overloaded or sent without enough food.

## Recurring checks

At any stage, these come before the stage checklist:

| check | sign | point to make |
|---|---|---|
| Food | Stored nutrition under about 5 days for the colony (rule of thumb) | Cook, hunt or harvest before the reserve runs out |
| Mood | Any colonist under 35 %, or two breaks in a day | Fix the worst thought: a room, a meal, recreation, rest |
| Injuries | A colonist bleeding or untreated | Assign the doctor; tend before the next job |
| Season | Winter or the end of the growing season within 5 days | Harvest, stock fuel and food, check heaters |
| Fire | Burning tiles near the base | Firefighting on priority 1 |
| Idle colonists | The idle alert | Their skills have no open work; check priorities and bills |
| Research | No project, or the bench unpowered | Queue the next project on the stage checklist |

## Sources

Research names, costs and prerequisites: the RimWorld 1.6.4871 XML
(`Core/Defs/ResearchProjectDefs`). Comfort temperatures, nutrition, crop yields, power
numbers, mood lines, bedroom rules, prisoner and trade rules, ship launch: rimworldwiki.com
(Temperature, Food, Power, Mood, Rooms, Hydroponics, Prisoner, Trade, Caravan, Ship,
Killbox). Rows marked *rule of thumb* are community practice, not game rules.
