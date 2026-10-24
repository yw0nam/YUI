# Event tiers

Tiers (`critical`, `high`, `medium`, `low`, `noise`) mean what SKILL.md step 3 says. Each
table gives the default tier; the rules under a table move a def up or down. A def missing
from every table gets the tier of its letter (§ Letters). A `command` event is the echo of
a command channel call, so it is `noise`.

## Incidents (`incident.fields.incidentDef`)

`fields.points` is the threat budget the storyteller spent; compare it with the colony's
fighters (references/threat.md § Raid points).

| incidentDef | tier | what happens | response |
|---|---|---|---|
| RaidEnemy | critical | Hostile raid; strategy and arrival vary (§ Raids) | Draft, man the killbox or the chokepoint, read the strategy |
| ManhunterPack | critical | A pack of animals hunts people | Everyone indoors behind doors; shoot from inside; never chase |
| AnimalInsanityMass | critical | Many animals on the map go manhunter at once | Same as ManhunterPack |
| Infestation | critical | Hives tunnel up under overhead mountain and keep spawning | Kill every hive; a surviving hive grows new ones |
| DeepDrillInfestation | critical | Insects come up at a deep drill | Fight at the drill; stop drilling for less risk |
| Ambush, ManhunterAmbush | critical | A caravan on the world map is attacked | Fight or flee with the caravan |
| MechCluster | high | A dormant mech cluster lands; it wakes on damage, on anything built within 2 tiles, on a person within about 13 tiles, or on a timer | Keep everyone away, then attack on your terms with EMP and mortars |
| PsychicEmanatorShipPartCrash | high | Ship part whose drone worsens the mood of one gender every few days | Destroy it within days, with ranged fire |
| DefoliatorShipPartCrash | high | Ship part that kills plants in a growing radius | Destroy it before it reaches the fields |
| ProblemCauser | high | Quest about a threat building near the colony | Read the quest; plan the attack |
| AnimalInsanitySingle | high | One animal goes manhunter | Down it from range; keep people out of its path |
| CaravanDemand | high | A force demands goods from a caravan | Pay or fight |
| RansomDemand | high | A faction demands ransom; the letter has a deadline | Decide before the deadline |
| WandererJoin | high | Someone asks to join; the offer expires | Accept or refuse on skills and traits |
| Disease_Plague | high | Kills in about 1.5 days untreated | Bed rest and a doctor with medicine today |
| Disease_Flu, Disease_Malaria | high | Fatal without treatment | Bed rest and medicine |
| ToxicFallout | high | 2.5–10.5 days of toxic dust; unroofed pawns build toxic buildup | Keep colonists and animals under roofs |
| VolcanicWinter | high | 7.5–40 days colder and darker; crops and wildlife drop | Indoor lit farms, food stock, heaters |
| ColdSnap | high | 1.5–3.5 days at about −20 °C outdoors; crops can die | Heated rooms, parkas, harvest early |
| HeatWave | high | 1.5–3.5 days at about +17 °C outdoors; heatstroke | Coolers, stay indoors |
| Disease_SleepingSickness | medium | Slow but fatal | Bed rest and medicine within days |
| Disease_OrganDecay | medium | Incurable; fatal in 30–40 days | Plan an organ replacement |
| Disease_GutWorms, Disease_MuscleParasites, Disease_FibrousMechanites, Disease_SensoryMechanites, Disease_BloodRot, Disease_AnimalFlu, Disease_AnimalPlague | medium | Disease that cripples or that a few tends cure | Tend with medicine |
| WastepackInfestation | medium | Cocoons that release insects when a person comes close | Mark the area off; fight as an Infestation if they wake |
| SolarFlare | medium | Electricity off for a few hours; turrets go dark | Keep fighters ready; food in freezers waits |
| Eclipse | medium | No sun for about a day | Batteries or fuel generators carry the grid |
| PsychicDrone | medium | Mood penalty on one gender for 0.75–1.75 days | Recreation, good meals |
| Flashstorm, ShortCircuit | medium | Fires | Firefighters on priority 1 |
| CropBlight | medium | Blight on crops | Cut the blighted plants |
| NoxiousHaze | medium | Smog from pollution: outdoor mood, light and growth drop | Stay indoors |
| OrbitalTraderArrival, TraderCaravanArrival | medium | Trader on the comms console or at the edge of the map | Sell surplus, buy what the stage checklist lacks |
| RefugeePodCrash, RefugeePodCrash_Baby, WildManWandersIn, StrangerInBlackJoin, RaidFriendly, VisitorGroup, CaravanArrivalTributeCollector, WandererJoinAbasia | medium | People who may join, help or trade | Rescue, recruit or trade |
| GiveQuest_* | medium | A quest offer, some with a deadline | Accept when the reward beats the risk |

