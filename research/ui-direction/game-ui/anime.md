# Anime game UI design breakdowns

Research pass for YUI's desktop-companion UI. Captured with ego-browser on 2026-11-22.
Screenshots sit beside this file in `scratchpad/game-ui/anime/`. Each entry names its PNG. Where a page had no usable design content, the entry says so.

Coverage gaps: Honkai Star Rail, Zenless Zone Zero, Wuthering Waves, NIKKE, and Blue Archive have no full case study here. Their Behance and Dribbble pages showed covers only. Genshin, Umamusume and Project Sekai are text-only. Umamusume's design doc is a fan tool site, not the game. Two ArtStation pages were login walls and were dropped.

## Atlus (Persona 5 / 3 Reload / Metaphor)

### 1. Curio, "What is Persona 5? Design style guide" (2026-11-08)
- URL: https://designbycurio.com/learn/persona-5-phantom-thieves-ui-2016
- Author: Curio Editorial (style guide, secondary analysis)
- Screen: the whole UI language of P5, shown through a "Take the Night" key-art hero.
- Visual: black ground, one blood red, white cut-outs. Menu words tilt and overlap. Panels have sawtooth edges like torn paper. Titles are built letter by letter from clipped typefaces, ransom-note style. Fills are flat. Shadows are hard and offset. Corners are never rounded. Transitions slash in on the diagonal instead of fading.
- Rationale quoted from the page: "attitude as system". Every element behaves as if cut out and pasted in a hurry by someone who knew exactly what they were doing.
- Coexistence with art: the key art is the banner; the UI cards overlap the art edge.
- Screenshot: `scratchpad/game-ui/anime/p5-curio-guide.png`

### 2. Siliconera, "Atlus Reveals The Design Secrets Behind Persona 5's Distinctive UI" (2017-11-13)
- URL: https://www.siliconera.com/atlus-reveals-design-secrets-behind-persona-5s-distinctive-ui/
- Author: Alistair Wong, reporting on the CEDEC + Kyushu 2017 session (via Famitsu)
- Screen: menus and battle UI, the design process itself.
- Quoted facts:
  - Colour per title is the identity: P3 teal/blue, P4 bright yellow, P5 red, Catherine pink.
  - P5 uses no sub-colours outside HP/MP, "in order to keep the distinctive red color."
  - Central lines pull the eye. Menu angle and contrast change to signal context. "The relevant information is always on the same side as the mainly white color."
  - Menus carry a 3D model that spins and ends in a pose. The layout is made in Photoshop, a motion designer captures a pose, and a custom tool renders it to 2D.
  - Atlus reasoning: after P3 sold poorly, marketing was a priority, and UI was "the best way to attract a larger, casual audience... at a low cost."
- Screenshot: `scratchpad/game-ui/anime/p5-siliconera-cedec.png`

