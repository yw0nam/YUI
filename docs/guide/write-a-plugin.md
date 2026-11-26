# Write a plugin

A plugin is one folder holding a manifest plus, optionally, MCP servers and skills. YUI runs each server. The brain reaches its tools with `yui.plugins.call` inside `yui_run`, and its skills with `help("plugin:<name>")`.

To build one with a coding agent, paste this line:

```text
Build a YUI plugin that <what it should do>, following https://raw.githubusercontent.com/yw0nam/YUI/main/coding-agents/yui-dev/skills/yui-plugin/SKILL.md
```

```mermaid
flowchart LR
  folder["my-plugin/"] --> manifest[".claude-plugin/plugin.json"]
  folder --> mcp[".mcp.json"]
  folder --> server["bin/my-plugin"]
  folder --> skills["skills/greet/SKILL.md"]
  mcp --> host["YUI MCP host"]
  host -->|"starts"| server
  brain["Brain"] -->|"yui_run"| host
```

The work takes four steps:

1. [Lay out the folder](#layout)
2. [Write the server](#servers)
3. [Declare tools and skills](#tools-and-skills)
4. [Test it locally](#test-locally)

## Layout

`bin/` holds a built server, though a server written in another language can sit wherever its `command` points.

YUI reads three fields of `plugin.json` and ignores the rest:

| Field | YUI uses it for |
|---|---|
| `name` | The plugin id: the catalog id, the log file name, and the name in every error. Lowercase letters, digits and `-`, starting with a letter or digit. |
| `version` | The version beside the plugin, and the one compared with the catalog to decide an update. |
| `description` | The line under the plugin's name on the Plugins page. |

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "One line on what the plugin lets a character do."
}
```

## Servers

`.mcp.json` names each server under `mcpServers`, with `command` required and `args` and `env` optional. YUI starts and lists the servers in the order their keys appear.

```json
{
  "mcpServers": {
    "my-plugin": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/my-plugin",
      "args": ["--stdio"],
      "env": { "MY_PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}" }
    }
  }
}
```

YUI starts `command` with `args` as argv and no shell, so an argument reaches the server as written. It replaces `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` in `command`, in every argument and in every `env` value.

The server gets two folders:

- ROOT is the plugin folder, which is also the working directory.
- DATA is the plugin's data folder. YUI creates it before the start and deletes it when the user removes the plugin.

The server inherits YUI's environment, with `env` applied over it.

| What YUI expects | What happens |
|---|---|
| `initialize` and `tools/list` answer within 30 s together | A miss shows **Unavailable**, naming the step it stopped at. |
| A server that ends on its own | It shows **Exited** with **Restart**; the next app start runs it again. |
| A stop | YUI closes the connection, waits up to 1 s, then kills the server and every process it started. |
| The app killed without quitting | Every process the server started ends: with the app on Windows, at the next app start on macOS. |
| stdout | The MCP channel, and nothing else. |
| stderr | Each line goes to the plugin log, prefixed `[<server>] ` and cut at 2000 bytes. |

On Windows, a process started with `CREATE_BREAKAWAY_FROM_JOB` leaves the tree and outlives a stop.

## Tools and skills

A tool name held by a built-in client tool or by an already enabled plugin is hidden, though the later plugin still runs ([Plugins](./plugins.md)).

These names belong to declared client tools: `address_character`, `body_action`, `generate_express`, `rate_relation` and `yui_run`. A plugin tool may take any other name.

| `_meta` key | Where | What it does |
|---|---|---|
| `io.github.yw0nam.yui/summary` | the tool's `_meta` in `tools/list` | The one-line summary the `yui_run` description lists for the tool ([Client Tools § The lists in the descriptions](../reference/client-tools.md#the-lists-in-the-descriptions)). |
| `io.github.yw0nam.yui/wait_ms` | the tool's `_meta` in `tools/list` | How long the host waits for one call ([Client Tools](../reference/client-tools.md#waits-and-cancel)). |
| `io.github.yw0nam.yui/preset` | the request `_meta` of every `tools/call` | The preset id of the calling character, so a tool keeps one state per character. |

YUI checks `arguments` against the tool's `inputSchema` before it sends a call, and it sends no `arguments` field when that object is empty. It also sends `notifications/cancelled` when a wait has passed or a turn stops ([Client Tools](../reference/client-tools.md)).

A skill is `skills/<folder>/SKILL.md`, one level deep. Its frontmatter sits between `---` lines:

```markdown
---
name: greet
description: Greets the user in one line.
---
```

| Field | Rule |
|---|---|
| `description` | Required. A skill without one is skipped, with a warning in the app log. |
| `name` | Optional; the folder name when absent. `help("plugin:<name>")` and the `yui_run` description use it. |

`help("plugin:<name>")` returns the text after the frontmatter and nothing else, so the body carries every instruction. YUI serves no other file of the skill folder.

The body is read on each call. The name and description are read at turn-on, so a frontmatter edit needs the plugin off and on again.

## Send signals

A server can hand the character a signal group without a tool call. It sends one notification, with no `id`, whose method is `notifications/io.github.yw0nam.yui/signals`:

```json
{"jsonrpc": "2.0", "method": "notifications/io.github.yw0nam.yui/signals",
 "params": {"signals": [{"kind": "build_done"}],
            "envelope": {"source": "my-plugin", "event_type": "build_done", "delivery": "urgent",
                         "event_id": "build-42", "occurred_at": 1787449000000}}}
```

`params` is the `POST /signals` body ([Signals ingress](../reference/signals-ingress.md#from-a-plugin)): a `signals` array and an `envelope`. Each item stays within 16 KiB; the 64 KiB body limit belongs to the HTTP route only.

The group goes to the main window's character and becomes a turn under the usual delivery rules. The External signals switch does not gate it: turning the plugin on is the consent.

- Send after the client's `notifications/initialized`. A notification sent before the handshake completes is dropped.
- A notification sent before the main window listens, early in app start, is lost.
- A notification that arrives after the plugin is turned off is dropped.
- A notification whose `params` is absent, `null`, or an object that breaks a rule adds a `signals refused: <reason>` line to the plugin log. Scalar or array `params` are refused while the frame is decoded, before that check, and leave no line.

## Test locally

1. Run the app (`pnpm tauri dev`, or a release build).
2. Open **Plugins**.
3. Choose **Add from folder…**.
4. Turn the plugin on, then choose **Allow** once.

The approval holds for that folder path while its files change. A different path asks again.

A change to `plugin.json`, `.mcp.json` or a skill's frontmatter needs the plugin off and on.

**Retry** and **Restart** start the server process again from the `.mcp.json` entry read at turn-on, so they pick up rebuilt server code but not a manifest change.

While a server is running, neither button appears.

## Tips

- Start from [the test fixture](https://github.com/yw0nam/YUI/tree/main/src-tauri/fixtures/mcp-test-plugin): one server, one tool with `_meta`, and one skill.
- [plugins/browser](https://github.com/yw0nam/YUI/blob/main/plugins/browser/README.md) is a worked plugin with one tool.
- A server that the backend agent connects to itself is Backend-attached, so you configure it in that agent rather than in the plugin folder.

## Go deeper

- [Client Tools](../reference/client-tools.md): `yui_run`, the yui API, arguments, waits and consent.
- [Client Tools § The lists in the descriptions](../reference/client-tools.md#the-lists-in-the-descriptions): what the `yui_run` description carries of a plugin's tools and skills.

To share it with other users, see [Contribute a plugin](./contribute-a-plugin.md).
