# Lasting mood through behaviour in desktop companions and games

**Question:** How do established desktop companions and games show a lasting mood through behaviour rather than a one-shot animation?
**Date checked:** 2026-11-24
**Scope:** Shimeji-ee, Mate Engine, Desktop Mate, The Sims (moodlets), Animal Crossing villagers, Tamagotchi-style pets. For each: states, duration, movement / idle choice / placement / voice, and how the user can tell the state.

**Method and caveats**
- "verified (opened URL)" means the page or file was fetched in this session and the cited text was read in the fetch result. Most fetches were summarised by a small model, so quoted wording is the fetch result's wording, not raw bytes. Where a fetch was truncated, this is noted.
- "unverified" means the claim comes from a search snippet only, or the page could not be opened (HTTP 402 / 403 noted).
- "not found in sources checked" means the sources opened did not state it.

---

## 1. Shimeji-ee (Windows desktop mascot, XML-driven)

**Sources**
- Project README: https://github.com/gil/shimeji-ee (verified, opened)
- Default behaviour file: https://raw.githubusercontent.com/gil/shimeji-ee/master/conf/behaviors.xml (verified, opened; 57 `<Behavior>` elements per the fetch)
- Project archive page: https://code.google.com/archive/p/shimeji-ee (unverified, search result only)
- Community note on `Frequency` 0 (unverified, search snippet only): https://art.cleberg.net/post/strawberrysunday12/Shimeji-One-How-to-stop-them-from-multiplying-629838334
- The `actions.xml` file was not opened. Its contents are unverified.

**Configuration files (verified, README)**
- `behaviors.xml` "specifies when Shimeji performs each action"; `actions.xml` "specifies the different actions Shimeji can do"; `settings.properties` "details which Shimeji are active". Per-set override: `img/[NAME]/conf/behaviors.xml` or `conf/[NAME]/behaviors.xml` replaces the default.
- "for every Behavior, there must be a corresponding action" and "Actions and Behaviors can be a sequence of other actions or behaviors." (verified, README)
- Required names in both files: ChaseMouse, Fall, Dragged, Thrown (verified, README).

**States (behaviour names and their conditions, verified from behaviors.xml)**
- Posture and placement behaviours: SitDown and StandUp (Frequency 200), WalkAlongWorkAreaFloor and WalkAlongIECeiling (100), WalkLeftAndSit / WalkRightAndSit (100), WalkLeftAlongIEAndJump / WalkRightAlongIEAndJump (100), SitOnTheLeftEdgeOfIE and SitOnTheRightEdgeOfIE (100), SitWhileDanglingLegs (0), SitAndSpinHead (0), SitAndFaceMouse (0, Hidden), ChaseMouse (0, Hidden), FallFromWall and FallFromCeiling (50, Hidden), JumpFromLeftWall / JumpFromRightWall (50), JumpFromBottomOfIE (50), JumpFromLeftEdgeOfIE / JumpFromRightEdgeOfIE (100), WalkAndThrowIEFromRight / Left (20), SplitIntoTwo (50, condition `mascot.totalCount < 50`), PullUpShimeji (50, same condition). (verified: opened raw behaviors.xml; values come from the fetch summary.)
- Mouse-related names exist, but "no mouse condition is defined" in the file (verified, raw behaviors.xml). How ChaseMouse is triggered is not found in sources checked.
- Frequency 0 for a behaviour is stated as a disable hint: "(hint: set frequency to 0.)" (verified, README). The fetch summary also lists several Frequency-0 behaviours as Hidden.
- Mood or emotion states: not found in sources checked. The file contains no mood variable.

**Duration**
- No `Duration` attribute and no time-based wait tag in behaviors.xml (verified, raw file). Attributes seen: `Name`, `Frequency`, `Hidden`; elements: `NextBehavior` (with `Add`), `BehaviorReference`, `Condition` blocks (verified, raw file).
- Animation length per action: unverified (actions.xml not opened).
- Meaning of the Frequency scale (weighted random selection is the likely reading): unverified. The official README does not explain it (verified, README), and no official Group Finity documentation was found.