`low`: ResourcePodCrash, MeteoriteImpact, ShipChunkDrop, PsychicSoothe, Aurora, SelfTame,
FarmAnimalsWanderIn, AmbrosiaSprout, Alphabeavers, ThrumboPasses, HerdMigration,
TravelerGroup, CaravanMeeting, GauranlenPodSpawn, Infestation_Jelly, WanderersSkylantern,
PoluxTreeSpawn, AnimaTreeSpawn, Disease_Abasia, GameEndedWanderersJoin.

Context rules:
- An incident with `succeeded: false` did not happen, so it is `noise`.
- A threat whose `points` is small next to the colony's armed fighters drops one tier
  (critical to high).
- A caravan incident (Ambush, ManhunterAmbush, CaravanDemand) is `low` when no colonist is
  in a caravan.
- A disease is one tier higher when the colony has no medicine or no free doctor.
- Alphabeavers go up to `medium` in a biome with few trees.
- MechCluster and WastepackInfestation become `critical` once they wake.

## Raids

The incident has no strategy field; the ThreatBig letter's text states the strategy and the
arrival. A walk-in raid meets the killbox. The others go around it.

| strategy (letter says) | killbox covers it | counter |
|---|---|---|
| Attacking immediately, walking in | yes | Hold in the killbox |
| Groups from several edges | partly | Several defense points, or fall back to the box |
| Unusually clever (`ImmediateAttackSmart`, likelier as points rise) | weaker | They avoid turret fields and spot traps; colonists hold the line |
| Prepare, then attack (`StageThenAttack`) | yes | Use the delay: repair, reposition, or strike while they wait |
| Edge drop pods | yes, after landing | Like a walk-in |
| Drop pods on top of the colony (`CenterDrop`) or scattered (`RandomDrop`) | no | Draft at once and fight indoors at the landing spot |
| Sappers (`ImmediateAttackSappers`, from about 700 points) | no | They dig through walls toward the colony; meet the sappers with fighters before the hole opens |
| Breachers (`ImmediateAttackBreaching`, from about 700 points) | no | They pick their own path through walls; kill the breachers at range |
| Siege (`Siege`, from about 500 points) | no | They build mortars out of range; snipe the builders, counter-battery, or attack before they are dug in |

## Letters (`letter.fields.letterDef`)

| letterDef | tier |
|---|---|
| ThreatBig, Bossgroup | critical |
| ThreatSmall, NewQuest_ThreatBig, Death, ChoosePawn, BetrayVisitors, RansomDemand | high |
| NegativeEvent | medium |
| NeutralEvent, NewQuest, AcceptJoiner, AcceptVisitors, RitualOutcomeNegative, BabyBirth, RelicHuntInstallationFound, GameEnded | medium |
| PositiveEvent, RitualOutcomePositive, HumanPregnancy, BabyToChild, ChildBirthday, ChildToAdult | low |
| BundleLetter | noise |

A letter or a message that shares its tick and subject with an incident, mental break or
death takes that event's tier. Two kinds of letter are known only by their `label` and
`text`, and their table decides the tier instead of the letterDef: an inspiration
(a `PositiveEvent` letter, § Inspirations) and a condition caused by a building
(§ Game conditions from buildings).

## Messages (`message.fields.messageDef`)

