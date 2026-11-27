# YUI

Embodied desktop-pet frontend (the body) for the selected backend agent (the brain): it renders a VRM character, fires candidate events at the backend, and performs whatever the backend sends back. Judgment lives in the backend, so the language here is about _firing_ (detecting, routing, ordering, naming a topic) and _performing_, never about writing what a character says. This glossary is the canonical vocabulary; issue titles, test names, and proposals use these terms.

## Language

### Split of responsibility

**Body**:
YUI itself — VRM rendering, sensing, I/O surfaces, and the card it sends on the request transports. Holds no judgment.
_Avoid_: head, client-side brain, frontend agent

**Brain**:
The selected backend — judgment, memory, and the agent loop.
_Avoid_: server, LLM (as a component name)

**Firing**:
Client-side detection that a candidate event occurred, the choice of which character receives a turn for it and in what order, and the topic the backend is told to address.
_Avoid_: triggering judgment, writing the reply

**Judgment**:
The brain's decision, once a character has the turn, whether it speaks and what the words are. Silence is expressed as empty speech text or the bare `[SILENT]` token, never dropped by the client.

### Turn lifecycle

**Turn**:
One backend round trip, from the moment the dispatcher admits a trigger until the reply's audio has drained. A local reaction that never reaches the brain is not a Turn.
_Avoid_: request, exchange, interaction

**Trigger**:
The event that makes a turn a candidate — typed text, a voice segment, a physical poke, a schedule tick, another open character's reply naming this character through `address_character`. Carried as one of `user`, `schedule`, `proactive`, `signals`, `milestone`, `addressed`. Firing a trigger is not a decision to speak.
_Avoid_: intent, command, prompt