**Movement, idle choice, placement**
- Behaviour choice is governed by Frequency plus Condition expressions evaluated against the environment: floor, wall, ceiling, IE (window) top, bottom, and sides, plus `mascot.totalCount` (verified, raw file). Example: FallFromWall is conditioned on `!mascot.environment.floor.isOn(mascot.anchor)`.
- Placement is the screen work area and open windows ("IE" in the file): floor, ceiling, window edges (verified, raw file).
- Mood carries into movement only indirectly, through the conditions. No persistent mood value was found.

**Voice**
- Not found in sources checked.

**How the user can tell the state**
- Posture and location only (sit, face the mouse, fall, throw a window, split into two). No text readout or sound was found in sources checked.

---

## 2. Mate Engine (Unity desktop companion, VRM avatars)

**Sources**
- GitHub README: https://github.com/language-coder/Mate-Engine (verified, opened)
- GitHub README, blob view: https://github.com/language-coder/Mate-Engine/blob/main/README.md (verified, opened)
- Steam store page: https://store.steampowered.com/app/3625270/MateEngine/ (verified, opened)
- Search result for the Steam listing: https://store.steampowered.com/app/3625270 (unverified, search only)

**States**
- Idle: "10 different idle animations for when the pet is relaxing on your desktop" (verified, Steam). README: "アイドルアニメーション – デスクトップ上でループ再生" (verified, README), i.e. an idle animation looped on the desktop.
- Drag: "1 drag animation plays when you move your pet around the desktop" (verified, Steam).
- Dance: "The pet dances when music plays on apps like Spotify, Chrome, and others!" Audio sources are whitelisted in Options (verified, Steam).
- Head, eye, hand and upper-body tracking of the cursor: head and eyes follow the mouse; "When you hover your mouse near its hands, the pet will try to catch and hold it!"; spine/chest tracking (verified, Steam).
- Touch regions: head pats make it "shake, jiggle, and spawn adorable heart particles"; hovering over sensitive parts makes it "react shyly and cover certain areas"; "Hover over its feet for 3 seconds to transform the pet into a chibi version!" (verified, Steam).
- Window or taskbar relaxing: "Drag your pet onto a window and it will relax on top!" and taskbar: "she'll lay down and relax on a big candy macaron" (verified, Steam). The same Steam page says "Taskbar/window sitting is currently disabled to avoid triggering anti-cheat systems in certain games." This contradicts the feature bullet above, so the current state is unverified.
- Time-based: README lists "Alarm / Timer" and "Sleep" as features, with no setup details (verified, README).
- Event messages: "Generates cute messages when you drag the avatar, make it dance, or let it sit on windows or the taskbar." Listed as Steam-only (verified, README).
- Mood or emotion state system: not mentioned in README or Steam page (verified: both opened, neither names one). Expression editing is listed only as "Blendshape Edit Support" in a comparison table, without usage details (verified, README).

**Duration**
- Not found in sources checked. No timers for mood, decay, or durations for idle clips were stated.

**Movement, idle choice, placement, voice**
- Movement: head/eye/hand tracking; dance from audio; drag animation (verified, Steam).
- Idle choice: the rules for picking among the 10 idle animations are not found in sources checked.
- Placement: desktop, with window / taskbar sitting described but conflicting (see above).
- Voice: README lists "Avatar SFX" and "AI Chat" as supported and "AI Voices" as unsupported (verified, README). Steam: chat is "a small, local AI with simple messages" (verified, Steam).
- Settings: opened by right-click or the `M` key (verified, README). Size, animation speed, language and modes are adjustable (verified, Steam). No config key names found.

**How the user can tell the state**
- Visual pose and motion; chat text bubbles and event messages (verified, Steam and README). Touch reactions show heart particles and a shy cover (verified, Steam).

---

## 3. Desktop Mate (Steam desktop companion, Japanese VTuber-style characters)

**Sources**
- Steam store page: https://store.steampowered.com/app/3301060/Desktop_Mate/ (verified, opened)
- Store page (search result only): https://store.steampowered.com/app/3301060 (unverified)

**States and behaviours (verified, Steam)**
- Sitting on windows: "Drag a character onto a window, and they'll sit right on top of it."
- Window jumping: "Just watching them jump from window to window is soothing."
- Cursor play: "Characters react to your mouse cursor by chasing and playing with it."
- Head pats: "respond to head pats".
- Alarm: "Set an alarm, and your characters will let you know when it goes off!" Some DLC mascots appear when alarms go off.
- Pair actions: "Special actions trigger between certain character pairs!"
- Game sync: "Desktop Mate characters react in real time to in-game actions" (Mahjong Soul; requires a DLC, per the search snippet, unverified).

