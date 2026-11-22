# Otaku / anime / VTuber / desktop-companion UI research

Scope: how companion, VTuber, and anime-game products present settings, menus, character controls, chat/speech, and notifications. Only what the cited pages show. Items marked **unverified** or **search snippet only** were not read on a primary page.

Legend: **[F]** = fetched and read on the page; **[S]** = search-result snippet only; **[U]** = unverified / not covered.

---

## 1. Desktop companions

### Mate Engine (open source, Unity, shinyflvre)
- Settings menu opens by right-clicking the avatar or pressing `M`. [F] https://github.com/shinyflvre/Mate-Engine
- Lists "Menu Customizations", "Debugging Menu", "System Icon Settings", "Idle Animation", "Dragging Animation", "Smooth Anim Transitions" ("smoother animation transitions than Desktop Mate"), "Window Sitting", "Taskbar Sitting", "Always On Top Toggle", "Big Screen Mode", "Sleep", "Custom VRM", "Custom Shaders", bloom and AO post-processing. [F] same URL
- Menu theme customization is described in the Chinese and Japanese sections; the Japanese section lists it as a future update. [F] same URL (inconsistent across languages)
- The README is internally inconsistent on AI features (supported in English table, unsupported in JP/ZH tables). [F] same URL. Do not cite AI-feature status from it.
- Steam listing: https://store.steampowered.com/app/3625270/MateEngine/ [S]

### Desktop Mate (infiniteloop, Steam, free)
- Characters "sit on your windows" (drag onto a window to perch), chase and play with the cursor, speak voice lines for clicks and head pats, and "tuck away at the edge of your screen" when not in use. [F] https://store.steampowered.com/app/3301060/Desktop_Mate/
- Built-in alarm: characters notify when it fires. [F] same URL
- Character pair actions (two characters sync movements). [F] same URL
- The store page says little about menus or UI chrome; customization is mainly character and DLC selection. [F] same URL

### Bongo Cat (Steam)
- Settings are grouped into categories; disabling "Bobbing" switches to on-demand rendering to save GPU. [S] https://steamdb.info/patchnotes/19552574
- Gaming Mode locks the overlay and disables interactions; F4 exits it. Settings are reached from a menu screen. [S] https://bo3.gg/games/articles/how-to-exit-gaming-mode-in-bongo-cat
- Steam listing: https://store.steampowered.com/app/3419430/Bongo_Cat/ [S]

### Shimeji-ee and forks
- Right-click the tray icon for general options; right-click an individual shimeji for per-character options. [S] Fork READMEs surfaced by search, e.g. https://github.com/chaoskagami/shimeji-ee. The canonical README was not read. Treat as **[U]** for the original project.

### Not researched
- VPet-Simulator, Ai Kanojo / desktop-girlfriend apps, Live2DViewerEX desktop pets: **[U] not covered**.

---

## 2. AI companion apps with characters

### Project AIRI (moeru-ai, MIT)
- Two frontends: Stage Web (browser) and Stage Tamagotchi (desktop, `pnpm dev:tamagotchi`). [F] https://github.com/moeru-ai/airi
- README states UI style "was inspired by games such as Cookard and UNBEATABLE"; Reka UI for the docs site and landing page; animation via web technologies. [F] same URL
- README does not describe theming. [F] same URL
- Avatar support: VRM and Live2D with auto blink, auto look-at, idle eye movement. [F] same URL
- Product Hunt post says the UI was still in progress. [S] https://www.producthunt.com/posts/airi

### Open-LLM-VTuber
- Desktop client switches between window mode and pet mode. Pet mode: transparent background, global top-most, mouse click-through, drag the companion anywhere. [F] https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- Other listed features: "Display of the AI's inner thoughts", proactive speaking, Live2D expressions via emotion mapping, camera/screen perception. [F] same URL
- v1.2.0 notes: a "Click-through" toggle added for Desktop Pet mode, and a fix for abnormal click-through. [S] https://newreleases.io/project/github/Open-LLM-VTuber/Open-LLM-VTuber/release/1.2.0

