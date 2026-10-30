---
name: setup
description: "Configure, update, or repair yui-notify coding-agent Threads and test the YUI listener. Invoke as `/yui-notify:setup` in Claude Code or `$yui-notify:setup` in Codex."
disable-model-invocation: true
license: PolyForm-Noncommercial-1.0.0
---

# yui-notify setup

The plugin posts Claude Code and Codex lifecycle events as app-wide Threads without
character speech. Codex waits for answers through synchronous hooks. Claude Code takes
answers through the plugin's channel server.

Commands run from this skill's directory. Read `references/troubleshooting.md` for a failed
command, and `references/remote.md` when the agent runs over SSH.

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
../../bin/yui-notify probe --endpoint <url>
```

Done when: the command prints
`ok: YUI is listening at <url>/threads/yui-notify-probe/answer?ask_id=probe&wait=0`.
HTTP 400 means “update YUI”; follow troubleshooting for other failure lines.

## 3. Write configuration

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

## 4. Test delivery

```bash
../../bin/yui-notify test
```

The command sends one completed Thread with a system entry. It fires no character turn.

Done when: the command prints `sent: HTTP 200` and the user confirms the Thread arrived in YUI.

## 5. Wire the agent and prove an answer

This step restarts the agent, so it comes last. Follow the agent's reference:

- Claude Code: `references/claude-code.md`
- Codex: `references/codex.md`

Done when: the user confirms that a text answer typed in the Threads window reached the
restarted session, as the reference's last step states.
