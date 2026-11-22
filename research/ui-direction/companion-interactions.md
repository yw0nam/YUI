# Creative character-anchored interaction: reference scan for YUI

Scope: how otaku, companion, game and AI products place menus, status and proactive behavior around a character. Read-only browsing on 2026-11-22 via ego-browser (TaskSpace 20, closed after use). No sign-in, forms or state-changing actions.

Legend: items marked **[opened]** were loaded and the quoted text was read in-session. Items marked **[U]** were not opened or the visual claim was not verified; they are leads only. No screenshots were inspected, so visual details (glow colour, animation) are not claimed unless the source text states them.

---

## 1. Radial, ring and pie menus

**VRChat Action Menu** [opened] https://docs.vrchat.com/docs/action-menu
- Controller: hold the Menu button to open the Action Menu, which is a radial menu. Keyboard/mouse equivalent is described on the same page.
- Two selection methods: "Flick" (push the stick toward the slice) and a second method described on the page. Clicking the joystick (or pressing R on keyboard) closes the menu but remembers position; a Back slice moves up one breadcrumb level.
- Root menu contains Gesture Toggle, Config, Emojis, Expression Menu and Close. Sub-menus (Expression, Puppet) are nested radial menus. Item count per ring is kept small by folders.
- Relevance: a proven pattern for a root ring with nested folders, and "close but remember where I was".

**Blender pie menus** [U] Blender manual index for UI controls was opened [opened] https://docs.blender.org/manual/en/latest/interface/controls/index.html but the pie-menu page was not located (the guessed URLs returned 404). Known from prior knowledge, not verified here: pie menus open at the cursor on a key hold, select by direction, and have up to 8 slices plus a centre.