Messages are the transient top-left text. Most repeat a letter of the same tick, or report
a finished task. RimEventFeed leaves out the feedback to the player's own input.

| messageDef | tier |
|---|---|
| ThreatBig | critical |
| ThreatSmall | high |
| NegativeHealthEvent, NegativeEvent | medium |
| NeutralEvent, PositiveEvent, SituationResolved | low |
| TaskCompletion | noise |

A `PawnDeath` message takes its tier from § Deaths.

Message texts worth a `medium` or higher whatever their type: a colonist burned by
superheated air (critical), a prisoner escaping, an animal roaming off the map, a colonist
collapsing from exhaustion or overdosing (high), food rotting in storage, crops dying of
cold or blight, a recruit joining (medium). Drop a message whose content a letter on the
same tick already carries.

## Game conditions from buildings

These conditions come from a building on the map and last until it is destroyed or shut off.
The letter's `label` and `text` name the effect; no event carries the condition's def.

| condition (effect) | tier | response |
|---|---|---|
| ToxicSpewer (toxic fallout), EMIField (electricity off), PsychicSuppression (consciousness down), PsychicDroner (mood drone) | high | Find and destroy the building |
| SunBlocker (no sun), GiantSmokeCloud (dim light), ClimateAdjustment (temperature shift), WeatherController (forced weather) | medium | Destroy the building when convenient |

The Planetkiller scenario ends the planet at a deadline; a reminder of it is `critical`
when the deadline is near.

## Mental breaks and states (`mentalBreakDef`, `mentalStateDef`)

Break thresholds by mood: minor below 35 %, major below 20 %, extreme below 5 %. Traits
shift them.

| def | tier | what the pawn does | response |
|---|---|---|---|
| Berserk, BerserkPermanent, BerserkTrance | critical | Melee-attacks anyone near | Keep people away; down it with fists or a blunt weapon |
| MurderousRage | critical | Hunts one colonist or prisoner to kill | Arrest or down it now |
| Binging_DrugExtreme | critical | Binges hard drugs; overdose can kill | Forbid or move the drugs |
| FireStartingSpree | high | Sets fires | Firefighters follow; move chemfuel |
| Jailbreaker | high | Walks to the prison to free a prisoner | Arrest or down it before the cell |
| SadisticRage | high | Beats prisoners | Arrest; keep it from the prison |
| GiveUpExit | high | Walks off the map for good | Arrest it before it leaves |
| RunWild | high | Lives as an animal | Tame it back (Animals skill) |
| Wander_Psychotic, Wander_Psychotic_Short | high | Wanders into danger | Arrest if the path is dangerous |
| Rebellion | high | A slave incites a revolt | Arrest; raise slave suppression |
| Manhunter, ManhunterPermanent, BerserkMechanoid, CocoonDisturbed | high | An animal, a mech or insects from a disturbed cocoon attack people | Indoors, shoot from cover |
| Catatonic | medium | Lies helpless for days | Rescue to a bed |
| Slaughterer | medium | Kills tame animals | Arrest; protect bonded animals |
| Tantrum, TargetedTantrum, BedroomTantrum | medium | Smashes furniture or one target | Move valuables; let it pass |
| Binging_DrugMajor, Binging_Food | medium | Eats food stock or social drugs | Restrict access |
| TargetedInsultingSpree | medium | Insults one colonist until that one may break | Separate the two |
| SocialFighting | medium | A fist fight | Separate them if one is weak |
| IdeoChange, Roaming | medium | Loses faith; a farm animal leaves | Let it pass; rope the animal |
| Wander_Sad, Wander_OwnRoom, InsultingSpree, CorpseObsession, WanderConfused, PanicFlee, PanicFleeFire, BerserkWarcall, Crying, Giggling | low | Passes on its own or does not hurt the colony | — |

Context rules:
- A break on a pawn that is not the player's (Inputs in SKILL.md) is `low`, except
  Berserk, BerserkPermanent, MurderousRage, Manhunter, ManhunterPermanent,
  BerserkMechanoid and CocoonDisturbed, which keep their tier because they attack people.
