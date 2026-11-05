# What's new

Releases are listed newest first, and older releases are on [GitHub Releases](https://github.com/yw0nam/YUI/releases).

## v0.6.0

### Highlights

- The settings window has a **Plugins** page, where you install an official or community plugin from the Catalog and turn it on ([Plugins](plugins.md)).
- A plugin's tools and skills reach the backend through three bridge tools, so the model describes a tool, calls it, and reads a skill ([Client Tools](../reference/client-tools.md)).
- The `browser` tool comes from the official `browser` plugin, which you install from the Catalog ([Plugins](plugins.md)).
- The **Terminal** tab in Threads opens host terminals you share with the backend. The backend needs your **Allow** first ([Terminal tools](../reference/client-tools.md#terminal-tools)).
- **Default** reasoning effort sends no effort, so the model applies its own default ([Connect a backend](connect-a-backend.md)).
- The **Waiting for you** chip opens the Threads window. **Mark read** takes a Thread off the Waiting tab; its open ask stays answerable from All ([Threads](../reference/threads.md)).
- yui-notify posts Threads for coding agents. On macOS, a Codex permission request posts without an ask while Codex's host app is in front. It also ships the `/yui-notify:thread-producer` skill ([yui-notify](https://github.com/yw0nam/YUI/blob/main/plugins/yui-notify/README.md)).
- A backend's approval or clarify question reaches you as an **Ask** card, which can take several choices ([Threads](../reference/threads.md)).
- Type `/` in the text input to run the backend's commands, such as `/status`, over push ([Push transport](../reference/push-transport.md)).
- **Quick start** on the **Connection** page takes a free Gemini key to a first conversation. Voice is optional, and **Maybe later** skips it ([Connect a backend](connect-a-backend.md)).
- The bundled character is VRoid's AvatarSample_A. The **Body** page links to VRoid Hub for free models ([Installation](installation.md)).

### Breaking changes

| Change | What you do |
| --- | --- |
| yui-notify removes `agent.*` signals, `events.*` configuration, and `test --delivery`. | Hooks post Threads without character turns, and Codex answers through synchronous hooks. Configure `endpoint`, `wait.stop`, and `wait.permission`, and use `test` to send a completed Thread ([yui-notify](https://github.com/yw0nam/YUI/blob/main/plugins/yui-notify/README.md)). |
| The `briefing.py migrate` command, the daily briefing's one-time folder move, is removed ([#1652](https://github.com/yw0nam/YUI/pull/1652)). | Nothing, unless your spool holds day folders at its root: move them into `reports/` by hand. |
| The Expression Broker connection is removed, and client-declared tools carry expression cues ([#1654](https://github.com/yw0nam/YUI/pull/1654)). | Nothing, unless you set `broker_base_url`: the key is ignored. A backend that does not pass a request's tools to its model carries expression cues only on Push, so set **Type** in the Chat section of the **Connection** page to **Push** ([Push transport](../reference/push-transport.md)). |
| `POST /agent-event` is removed ([#1655](https://github.com/yw0nam/YUI/pull/1655)). | Nothing, unless a hook posts to `/agent-event`: post a signals envelope to [`/signals`](../reference/signals-ingress.md) instead. |
| The `immediate` delivery class and a `/signals` request without an envelope are removed ([#1656](https://github.com/yw0nam/YUI/pull/1656)). | Nothing, unless a producer sends `immediate` or no envelope: send `urgent` or `batched` inside an envelope. |
| The factorio server moves to `plugins/factorio`, and the avatar, desktop-control, shell-sandbox, browser-cdp and router servers under `Mods/` are removed ([#1674](https://github.com/yw0nam/YUI/pull/1674)). | Nothing, unless you run one of the removed servers or factorio from a checkout: the servers' folders are gone, and factorio runs from `plugins/factorio`. |
| `address_character.to` and `rate_relation.toward` drop their enum of open presets, and each turn lists the open characters instead ([#1686](https://github.com/yw0nam/YUI/pull/1686)). | Nothing, unless your backend picks those arguments from the enum: it reads the `open characters:` line in the client context ([Client Context](../reference/client-context.md)). |
| Reasoning effort starts at **Default**, which sends no effort, and an unknown stored value reads as **Default** ([#1700](https://github.com/yw0nam/YUI/pull/1700)). | A preset that stored **None** keeps it. Pick **Default** once to let the model apply its own. |
| The built-in `browser` tool, the **Allow browser use** switch, and the `yui.browser` setting are removed; the tool comes from the official `browser` plugin ([#1704](https://github.com/yw0nam/YUI/pull/1704)). | Install the `browser` plugin on the **Plugins** page and turn it on ([Plugins](plugins.md)). |
| Claude Code's channel server and its launch flag are removed, and Claude Code answers through its inbox socket ([#1751](https://github.com/yw0nam/YUI/pull/1751)). | Remove `--dangerously-load-development-channels plugin:yui-notify@yui` from how you launch Claude Code. The flag has no effect on yui-notify now. |
| The bed scene, `go_to_bed`, the lying posture, and the wake line are removed ([#1757](https://github.com/yw0nam/YUI/pull/1757)). | Remove `go_to_bed` from your backend's `body_action` choices. `POST /avatar/command` rejects it as an unknown action. |
| A Chat Completions response with a cue and no text gets an answer, whatever its `finish_reason` ([#1796](https://github.com/yw0nam/YUI/pull/1796)). | A backend that ends a cue-only turn with `finish_reason: "stop"` as silence gets a follow-up request. Answer with an empty follow-up to stay silent. |
| The Terminal and Threads tools load on demand, and `plugin_describe` and `plugin_call` are renamed `yui_tool_describe` and `yui_tool_call` ([#1833](https://github.com/yw0nam/YUI/pull/1833)). | Rename the two bridge tools in your backend. Read the on-demand tool names from the `on-demand tools:` line in the [Client Context](../reference/client-context.md). |
| An Ask can let the user pick several choices, and the answer carries a `choices` array instead of one `choice` ([#1837](https://github.com/yw0nam/YUI/pull/1837)). | Send `choices` for a multi-select Ask. A client older than this release cannot answer a multi-select Ask ([Threads](../reference/threads.md)). |
| AvatarSample_A replaces Sendagaya Shino as the bundled default VRM ([#1850](https://github.com/yw0nam/YUI/pull/1850)). | Nothing, unless you used Sendagaya Shino: a stored selection of it loads the default. Add your own copy with **Add from file…** in the **Body** page's VRM section. |
| Push Stop covers the newest 200 turn ids, not every outstanding turn ([#1880](https://github.com/yw0nam/YUI/pull/1880)). | Nothing, unless a backend leaves more than 200 turns unfinished and needs Stop to reach the older ones. |
| The loopback ingress serves one request per connection, with read deadlines and at most 64 open connections ([#1884](https://github.com/yw0nam/YUI/pull/1884)). | A producer that reuses one keep-alive connection for many posts must open a new connection for each request. Headers must arrive within 5 seconds, and the body within 10 seconds ([`/signals`](../reference/signals-ingress.md)). |

### Fixes and smaller changes

#### Chat and turns

- `address_character` hands a message to another character only when the user asks for the handoff ([#1695](https://github.com/yw0nam/YUI/pull/1695)).
- Enum-mode `emotion_text` takes a sequence of table tags ([#1727](https://github.com/yw0nam/YUI/pull/1727)).
- Speech bubbles drop HTML that Markdown does not produce, such as forms ([#1789](https://github.com/yw0nam/YUI/pull/1789)).
- A turn that hits a rate limit (HTTP 429) shows one plain line ([#1801](https://github.com/yw0nam/YUI/pull/1801)).

#### Windows and characters

- Signal chips stay inside the strip beside the character at every window size ([#1679](https://github.com/yw0nam/YUI/pull/1679)).
- The signal details sheet stays inside the pet window, and opening it never scrolls the page ([#1697](https://github.com/yw0nam/YUI/pull/1697)).
- The character's soles stand on the floor line at their near edge ([#1761](https://github.com/yw0nam/YUI/pull/1761)).
- The Threads and delegation chips fold in a narrow pet window ([#1767](https://github.com/yw0nam/YUI/pull/1767), [#1773](https://github.com/yw0nam/YUI/pull/1773)).
- On macOS 26.2, the Threads window's resize edges show a resize cursor ([#1782](https://github.com/yw0nam/YUI/pull/1782)), and the settings hint dot shows the pointer cursor ([#1788](https://github.com/yw0nam/YUI/pull/1788)).
- VRoid VRM 0.x models show surprised, curious, and embarrassed expressions ([#1848](https://github.com/yw0nam/YUI/pull/1848)).

#### Threads and terminals

- The Threads store targets 200 Threads, but keeps Threads that wait for an answer, so it can hold more ([#1885](https://github.com/yw0nam/YUI/pull/1885)).
- In the Threads, Terminal, delegation, and workflow lists, a click, the focused row, and the scroll position survive a snapshot ([#1894](https://github.com/yw0nam/YUI/pull/1894)).
- The Ask card's buttons and text field show a visible focus ring, and a folded delegation chip keeps its accessible name ([#1829](https://github.com/yw0nam/YUI/pull/1829), [#1831](https://github.com/yw0nam/YUI/pull/1831), [#1839](https://github.com/yw0nam/YUI/pull/1839)).
- At most 16 terminals can be open at once ([#1881](https://github.com/yw0nam/YUI/pull/1881)).
- The Terminal tab sends whole Hangul syllables typed through WebKit's Korean IME ([#1783](https://github.com/yw0nam/YUI/pull/1783)).
- Copying inside tmux in a Terminal reaches the system clipboard ([#1793](https://github.com/yw0nam/YUI/pull/1793)).

#### Voice and settings

- TTS recovers when the voice server starts after the app ([#1847](https://github.com/yw0nam/YUI/pull/1847)).
- The Connection page shows whether the STT and TTS servers answer. **Reconnect** appears when a server cannot be reached or does not answer in time ([#1871](https://github.com/yw0nam/YUI/pull/1871)).
- A text size setting, five steps from 90% to 140%, scales the text in every window ([#1775](https://github.com/yw0nam/YUI/pull/1775)).

#### App and plugins

- The daily briefing page reads as a ruled reference sheet, with one lead item per section ([#1649](https://github.com/yw0nam/YUI/pull/1649)).
- The macOS build carries an ad hoc signature, so the first launch offers **Open Anyway** in System Settings instead of refusing the app as damaged ([#1696](https://github.com/yw0nam/YUI/pull/1696)).
- A running plugin states its tool count once on the **Plugins** page ([#1707](https://github.com/yw0nam/YUI/pull/1707)).
- The `browser` plugin 0.1.1 starts ego lite outside its job on Windows, and a stalled screenshot is bounded ([#1754](https://github.com/yw0nam/YUI/pull/1754)).
- Plugin servers stop cleanly: Windows waits for the process, and macOS and Linux clean up what a killed app left ([#1755](https://github.com/yw0nam/YUI/pull/1755), [#1756](https://github.com/yw0nam/YUI/pull/1756)).

### Known issues

- If Fish Audio ends free access to `s2.1-pro-free`, the voice model that Quick start sets by default, speech fails and the bubble only says the voice cannot speak ([#1813](https://github.com/yw0nam/YUI/issues/1813)).