**Not opened (leads only):**
- Genshin Impact gadget wheel [U] https://genshin.hoyoverse.com/en/ was opened but the home page had no gadget text.
- The Sims pie menu on a Sim [U] https://www.ea.com/games/the-sims/the-sims-4 was opened; the page is a store/news page and did not describe the pie menu.
- GTA weapon wheel [U], Secret of Mana ring menu [U], Kingdom Hearts command menu [U] (https://kingdomhearts.com/ opened, no command-menu text), Persona 5 menus [U], Animal Crossing reaction wheel [U] (Nintendo store page opened, no reaction-wheel text).

---

## 2. Desktop pets, companions and VTuber tools

**Desktop Mate (Steam)** [opened] https://store.steampowered.com/app/3301060/Desktop_Mate/
- Store description: characters "sit on top of your windows"; drag a character onto a window and it sits on it; characters "react to your mouse cursor by chasing and playing with it"; click and head-pat voice lines; built-in alarm where the character announces it; multi-character mode.
- DLC list (Steam search) [opened] https://store.steampowered.com/search/?term=desktop+mate shows Zundamon, Kagamine Len, Miku, Kasane Teto and Mori Calliope character DLC, i.e. the character itself is the product unit.
- Relevance: the character is the thing to pick and customise, and an alarm delivered in her voice is a native "notice" pattern.

**Mate Engine** [opened] https://github.com/shinyflvre/Mate-Engine
- README: "Right-click the avatar or press M to open the settings menu." So the settings open from the character, not from a tray.
- Features list includes "Event-Based Messages: Generates cute messages when you drag the avatar, make it dance, or let it sit on windows or the taskbar", plus "Menu Customizations", "Custom VRM", "Window Sitting", "Taskbar Sitting", "Head Tracking", and "AI Chat".
- Relevance: right-click on the avatar opens settings; in-character speech bubbles fire from interaction events (YUI already has a bubble surface).

**Open-LLM-VTuber** [opened] https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- Feature list: desktop client switches between window mode and "desktop pet mode" with a transparent background; "Touch feedback, interact with your AI companion through..."; "Visual perception... camera, screen recording and screenshots"; "AI proactive speaking feature"; "Display AI's inner thoughts ... without them being spoken".
- Relevance: the same pair YUI needs (transparent pet + proactive speech) is shipped, and "inner thoughts shown but not spoken" is a direct precedent for a thought bubble.

**Project AIRI** [opened] https://github.com/moeru-ai/airi
- Repo describes itself as a "self-hosted... Grok Companion" with realtime voice, Minecraft and Factorio play; desktop client named tamagotchi (`pnpm dev:tamagotchi`). Recent commits mention "organize conversations by place and character". Visual UI of the pet was not inspected.
- Relevance: conversation grouped by character, a pattern for a per-character history view.

**VTube Studio** [opened, thin] https://denchisoft.com/ and [U] its in-app hotkey UI. Official site describes features only at a high level; no menu geometry was read.

**VPet-Simulator** [opened, store listing only] https://store.steampowered.com/search/?term=vpet lists "VPet-Simulator" (free). The UI around the pet was not read.

**Shimeji family** [search only] https://store.steampowered.com/search/?term=shimeji and https://github.com/search?q=shimeji-ee&type=repositories show many desktop-pet repos; no UI detail read. [U] for menu behaviour.

**Not opened:** Bongo Cat [U], Shimeji-ee project page [U], Friend pendant [U] (page opened but returned only "Meet your friend" text).

---

## 3. Proactive and ambient AI presence

**ChatGPT Voice** [opened] https://help.openai.com/en/articles/8400625-voice-mode-faq
- Help text describes "Live" mode: "making turn-taking and interruptions feel more natural", and "show visual results through supported widgets". The orb visual is not described in the help text, so no orb claim is made here.

**Apple Intelligence and Siri** [opened] https://www.apple.com/apple-intelligence/
- Page text: "Visual Intelligence ... Learn about what's in front of you and on your screen"; "Ask Siri about what's in front of you ... using the content on your screen"; Siri AI "Integrated into your apps, grounded in your context, and private at every step."
- The edge-glow animation the owner remembers is **not** described in the text read. [U] for the glow itself; check the page's video.

**Rabbit r1 / rabbit OS3** [opened] https://www.rabbit.tech
- Text: "remember something while you're out? press the button, say what needs doing, and put it in motion." Hardware-first, button-triggered. No ambient notice pattern described.

**Friend pendant** [opened, empty] https://www.friend.com
- Page text is only the header and footer (JS-rendered); nothing usable was read. [U]

**Humane AI Pin** [U] (not opened).

**Grok companions (Ani)** [opened, no companion text] https://x.ai/grok
- The page did not mention companions. Ani's affection UI is [U]; a search on the Grok app would be needed.

**Character.AI** [opened, sign-up wall] https://character.ai — only the "Get access to 10M+ Characters" sign-up copy is visible. No in-chat UI read.

**Replika** [opened] https://replika.com
- Text: "Your Rep holds all of it, so every conversation knows where you are in your life." Relationship and life-context framing. No notice UI read.

**Nomi** [opened] https://nomi.ai
- Text: "humanlike memory... a deep, consistent, and evolving relationship." No notice UI read.

**Sesame (Maya/Miles)** [opened] https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice
- Research post on conversational voice (Feb 27, 2025). Voice UI screens not read.

**Limitless** [partial] https://www.limitless.ai — load timed out with the document interactive; no text read.

**Rewind, Humane** [U].

**Pattern notes from the above:** the products that show an AI acting on its own do it through explicit controls (Open-LLM-VTuber's proactive toggle) or through a visible "inner thought" text channel rather than through interruptions. Documented text in these sources is weak on visuals, so the glow/orb/timeline patterns in the owner's brief remain [U] until screenshots are checked.

---

## 4. Character-centred settings and lobbies

**The Sims 4** [opened] https://www.ea.com/games/the-sims/the-sims-4
- Store/news page only. It names Create-a-Sim and Build/Buy item categories, with a "golden glow-up" for Elder Sims. The character-centred CAS screen is not described in text; [U] for the CAS layout.

**Blue Archive** [opened, thin] https://bluearchive.nexon.com/ — JS-rendered, no lobby text read. [U] for the centre-stage lobby.

**NIKKE** [failed] https://www.nikke-en.com/ — DNS failure (`ERR_NAME_NOT_RESOLVED`). [U]

**VRChat Action Menu** (see section 1) also shows settings nested under the character's own menu, a second character-anchored settings pattern.

**Genshin Impact, Kingdom Hearts, Animal Crossing** — homepages opened, no character-settings text. [U]

---

## Ideas for YUI

Each idea names the surface (character window, quick card, settings, bubble), the references, and risks. The owner should check each reference's visuals before adopting; only the text claims above are verified.

1. **Radial palette on right-click.** The user right-clicks the character; a ring of 5 to 6 slices blooms around her; a slice opens its settings window. Surface: character window (transparent overlay). References: VRChat Action Menu https://docs.vrchat.com/docs/action-menu (root ring, nested folders, close-and-remember); Mate Engine right-click settings https://github.com/shinyflvre/Mate-Engine. Risks: a transparent always-on-top window must hit-test only the ring and character, otherwise it blocks clicks behind it; the ring must be reachable by keyboard; reduced motion should replace the bloom with a fade.

2. **"What I noticed" ribbon.** A thin strip under or beside her that holds the last few things she noticed (screen context, a finished task), tap to expand. Surface: bubble or quick card. References: Open-LLM-VTuber "inner thoughts" text channel https://github.com/Open-LLM-VTuber/Open-LLM-VTuber; Apple Siri "what's on your screen" framing https://www.apple.com/apple-intelligence/. Risks: a log of observations can feel like surveillance; keep it short, user-clearable, and off by default for screen watching.

3. **Notice that slides from her, not a popup.** A small card leaves her shoulder with a line of speech and one action; it never steals focus and dismisses on ignore. Surface: bubble. References: Desktop Mate alarm and head-pat voice lines https://store.steampowered.com/app/3301060/Desktop_Mate/; Mate Engine event messages https://github.com/shinyflvre/Mate-Engine. Risks: Clippy-style pushiness; cap frequency, respect the owner's proactive setting, and the card must never auto-open a window.

4. **Settings as a room she stands in.** The settings are objects in a small room; clicking a shelf or desk opens that section, and she reacts (turns, nods) when one opens. Surface: settings window with the character as the centre. References: Sims CAS and Build/Buy as character-centred editing https://www.ea.com/games/the-sims/the-sims-4 (layout [U]); Nikke/Blue Archive centre-stage lobby [U]. Risks: a room-metaphor settings page is slow to scan; keep a plain list view for keyboard and screen-reader users.

5. **Thinking state as her posture.** While the backend is composing, she shows a small "thinking" pose or a soft aura, not a spinner. Surface: character window. References: Sesame voice-first UI framing https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice (turn-taking focus, [U] visuals); ChatGPT Live turn-taking https://help.openai.com/en/articles/8400625-voice-mode-faq. Risks: a constant animation drains the desktop; the state must stop when reduced motion is on, and must not claim work that did not happen.

6. **Timeline of her day in a quick card.** A horizontal timeline on the quick card lists what she spoke up about, with the trigger and whether it was acted on. Surface: quick card. References: Rewind/Limitless-style recall [U]; Replika's "every conversation knows where you are in your life" framing https://replika.com. Risks: a log that stores screen content needs retention limits and a clear-all action.

7. **Greeting-and-gift on window sit.** When she sits on a window, a small reaction (a gesture, a line from the card) plays, and the character window tells you why she moved. Surface: character window with bubble. References: Desktop Mate window sitting and taskbar sitting https://store.steampowered.com/app/3301060/Desktop_Mate/; Mate Engine window and taskbar sitting https://github.com/shinyflvre/Mate-Engine. Risks: window sitting on a transparent window needs a passthrough region so the window beneath stays clickable.

8. **Character card select as a switcher on her plinth.** Switching characters or outfits is a carousel under her feet with a preview, applied on confirm. Surface: settings or quick card. References: Desktop Mate DLC character store cards https://store.steampowered.com/search/?term=desktop+mate; VRChat avatar selection [U]. Risks: a swap that reloads a VRM mid-conversation must keep the current turn's audio intact.

---

## Not verified (listed so they are not cited as facts)

- Genshin gadget wheel, GTA weapon wheel, Secret of Mana ring, Kingdom Hearts command menu, Persona 5 menus, Animal Crossing reaction wheel, The Sims pie menu: [U], no page read.
- Blender pie menu page: not located [U].
- Apple Siri edge glow: [U].
- ChatGPT Voice orb: [U].
- Friend, Humane, Rewind, Limitless, Grok Ani, Character.AI in-chat UI: [U] or thin.
- Bongo Cat, Shimeji-ee project page, VTube Studio hotkey UI: [U].
- NIKKE: DNS failure, not read.
