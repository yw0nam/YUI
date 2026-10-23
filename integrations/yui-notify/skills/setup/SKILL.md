---
name: setup
description: "Configure or update yui-notify so the Claude Code and Codex hooks tell a YUI character when a coding agent finished or needs input. Use this when the user asks to install, set up, change, or repair the yui-notify plugin, choose which character receives agent signals, or test that YUI reacts to an agent. This skill is user-invoked: run it from Claude Code as `/yui-notify:setup` or from Codex as `$yui-notify:setup`."
disable-model-invocation: true
license: PolyForm-Noncommercial-1.0.0
---

# yui-notify setup

The yui-notify plugin installs hooks in Claude Code and Codex. A `Stop` hook posts
`agent.done`, a `PermissionRequest` hook posts `agent.needs_input`, and a Claude Code
`Notification` hook posts `agent.needs_input` when an MCP server asks the user a question.
Each signal goes to one YUI character over the loopback ingress.

This skill writes the plugin's configuration and checks the whole path from a hook to the
character. Read `references/troubleshooting.md` when a probe or a test fails, and
`references/codex.md` or `references/remote.md` when the branch they name applies.

Every command below runs from this skill's directory, and the entry point is
`../../scripts/yui-notify`.

## 1. Locate the current setup

Read `$XDG_CONFIG_HOME/yui-notify/config.json`; use `~/.config` when `XDG_CONFIG_HOME` is
unset.

- The file exists: this is update mode. Show its values and, when present,
  `$XDG_STATE_HOME/yui-notify/last-error.json` (use `~/.local/state` when `XDG_STATE_HOME`
  is unset). Ask which values the user wants changed. In steps 2 and 3 ask only about
  those, and keep every other loaded value.
- The file is missing: this is new setup.

Then find hand-installed YUI hooks that would double-send. Look for an entry under `hooks`
in `~/.claude/settings.json`, `~/.claude/settings.local.json`, the current project's
`.claude/settings.json` and `.claude/settings.local.json`, `~/.codex/hooks.json`, and the
hooks tables of `~/.codex/config.toml`, whose command posts to
`/agent-event` or `/signals` on the YUI port or runs a script that does. List each entry
and offer to remove that entry alone. Change no other hook, and ask before deleting a
script file.

Done when: you have told the user the mode (new or update), and the user has answered
remove or keep for every hand-installed YUI hook you found.

## 2. Probe the character

Ask where YUI runs: on this machine, or on another machine over SSH. For the SSH branch
read `references/remote.md` and follow it before the probe.

Ask which character receives the signals. The main window's character listens at
`http://127.0.0.1:<port>`; a preset's character listens at the URL copied from that
preset's row in the preset list, without the trailing `/signals`. The default port is
`8770`.

Run the probe with the chosen endpoint:

```bash
../../scripts/yui-notify probe --endpoint <url>
```

Done when: the probe prints `ok: YUI is listening at <url>`. On any other line, follow
`references/troubleshooting.md` before continuing.

## 3. Choose the delivery classes

Ask two questions, one for `done` and one for `needs_input`. Offer `urgent`, `batched`, and
`drop`, with the defaults `batched` for `done` and `urgent` for `needs_input`. Give one
line on each choice, from the delivery-class table in
https://github.com/yw0nam/YUI/blob/main/docs/guide/signals-producer.md.

For each agent the user runs, ask whether to turn on a one-sentence model summary of the
finished work — suggest `claude-haiku-5-5` for Claude Code and `gpt-6-luna` for Codex, or
take another model id — or keep the excerpt: the default sends no model call, and a long
message keeps its first and last 740 characters.

Done when: the user has chosen a delivery class for `done`, a delivery class for
`needs_input`, and a summary model or the excerpt for each agent the user runs.

## 4. Wire the agents

Claude Code: the installed plugin's hooks are active after `/reload-plugins` or a restart
of Claude Code.

Codex: follow `references/codex.md`.

Done when: for each agent the user runs, `/hooks` lists the yui-notify `Stop` and
`PermissionRequest` hooks (Claude Code also lists the `Notification` hook).

## 5. Write the configuration

Create `$XDG_CONFIG_HOME/yui-notify/` when it is missing, and write `config.json` with the
values chosen in steps 2 and 3:

```json
{
  "endpoint": "http://127.0.0.1:8770",
  "events": { "done": "batched", "needs_input": "urgent" },
  "summary": null
}
```

`endpoint` is the URL from step 2 with no trailing `/signals`. A preset URL keeps its
`/presets/<id>` prefix. `summary` is `null` by default: a long message then keeps its
first and last 740 characters. An object turns the one-sentence summary on per agent,
e.g. `"summary": { "claude-code": "claude-haiku-5-5", "codex": "gpt-6-luna" }`.

Done when: the file parses as JSON and holds `endpoint`, `events.done`,
`events.needs_input`, and `summary`.

## 6. Run a round trip

Send one test signal:

```bash
../../scripts/yui-notify test
```

The default `urgent` delivery class makes the character speak when the user is present.
Use `--delivery batched` to check the next five-minute batch instead.

Ask the user whether the character reacted. If it did not, or the command did not print a
success line, follow `references/troubleshooting.md`.

Done when: the command prints `sent: HTTP 200` and the user confirms that the character
reacted.