- Animals that went manhunter on an incident's tick belong to that incident's group, which
  decides the tier.
- The second break in a colony within a day is one tier higher: mood is collapsing, so the
  kibitz point is the mood fix (references/stages.md § Recurring checks).

## Deaths (`death`)

The Deaths table alone decides a death's tier. `hediffDef`, `damageDef` and `instigator`
only name the cause.

| pawn | tier |
|---|---|
| `isColonist` true | high: always speak; name the colonist and the cause; watch their relations' mood next |
| the player's slave | high |
| the player's animal or mech (`def` not `Human`) | medium |
| anyone else (raiders, visitors, wild animals, prisoners) | noise |

A death during a raid is part of the raid's group, so mention it with the raid.

## Health conditions (letters, screenshots, the player's words)

A living colonist's condition. A death event never takes its tier from this table.

| condition | tier | how fast | response |
|---|---|---|---|
| BloodLoss with open bleeding | critical | Hours | Tend now |
| HeartAttack | critical | Immediate | Tend with medicine |
| DrugOverdose | critical | Immediate | Tend; forbid the drugs |
| LuciferiumAddiction short of supply | critical | Withdrawal kills | Keep luciferium supplied |
| WoundInfection | high | Under about 1.25 days untreated | Bed, doctor, medicine |
| Plague, Flu, Malaria, LungRot | high | Days | Bed rest, medicine |
| Heatstroke, Hypothermia | high, critical when far out of range | Hours to about 3 days; faster the further out of range | Move the pawn to a tolerable room |
| Malnutrition | high | About 6 days after food runs out | Feed the pawn |
| ToxicBuildup | high | Builds while exposed | Get under a roof |
| Psychite, GoJuice or Ambrosia addiction in withdrawal | high | Mood crash and forced breaks | Supply the drug or ride out withdrawal in bed |
| OrganDecay, HeartArteryBlockage, BloodRot | medium | Weeks | Plan surgery or a replacement organ |
| GutWorms, MuscleParasites, SleepingSickness | medium | Slow | Medicine |
| FoodPoisoning, Dementia, Alzheimers, mechanites | low | — | — |

## Inspirations

An inspiration arrives as a `PositiveEvent` letter; its `label` names the inspiration. Use
one while it lasts: up to 8 days, or until the next matching job.

| inspiration | tier | use it for |
|---|---|---|
| Inspired_Recruitment | high when a prisoner is held | The next recruit attempt succeeds |
| Inspired_Surgery | high when surgery is pending | Doubles surgery success |
| Inspired_Creativity | medium | The next crafted item is two qualities higher: make a weapon, armor or art |
| Inspired_Trade | medium | Better prices with the next trader |
| Inspired_Taming | medium | The next tame succeeds |
| Frenzy_Work, Frenzy_Shoot | medium | A big build or a fight |
| Frenzy_Go | low | — |

## Alerts (screenshot only)

The bottom-right alerts are the colony's current problems. RimEventFeed does not emit
them; a screenshot or the player shows them.

- `critical`: colonist needs rescue, life-threatening condition, starvation, major or
  extreme break risk.
- `high`: heatstroke or hypothermia (critical when far out of range), fire in the home
  area, colonist needs tending, low food, toxic buildup, raid arriving, no defenses.
- `medium`: minor break risk, missing doctor or warden, missing beds, meal source or
  recreation, no warm clothes, no batteries, research bench idle, quest expiring.
- `low`: idle colonists, tattered apparel, filth, unhappy nudity, ugly bedroom.

## Sources

Def names, categories, letter defs, raid strategies and arrival modes: the RimWorld 1.6.4871
XML under `Data/{Core,Royalty,Ideology,Biotech}/Defs/`. Break thresholds: the
`MentalBreakThreshold` stat (35 %) and the wiki's major and extreme fractions. Durations
and lethality: rimworldwiki.com (Events, Disease, Mental break, Infestation, Mech cluster,
Blood loss, Heatstroke, Hypothermia, Malnutrition, Addiction). Alert names: the classes in
`Assembly-CSharp.dll`.
