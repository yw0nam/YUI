---
name: setup
description: "Configure, update, or repair yui-notify coding-agent Threads and test the YUI listener. Invoke as `/yui-notify:setup` in Claude Code or `$yui-notify:setup` in Codex."
disable-model-invocation: true
license: PolyForm-Noncommercial-1.0.0
---

# yui-notify setup

The plugin posts Claude Code and Codex lifecycle events as app-wide, view-only Threads
without character speech. You answer the agent at its own terminal.

Run this setup once on every host where an agent runs, each with the plugin installed there.
Commands run from this skill's directory. Read `references/troubleshooting.md` for a failed
command, and `references/remote.md` when the agent runs over SSH.

## 1. Locate the setup

Read `$XDG_CONFIG_HOME/yui-notify/config.json` (default `~/.config/yui-notify/config.json`).
For an existing file, show the endpoint and ask which value to change. Show any
`$XDG_STATE_HOME/yui-notify/last-error.json` (default `~/.local/state/yui-notify/last-error.json`).
A missing configuration starts new setup.

Find hand-installed YUI hooks in user and project Claude settings, `~/.codex/hooks.json`,
and the hooks tables in `~/.codex/config.toml`. List hooks that post to YUI or invoke a
YUI script. Offer to remove only duplicate entries; ask before deleting a script file.

Done when: the user knows whether this is new setup or update, and has chosen what to
keep for every duplicate hook.

## 2. Probe YUI

Turn on **Settings → Proactive → What she reacts to → External signals** in YUI, then restart YUI.
Ask where YUI runs. For an agent over SSH, follow `references/remote.md` first.
Use `http://127.0.0.1:<port>` with no path, default `http://127.0.0.1:8770`.

```bash
../../bin/yui-notify probe --endpoint <url>
```

Done when: the command prints
`ok: YUI is listening at <url>/threads/yui-notify-probe`.
HTTP 400 or 404 means “update YUI”; follow troubleshooting for other failure lines.

## 3. Write configuration

Create `$XDG_CONFIG_HOME/yui-notify/` when missing and write `config.json` with the chosen
endpoint.

```json
{
  "endpoint": "http://127.0.0.1:8770"
}
```

The endpoint is `http://127.0.0.1:<port>` with no path; a path is invalid and uses the default.

Done when: the JSON contains `endpoint`.

## 4. Test delivery

```bash
../../bin/yui-notify test
```

The command sends one `input-required` Thread with a system entry and no ask. It fires no
character turn unless Thread turns is on in YUI (off by default). Ask the user to open the
Threads chip beside the character and find it.

Done when: the command prints `sent: HTTP 200; look for it in YUI's Threads window` and the
user finds the test Thread. A failure line means the Thread never showed: read
`references/troubleshooting.md`.

## 5. Wire the agent and prove a Thread

This step restarts the agent, so it comes last. Follow the agent's reference:

- Claude Code: `references/claude-code.md`
- Codex: `references/codex.md`

Done when: the user confirms that the session's Thread shows `completed` when the agent
stops, as the reference's last step states.