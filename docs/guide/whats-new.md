# What's new

Releases are newest first; older releases are on [GitHub Releases](https://github.com/yw0nam/YUI/releases).

## v0.6.0

### Highlights

- The settings window has a **Plugins** page. Install an official or community plugin from the Catalog, then turn it on ([Plugins](plugins.md)).
- A plugin's tools and skills reach the backend through three bridge tools, so the model describes a tool, calls it, and reads a skill ([Client Tools](../reference/client-tools.md)).
- The `browser` tool comes from the official `browser` plugin, installed from the Catalog like any other plugin ([Plugins](plugins.md)).
- **Default** reasoning effort sends no effort, so the model applies its own default ([Connect a backend](connect-a-backend.md)).
- yui-notify posts nothing while the agent's app is in front, and warns at session start when it cannot reach YUI ([Send signals from a producer](signals-producer.md)).

### Breaking changes

| Change | What you do |
| --- | --- |
| The `briefing.py migrate` command, the daily briefing's one-time folder move, is removed ([#1652](https://github.com/yw0nam/YUI/pull/1652)). | Nothing, unless your spool holds day folders at its root: move them into `reports/` by hand. |
| The Expression Broker connection is removed, and client-declared tools carry expression cues ([#1654](https://github.com/yw0nam/YUI/pull/1654)). | Nothing, unless you set `broker_base_url`: the key is ignored. Expression cues on Chat Completions and Responses need a backend that passes request tools to its model; elsewhere they arrive on the push transport ([Push transport](../reference/push-transport.md)). |
| `POST /agent-event` is removed ([#1655](https://github.com/yw0nam/YUI/pull/1655)). | Nothing, unless a hook posts to `/agent-event`: point it at `/signals`. |
| The `immediate` delivery class and a `/signals` request without an envelope are removed ([#1656](https://github.com/yw0nam/YUI/pull/1656)). | Nothing, unless a producer sends `immediate` or no envelope: send `urgent` or `batched` inside an envelope. |
| The factorio server moves to `plugins/factorio`, and the avatar, desktop-control, shell-sandbox, browser-cdp and router Mods are removed ([#1674](https://github.com/yw0nam/YUI/pull/1674)). | Nothing, unless you run one of the removed Mods or factorio from a checkout: the Mods' folders are gone, and factorio lives in `plugins/factorio`. |
| `address_character.to` and `rate_relation.toward` drop their enum of open presets, and each turn lists the open characters instead ([#1686](https://github.com/yw0nam/YUI/pull/1686)). | Nothing, unless your backend picks those arguments from the enum: it reads the `open characters:` line in the client context ([Client Context](../reference/client-context.md)). |
| Reasoning effort starts at **Default**, which sends no effort, and an unknown stored value reads as **Default** ([#1700](https://github.com/yw0nam/YUI/pull/1700)). | A preset that stored **None** keeps it. Pick **Default** once to let the model apply its own. |
| The built-in `browser` tool, the **Allow browser use** switch, and the `yui.browser` setting are removed; the tool comes from the official `browser` plugin ([#1704](https://github.com/yw0nam/YUI/pull/1704)). | Install the `browser` plugin on the **Plugins** page and turn it on ([Plugins](plugins.md)). |

### Fixes and smaller changes

- The daily briefing page reads as a ruled reference sheet, with one lead item per section ([#1649](https://github.com/yw0nam/YUI/pull/1649)).
- Signal chips stay inside the strip beside the character at every window size ([#1679](https://github.com/yw0nam/YUI/pull/1679)).
- `address_character` hands a message to another character only when the user asks for the handoff ([#1695](https://github.com/yw0nam/YUI/pull/1695)).
- The macOS build carries an ad hoc signature, so the first launch offers **Open Anyway** in System Settings instead of refusing the app as damaged ([#1696](https://github.com/yw0nam/YUI/pull/1696)).
- The signal details sheet stays inside the pet window, and opening it never scrolls the page ([#1697](https://github.com/yw0nam/YUI/pull/1697)).
- A running plugin states its tool count once on the **Plugins** page ([#1707](https://github.com/yw0nam/YUI/pull/1707)).