### Grok companions (Ani, Bad Rudy)
- Companion settings via a gear icon in the app. A relationship/intimacy meter appears on the right side of the screen and rises with chat and gifts. Reports disagree on unlock thresholds. [S] https://www.testingcatalog.com/grok-debuts-interactive-ai-companions-on-ios-with-anime-avatars/ and https://www.tomsguide.com/ai/i-tried-groks-new-companion-feature-and-ive-never-felt-so-uncomfortable
- One outlet calls the system similar to dating sims; a German report notes the levels are never explained. [S] same sources
- Anti-reference value: this is the closest thing to a game HUD meter in the companion space. [S]

### Not researched
- Replika, Character.AI, Nomi, Kindroid: **[U] not covered**.

---

## 3. VTuber tooling

### VTube Studio (DenchiSoft)
- Settings open from a gear icon; several tabs; a help icon links to the manual; language change requires restart. [F] https://github.com/DenchiSoft/VTubeStudio/wiki/VTube-Studio-Settings
- Settings groups: Misc (hide logo, remember scene, mouse input range), Voice lipsync, Camera (AR/webcam, tracking-lost behaviour, sliders, calibrate button), Quality/effects, Record Screen (small red dot). [F] same URL
- Page does not describe colours, themes, or notifications. [F] same URL
- Hotkeys: keyboard (up to two-key combos) or on-screen buttons; up to 8 on-screen buttons on the main screen. [S] https://github.com/DenchiSoft/VTubeStudio/wiki (hotkey pages surfaced by search)
- Official site: props, VFX, microphone lipsync. [S] https://www.denchisoft.com

### Warudo, VNyan, VSeeFace
- No official UI screenshots or settings descriptions were read. VSeeFace has a UI-hiding control for clean transparent backgrounds; Warudo docs reference OpenSeeFace. [S] https://docs.warudo.app/docs/mocap/openseeface and an unofficial PRISM guide.
- **[U] UI layout for Warudo, VNyan, VSeeFace not established.**

---

## 4. Anime game UIs

### Persona 5 / Atlus (CEDEC 2017 talk, via press coverage)
- One main colour per game; P5's red kept dominant by dropping sub-colours except HP/MP. [F] https://www.siliconera.com/?p=668266
- Central lines guide the eye; relevant information sits on the same side as the mostly white elements. [F] same URL
- Menus used a 3D model that spins and ends in a pose, driven by a custom tool: layout built in Photoshop, a motion designer captured a pose, and the tool rendered 2D frames. [F] same URL
- Separate designers for menu and battle UI. [F] same URL
- Atlus says it wants UI with "a sense of playfulness and entertainment value." [F] same URL
- Director Hashino: each menu page gets a unique design yet must stay "simple, practical and usable"; designing stylish menus is "actually really annoying." [S] https://www.pcgamer.com/games/rpg/persona-series-director-says-atluss-flashy-menus-are-actually-really-annoying-to-design (pushsquare.com returned 403 on fetch)
- No frame counts or durations found in the coverage. **[U] timing numbers.**

### Zenless Zone Zero / HoYoverse
- HoYoverse published a menu guide covering the Main Menu, Exploration Screen, and HDD screen. [S] https://www.sportskeeda.com/esports/zenless-zone-zero-fairy-library-menu-screens-explained
- Creator notes say UI design received attention alongside scenes. [S] https://www.hoyolab.com/article/27972591
- Producer interview mentions the animation and UI teams as close collaborators. [S] https://news.denfaminicogamer.jp/interview/250819z
- **[U] menu animation, button feedback, toast styles, typography: not read on a primary source.**

### Blue Archive / Nexon
- PC release added customisable keybinds and resolution settings. [S] https://www.siliconera.com/?p=1100148
- UI concept: the smartphone UI is the "Sensei's" screen. [S] https://www.invenglobal.com/articles/22852/kim-yong-ha-kim-ji-hoon-life-is-ultimately-a-gachayou-just-have-to-keep-pulling
- **[U] settings layout, transitions, and feedback not established.**

### Honkai: Star Rail, Genshin Impact, Arknights
- **[U] not researched.**

---

## 5. Visual novel conventions (Ren'Py)

Source: https://www.renpy.org/doc/html/gui.html [F]

- **Name plate (namebox):** a framed image background, shown only when the speaker has a name. Name colour comes from the accent by default, overridable per character with `who_color`. Position via `gui.name_xpos`, `gui.name_ypos`, `gui.name_xalign`.
- **Dialogue window (textbox):** image background; text in the central 60% of the screen; bottom-anchored with `gui.textbox_yalign`.
- **Choice menu:** separate idle and hover background images, text colours `gui.choice_button_text_idle_color` / `..._hover_color`.
- **Click-to-continue (CTC) cue:** `ctc_appear` starts at alpha 0.0, waits `pause 5.0`, then `linear 0.5 alpha 1.0`. Docs advise delaying CTC by several seconds so images can load. [F] same URL