**Trigger headline**:
The one `trigger:` line of the client context that names what fired a turn. The backend reads it, so it is the words the backend sees.
_Avoid_: trigger line (for the bubble's line), headline

**Trigger line**:
The line in the bubble's quote slot that says why she spoke on a turn she started: a schedule cue's time and label, an idle cue's label, the first meeting, a screen switch, or another character's name. A waited turn adds `+N` for its other members and signal groups. The bubble draws it, and the reply after it is the backend's. A user turn quotes the user's message instead.
_Avoid_: reason, why line, trigger headline

**Handoff**:
An addressed turn whose sender passed the user's message on with `address_character` `handoff`; the receiver's trigger carries that message verbatim, and her reply answers the user.
_Avoid_: transfer, delegation, forward

**Guardrails**:
The gate a trigger passes on arrival and before it takes a turn's slot: a debounce, then the rate limit. It answers whether to _bother_ the brain, never what the brain should say. A candidate that do-not-disturb or the proactive gap holds waits in the waiting list instead.
_Avoid_: filter, policy, throttle

**Do-not-disturb**:
The device-wide hold a running Rest or Focus sets, started from the Character menu's Rest list or the tray's Do Not Disturb item, that holds every self-fired trigger in every pet window: idle and schedule cues, screen watch, the once-a-day milestone, Thread reactions a count or a wait starts, the dropped cue of a fall she started herself, and signals, urgent ones included. Held idle cues, screen watch, the once-a-day milestone and schedule cues wait in the dispatcher's waiting list and go out together once it is off, unless they expired first; a user message carries the ones that do not expire on user activity. A count or wait reaction waits until it is off. Held signals stay in their buffers, at most the 5 newest groups per buffer. User input, gestures and addressed turns still pass. A Threads-chip tap still starts its reaction, and the chips stay on screen without wiggle or pulse. A backend-started push turn is never held. An Active hours `off` span holds the same triggers in that character's pet window only, and is shown as Quiet.
_Avoid_: quiet mode, mute

**Rest**:
The hold on her own turns that a user starts from the Character menu's Rest list or the tray's Do Not Disturb item. It runs one Rest choice until that choice ends, until End now stops it, or until the user turns it off. While it runs, do-not-disturb holds her, and the status pill and the Rest pill show its end. Stored under `yui.dnd`.
_Avoid_: snooze, pause, break

**Rest choice**:
One of six choices a Rest starts: For 1 hour, Until tonight (00:00), Until tomorrow morning (08:00), Until I turn it off, and the two Focus choices. Until tonight is not offered from 00:00 to 07:59. The end of a choice is set when it starts.
_Avoid_: mode, option, setting

**Focus**:
A Rest choice of 25 or 50 minutes. It holds her own turns for that long, and the Rest pill and the status pill count its minutes left. Focus is not keyboard focus, which is the window or control that takes typed input.
_Avoid_: focus mode, pomodoro, session

**Waiting list**:
The dispatcher's one ranked list of self-started candidates that cannot speak now, because do-not-disturb, the proactive gap, absence, a running turn or the rate limit holds them. Entries rank by class (now, scheduled, room), then by age, and at most 10 wait. Each expires by its own rule: a first meeting or addressed line at the end of its day, a schedule cue after its grace window, an idle or screen reaction on the user's next activity. At a free slot the admissible entries go out together. Signal groups wait in their own buffers, not in this list.
_Avoid_: queue, backlog, pending list

**Waited turn**:
The turn a free slot sends for several waiting entries (the bundle): its trigger is the top-ranked entry, and the others ride with it as waited items, with the buffered signal groups. When the user speaks first, the entries that do not expire on activity ride on the user's turn. A waited turn counts once against the rate limit.
_Avoid_: batch, catch-up turn

**Active hours**:
A character's list of spans. Each span has a start time, an end time and a pace: More, Normal, Less or Off (stored `high`, `normal`, `low` or `off`). In a pet window, a span's pace multiplies the base pace, and the product scales both the proactive gap and the idle cue minutes: More halves it and Less triples it, while Normal and Off leave the span out of it. Off holds the same triggers as do-not-disturb, in that pet window only. An hour no span covers is Normal. A span whose end is before its start runs past midnight, and equal start and end cover the whole day. Where spans overlap, the span that started most recently before the minute wins; on a tie, the later span in the list wins. The card's `extensions.yui.active_hours` is the default, and the Persona page edits the spans per character.
_Avoid_: band, level, schedule, quiet hours

**Quiet**:
The label the status pill and the Rest pill show while an Active hours `off` span covers the current time, with its end: "Quiet · until 12:00" in the pill, "Quiet · 12:00" on the Rest pill. The span holds her own turns as a Rest does, but it is not a Rest: the Rest list does not end it, and it ends with the span. "Quiet hours" and "quiet mode" are not terms; name the span by its Active hours entry.
_Avoid_: quiet hours, quiet mode, Rest (for a span)

**Base pace**:
The device-wide pace (Less, Normal or More; stored `low`, `normal` or `high`, default Normal) set by "How often she speaks up" at the top of the Proactive page. Every pet window multiplies it by its character's span pace, so it scales the proactive gap and the idle cue minutes the same way a span does.

**Proactive gap**:
The device-wide wait after any turn starts, user or proactive, spoken or silent, before a proactive source may speak up on her own. Shown as "Wait after a conversation" under Advanced on the Proactive page, stored as `yui.proactive-pacer-gap` (default 10 minutes; 0 disables it). Each pet window scales it by the base pace times the span pace.
_Avoid_: quiet gap, pacer gap, global gap

**Chain cap**:
The most addressed turns one window answers in a row without a user turn in between; `addressed_chain_max` in configs/guardrails.json, overridable on the Together page. The next one is dropped with reason `addressed_cap`.
_Avoid_: ping-pong cap, chain limit, addressed limit

**Tier**:
How a trigger is routed. Tier 1 is performed locally with no backend call; tier 2 becomes a turn.

**Trigger cue**:
Metadata about a schedule/proactive firing source (label, user-authored context, timing), forwarded client→brain. Includes built-in touch/gesture cues.
_Avoid_: bare "cue"

**Express cue**:
The one-way `generate_express` instruction, brain→client: emotion, motion, a TTS voice-tag (`emotion_text`), and a free-text voice direction (`caption`) carried out-of-band, streamed per beat and applied when the sentence it belongs to starts playing. Never inline markup inside speech text.
_Avoid_: bare "cue", expression command, tag, control token

**Reflex turn**:
A gesture-fired turn (head pat, drag-held, window-sit, peek, drop, touch) that skips the thinking filler — immediate reaction, no deliberative pause.

**Background marker**:
The placeholder user-content text on turns with no real user utterance.

**Client context**:
The per-turn block of plain-text `key: value` lines with the environment and trigger state the client injects ahead of the utterance, inside `<client_context>` tags under a header line that marks it client-injected and its quoted values as data.

### Presence & body

**Posture**:
The character's current physical state: `standing`, `sitting`, `peeking`, `dragging`, `walking`, or `climbing`. Sent to the brain as context on the `body:` line.
_Avoid_: state, pose, stance

**Perch**:
The character resting on a foreign window's edge or the Threads window's; the supporting window is reported as `perched_on`.

**Grounded motion**:
A motion whose clip keeps the character standing on the floor. While one plays, the renderer moves the whole model up or down so its lowest sole sits on the floor.
_Avoid_: floor motion, standing motion

**Ambient (Tier 1)**:
Backend-independent idle life — blink, sway, breath. Runs always; attenuates under reduced-motion.

**Filler**:
A short client-side utterance from a pool, covering the silence between a firing and the brain's first speech, or announcing a Thread reaction. It is stagecraft, not thinking, and never influences what the brain says.
_Avoid_: thinking, placeholder, stall

**Come-along**:
Her travel from her desktop spot onto the settings stage when the settings window opens, and back home when it closes; or her staying on the desktop in the sulking case. Its entry is set by an Entry family. The stage peek pin, which holds her hips beyond her window's edge for an edge entry clip, holds no Posture and is not a Perch.
_Avoid_: summon, follow

**Entry family**:
A named group of backend emotions and entry clips in `stage.entry_families` of `configs/avatar.json` (shipped: glad, plain, glum), from which a Come-along picks its entry clip by the last backend emotion; plain takes any emotion no family lists. An angry emotion takes the sulking case instead.
_Avoid_: mood, entry type

**Page reaction**:
The short reaction she plays once when she enters a settings page, and again when a shown change (body, voice or pace) appears. Idling follows it.
_Avoid_: cue, page animation

### Relations

**Relation**:
A character's directed value toward the user or toward another preset: −20..20, its band, a log of changes with reasons, and an optional `note` an external engine writes. Sent to the brain as the `relation:` line; moved by the `rate_relation` tool.
_Avoid_: stance, affinity, opinion, feeling

**Band**:
One of the five named ranges of a relation: `hostile` (≤ −12), `cold` (≤ −4), `neutral`, `warm` (≥ 4), `close` (≥ 12).
_Avoid_: level, tier, mood

### Threads

**Thread**:
One outside conversation a producer posts for the user to read, with an id, source, state, and entries; replying to its source is the backend agent's job.
_Avoid_: session, ticket, inbox

**Ask**:
One question held open for the user, which the backend asks in a character's own chat over the push transport (an `ask` frame). It has an `ask_id`, a prompt, optional choices, and whether free text is accepted.
_Avoid_: prompt, request

**Answer**:
The user's reply to one Ask: a choice id, several choice ids for a multi-select Ask, text, or both. It travels as an `answer` frame.
_Avoid_: reply, response

**Settings request**:
An agent's pending change to settings that need the user's Allow, shown on its own card in the Ask slot. Unlike an Ask, the client raises it, not the push transport. The user answers it with a decision: the paths they allow, and an optional note.
_Avoid_: permission prompt, approval dialog, access request

**Backend command**:
A command the backend states in `ready.commands` and runs when the user types `/name` in the text input; push transport only. Its output is a Command reply, never a Turn.
_Avoid_: slash command (for the client side), Trigger

**Command reply**:
The text a Backend command printed, shown above the input until closed and written to the client log; never spoken and never a Turn. Over push, it travels as a `command_reply` frame.
_Avoid_: reply panel, Answer

**Waiting Thread**:
A Thread in `input-required` that the user has not marked read since the producer's last update.
_Avoid_: unread, pending

**Attached Thread**:
A Thread the user put on the main character's chat input with the Threads window's Attach to chat, shown as a chip; the next send, typed or spoken, carries it by id as that turn's `threads attached:` block, and the chip clears.
_Avoid_: reference, link, pinned Thread

**Threads window**:
The window `threads` where the user reads Threads and works in Terminals; it grows out of the Threads chip, or opens without the grow on the Terminal tab from the tray's Terminal item and on either tab from the Character menu's Threads and Terminal items, moves and resizes on its own, and first opens beside the main character; its head switches between the Threads tab and the Terminal tab, and its list collapses to a rail. An automatic open by a Thread reaction does not take keyboard focus.
_Avoid_: inbox, panel, dashboard

**Thread turns**:
The device-wide setting (`off`, `notable`, `every`) by which a Thread update gives the main character a signals turn.

**Thread reactions**:
The device-wide switch `yui.thread-reactions`, on by default, and the client-side body reaction it governs: on a Threads-chip tap, on the chip's waiting count reaching its threshold, or on one Thread waiting out its threshold, the main character says a filler line if the Threads window is closed or covered (a tap says none), sits on the Threads window, and shows an expression. The reaction itself gives no Turn; when it finishes, it sends every buffered Thread turn it holds as one turn.
_Avoid_: notification, alert, Thread turn (a Thread turn reaches the brain)

**Reaction thresholds**:
The device-wide setting `yui.thread-reaction-thresholds`: the waiting count (Off, 2, 3 or 5, default 3) and the wait in minutes (Off, 5, 10 or 30, default 10) at which a Thread reaction starts without a chip tap.
_Avoid_: trigger (a Trigger is a turn's cause), summon

**Threads chip**:
The pill in the main window's chip column that counts waiting Threads and access requests; tapping it opens the Threads window and starts a Thread reaction; it hides while that window is open.
_Avoid_: badge, notification pill

### Terminal

**Terminal**:
A shell YUI runs in a PTY, shown in the Threads window's Terminal tab, owned by the user or by the preset that opened it.
_Avoid_: shell window, console, task space

**Terminal access**:
One preset's right to read and write one Terminal, given by the user's Allow and ended by Take back.
_Avoid_: permission, grant, control

**Access request**:
A preset's pending read or write on a Terminal it has no access to, shown as the Allow / Deny card.
_Avoid_: prompt, approval dialog

### Surfaces & periphery

**Surface**:
A floating piece of chrome the character speaks or listens through (speech bubble, status pill, text input) that appears only when it has something to show, then recedes.
_Avoid_: widget, overlay, panel

**Status pill**:
The pill at the top of the character window that shows the capture, voice input, backend tool and Rest tells. Its Rest segment reads "Resting · until 08:00", "Resting" with no end, "Focus · 18 min left" or "Quiet · until 12:00".
_Avoid_: status bar, tell bar

**Unified chat window**:
The window `unified` that shows every open preset's lines one at a time in one dialogue box and routes the user's typed and spoken messages to the open presets. It shows while the Unified chat switch is on, two or more presets are open and a window can exist; while it shows it is the only chat path: no pet window shows its own bubble or input for chat, and every separate message window is hidden. Its own × turns the switch off.
_Avoid_: group chat, merged chat, lobby, multi chat

**Mention**:
The user's pick of a recipient in the unified chat window: a cast chip carrying one preset id, or everyone: the everyone chip, or `@everyone` (aliased by `@here` and `@all`). A leading typed `@name` that matches an open preset's name, or `@everyone`, routes like a pick; any other typed `@` is plain text. The names `everyone`, `here` and `all` are reserved, so no preset is created or renamed to one.
_Avoid_: tag, call-out, ping

**Cast chip**:
The unified chat window's chip for one open preset in its head row, the recipient picker: the preset's face, its name and a dot for its line — talk while its line holds the box, think while its turn runs or its line waits for the box, else idle. The cast chips and the everyone chip after them are one radio group; a click picks the chip's recipient. The checked chip is the counted pick, else the preset a typed leading `@name` resolves to, else, while a send runs, that send's recipient, else the last speaker, else main's preset, else the first open preset.
_Avoid_: avatar pill, presence badge, recipient chip

**Character menu**:
The pill menu around her, opened by a right-click on her in the pet window and drawn in the Character menu window: two columns of pills beside her, where a Rest, Body, Voice, Pace or More pill replaces its column in place with its own list; Rest's list takes the right column, and while a Rest or Focus runs it opens with a status row.
_Avoid_: context menu, radial menu, pie menu, ring menu

**Character menu window**:
The app's one window `character-menu`, created hidden at main's boot. When the Character menu opens, it is shown with keyboard focus beside the right-clicked character, lets clicks outside its pills through, and is hidden on close.
_Avoid_: menu overlay, popup window

**Status row**:
The first row of the Rest list while a Rest or Focus runs, before End now: it names the running choice and its end, as "Resting until 08:00", "Resting", or "Focus · 18 min left". It is not a button, and the keyboard passes it by. Distinct from the Status pill, which sits at the top of the character window.
_Avoid_: status pill (for the list row), header

**Settings stage**:
The stage area on the left of the settings window. The character comes along onto it and is attached to the window as a native child. It holds her name, her state and a caption of what she is doing.
_Avoid_: stage window, stage panel, dock

**Stage slot**:
The area at the top of the Settings stage where her window sits while she is on the stage; its bottom edge is the stage foot's top line, where her feet stand.
_Avoid_: stage rect, dock rect

**Aside**:
A line the client speaks in the character's voice outside a turn's utterance: filler, a failure apology, the card's greeting. While the unified chat window shows, an aside goes there with the character's lines; an app notice (the first-run hint, a hotkey failure) stays on the character's own bubble.
_Avoid_: client line, system line

**Signals**:
A burst of events from an external producer POSTed to the `/signals` ingress, sent by a YUI-hosted MCP server, or derived from a Thread update, flushed as one turn.

**Delivery class**:
How urgent a signal group is, chosen by the producer: `urgent` (handle now) or `batched` (can wait and go out together). The client routes by it and shows it as the dot and class of a source line; it never changes the wire value.
_Avoid_: tier, urgency, priority

**Signal chip**:
The pill beside the avatar for one signal group, with a details sheet on tap and a cross to dismiss; in memory only.

### Plugins and tools

**Plugin**:
The install unit YUI runs: one folder in `plugins/` with a `.claude-plugin/plugin.json` manifest and the components it bundles, installed by YUI from the Catalog (browser) or added from a folder. Alone, the word means only this; a Tauri plugin, a Hermes plugin, and a Coding-agent plugin are named with their ecosystem.
_Avoid_: mod, add-on, extension

**Coding-agent plugin**:
A Claude Code or Codex plugin in `coding-agents/`, installed from the Marketplace (yui-notify, yui-dev). YUI never runs it.

**Marketplace**:
The list of Coding-agent plugins in `.claude-plugin/marketplace.json` at the repository root, named `yui`.
_Avoid_: registry, index

**Catalog**:
`plugins/catalog.json` on main, the list of plugins YUI installs: official plugins with a release asset and sha256 per platform, and community plugins by their GitHub repo.
_Avoid_: registry, store, index

**MCP server**:
A standalone process that offers tools over MCP (a plugin's `.mcp.json` server). Not part of the app runtime: the backend agent or the MCP host runs it as its own process.
_Avoid_: Mod

**Backend-attached**:
How an MCP server reaches the brain through the backend agent's own MCP configuration, outside YUI.

**YUI-hosted**:
How an MCP server runs when YUI starts it as its own child process through the MCP host, which publishes the server's tools in the host's snapshot. Pairs with Backend-attached.

**MCP host**:
The part of the Rust shell that runs YUI-hosted MCP servers (`src-tauri/src/mcp_host/`). Its Tauri commands carry the prefix `plugin_host_` and its snapshot event the prefix `plugin-host-`.
_Avoid_: plugin manager, runtime

**Plugin tool**:
A tool one of a plugin's MCP servers declares, published in the MCP host's snapshot while the plugin is enabled and run by `yui.plugins.call` in `yui_run`. Not a Client tool.
_Avoid_: MCP tool, plugin function

**Skill**:
A `SKILL.md` that an agent reads for one workflow (yui-daily-briefing, yui-wake-character).
_Avoid_: recipe, prompt pack

**Hook**:
A handler a host runs on one of its own events, such as yui-notify's `Stop` hook in a coding agent.
_Avoid_: trigger (a Trigger is a turn's cause)

**Integration**:
Wiring for one backend agent, kept under `integrations/<agent>/` (the Hermes platform plugin, Hermes desire).
_Avoid_: adapter, connector

**Client tool**:
A tool the client runs itself and declares to the backend: generate_express, body_action, rate_relation, address_character and yui_run.
_Avoid_: in-app tool, local tool

**yui API**:
What a `yui_run` script reaches: settings, state, info, guide, terminal and plugins in every Tauri pet window; look and threads in main. A yui call is one call a script makes into it.
_Avoid_: SDK, bridge

**Image handle**:
An `{ image: n }` value a yui call returns in place of an image; the `yui_run` result attaches the image only when the script's returned value holds its handle.
_Avoid_: image reference, image id

**Producer**:
An outside program that posts signals to `/signals` (a scheduled script or a webhook) or conversations to `/threads` (yui-notify's coding-agent hooks), or a plugin's MCP server that sends the signals notification.
_Avoid_: sender, emitter

### Configuration

**Tunable**:
A numeric or enum knob the client reads at boot (peek distances, jump gravity, gaze curve, attachment caps). Its one home is `configs/*.json`; the validator requires the section and the consuming module reads the validated value.
_Avoid_: default constant, fallback value, code-side default

**Preset**:
A named bundle of per-character client state: the backend connection and chat id, the card, the TTS voice, the conversation history, the VRM selection, the camera zoom and orbit, and the filler phrases. One preset is active at a time; the built-in default preset keeps the unprefixed storage keys. Everything else is device-wide and shared by every preset.
_Avoid_: profile, character (for this bundle)

**Preset file**:
A `.yui` zip that carries one preset to another machine: a manifest, the card, and, when present, the thumbnail with its crop, the VRM (a bundled one by id, a user one unless its license forbids redistribution), and the voice's reference clip. Import always creates a new preset. Keys, connection settings, history and relations never go in.
_Avoid_: character bundle, character file, bundle

**Card**:
The persona text of a preset in Tavern Card V2 shape. Sent as the first system message on Chat Completions and as `instructions` on Responses. Never sent on push.
_Avoid_: character card (as a YUI term), profile, persona file

**Reading dictionary**:
The device-wide list of `surface=reading` pairs the client applies to the text it sends to the TTS service, never to the bubble.
_Avoid_: lexicon, pronunciation dictionary, user dictionary

**Greeting**:
The card's `first_mes` or one of its `alternate_greetings`, performed by the client after a session reset, once at the first boot of a preset a card import created, and once when Quick start connects or its Replay runs, on an empty session, and recorded as an assistant entry.
_Avoid_: first message, opener

**Default voice**:
The Fish Audio voice that Quick start's voice step adds to the voice list and selects for the app language, from `tts_default_voices` in `configs/endpoints.json`. Picked once, when voice is turned on; a later language change keeps it. Not `tts_speaker`, the configured voice the client starts with until another is picked.
_Avoid_: starter voice, fallback voice

**Quick start**:
The Connection page's free Gemini path, chosen by the Quick start cell of its switch: what is sent and the daily limit, the key page link, and one key field confirmed by the model list read. A confirmed key writes the preset's URL, model and key, turns idle check-ins and the schedule off, and has the pet window greet. With another server configured it warns that connecting replaces it. Once connected it shows a done line, the voice step, and Help. The voice step is an optional Fish Audio key, confirmed by a voice list read, that turns on voice with the Default voice; with a TTS server already set, the step shows a voice-is-on line in its place.
_Avoid_: setup page, First conversation page

**First conversation**:
The flow after Quick start confirms a key: the pet window greets, opens the input, and shows the controls hint with Hear the controls and Hear what she can do. Quick start's Replay reruns it: the greeting only on an empty session, then the input and the hint whatever its seen flag says, skipped while a turn runs.
_Avoid_: onboarding, wizard

**Task space**:
An ego lite tab workspace the `browser` plugin works in, named `yui-<presetId>`: one per preset, so one per pet window. It outlives a call, the plugin being disabled, the window, and the app. The user closes it in ego lite, and ego lite closes it after 30 idle minutes. ego lite's "YUI" browser profile is where those spaces run, and it is not a Preset.
_Avoid_: tab group, browser session

**Pet window**:
The transparent always-on-top window the character stands in, with her speech bubble and text input beneath her while docked; the owner calls it the character window (캐릭터 창). `main` is the first one; each Bound pet window is another. The message window is its popped-out bubble and input, and the unified chat window replaces its chat while shown.
_Avoid_: character window (in code and docs), avatar window, main window (for a bound one)

**Bound pet window**:
A pet window opened for one preset by label `pet-<id>` and URL query `preset=<id>`. Its per-preset keys resolve under that preset (`yui.<id>.*`; the built-in default keeps the unprefixed keys) and it keeps the preset while `main`, the window without the query, follows the active one. It opens its own settings window `settings-<id>` and message window `message-<id>`, which resolve the same preset's keys and close when it closes or its preset leaves the registry. `yui.windows` is the device-wide list of ids the user wants open, and each of the three windows holds its live key `yui.live-window.<label>` from boot until it closes; the registry refuses to remove or activate a preset while any of the three is live, and `main` clears keys whose window no longer exists at boot.
_Avoid_: secondary window, companion window, extra window, sub-window
