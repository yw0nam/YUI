# Write a plugin

A plugin YUI hosts is a folder with `.claude-plugin/plugin.json`, an optional `.mcp.json` naming
its MCP servers, and an optional `skills/` folder. YUI runs each server itself as a child
process over stdio — a YUI-hosted MCP server — and gives the backend its tools and skills
through the bridge tools. An MCP server the backend agent connects to itself is
Backend-attached: it is configured in that agent, not in this folder.

To install a plugin and turn one on, see [Plugins](./plugins.md).

## Layout

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── bin/
│   └── my-plugin
└── skills/
    └── greet/
        └── SKILL.md
```

`bin/` is where a built server binary lives; a server written in another language sits wherever
its `command` points.

YUI reads three fields of `plugin.json` and ignores every other field:

| Field | What YUI uses it for |
|---|---|
| `name` | The plugin id — the catalog entry's id, the plugin's log file name, and the name in every error string. Lowercase letters, digits and `-`, starting with a letter or digit. |
| `version` | The version shown beside the plugin, and the one YUI compares with the catalog to decide whether an update is due. |
| `description` | The line under the plugin's name on the Plugins page. |

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "One line on what the plugin lets a character do."
}
```

## Servers

`.mcp.json` names each server under `mcpServers`. `command` is required and `args` and `env` are
optional, and the order of the keys is the order YUI starts and lists the servers in.

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

YUI starts `command` with `args` as argv and no shell, so an argument reaches the server exactly
as written: `$(…)`, `;` and quotes are not interpreted.

`${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` are replaced in `command`, in every argument
and in every `env` value. ROOT is the plugin folder, which is also the server's working
directory. DATA is the plugin's own data folder, created before the server starts and deleted
when the user removes the plugin with **Delete** or **Remove from list**
([Plugins § Remove](./plugins.md#remove)). The server inherits YUI's environment, with `env`
added on top.

What YUI expects of a server:

| Expectation | What happens |
|---|---|
| `initialize` and `tools/list` answer in time | The two share one 30 s deadline. A server that misses it shows **Unavailable**, naming the step it stopped at. |
| A server that ends on its own | It is not restarted; **Restart** or the next app start runs it again. |
| A stop | YUI closes the connection, waits up to 1 s, then kills the process group, children included. |
| stdout | The MCP channel, and nothing else. |
| stderr | Each line goes to the plugin's log, prefixed `[<server>] ` and cut at 2000 bytes. Where the log is: [Plugins § Log](./plugins.md#log). |

## Tools

A tool name is taken when a built-in client tool has it or a plugin turned on earlier has it;
the later plugin still runs, with that name hidden ([Plugins § Hidden names](./plugins.md#hidden-names)).
These names belong to built-in client tools: `address_character`, `body_action`,
`generate_express`, `look`, `plugin_call`, `plugin_describe`, `plugin_skill`, `rate_relation`.

Three `_meta` keys matter to a plugin:

| Key | Where | What it does |
|---|---|---|
| `io.github.yw0nam.yui/summary` | the tool's `_meta` in `tools/list` | The one-line summary a turn shows for the tool; without it YUI takes one from the tool's `description` ([Client Context § plugin tools](../reference/client-context.md#plugin-tools)). |
| `io.github.yw0nam.yui/wait_ms` | the tool's `_meta` in `tools/list` | How long the MCP host waits for one call to the tool ([Client Tools § Waits and cancel](../reference/client-tools.md#waits-and-cancel)). |
| `io.github.yw0nam.yui/preset` | the request `_meta` of each `tools/call` | The id of the preset whose character called, so a tool can keep one state per character ([Client Tools § Status and consent](../reference/client-tools.md#status-and-consent)). |

YUI checks a call's `arguments` against the tool's `inputSchema` before it sends the call, and
sends no `arguments` field when that object is empty. A call that runs past its wait, or whose
turn stops, reaches the server as `notifications/cancelled`. The result reaches the model as
text and images in one shape ([Client Tools § Bridge tools](../reference/client-tools.md#bridge-tools)).
[plugins/browser](https://github.com/yw0nam/YUI/blob/main/plugins/browser/README.md) is a worked
plugin with one tool.

## Skills

A skill is `skills/<folder>/SKILL.md`, one level deep. Its frontmatter sits between `---` lines:

| Field | |
|---|---|
| `description` | Required. A skill without one is skipped, with a warning in the app log. |
| `name` | Optional; the folder name when absent. `plugin_skill` and the per-turn line use it. |

```markdown
---
name: greet
description: Greets the user in one line.
---

Say hello to the user, then stop.
```

`plugin_skill` returns the text after the frontmatter and nothing else: YUI serves no other file
of the skill folder, so the body carries every instruction the agent needs. The body is read on
each `plugin_skill` call, so an edit to it takes effect on the next call. The name and the
description are read when the plugin is turned on, so a frontmatter edit needs the plugin turned
off and on again. What a turn shows of a skill:
[Client Context § plugin skills](../reference/client-context.md#plugin-skills).

## Test locally

Run the app (`pnpm tauri dev`, or a release build), open **Plugins**, and choose
**Add from folder…** ([Plugins § Add from a folder](./plugins.md#add-from-a-folder)). Turn the
plugin on and **Allow** once: the approval holds for that folder path while its files change.

After changing `plugin.json`, `.mcp.json`, a server's code or a skill's frontmatter, turn the
plugin off and on — turning on reads the manifest again. **Restart** does not pick up a change:
a running server shows no **Restart**, and a server YUI starts again runs from the spec it read
when the plugin was turned on.

[The test fixture](https://github.com/yw0nam/YUI/blob/main/src-tauri/fixtures/mcp-test-plugin)
is a minimal plugin with one server, a tool that carries `_meta`, and one skill.

## Publish

A catalog entry comes from one of two sources.

**Official** — the plugin lives under `plugins/<id>/` in this repository, and the YUI release
workflow builds and releases it:
[Build, Run & Logs § Plugin releases](https://github.com/yw0nam/YUI/blob/main/docs/agent-guide/build-run.md#plugin-releases)
carries the tag, the version rule and the zip layout.

**Community** — the plugin lives in the author's public GitHub repository, and YUI installs it
from:

- `.claude-plugin/plugin.json` on the default branch, carrying the current `version`.
- A GitHub release tagged `v<version>`.
- One asset per platform the catalog entry declares, named
  `<id>-<version>-<platform>.zip`, where `<platform>` is `darwin-arm64` or `windows-x64`.
- A zip whose root is the plugin root, with a `plugin.json` inside whose `name` is the entry's
  `id` and whose `version` is the tagged version.
- `checksums.txt` in the same release, listing each asset on a `sha256sum` line —
  `<hex>  <file>` or `<hex> *<file>`.

YUI reads the version from the default branch, so a release goes out before its version change
reaches that branch.

To list a community plugin, follow
[CONTRIBUTING.md § Plugins](https://github.com/yw0nam/YUI/blob/main/CONTRIBUTING.md#plugins).
