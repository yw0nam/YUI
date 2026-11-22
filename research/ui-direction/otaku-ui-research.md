# Otaku / anime / VTuber / desktop-companion UI research

Scope: how companion, VTuber, and anime-game products present settings, menus, character controls, chat/speech, and notifications. Only what the cited pages show.

Legend: **[F]** = read on the page (WebFetch or ego-browser text/screenshot). Where a claim comes from a screenshot or video it says so. **[S]** = search-result snippet only, not opened. **[U]** = unverified / page failed or was gated.

Revision 2 (ego-browser pass): re-checked the anime game sites, companion and VTuber sites, Persona 5 interviews, and Desktop Mate. Corrections are marked **(corrected)**.

---

## 1. Desktop companions

### Mate Engine (open source, Unity, shinyflvre) [F]
- Settings menu opens by right-clicking the avatar or pressing `M`. https://github.com/shinyflvre/Mate-Engine
- README lists "Menu Customizations", "System Icon Settings", "Idle Animation", "Dragging Animation", "Smooth Anim Transitions" ("smoother animation transitions than Desktop Mate"), "Window Sitting", "Taskbar Sitting", "Always On Top Toggle", "Big Screen Mode", "Sleep", "Custom VRM", "Custom Shaders", bloom and AO. Same URL.
- Menu theme customization is described in the Chinese and Japanese sections; the Japanese section marks it as a future update. Same URL.
- README contradicts itself on AI features across language tables. Do not cite AI-feature status from it.
- Steam listing https://store.steampowered.com/app/3625270/MateEngine/ [S], not opened.

### Desktop Mate (infiniteloop, Steam) [F]
- Store copy: "A little more joy on your desktop, every day. Always with the characters you love—they sit on your windows, play with your mouse cursor, and respond to head pats. Featuring a built-in alarm and in-game sync." https://store.steampowered.com/app/3301060/Desktop_Mate/
- Store page (read via browser): Free to Play, tags Anime, Cute, Utilities, Animation & Modeling. Release date 8 Jan 2025 **(corrected: earlier I cited 7 Jan from an aggregator)**. Developer and publisher infiniteloop. English reviews "Mixed (5,406)" **(corrected: earlier 5,205)**; recent reviews "Mostly Positive (116)".
- Screenshot of the store header (same URL): a pale-blue capsule with anime characters in front of a monitor logo, plus a "Here comes a new challenger!" DLC promo for fighting-game characters. The screenshot shows a flat, bright, pastel-blue look with a clean Steam chrome around it.
- Characters "tuck away at the edge of your screen" when not in use (store text, earlier fetch). Same URL.

### Bongo Cat (Steam) [S]
- Settings grouped into categories; disabling "Bobbing" switches to on-demand rendering. https://steamdb.info/patchnotes/19552574
- Gaming Mode locks the overlay; F4 exits. https://bo3.gg/games/articles/how-to-exit-gaming-mode-in-bongo-cat
- Steam listing https://store.steampowered.com/app/3419430/Bongo_Cat/ [S], not opened.

### VPet-Simulator (LorisYounger, GitHub) [F]
- README (Chinese, English variant exists): "32(种) * 4(状态) * 3(类型)" animations, with the note that some types have no sick or loop states, so the real count is lower. https://github.com/LorisYounger/VPet/blob/main/README.md
- Describes itself as an open-source desktop pet that can be embedded in any WPF app, with a Steam (free) build and Steam Workshop support. Same URL.
- Repo page shows 7.3k stars and 715 forks (screenshot/text of repo page). https://github.com/LorisYounger/VPet
- Settings UI and visuals **[U]**: README text was read, but no settings screenshot was viewed.

### Shimeji-ee and forks [S]
- Right-click the tray icon for general options; right-click an individual shimeji for per-character options. Fork READMEs surfaced by search, e.g. https://github.com/chaoskagami/shimeji-ee. The original README was not read. **[U] for original project.**

### Not researched
- Ai Kanojo / desktop-girlfriend apps and Live2DViewerEX desktop pets: **[U] not covered**.

---

## 2. AI companion apps with characters

