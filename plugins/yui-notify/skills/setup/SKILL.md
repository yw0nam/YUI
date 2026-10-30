---
name: setup
description: "Configure, update, or repair yui-notify coding-agent Threads and test the YUI listener. Invoke as `/yui-notify:setup` in Claude Code or `$yui-notify:setup` in Codex."
disable-model-invocation: true
license: PolyForm-Noncommercial-1.0.0
---

# yui-notify setup

The plugin posts Claude Code and Codex lifecycle events as app-wide Threads without
character speech. Codex waits for answers through synchronous hooks. Claude Code Threads
accept answers through the channel server when launched with the channel flag.

Commands run from this skill's directory. Read `references/troubleshooting.md` for a failed
command, and `references/codex.md` or `references/remote.md` when applicable.

## 1. Locate the setup

Read `$XDG_CONFIG_HOME/yui-notify/config.json` (default `~/.config/yui-notify/config.json`).
For an existing file, show the endpoint and wait caps and ask which values to change.
Keep other supported values. Show any `$XDG_STATE_HOME/yui-notify/last-error.json`
(default `~/.local/state/yui-notify/last-error.json`). A missing configuration starts new setup.

Find hand-installed YUI hooks in user and project Claude settings, `~/.codex/hooks.json`,
and the hooks tables in `~/.codex/config.toml`. List hooks that post to YUI or invoke a
YUI script. Offer to remove only duplicate entries; ask before deleting a script file.

Done when: the user knows whether this is new setup or update, and has chosen what to
keep for every duplicate hook.

## 2. Probe YUI

Ask where YUI runs. For an agent over SSH, follow `references/remote.md` first.
Use `http://127.0.0.1:<port>` with no path, default `http://127.0.0.1:8770`.
Turn on **Settings → Proactive → Watchers → External signals**, then restart YUI.

```bash
../../scripts/yui-notify probe --endpoint <url>
```

Done when: the command prints
`ok: YUI is listening at <url>/threads/yui-notify-probe/answer?ask_id=probe&wait=0`.
HTTP 400 means “update YUI”; follow troubleshooting for other failure lines.

## 3. Wire the agents

Claude Code loads plugin hooks after `/reload-plugins` or restart. Install `uv` on every
Claude Code host, including SSH hosts; the channel server uses Python 3.11+ through uv.
Hooks still use system `python3` (3.9+, stdlib only). Start a new session with:

```bash
claude --dangerously-load-development-channels plugin:yui-notify@yui
```

Offer a shell alias such as `alias claude-yui='claude --dangerously-load-development-channels plugin:yui-notify@yui'`
so later sessions keep the flag. Channels are a research preview requiring channel access
for the user's account and organization. Without the flag the MCP server stays idle and
Claude Code Threads remain read-only. Codex follows
`references/codex.md`; changed hook definitions require trusting the hooks again.

Done when: `/hooks` lists `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`, and
`PermissionRequest` without a review warning. Claude Code also lists `Notification`.

## 4. Write configuration

Create `$XDG_CONFIG_HOME/yui-notify/` when missing and write `config.json` with the chosen
endpoint and wait caps. Use the defaults unless the user requests different caps.

```json
{
  "endpoint": "http://127.0.0.1:8770",
  "wait": { "stop": 600, "permission": 120 }
}
```

Both waits accept 1–600 seconds; out-of-range values use defaults. The endpoint is
`http://127.0.0.1:<port>` with no path; a path is invalid and uses the default.

Done when: the JSON contains `endpoint`, `wait.stop`, and `wait.permission`.

## 5. Test delivery

```bash
../../scripts/yui-notify test
```

The command sends one completed Thread with a system entry. It fires no character turn.
Ask the user to verify the test Thread in YUI. Codex Stop asks for the next instruction;
permission asks offer Allow, Deny, text, or release to the terminal. A channel-enabled
Claude Code session supports the same asks; its hooks never wait for an answer.

Done when: the command prints `sent: HTTP 200` and the user confirms the Thread arrived.