**Mood or emotion**
- The page "makes no explicit claims about moods or emotions" (verified, Steam). No mood system found in sources checked.

**Duration**
- Not found in sources checked.

**Movement, idle choice, placement, voice**
- Placement: window tops; the characters jump between windows (verified, Steam).
- Voice: "Characters play voice lines in various scenes!"; voices for clicks and head pats; "Voice content varies by DLC character." (verified, Steam)
- Idle choice: not found in sources checked.

**How the user can tell the state**
- Visual location and motion; voice lines; alarm notification (verified, Steam).

**Other facts (verified, Steam)**
- Core app is free; default character is free, and character DLC is paid. Requires a GPU or integrated GPU (search snippet, unverified).

---

## 4. The Sims (mood and moodlets; Sims 3 and Sims 4 referenced)

**Sources**
- The Sims Wiki, Mood: https://www.thesimswiki.com/wiki/Mood (verified, opened; mostly Sims 3 display details)
- The Sims Wiki, Moodlet: https://www.thesimswiki.com/wiki/Moodlet (verified, opened)
- GamePressure guide: https://gamepressure.com/thesims4/emotions/z368d1 (verified, opened)
- Japanese fan wiki, Moodlet tables: https://wikiwiki.jp/sims4/Moodlet (verified, opened; Japanese source)
- Sims Fandom Moodlet page: https://sims.fandom.com/wiki/Moodlet (unverified; HTTP 402, not read)
- Prima Games guide: https://primagames.com/eguides/the-sims-4-eguide/feelings-lots-of-feelings/moodlets (unverified; HTTP 403, search snippet only)
- Carl's Sims 4 Guide: https://carls-sims-4-guide.com/emotions (unverified; HTTP 403)
- Search snippet "usually short lived, only lasting a few hours or until a condition changes" (unverified, Prima Games snippet)

**States**
- Mood tiers, from the net total of moodlets: "When the moodlet net total is close to zero or if the Sim has no moodlets, then the Sim will usually be at the 'Fair' state." Good moods run from Happy (+10 to +25) to Elated (+60 and up). Bad moods have two stages, split at -10 and -50 (verified, Mood page).
- Moodlets: many discrete modifiers (for example "風味が増した！" Happy, strength 1, from microwaved food) (verified, wikiwiki.jp).
- Uncomfortable moodlets escalate over time: 膀胱の限界 changes to "マジで膀胱の限界" after 3 hours; 空腹 changes to "貪欲" after 24 hours (verified, wikiwiki.jp).
- Mood is "determined by the level of their needs" (verified, Mood page).

**Duration**
- "Some moodlets happen for an indefinite amount of time while others are timed." (verified, Moodlet page)
- "Moodlets that do not specify a time end when certain events occur, such as leaving the area that gives the moodlet." (verified, Moodlet page)
- Sample: a Happy moodlet at strength 1 lasts 4 hours (verified, wikiwiki.jp). The fan wiki lists durations per moodlet, "most of them 4 hours", with some at 2, 8 or 12 hours and a few at 2 days (unverified, search snippet only).
- "short-lived events last an hour or two, while bigger events may affect the Sim's mood for many hours and even one, or two days." (verified, GamePressure)
- Removal: Moodlet Manager lifetime reward; Ctrl-click with testing cheats; "Clicking on negative or neutral moodlets will queue the appropriate interaction to resolve the issue." (verified, Moodlet page)
- Stacking and fading or decay rates: not found in sources checked (the Moodlet page says it does not mention timeouts, fading or decay).

**Movement, idle choice, placement, voice**
- Movement, idle choice, placement and voice tied to mood: not found in sources checked. The Mood page does not mention mood-related sound (verified, Mood page).

**How the user can tell the state**
- Mood bar (Sims 3): "If there is no color in the bar, that indicates the Sim is in a neutral mood; neither good nor bad." Hover over the mood bar shows the mood state (verified, Mood page).
- Plumbob colour: "green if the Sim is in a good mood, and red if they are in a bad mood" (verified, Mood page).
- Portrait expression changes with mood (Sims 3) (verified, Mood page).
- Sims 4: "the mood bar is replaced by the Sim's emotional state" (verified, Mood page).
- Moodlet icons above the Sim's head, with a description and remaining time; the current mood as text and colour in the bottom panel (verified, GamePressure).