### Project AIRI (moeru-ai, MIT) [F]
- Two frontends: Stage Web (browser) and Stage Tamagotchi (desktop). https://github.com/moeru-ai/airi
- README: UI style "was inspired by games such as Cookard and UNBEATABLE"; Reka UI for docs site; animation via web tech. Same URL.
- Avatars: VRM and Live2D, auto blink, auto look-at, idle eye movement. Same URL.
- Theming not described in README. Same URL.
- Product Hunt says UI still in progress: https://www.producthunt.com/posts/airi [S].

### Open-LLM-VTuber [F]
- Window mode and pet mode; pet mode has transparent background, global top-most, mouse click-through, drag anywhere. https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- Other features: display of inner thoughts, proactive speaking, Live2D expressions via emotion mapping. Same URL.
- v1.2.0 notes: "Click-through" toggle for Desktop Pet mode and a click-through bug fix. https://newreleases.io/project/github/Open-LLM-VTuber/Open-LLM-VTuber/release/1.2.0 [S].

### Grok companions (Ani, Bad Rudy) [S]
- Companion toggle via gear icon. An intimacy meter appears on the right side of the screen and rises with chat and gifts. Reports disagree on unlock thresholds. https://www.testingcatalog.com/grok-debuts-interactive-ai-companions-on-ios-with-anime-avatars/ and https://www.tomsguide.com/ai/i-tried-groks-new-companion-feature-and-ive-never-felt-so-uncomfortable
- App is iOS-gated for the reported version; not opened. **[U] for current design.**
- Anti-reference value: closest to a game HUD meter.

### Replika [F] (screenshot of replika.com)
- Hero: full-bleed sky-blue cloud gradient; large bold white sans headline "The AI friend to do life with"; coral/orange pill CTA "Get the app". https://replika.com/
- A rounded glass card holds a 3D character; a white rounded chat bubble ("this song for your walk home tonight. trust me.") floats over the card's top-right corner; a tilted Spotify album card overlaps the bottom-left. The composition is a sticker-like collage of chat bubble and music card. Screenshot-based description.
- Site claims 42,160,934 users worldwide (marketing claim, unverified).
- In-app UI **[U]**: not reached.

### Character.AI [F, gated]
- Sign-up wall only: "Sign Up to Chat", Google/Apple/email options. https://character.ai/
- No UI visible without sign-in. **[U] for in-app design.** Do not sign in.

### Nomi [F] (screenshot)
- Full-page deep-violet gradient over a faint grid of character portraits. Large white geometric sans headline "An AI Companion with Memory and a Soul". Outlined white rounded-rectangle buttons; "Start Chatting" button in lavender with violet text. https://nomi.ai/
- In-app UI **[U]**.

### Kindroid [F] (screenshot)
- Warm off-white background, bold grotesk headline "Meet Your Kindroid" right-aligned, tall rounded photo card with a small caption bubble "I missed you..." and a picture-in-picture video tile in the bottom-right. Coral pill "Sign up" button. https://kindroid.ai/
- Page text lists "By text", "By voice", "live video calls", with a call timer "LIVE 00:18". Screenshot-based description.
- In-app UI **[U]**.

---

## 3. VTuber tooling

### VTube Studio (DenchiSoft) [F for settings wiki, S for hotkeys]
- Settings open from a gear icon; several tabs; help icon links to manual; language change needs restart. https://github.com/DenchiSoft/VTubeStudio/wiki/VTube-Studio-Settings
- Groups: Misc (hide logo, remember scene, mouse input range), Voice lipsync, Camera (AR/webcam, tracking-lost behaviour, sliders, calibrate), Quality/effects, Record Screen. Same URL.
- No colour, theme, or notification description on the page. Same URL.
- Hotkeys: keyboard (up to two-key combos) or on-screen buttons; up to 8 on-screen buttons on the main screen. [S] https://github.com/DenchiSoft/VTubeStudio/wiki (hotkey pages from search)

