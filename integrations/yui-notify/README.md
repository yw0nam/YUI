# yui-notify

Claude Code and Codex hooks that tell a YUI character when a coding agent finished or
needs input. A `Stop` hook posts `agent.done`; a `PermissionRequest` hook posts
`agent.needs_input`; a Claude Code `Notification` hook posts `agent.needs_input` when an
MCP server asks the user a question. Each signal goes to one YUI character over the
loopback ingress.

## Install

Claude Code:

```
/plugin marketplace add yw0nam/YUI
/plugin install yui-notify@yui
```

Codex:

```bash
codex plugin marketplace add yw0nam/YUI
codex plugin add yui-notify@yui
```

Codex asks the user to trust the hooks at startup; see
[`skills/setup/references/codex.md`](skills/setup/references/codex.md).

Then run the setup skill, which probes the character, chooses the delivery classes, writes
the configuration, and sends a test signal:

- Claude Code: `/yui-notify:setup`
- Codex: `$yui-notify:setup`

YUI must run with **Settings → Proactive → Watchers → External signals** on. The listener
is loopback-only, and its port defaults to `8770`.

## What it sends

| Agent | Hook | `event_type` | Default delivery class |
|---|---|---|---|
| Claude Code, Codex | `Stop` | `agent.done` | `batched` |
| Claude Code, Codex | `PermissionRequest` | `agent.needs_input` | `urgent` |
| Claude Code | `Notification` (`elicitation_dialog`, `elicitation_url_dialog`) | `agent.needs_input` | `urgent` |

Every signal POSTs to `<endpoint>/signals` with:

- `source`: `claude-code` or `codex`
- `event_id`: `<session_id>:<phase>`
- `label`: the present parts of host, `tmux <session>:<window>`, and `<project> (<branch>)`
- item fields: `project`, `branch`, `host`, `tmux`, and `summary` for `agent.done` or
  `pending` for `agent.needs_input`

The delivery classes and the envelope fields are in the
[signals ingress reference](../../docs/reference/signals-ingress.md) and the
[producer guide](../../docs/guide/signals-producer.md).

## What it does not send

- A Claude Code `Stop` while any `background_tasks` entry has status `running`.
- A `Stop` of a headless `claude -p` run: the process exits before the `async` hook finishes, so
  no `agent.done` is sent.
- The `idle_prompt` and `permission_prompt` notifications: they repeat `Stop` and
  `PermissionRequest`.
- A Codex `Notification`: Codex has no such event, so an MCP elicitation prompt in Codex
  posts nothing.
- An event whose delivery class in the configuration is `drop`.
- The nested `claude -p` call that writes a summary; it runs with `YUI_NOTIFY_CHILD=1`,
  and every hook exits at once under that variable.

## Configuration

`$XDG_CONFIG_HOME/yui-notify/config.json`, or `~/.config/yui-notify/config.json` when
`XDG_CONFIG_HOME` is unset.

| Key | Value | Default |
|---|---|---|
| `endpoint` | `http://127.0.0.1:<port>`, optionally followed by `/presets/<id>`; no trailing `/signals` | `http://127.0.0.1:8770` |
| `events.done` | `urgent`, `batched`, or `drop` | `batched` |
| `events.needs_input` | `urgent`, `batched`, or `drop` | `urgent` |
| `summary` | A model id for the one-sentence summary, or `null` to send the message text | `claude-haiku-5-5` |

A missing file, an unreadable file, or an invalid value falls back to its default. A value
outside the three delivery classes takes that event's default.

```json
{
  "endpoint": "http://127.0.0.1:8770/presets/aaaa0001",
  "events": { "done": "batched", "needs_input": "urgent" },
  "summary": "claude-haiku-5-5"
}
```

## Files

| Path | Content |
|---|---|
| `$XDG_CONFIG_HOME/yui-notify/config.json` | The configuration above |
| `$XDG_STATE_HOME/yui-notify/last-error.json` | `{"time", "url", "status", "error"}` from the last failed hook POST; `XDG_STATE_HOME` defaults to `~/.local/state` |

## Commands

```bash
yui-notify hook
yui-notify probe [--endpoint URL]
yui-notify test [--endpoint URL] [--delivery urgent|batched]
```

- `hook` reads the agent's hook JSON on stdin and exits 0 after posting or after any
  failure. It never writes to stdout.
- `probe` posts `{"signals": [], "envelope": "yui-notify-probe"}`; HTTP 200 proves the
  listener is up and the route and preset exist. The client drops the group because the
  envelope is not an object, so nothing is delivered and YUI logs one warning.
- `test` posts one `yui-notify.test` signal and prints `sent: HTTP <n>` on success.

`probe` and `test` print one line and exit 1 on failure. The
[setup troubleshooting page](skills/setup/references/troubleshooting.md) maps each line to
its cause.

## Requirements

- `python3` 3.9 or later for the hook process.
- Claude Code or Codex with plugin support.
- YUI running with External signals on.
- The `claude` CLI is optional. With it, `summary` writes one sentence from the last
  assistant message; without it, the message is cut to 1500 characters.

## Developing

```bash
cd integrations/yui-notify
uv sync
uv run pytest
uv run ruff format --check .
uv run ruff check .
```