---

## 5. Animal Crossing villagers (personality, mood, and town behaviour)

**Sources**
- Nookipedia, Villager: https://nookipedia.com/wiki/Villager (verified, opened)
- Nookipedia, Cranky: https://nookipedia.com/wiki/Cranky (verified, opened)
- Animal Crossing Wiki, Villager: https://animalcrossing.fandom.com/wiki/Villager (unverified; HTTP 402)
- TechRaptor personality guide, search snippet: https://techraptor.net/gaming/guides/animal-crossing-new-horizons-personality-guide (unverified, search only)

**States (verified, Nookipedia Villager; "most games")**
- Happy: "Happy villagers have music notes around them and sing the town tune."
- Angry: "Angry villagers make a continuous sound while they move their entire body." They "will refuse any conversations the player tries to have with them."
- Sad: "Sad villagers droop somewhat, make a deep droning noise, and have a black cloud emoticon coming off of them." They also "refuse any conversations."
- Personality is a fixed trait, with eight types (search snippet, unverified; Nookipedia Cranky confirms the Cranky trait).

**Duration**
- "The mood of a villager may change depending on interactions they have with players or other villagers." (verified, Nookipedia Villager)
- No numeric timer, decay rate or mood meter was stated ("The page names no numeric mood or happiness meter.") (verified, Nookipedia Villager).
- Cranky: "The cranky personality has softened significantly in New Leaf and New Horizons." Players who talk to them, run errands and send letters "will eventually begin to open up" (verified, Nookipedia Cranky).

**Movement, idle choice, placement, voice**
- Movement: "Unlike the first game, the villagers walk at a much slower pace than the player" (Wild World onward) (verified, Nookipedia Villager).
- New Horizons visiting another island: "all of the villager's actions will be limited to walking to a designated area, idling, and repeating." Activities include "eating and drinking, sprinting, exercising" (verified, Nookipedia Villager).
- Schedule: Cranky villagers "usually go to sleep at 3:30 AM and wake up at 9:00 AM" in New Horizons, and a locked house shows a sleep letter (verified, Nookipedia Cranky).
- Voice: "Villagers of the same personality share the same pool of dialogue." (verified, Nookipedia Villager). Cranky: "deep-voiced" and "many have frowns"; "Gahaha" laugh in New Leaf and "noticeably less often" in New Horizons (verified, Nookipedia Cranky).

**How the user can tell the state**
- Visual: music notes (happy), body movement (angry), droop and black cloud emoticon (sad), frowns (cranky) (verified, Nookipedia).
- Audio: town tune (happy), continuous sound (angry), droning noise (sad), laugh (cranky) (verified, Nookipedia).

---

## 6. Tamagotchi-style pets (original device and successors)

**Sources**
- Wikipedia, Tamagotchi: https://en.wikipedia.org/wiki/Tamagotchi (verified, opened; the fetch read the first 100,000 of about 126,000 characters, and the rest was not read)

**States (verified, Wikipedia)**
- Three meters: Hunger, Happy, Training ("formerly called Discipline in earlier releases"). Hunger is refilled by meals; Happy by mini-games or snacks; Training by scolding or praising.
- Sickness: "a skull icon appears next to the pet as it sits still at the bottom of the screen." "The pet can die if sickness is left unchecked." Medicine cures it. "Usually, a pet will not play or accept a meal when sick."
- Sleep: "Usually, the pet's age will increase once it has awakened from its sleep time."

**Duration**
- Each life stage: "lasts a set amount of days, depending on the model of the toy." When a stage changes, "the toy plays a jingle, and the pet's appearance changes." (verified, Wikipedia)
- Original 1996 device: the egg "will wiggle for around 5~ minutes, and then hatch" after the clock is set; the clock setting is also how the original could be paused (verified, Wikipedia).
- Rate of meter decay: not found in the portion of the page read.

**Movement, idle choice, placement, voice**
- Placement: the sick pet "sits still at the bottom of the screen" (verified, Wikipedia).
- Idle choice and voice: not found in the portion of the page read.