### Warudo [F] (docs homepage screenshot)
- Handbook is a dark navy topbar with a left nav tree (Tutorials, Motion Capture, etc.), a light-on-dark theme, and a moon/sun toggle. https://docs.warudo.app/
- Marketing copy: "posing your character with 500+ idle animations", "node-based visual scripting system", Mod SDK, C# scripting SDK. Same URL.
- Screenshot: anime avatar banner strip with diagonal slices across the header. Screenshot-based description.
- In-app settings UI **[U]**: docs page does not show it.

### VNyan [F] (wiki home)
- Text: "Its easy-to-use Node Graph interface allows you to design anything from simple chat interactions to immersive 3D world interactions." Built-in Twitch, YouTube, Pulsoid integration. https://github.com/Suvidriel/VNyanDoc/wiki/Home
- Community wiki, disclaimed as possibly incomplete. Same URL.
- App UI screenshots **[U]**.

### VSeeFace [F for nav only]
- Official site nav: Manual, Virtual camera, Transparency, Tracking/Webcam, Troubleshooting. https://www.vseeface.icu/ (manual anchor https://www.vseeface.icu/#manual)
- The guessed `manual.html` URL returned 404; the manual is an in-page section. Settings screenshots **[U]** — not reached.

---

## 4. Anime game UIs

Screenshot-based observations are from the official homepage screenshots. Text-based observations are from the page text. Neither covers in-game menus; no in-game capture was taken.

### Honkai: Star Rail (hsr.hoyoverse.com) [F, screenshot + text]
- Full-bleed key art of the new 5-star character on a deep navy-purple cosmic background. https://hsr.hoyoverse.com/en-us/
- Serif display title in cream/red script "Now, Lay Laughter to All Stars" with a version badge "V4.7 is Now Open" and a small circular stopwatch icon. Gold and purple ornamental frames around the buttons "Other Downloads" and "Download via HoYoPlay".
- Shape language: ornate, rounded, jewel-like frames; purple/gold accent.
- Animation: **[U]** (static screenshot only).

### Genshin Impact (genshin.hoyoverse.com) [F, screenshot + text]
- Icon row at top right: globe, share, Redeem Codes (with an alert pip), Top-Up Bonus (gold ribbon with gift icon), Official Site (blue ribbon). https://genshin.hoyoverse.com/en/
- Blue-white winter palette with a centred star-burst and key art across the whole width; a "PC Download" button with a purple ornamental frame.
- Shape language: ribbon and banner-shaped tabs; gift badge as a sticker-like element.
- Animation: **[U]**.

### Zenless Zone Zero (zenless.hoyoverse.com) [F, loading screen]
- The page was still loading; its loading screen showed the screenshot below.
- Loading screen: very large condensed bold blue sans "LOADING" across the centre, a chibi character overlapping it, a red progress bar with a blue star-shaped marker at the head and a percentage ("98%") at the right end. Dark navy background with a halftone texture and faint city silhouettes at the bottom. https://zenless.hoyoverse.com/en-us/
- Shape language: sharp, comic-ink, halftone; flat cel-shading; red-and-blue accent.
- Its menu guide (main menu, exploration screen, HDD) is from a search snippet **[S]**: https://www.sportskeeda.com/esports/zenless-zone-zero-fairy-library-menu-screens-explained
- Menu animation, button feedback: **[U]**.

### Arknights (arknights.global) [F, screenshot + text]
- Top nav in uppercase condensed sans (HOME, CHARACTER, NEWS, DISCOVER, GAMEPLAY, COMIC, GALLERY), with a "GIFT CODE" pill button and a music-note toggle. https://arknights.global/
- Full-bleed grayscale cinematic PV: a silhouetted character in a foggy white hall. A "PV 001 / 002" pager sits bottom-right; a "SCROLL" cue bottom-centre; social icons down the right edge.
- Shape language: sharp, rectangular, monochrome; the wordmark is a thin, high-contrast serif-like logotype.
- Motion: **[U]** (static screenshot only; PV is video).

### Blue Archive (bluearchive.nexon.com) [F, screenshot + text]
- Page is served in Korean in this session. Text includes event copy and a login prompt. https://bluearchive.nexon.com/
- Screenshot: warm brown, wood-panelled office interior as background; a small dark-glass tab at top-left with a chevron arrow; X, YouTube, and a "공식 커뮤니티 바로가기" (official community) pill at top-right; a centred event banner with a login-gated input.
- Shape language: rounded dark-glass pills and soft rectangles, a restrained warm palette.
- Animation and in-game settings: **[U]**.