Text speed and typewriter settings are not covered on that page. **[U]**

---

## 6. Patterns, mapped to anti-references

Anti-references: no SaaS chatbot widget, no messenger chat list, no pushy mascot bubbles; character is protagonist; UI recedes at rest and warms when present; respects reduced motion; legible over any desktop.

| # | Pattern | Source | Fits the anti-references? |
|---|---|---|---|
| A | One signature colour per product, with sub-colours removed (P5 red) | Persona 5 [F] | Yes, if the amber stays the only accent |
| B | Name plate as a framed object, name coloured per character | Ren'Py [F] | Yes for speech bubble, if it reads as a sticker, not a chat header |
| C | Hover/focus swaps a background image, not only colour | Ren'Py [F] | Yes; a state change, not motion |
| D | Delayed, slow fade-in for a "continue" cue (5 s pause, 0.5 s fade) | Ren'Py [F] | Yes, and it respects a quiet UI |
| E | Character tucks away at screen edge when idle; perches on windows | Desktop Mate [F] | Yes; UI recedes at rest |
| F | Right-click or `M` opens the menu on the character | Mate Engine [F] | Yes, matches the quick card entry |
| G | Settings in tabs with a help link and a "restart required" note | VTube Studio [F] | Partly; a plain utility pattern |
| H | Up to 8 hotkey buttons on the main screen | VTube Studio [S] | Partly; can drift into a control HUD |
| I | Click-through toggle for pet mode | Open-LLM-VTuber [S] | Yes; a settings switch |
| J | Relationship/intimacy meter on screen | Grok companions [S] | **No**; this is game HUD |
| K | Cursor chasing and head-pat reactions | Desktop Mate [F] | **Pushy**; not for YUI |
| L | Settings grouped into categories; on-demand rendering when bobbing is off | Bongo Cat [S] | Yes; performance-aware |

---

## 7. Top 8 patterns to prototype (ranked)

1. **Signature accent with sub-colours removed (A).** Why: it is the single biggest lever for "prettier" without adding chrome. Where: settings rail active state, quick card, speech bubble name. Risk: amber could read as a warning colour in some states. Keep it to one hue family.
2. **Recede-at-rest, warm-when-present (E).** Why: a direct match for the anti-reference. Where: quick card and speech bubble fade in and out with the character's state. Risk: an idle character that hides too much feels broken.
3. **Framed name plate with per-character colour (B).** Why: makes the speech bubble feel like it belongs to the character. Where: speech bubble on the stage. Risk: looks like a chat header if overdone.
4. **Hover and focus as image or fill swap (C).** Why: crisp feedback without motion, good on the settings segments and selects. Where: settings segments and the quick card buttons. Risk: needs new assets or a consistent fill token.
5. **Slow delayed "continue" cue (D).** Why: a calm, character-driven prompt for speech progression. Where: speech bubble when a line is complete. Risk: long delays feel like lag; keep the wait short and skip under reduced motion.
6. **Right-click or hotkey on the character opens the menu (F).** Why: the most common desktop-pet convention. Where: quick card entry from the character. Risk: conflicts with the OS context menu on some platforms.
7. **Settings tabs with a help link and a restart note (G).** Why: it fits the rail structure without adding decoration. Where: settings window. Risk: low; a plain utility pattern.
8. **Performance toggle paired with an animation toggle (L).** Why: a clean path for "prettier" that still respects low-power machines. Where: settings, under an animation group. Risk: adds a setting that must be tested with reduced motion.

Excluded for YUI: J (relationship meter) and K (cursor chase).

---

## 8. Gaps

- Not covered: VPet, Ai Kanojo-type apps, Live2DViewerEX, Replika, Character.AI, Nomi, Kindroid, Honkai: Star Rail, Genshin, Arknights, Warudo/VNyan layouts. All **[U]**.
- Persona 5 timing figures and the Push Square Metaphor interview were not read (403, snippet only).
- Blue Archive and ZZZ menu motion are **[U]**; no primary UI-specific source was fetched.
- Mate Engine's AI-feature support is contradictory across its own README languages; not used.