**How the user can tell the state**
- Skull icon (sickness); jingle and appearance change at stage change; the meters (verified, Wikipedia). Sprite changes tied to hunger or happiness: not found in the portion of the page read.

---

## Gaps

**Not verified or not found**
- Shimeji-ee: `Frequency` value semantics (weighted random or other), the animation timing in `actions.xml`, and how ChaseMouse is triggered. The official docs were not found.
- Shimeji-ee: any voice, mood, or text readout. None found in sources checked.
- Mate Engine: config keys, timers, mood or emotion logic, idle clip selection, and current window-sitting status (Steam page contradicts itself).
- Desktop Mate: idle choice, mood, and durations. Not found.
- The Sims: English numeric moodlet durations and decay. Sims Fandom (402), Prima (403) and Carl's Sims (403) could not be opened. Fan-wiki numbers beyond the sampled rows are from a search snippet only.
- Animal Crossing: wandering pattern, daily schedule beyond Cranky sleep hours, and any numeric mood meter. The Fandom villager page (402) was not opened.
- Tamagotchi: meter decay rates and sprite or sound changes by meter, in the part of the page not read (about 26,000 characters).

**Blocked sources**
- https://sims.fandom.com/wiki/Moodlet (HTTP 402)
- https://animalcrossing.fandom.com/wiki/Villager (HTTP 402)
- https://primagames.com/eguides/the-sims-4-eguide/feelings-lots-of-feelings/moodlets (HTTP 403)
- https://carls-sims-4-guide.com/emotions (HTTP 403)
- https://code.google.com/archive/p/shimeji-ee was not opened.

**Not used**
- Shijima-Qt, uDesktopMascot and other Shimeji forks were seen in search results only and are not covered.

---

## Patterns that recur

Facts only, drawn from the sources above.

1. **Mood as an accumulated or aggregated state, not a single animation.** The Sims derives mood from a net total of moodlets, with named tiers (verified, Mood page). Tamagotchi derives state from three meters (verified, Wikipedia).
2. **Timed and untimed modifiers.** The Sims has timed moodlets (for example 4 hours) and untimed ones that end on in-world events such as leaving an area (verified, Moodlet page and wikiwiki.jp). Tamagotchi life stages run for a set number of days (verified, Wikipedia).
3. **Escalation over time.** Some Sims negative moodlets change wording after 3 hours or 24 hours (verified, wikiwiki.jp). Tamagotchi sickness progresses to death if unchecked (verified, Wikipedia).
4. **Behaviour selected by weighted, conditioned choice, not by a duration.** Shimeji's behaviours.xml has no Duration attribute; behaviours are picked by Frequency and Condition against the environment (verified, raw file).
5. **Environment-bound placement.** Shimeji conditions on floor, wall, ceiling and window edges (verified, raw file). Desktop Mate sits on windows (verified, Steam). Mate Engine lists window and taskbar sitting, with the current status disputed (verified, Steam).
6. **Interaction-driven mood change.** Villager mood changes with interactions (verified, Nookipedia). Cranky villagers soften as the player interacts (verified, Nookipedia). Sims moodlets can be resolved by clicking them to queue an interaction (verified, Moodlet page).
7. **Visible mood cues in several channels.** Visual: plumbob colour, mood bar text, skull icon, black cloud emoticon, moodlet icons (verified, sources above). Audio: town tune, droning noise, jingle at Tamagotchi stage change (verified, Nookipedia and Wikipedia). Motion: body movement for angry villagers, shaking and heart particles for head pats in Mate Engine and Desktop Mate (verified, Nookipedia and Steam pages).
8. **Voice tied to a fixed pool or a DLC.** Villagers of one personality share one dialogue pool (verified, Nookipedia). Desktop Mate voice lines vary by DLC character (verified, Steam).
9. **Sleep cycles.** Tamagotchi pets sleep and age after waking (verified, Wikipedia). Cranky villagers keep fixed sleep hours (verified, Nookipedia). Mate Engine lists a Sleep feature without details (verified, README).
10. **Touch or hover as a state trigger.** Mate Engine: hovering over feet for 3 seconds gives chibi mode; sensitive areas make it shy (verified, Steam). Shimeji has Dragged and Thrown behaviours (verified, README).