### 3. PersonaCentral, "Persona 5 Developer Interview About UI Design" (2016-09-11)
- URL: https://personacentral.com/persona-5-interview-ui-design-sound-music/
- Author: Masayoshi Sutou (P5 art director, translated from Famitsu #1449 by Play-Asia)
- Quoted rationale:
  - Sutou: "I tend to not add gradations, but prefer filling in each and every graphic."
  - On the menu: "Each entry on the menu screen is animated... as soon as you press the button to bring up the menu it will pop up without any lag whatsoever, this was something that I was very particular about."
  - Colour: P3 teal, P4 yellow, P5 crimson, so the menus needed black and white text on red. "After much deliberation I... was confident with it."
  - Layout and programming work: designers hand specs to programmers and check every frame.
- Screenshot: `scratchpad/game-ui/anime/p5-personacentral-interview.png`

### 4. PersonaCentral, "Panel on the Concept and Development Behind Persona 5's UI" (2017-11-13)
- URL: https://personacentral.com/persona-5-panel-concept-development-ui/
- Author: Reggy (summary of CEDEC + Kyushu 2017, panel by Masayoshi Sutoh and Kazuhisa Wada)
- Screen: the panel itself. The page text was short; the content matches entry 2.
- Screenshot: `scratchpad/game-ui/anime/p5-personacentral-panel.png`

### 5. PersonaCentral, "Persona 3 Reload Developer Interview on UI Development" (2023-11-29)
- URL: https://personacentral.com/p3r-interview-menu-ui/
- Author: Famitsu interview with Tomohiro Kumagai (art director), Takuya Yamaguchi (director), Ryota Niitsuma (producer)
- Shows early UI mock-ups from development (text only in the capture). Kumagai's path: UI designer from P4 Arena Ultimax, then P5 and P5 Royal, then volunteered as P3R art director.
- Screenshot: `scratchpad/game-ui/anime/p3r-personacentral-interview.png`

### 6. GamesRadar, "Persona 3 Reload's amazing UI might have the best menus..." (2024-02)
- URL: https://www.gamesradar.com/persona-3-reloads-ui-goes-hard-and-one-indie-dev-reckons-theyve-figured-out-why/
- Author: Hirun Cryer, quoting senior UX designer Alex Tokmakchiev.
- Argument: the menus are strong because Atlus keeps its UI staff long-term and treats them as a core discipline. The page cites the Famitsu interview in entry 3.
- Screenshot: `scratchpad/game-ui/anime/p3r-gamesradar.png`

### 7. Adrian Kowalik, "Persona 3 Reload UI Recreation"
- URL: https://adrian-kowalik.com/projects/persona-3-reload-ui-recreation
- Author: Adrian Kowalik (independent recreation)
- The capture had no extractable text. Only the screenshot is kept. Not verified beyond that.
- Screenshot: `scratchpad/game-ui/anime/p3r-kowalik-recreation.png`

### 8. Medium / Design Bootcamp, "How Persona 5's UI balances both style and substance" (2025-07-01)
- URL: https://medium.com/design-bootcamp/how-persona-5s-ui-balances-both-style-and-substance-de8cb1b807ef
- Author: Jeffrey Owusu. Member-only; the capture shows the intro only. Thin on specifics.
- Screenshot: `scratchpad/game-ui/anime/p5-medium-balance.png`

### 9. Aftermath, "Join Us In Appreciating Metaphor: ReFantazio's Menu Screens" (date not captured)
- URL: https://aftermath.site/metaphor-refantazio-menu-screen-art/
- Author: Luke Plunkett. The article is mostly a video embed and praise. It notes the menus "move just as nice as they look in screenshots."
- Screenshot: `scratchpad/game-ui/anime/mr-aftermath-menu-art.png`

### 10. Audrey Tsomedis, "Metaphor: ReFantazio Menus (FANMADE)" (2024-03-28)
- URL: https://www.behance.net/gallery/194947125/Metaphor-ReFantazio-Menus-(FANMADE)
- Fan-made menu study. The capture shows the cover: the character art is cut into a red/white ink-splatter field over a blurred, greyscale key-art backdrop. Menu labels sit on top in a condensed display face (New Game / Load Game / System). Splatter colours echo the title's red and teal.
- Screenshot: `scratchpad/game-ui/anime/mr-behance-menus-fanmade.png`

### 11. Game UI Database, Metaphor: ReFantazio
- URL: https://www.gameuidatabase.com/gameData.php?id=1970
- Index of real Metaphor screens, grouped by Title, Settings, Dialogue, Modals, Button Layouts. Useful as a reference set for the actual screens; the capture is the index only.
- Screenshot: `scratchpad/game-ui/anime/mr-gameuidatabase.png`

## HoYoverse (Honkai Star Rail / Zenless Zone Zero / Genshin)

### 12. Chelsea Mai, "Honkai Star Rail: Smart Equip menu" (case study)
- URL: https://www.chelseamai.com/honkai-star-rail
- Author: Chelsea Mai, UX/UI technical designer (fan-made redesign, not Hoyoverse)
- Problem: swapping Relics one by one takes too long.
- Solution: a "Smart Equip" menu to swap whole saved loadouts in one step. Stated outcomes: 82% faster equipping, 33% lower menu bounce rate.
- Design goal quoted: "Integrate solution into current game UI style & brand."
- Screen: a dark-navy star-field build panel with gold-rimmed relic icons, a compare/recommendation pair, and set-effect text. Preset plans sit in the left column.
- Screenshot: `scratchpad/game-ui/anime/hsr-chelseamai.png`

### 13. Katharina Kasprzak (eyween), "Independent UI/UX Case Study: Honkai Star Rail" (2024-11-01)
- URL: https://eyween.artstation.com/blog/WBeAB/independent-ui-ux-case-study-honkai-star-rail
- Author: Katharina Kasprzak. Analysis of Hoyoverse's mobile layouts.
- Observed pattern: a consistent design system across Hoyoverse titles, with WYSIWYG-style, short labels and icons. In mobile HSR, actions sit in thumb-reachable zones: map/quest/menu at top-left, chat and camera bottom-left, attacks and skills bottom-right, team members mid-right.
- Screenshot: `scratchpad/game-ui/anime/hsr-eyween-case-study.png` (the duplicate lessons page was dropped)

### 14. PhanBaDuc, "ZenlessZoneZero UI Concept" (Figma)
- URL: https://www.figma.com/community/file/1667105333120958725/zenlesszonezero-ui-concept
- Free Figma file. Landing page, character showcase, responsive layouts, auto-layout components. The file description says "Feel free to duplicate, study, and remix." Screenshot is a landing-page capture.
- Screenshot: `scratchpad/game-ui/anime/zzz-figma-concept.png`

### 15. JH Kim, "zenless zone zero - Z·Z·Z UI Concept Design" (Behance, 2024-01-12)
- URL: https://www.behance.net/gallery/188673799/zenless-zone-zero-ZZZ-UI-Concept-Design
- Concept reel. The capture shows the cover: the ZZZ logo, and a "Character Select" frame with a green Section 5 panel and a level badge beside the character art. The green and yellow accent panels are the most visible decorative choice; the capture does not show more than that.
- Screenshot: `scratchpad/game-ui/anime/zzz-behance-concept.png`

### 16. Sarah Liriano, "Genshin Impact UX Redesign" (ELVTR course)
- URL: https://www.sarahlirianoportfolio.com/hybrid/genshin-impact-ux-redesign
- UX-only redesign of inventory (scalability, filtering, grouping, mobile layout) and a new character customization flow. Text-only analysis; artwork is credited to miHoYo.
- Screenshot: `scratchpad/game-ui/anime/genshin-sarah-ux-redesign.png`

## Kuro / Wuthering Waves

### 17. Sajin David, "Wuthering Waves UI Reimagined" (Behance, 2026-03-03)
- URL: https://www.behance.net/gallery/245124487/Wuthering-Waves-UI-Reimagined
- Concept redesign. The capture is the cover only, and the project modules were not opened.
- Screenshot: `scratchpad/game-ui/anime/wuwa-behance-reimagined.png`

### 18. Rizky Febrianto, "Wuthering Wave Website UI Design: Camellya" (Dribbble)
- URL: https://dribbble.com/shots/25218015-Wuthering-Wave-Website-User-Interface-Design-Camellya
- Website concept. The capture is a Dribbble landing page with little design detail.
- Screenshot: `scratchpad/game-ui/anime/wuwa-dribbble-camellya.png`

## Blue Archive, NIKKE, Arknights, Umamusume, Project Sekai

### 19. TIMOTHY1498, "Blue Archive - Dialogue GUI (Remade)" (Figma)
- URL: https://www.figma.com/community/file/1395637001129201308/blue-archive-dialouge-gui-remade
- Community remake of the dialogue box. Credit line: "All character and GUI/UI originally by Nexon and Nexon Games." The page has no design rationale; it is a file to inspect.
- Screenshot: `scratchpad/game-ui/anime/bluearchive-figma-dialogue.png`

### 20. Hee Won Min, "NIKKE: In the Mirror UI Design" (Behance, 2024-12-11)
- URL: https://www.behance.net/gallery/214529459/NIKKE-In-the-Mirror-UI-Design
- Author: Hee Won Min (PRO). Related projects on the same page: "NIKKE: EVENT UI DESIGN", "GODDESS OF VICTORY: NIKKE UI 2024", "NIKKE: UI Resource". The capture is the project index only.
- Screenshot: `scratchpad/game-ui/anime/nikke-behance-mirror-ui.png`

### 21. Arknights, Game UI Database
- URL: https://www.gameuidatabase.com/gameData.php?id=478
- Index of Arknights screens: title, settings, dialogue, guided tutorial, world map, pause, results, unit collection, loadout, upgrade, name entry. Reference index only.
- Screenshot: `scratchpad/game-ui/anime/arknights-gameuidb.png`

### 22. Umaguide, "UI Design System" (uma.guide)
- URL: https://uma.guide/UIDesign
- Author: Umaguide (fan reference site for Umamusume, not the game). This is the most explicit design rationale in the set.
- Quoted principle: "Umaguide is a fast, readable reference tool with a single game-flavored showcase — the homepage. Utility comes first everywhere; the 'game UI' is a deliberate accent, never the default."
- The page also records the reversal: "The site briefly leaned into a 'gamified' chrome everywhere (glossy panels, ribbon headers, beveled buttons on ordinary content). Feedback was clear: people came for a tool and the chrome got in the way."
- Screenshot: `scratchpad/game-ui/anime/uma-guide-uidesign.png`

### 23. Bryson's Game Design, "Game Analysis: Project Sekai" (2023-02-17)
- URL: https://brysonsgamedesignblog.wordpress.com/2023/02/17/game-analysis-project-sekai/
- Game-design analysis of the rhythm loop, not the UI. Low relevance to the visual brief.
- Screenshot: `scratchpad/game-ui/anime/sekai-bryson-analysis.png`

## Transferable to a desktop companion

1. **One accent per character, no sub-colours.** Sutou and the CEDEC notes say P5 kept one red and used sub-colours only in HP/MP, so the colour stayed the identity (Siliconera, entry 2; PersonaCentral 2016, entry 3). For YUI, give each character one accent that tints bubbles, the pet's outline and the settings card. Keep status colours out of that accent. Source: `scratchpad/game-ui/anime/p5-siliconera-cedec.png` and `p5-personacentral-interview.png`.

2. **Torn, tilted notice cards with hard offset shadows and no rounded corners.** The proactive notice or chat bubble can use a sawtooth or angled edge and a hard black drop shadow, the way P5 does for its menu panels (Curio, entry 1). Keep text readable at small sizes. Source: `scratchpad/game-ui/anime/p5-curio-guide.png`.

3. **Pre-render menus so they open with no lag.** Sutou: "it will pop up without any lag whatsoever." For the right-click menu, keep its entries in memory and animate each entry in on open. Do not wait on an async load. Source: `p5-personacentral-interview.png`.

4. **Diagonal slash-in transitions instead of fades.** Curio describes transitions that "slash in on the diagonal" and do not fade. A YUI notice could enter on a short angled wipe, with the same timing for close. Source: `p5-curio-guide.png` (text, entry 1).

5. **Character art bleeding into a blurred key-art backdrop for the settings window.** The Metaphor fan menu cuts the character into an ink-splatter field over a blurred, desaturated key image, with labels on top (entry 10). For the settings window, use the character's portrait as a blurred backdrop, with the form on a clean card. Source: `scratchpad/game-ui/anime/mr-behance-menus-fanmade.png`.

6. **Utility first; character flavour only on the showcase surface.** Umaguide's rule is that the game chrome is "a deliberate accent, never the default" (entry 22). Apply this to YUI: the pet and its bubbles get the full style, while settings, the Proactive list and logs stay plain. Source: `scratchpad/game-ui/anime/uma-guide-uidesign.png`.

7. **Named loadouts swapped in one step.** Chelsea Mai's Smart Equip replaces one-by-one edits with saved sets, with a stated 82% speed gain (entry 12). For YUI, save named character presets (persona, voice, accent) that switch in one click from the pet's right-click menu. Source: `scratchpad/game-ui/anime/hsr-chelseamai.png`.

8. **Place frequent actions in reach-zones around the pet.** eyween's HSR analysis puts map, chat, attacks and team swaps in the zones a thumb reaches (entry 13). On the desktop, put quick actions (talk, mute, dismiss) on the edge of the pet nearest the cursor, and keep them away from the centre where the character is. Source: `scratchpad/game-ui/anime/hsr-eyween-case-study.png`.

## Caveats

- Most Behance and Dribbble captures show covers, not project modules. Treat them as pointers, not as evidence of layout.
- The Siliconera, PersonaCentral and Curio pages are secondary summaries of the CEDEC 2017 talk and the 2016 Famitsu interview. The quotes are translated, not verified against the original Japanese.
- The Medium piece is member-only; only its intro was readable.
- No Hoyoverse, Kuro or Nexon developer source was found; all HoYoverse and Kuro material here is fan or third-party analysis.