### Persona 5 / Metaphor: ReFantazio [F, press quotes]
- Hashino (via The Verge, quoted in Kotaku): "we try to keep things simple, practical, and usable. But maybe the reason that we've achieved both [functionality and beauty] is that we have unique designs that we make for each and every menu. This is actually really annoying to do." https://kotaku.com/-metaphor-refantazio-persona-5-menu-ui-hashino-1851667088
- "Whether it's the shop menu or the main menu, when you open them up there's a whole separate program running and a separate design that goes into making it." Same URL.
- Kotaku: Persona 5 text had "angular black, red, and white" styling and needed iteration and refinement to stay readable. Same URL.
- PC Gamer describes Atlus menus at "off-kilter angles" that "tumble onto the screen as a collage of disparate elements". https://www.pcgamer.com/games/rpg/persona-series-director-says-atluss-flashy-menus-are-actually-really-annoying-to-design
- CEDEC 2017 (Siliconera, [F] earlier): one main colour per game (P3 blue, P4 yellow, P5 red, Catherine pink); P5 drops sub-colours except HP/MP; central lines guide the eye; information sits on the same side as the white elements; menus use a spun 3D model captured to 2D. https://www.siliconera.com/?p=668266
- Timing numbers: **[U]**. None in these sources.
- Note: Kotaku's core article is about Metaphor: ReFantazio; the Persona 5 quotes are secondary context.

