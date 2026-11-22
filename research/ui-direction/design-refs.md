# Design references: character-centred and radial UI for YUI

Survey date: 2026-11-22. All entries were opened in ego-browser (read-only). `[U]` marks a source I could not open or could not search. Visual claims come from screenshots I viewed; text-only claims are marked as such.

## 1. The two named sites

### uberdesigner.ai
- **What it is:** a template and component library by the "ubernatural" studio (footer: Advanced Design Technologies Ltd). Each entry is a prompt for Claude, Codex, Kimi or Cursor, plus a Vite + React project and a Figma file.
- **Offers:** 763 templates (160 UI components, 598 games, 5 industry). Free entries need an account; Pro entries need a plan.
- **Price:** $29/month or $249/year (from the page text). Free tier: free account.
- **Relevance:** the "games" section and the "UI components" section are the closest fit. The search page for `radial` returned no matching items (`https://uberdesigner.ai/library?q=radial`, 32 results shown, none with a radial title). I did not open the game templates one by one, so I cannot say whether any is a radial menu.
- **Entry points:** https://uberdesigner.ai/library?kind=game , https://uberdesigner.ai/library?kind=ui

### cuedesign.space (Cue)
- **What it is:** a curated UI component library of "Awwwards-tier" animations and interactions, hand-picked by a founder-designer. Each component ships with an AI prompt for Cursor, v0, Bolt, Framer or Claude. Related products: Cue Kit (https://kit.cuedesign.space/), Mockup Studio.
- **Offers:** 345 components (page text). Browse by section (Interactions, Isometric, Free, Cue+).
- **Price:** free browsing; Cue+ at $129 lifetime (the page also shows a Black Friday offer of $129/$149 with a code).
- **Relevance:**
  - Pixel Pet, a "free React pixel character", a tiny friend component: https://www.cuedesign.space/#/pixel-pet (text on page: "A tiny friend that f..."; visually not checked)
  - "GrassBuddy Morphing Fur Pet" (3D & WebGL), listed on the home page; I did not open its page.
  - "Fuzzy Footer Buddies" (Landing Sections), listed on the home page.
  - "Mood-Reactive Counter" (Dashboards & Widgets), listed on the home page.
  - "NightSea Agent Home Screen" (AI & Agents), listed on the home page.
  - Category pages: https://www.cuedesign.space/mobile , https://www.cuedesign.space/mcp

## 2. Reference sites

### 2.1 Interface In Game (interfaceingame.com)
- **What it holds:** screenshots and short videos of in-game UI, grouped by game. Filter by genre and by element type (Menu, Inventory, Stats, Settings, Overlay, In game, Tutorial, etc.).
- **How to search:** the site search (`/?s=`) for "radial" returned "No games found". Use the element filter on a game page, for example the Cyberpunk 2077 page lists "Circle menu" (12 screenshots) and the element tags on each screenshot.
- **Entries:**
  - Cyberpunk 2077, "Circle menu" (MENU / INVENTORY / STATS tags, 12 likes). https://interfaceingame.com/screenshots/cyberpunk-2077-circle-menu/ . Visible in the screenshot I viewed: a ring of about 7 slots (weapon and item icons) arranged around a central empty well; the highlighted slot is enlarged with a red frame and a "Selected item" detail card on the right (D5 Copperhead, with stats); bottom footer shows "Apply" with a mouse icon and a row of tabs (MENU, INVENTORY, STATS) plus key hints. Hold vs click: not visible in a still image. Sub-levels: the tab row at bottom-left shows the three top-level sections, so the ring is one level inside a tab set.
  - Cyberpunk 2077 page, element list also includes "Cyberware", "Breaching", "Braindance editor", "Breach protocol": https://interfaceingame.com/games/cyberpunk-2077/ (the list is text only; I did not open each).
  - Other element filters on the same site (text only): https://interfaceingame.com/screenshots/?elements=inventory , https://interfaceingame.com/screenshots/?elements=main-menu
- **Note:** the Cyberpunk 2077 circle menu is the best concrete game example I found for a ring menu. I did not find a second game with a radial menu on this site through search; more would need a browse of the Menu element filter.

### 2.2 HUDS+GUIS (hudsandguis.com)
- **What it holds:** film and game UI (FUI) articles, podcast, and the book "FUI: The Book" on how to design UI for film and games. Articles on specific productions (e.g. "Jurassic World Rebirth UI Designs", "The Silent Sea", "Andor Season 2", "Cyber City Odeo 808 - Cyberpunk UI").
- **How to search:** site search at https://www.hudsandguis.com/search (the `?s=` form redirected to the homepage; not confirmed).
- **Entries:**
  - "FUI: The Book" page: https://www.hudsandguis.com/fui (text only; a book on designing UI for film and games, no radial examples on the page).
  - "Cyber City Odeo 808 - Cyberpunk UI" (anime, cyberpunk). Listed on the homepage: https://www.hudsandguis.com/ (not opened).
  - "Apple's Liquid Glass" (design system article, consumer products). Listed on the homepage (not opened).
  - "Google Material 3 Expressive" (design system article). Listed on the homepage (not opened).
- **Use for YUI:** background for ambient or floating overlay UI in film/game style.

### 2.3 Game UI Database (gameuidatabase.com) [U]
- **Status:** the site returned a Cloudflare "Just a moment..." verification page. I could not search it or open entries.
- **Contents (from the landing page text, which I read before the block):** 2,004 games, 79,956 screens, 2,572 videos; categories include Settings Menu, Button Layouts, Modals and Overlays, Title & System Menus, HUD: Info & Notifications.
- **How to search (per the site):** search box, filters, screen categories, and #hex codes. Not reached.
- **Next step for the owner:** open it in a normal browser and search "radial", "wheel", "pie". The category "Button Layouts" and "Settings Menu" may hold radial examples.

### 2.4 Mobbin (mobbin.com)
- **What it holds:** 600,000+ shipped app and website screens, flows, animations, UI elements. Searchable by app and pattern.
- **Status:** search URL for "radial menu" returned no results in the cached view. The page is gated behind login for search, so I could not confirm entries.
- **Price:** Pricing page (not opened); free sign-up for limited use.
- **Use for YUI:** the "Animations" and "UI Elements" tabs are the most relevant. Not verified.

### 2.5 Refero (refero.design) and Refero Styles (styles.refero.design)
- **What it holds:** refero.design is a library of real product screens and flows (web apps, iOS apps), with a research mode. styles.refero.design is a library of 2,000+ "DESIGN.md" style summaries from product websites (colours, type, spacing, components).
- **Status:** the search URL `https://refero.design/search?q=radial%20menu` showed a "Login with magic link" page, so search needs an account. Not verified.
- **Entries (styles library, text only):**
  - https://styles.refero.design/ , "Your favorite sites, in DESIGN.md" (2,000+ styles, open-source)
  - https://refero.design/styles (style tags such as "Playful & colorful", "Retro web", "Black & white")
- **Use for YUI:** the DESIGN.md format could describe a character-centred visual style for the owner's design brief. Relevance to radial menus: low.

### 2.6 component.gallery
- **What it holds:** 60 components with 2,671 examples from design systems and 95 design systems. Components list at https://component.gallery/components/ (Accordion, Menu, Dropdown, etc.).
- **How to search:** the `SEARCH` button (⌘K) on the site; the `?q=` URL did not filter.
- **Relevance:** the "Menu" and "Disclosure" components are text-only generic references. I found no radial or pie menu component in the list text I read.
- **Entry:** https://component.gallery/components/

### 2.7 Godly (godly.website)
- **What it holds:** design inspiration gallery of websites, with categories (Web, Interface, Branding, Motion, Illustration, Posters, Print) and "Recent".
- **How to search:** category tabs and "Recent" feed; no search was tested.
- **Entry:** https://godly.website/ (landing text only; no radial item opened).

### 2.8 Dribbble (dribbble.com)
- **What it holds:** designer shots (images) with search by tag.
- **How to search:** https://dribbble.com/search/radial-menu , https://dribbble.com/search/pie-menu (both work).
- **Entries (opened):**
  - Spatial Pie Menu by Oleg Frolov: https://dribbble.com/shots/24483971-Spatial-Pie-Menu . Visible: a 3D pie of six round tiles floating over a grid floor, with a hand gesture beneath; items are labelled MUTE, AI, SETTINGS, VR, and a timer tile ("08:01", highlighted red); a small loading ring at the centre. Item count: 6 visible. Opening: hand-gesture (VR context), so not click-to-open on a desktop. Selection: the highlighted tile is filled red. Sub-levels: not visible.
  - Concept Idea: Radial Menu UI (animated) by Jared Katamani: https://dribbble.com/shots/801609-Concept-Idea-Radial-Menu-UI-animated . Text only: palette #F9F9F9, #919091, #30C0FF; described as animated. Not visually checked.
  - Contextual Cursor Pie Menu by Jean Pichot: https://dribbble.com/shots/23203859-Contextual-Cursor-Pie-Menu . Title only; the menu is anchored at the cursor (from title). Not visually checked.
  - Spatial Circular Menu II: https://dribbble.com/shots/24290389-Spatial-Circular-Menu-II (listed on search page; not opened).
  - Unique Circular Navigation (Menu) Design - UX/UI: https://dribbble.com/shots/5352116-Unique-Circular-Navigation-Menu-Design-UX-UI (listed; not opened).
  - Pie Menu 01 / 02: https://dribbble.com/shots/3768267-Pie-Menu-01 , https://dribbble.com/shots/3768270-Pie-Menu-02 (listed; not opened).

### 2.9 Behance (behance.net)
- **How to search:** https://www.behance.net/search/projects?search=radial%20menu
- **Status:** the first results are branding projects (bakery, restaurant identity, etc.) that match only the words "menu". No radial UI project found in the first page I read. Low relevance.

## 3. Radial-menu examples: what I could confirm

| # | Source | URL | Items | How it opens | Selection | Sub-levels | Animation |
|---|---|---|---|---|---|---|---|
| 1 | Cyberpunk 2077 "Circle menu", Interface In Game (screenshot) | https://interfaceingame.com/screenshots/cyberpunk-2077-circle-menu/ | about 7 slots in view (ring) | not visible in still | enlarged slot with red frame; detail card on right | tabs MENU / INVENTORY / STATS at bottom-left | not visible in still |
| 2 | Spatial Pie Menu, Dribbble (Oleg Frolov) | https://dribbble.com/shots/24483971-Spatial-Pie-Menu | 6 tiles | gesture (VR context, not desktop) | highlighted tile filled red | not visible | not visible in still; floating tiles in 3D |
| 3 | Concept Idea: Radial Menu UI (animated), Dribbble | https://dribbble.com/shots/801609-Concept-Idea-Radial-Menu-UI-animated | not checked | not checked | not checked | not checked | described as animated; not played |
| 4 | Contextual Cursor Pie Menu, Dribbble | https://dribbble.com/shots/23203859-Contextual-Cursor-Pie-Menu | not checked | cursor-anchored (from title) | not checked | not checked | not checked |

Notes: (a) Sources 1 and 2 are the only two I could visually confirm. (b) Animation claims are unverified for all four until a video or a play is opened. (c) For the YUI idea (right-click on the character opens a ring around her, one pick opens settings), source 4 is the closest pattern, but it is only a title in this survey.

## 4. Character-centred and ambient AI references (found)

- Cue Pixel Pet (React pixel character): https://www.cuedesign.space/#/pixel-pet
- Cue home list (buddy and agent components, text only): https://www.cuedesign.space/
- Interface In Game, Cyberpunk "Circle menu" (in-world ring): https://interfaceingame.com/screenshots/cyberpunk-2077-circle-menu/
- Dribbble Spatial Pie Menu (floating tiles in 3D space): https://dribbble.com/shots/24483971-Spatial-Pie-Menu
- No glow/orb or proactive-notice examples were confirmed visually in this pass; the Game UI Database would be the next place to look (blocked, see 2.3).

## 5. Not done in this pass

- Game UI Database search for radial/wheel/pie (blocked by Cloudflare) [U].
- Mobbin and Refero search results (login-gated) [U].
- Godly search (no search tested).
- Full Interface In Game browse of the Menu element filter for more radial examples.
- Playing the Dribbble animated shots (video).
