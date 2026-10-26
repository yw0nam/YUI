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
The event that makes a turn a candidate — typed text, a voice segment, a physical poke, a schedule tick, another open character's reply naming this character through `address_character`. Carried as one of `user`, `schedule`, `proactive`, `agent`, `signals`, `milestone`, `addressed`. Firing a trigger is not a decision to speak.
_Avoid_: intent, command, prompt

**Handoff**:
An addressed turn whose sender passed the user's message on with `address_character` `handoff`; the receiver's trigger carries that message verbatim, and her reply answers the user.
_Avoid_: transfer, delegation, forward

**Guardrails**:
The gate a trigger passes before it becomes a turn: cooldown, do-not-disturb, debounce, rate limit. It answers whether to _bother_ the brain, never what the brain should say.
_Avoid_: filter, policy, throttle

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
The per-turn JSON block of environment + trigger state the client injects ahead of the utterance.

**Expression Broker**:
The MCP where the body publishes its renderable emotion/motion/emotion_text vocabulary; the brain reads it to know what it can cue. Deprecated: removed in v0.6.0. Use client-declared tools.
_Avoid_: bare "broker", message broker

### Presence & body

**Posture**:
The character's current physical state: `standing`, `sitting`, `peeking`, `dragging`, `walking`, `climbing`, or `lying`. Sent to the brain as context on the `body:` line.
_Avoid_: state, pose, stance

**Perch**:
The character resting on a foreign window's edge; the supporting window is reported as `perched_on`.

**Ambient (Tier 1)**:
Backend-independent idle life — blink, sway, breath. Runs always; attenuates under reduced-motion.

**Filler**:
A short client-side utterance covering the silence between a firing and the brain's first speech. It is stagecraft, not thinking, and never influences what is said.
_Avoid_: thinking, placeholder, stall

### Relations

**Relation**:
A character's directed value toward the user or toward another preset: −20..20, its band, a log of changes with reasons, and an optional `note` an external engine writes. Sent to the brain as the `relation:` line; moved by the `rate_relation` tool.
_Avoid_: stance, affinity, opinion, feeling

**Band**:
One of the five named ranges of a relation: `hostile` (≤ −12), `cold` (≤ −4), `neutral`, `warm` (≥ 4), `close` (≥ 12).
_Avoid_: level, tier, mood

### Surfaces & periphery

**Surface**:
A floating piece of chrome the character speaks or listens through (speech bubble, status pill, text input) that appears only when it has something to show, then recedes.
_Avoid_: widget, overlay, panel

**Unified chat window**:
The window `unified` that shows every open preset's lines one at a time in one dialogue box and routes the user's messages to the open presets. It shows while the Unified chat switch is on, two or more presets are open and a window can exist; while it shows it is the only chat path: no pet window shows its own bubble or input for chat, and every separate message window is hidden. Its own × (or Cmd+W) turns the switch off.
_Avoid_: group chat, merged chat, lobby, multi chat

**Mention**:
The user's pick of a recipient in the unified chat window's composer: a recipient chip carrying one preset id, or `@everyone` (aliased by `@here` and `@all`). A leading typed `@name` that matches an open preset's name, or `@everyone`, routes like a pick; any other typed `@` is plain text. The names `everyone`, `here` and `all` are reserved, so no preset is created or renamed to one.
_Avoid_: tag, call-out, ping

**Recipient chip**:
One of the radio chips above the unified chat window's composer: one per open preset and one for everyone. The checked chip is where Enter sends: the counted pick, else the preset a typed leading `@name` resolves to, else the last speaker, else main's preset. A click picks it.
_Avoid_: recipient badge, target chip

**Cast chip**:
The unified chat window's chip for one open preset in its head row: the preset's face, its name and a dot for its line — talk while its line holds the box, think while its turn runs or its line waits for the box, else idle.
_Avoid_: avatar pill, presence badge

**Aside**:
A line the client speaks in the character's voice outside a turn's utterance: filler, a failure apology, the card's greeting. While the unified chat window shows, an aside goes there with the character's lines; an app notice (the first-run hint, a hotkey failure) stays on the character's own bubble.
_Avoid_: client line, system line

**Signals**:
A burst of events from an external producer POSTed to the `/signals` ingress, flushed as one turn.

**Delivery class**:
How urgent a signal group is, chosen by the producer: `urgent` (handle now), `batched` (can wait and go out together), or the deprecated `immediate` (removed in v0.6.0; use `urgent` or `batched`). The client routes by it and shows it as the dot and class of a source line, where `immediate` reads as `batched`; it never changes the wire value.
_Avoid_: tier, urgency, priority

**Signal chip**:
The pill beside the avatar for one signal group, with a details sheet on tap and a cross to dismiss; in memory only.

**Mod**:
A standalone MCP server the brain uses (avatar, browser-cdp, desktop-control, shell-sandbox). Not part of the app runtime.

### Configuration

**Tunable**:
A numeric or enum knob the client reads at boot (peek distances, jump gravity, gaze curve, attachment caps). Its one home is `configs/*.json`; the validator requires the section and the consuming module reads the validated value.
_Avoid_: default constant, fallback value, code-side default

**Preset**:
A named bundle of per-character client state: the backend connection and chat id, the card, the TTS voice, the conversation history, the VRM selection, the camera zoom and orbit, and the filler phrases. One preset is active at a time; the built-in default preset keeps the unprefixed storage keys. Everything else is device-wide and shared by every preset.
_Avoid_: profile, character (for this bundle)

**Card**:
The persona text of a preset in Tavern Card V2 shape. Sent as the first system message on Chat Completions and as `instructions` on Responses. Never sent on push.
_Avoid_: character card (as a YUI term), profile, persona file

**Reading dictionary**:
The device-wide list of `surface=reading` pairs the client applies to the text it sends to the TTS service, never to the bubble.
_Avoid_: lexicon, pronunciation dictionary, user dictionary

**Greeting**:
The card's `first_mes` or one of its `alternate_greetings`, performed by the client after a session reset — and once at the first boot of a preset a card import created — and recorded as an assistant entry.
_Avoid_: first message, opener

**Task space**:
An ego lite tab workspace the `browser` tool works in, named `yui-<presetId>`: one per preset, so one per pet window. It outlives a call, the browser switch going off, the window, and the app. The user closes it in ego lite, and ego lite closes it after 30 idle minutes. ego lite's "YUI" browser profile is where those spaces run, and it is not a Preset.
_Avoid_: tab group, browser session

**Bound pet window**:
A pet window opened for one preset by label `pet-<id>` and URL query `preset=<id>`. Its per-preset keys resolve under that preset (`yui.<id>.*`; the built-in default keeps the unprefixed keys) and it keeps the preset while `main`, the window without the query, follows the active one. It opens its own settings window `settings-<id>` and message window `message-<id>`, which resolve the same preset's keys and close when it closes or its preset leaves the registry. `yui.windows` is the device-wide list of ids the user wants open, and each of the three windows holds its live key `yui.live-window.<label>` from boot until it closes; the registry refuses to remove or activate a preset while any of the three is live, and `main` clears keys whose window no longer exists at boot.
_Avoid_: secondary window, companion window, extra window, sub-window