### Blue Archive / ZZZ / HSR menu motion, typography, notifications
- **[U]**: not observable from homepages. Would need in-game video or a Japanese developer interview (Denfaminicogamer, [S] only: https://news.denfaminicogamer.jp/interview/250819z).

---

## 5. Visual novel conventions (Ren'Py)

Source: https://www.renpy.org/doc/html/gui.html [F, earlier]

- **Name plate (namebox):** framed image background, shown only when speaker has a name. Colour from accent by default, per-character override via `who_color`. `gui.name_xpos`, `gui.name_ypos`, `gui.name_xalign`.
- **Dialogue window (textbox):** image background; text in central 60% of screen; `gui.textbox_yalign`.
- **Choice menu:** separate idle and hover background images; `gui.choice_button_text_idle_color` / `..._hover_color`.
- **Click-to-continue (CTC):** `ctc_appear` starts at alpha 0.0, `pause 5.0`, then `linear 0.5 alpha 1.0`. Docs advise delaying CTC so images can load.
- Text speed and typewriter settings: **[U]** (not on this page).

---

## 6. Patterns, mapped to anti-references

Anti-references: no SaaS chatbot widget, no messenger chat list, no pushy mascot bubbles; character is protagonist; UI recedes at rest and warms when present; respects reduced motion; legible over any desktop.

| # | Pattern | Source | Fits anti-references? |
|---|---|---|---|
| A | One signature colour per product, sub-colours removed (P5 red; HSR purple/gold; Genshin blue; ZZZ red/blue; Arknights monochrome) | Persona 5 [F]; HSR, Genshin, ZZZ, Arknights screenshots [F] | Yes, if amber stays the only accent |
| B | Name plate as framed object, name coloured per character | Ren'Py [F] | Yes for speech bubble, as a sticker not a chat header |
| C | Hover/focus swaps a background image, not only colour | Ren'Py [F] | Yes; a state change, not motion |
| D | Delayed, slow fade-in for a "continue" cue (5 s pause, 0.5 s fade) | Ren'Py [F] | Yes, and quiet |
| E | Character tucks away at screen edge when idle; perches on windows | Desktop Mate [F] | Yes; UI recedes at rest |
| F | Right-click or `M` opens the menu on the character | Mate Engine [F] | Yes, matches quick card entry |
| G | Settings in tabs with help link and "restart required" note | VTube Studio [F] | Partly; plain utility pattern |
| H | Up to 8 hotkey buttons on the main screen | VTube Studio [S] | Partly; can drift into a control HUD |
| I | Click-through toggle for pet mode | Open-LLM-VTuber [S] | Yes; a settings switch |
| J | Relationship/intimacy meter on screen | Grok companions [S] | **No**; game HUD |
| K | Cursor chasing and head-pat reactions | Desktop Mate [F] | **Pushy**; not for YUI |
| L | Settings grouped into categories; on-demand rendering when bobbing is off | Bongo Cat [S] | Yes; performance-aware |
| M | Floating chat bubble over a character card, with a secondary "now playing" card | Replika [F, screenshot] | Partly; the bubble is close to YUI's speech bubble, but Replika's collage is a companion-app layout, so keep it single and small |
| N | Bespoke, angled, collage-style menus per screen | Persona 5 / Metaphor [F] | **No** for YUI; Atlus itself says it is "really annoying" to make and reads poorly without iteration |
| O | Loading screen with a character on a progress bar and a red-blue accent | ZZZ [F, screenshot] | Partly; YUI has no long loads, so low value |

---

## 7. Top 8 patterns to prototype (ranked, revised)

Changes from revision 1: #1 is now backed by four more games' screenshots. #3 gets a Replika/Kindroid precedent and a stated risk. Persona-style angled menus (N) are added to the excluded list.

1. **Signature accent, sub-colours removed (A).** Why: strongest evidence across five games and Persona 5 with concrete numbers (one hue, others dropped). Where: settings rail active state, quick card, speech bubble name. Risk: amber could read as a warning colour in some states; keep to one hue family.
2. **Recede-at-rest, warm-when-present (E).** Why: directly matches the anti-reference; Desktop Mate's edge-tucking is verified on its store page. Where: quick card and speech bubble fade with character state. Risk: an idle character that hides too much looks broken.
3. **Framed name plate with per-character colour (B), with a floating bubble precedent (M).** Why: Ren'Py's namebox plus Replika/Kindroid's floating caption bubbles support the speech bubble idea. Where: speech bubble on the stage. Risk: looks like a messenger chat header if it grows; keep it one bubble, no history.
4. **Hover and focus as image or fill swap (C).** Why: crisp feedback without motion; Ren'Py's hover image is documented. Where: settings segments, quick card buttons. Risk: needs new assets or a consistent fill token.
5. **Slow delayed "continue" cue (D).** Why: a calm, character-driven prompt for speech progression. Where: speech bubble when a line completes. Risk: long waits feel like lag; keep it short and skip under reduced motion.
6. **Right-click or hotkey on the character opens the menu (F).** Why: most common desktop-pet convention; Mate Engine documents it. Where: quick card entry. Risk: conflicts with the OS context menu on some platforms.
7. **Settings tabs with help link and restart note (G).** Why: fits the rail without decoration; VTube Studio's wiki documents it. Where: settings window. Risk: low.
8. **Performance toggle paired with animation group (L).** Why: a clean path to "prettier" that respects low-power machines. Where: settings, under animation. Risk: adds a setting that must be tested with reduced motion. Evidence still only [S] (Bongo Cat).

Excluded for YUI: J (relationship meter), K (cursor chase), N (bespoke angled collage menus).

---

## 8. Still unverified

- Grok companion in-app UI (gated / iOS): [S] only.
- Character.AI, Nomi, Kindroid, Replika in-app UI: homepage or sign-up only; no in-app screens viewed. Did not sign in.
- Warudo, VNyan, VSeeFace app UI and settings screenshots: docs and wiki text read, but no app-UI screenshot.
- VPet settings UI: README text read, no settings screenshot.
- ZZZ, Blue Archive, HSR, Genshin, Arknights in-game menus, transitions, notifications, timings: not reachable from public homepages; only homepage screenshots (static) and the loading screen. Video (PVs, trailers) not watched.
- Persona 5 timing numbers and CEDEC slides: not in the sources read.
- Shimeji-ee original README, Bongo Cat and Mate Engine Steam pages, VTube Studio hotkey pages: [S] only, not opened in this pass.
- Ren'Py text speed and typewriter settings: not on the gui page.
