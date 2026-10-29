# yui-notify

Claude Code and Codex hooks post coding-agent conversations as [Threads](../../docs/reference/threads.md).
Threads are app-wide and fire no character turn. Codex accepts answers through synchronous
hooks; Claude Code Threads are read-only and permission questions stay at its terminal.

## Install

Claude Code:

```text
/plugin marketplace add yw0nam/YUI
/plugin install yui-notify@yui
```

Codex:

```bash
codex plugin marketplace add yw0nam/YUI
codex plugin add yui-notify@yui
```

Codex requires hook trust at startup. Changed hook definitions require trust again; see
[Codex setup](skills/setup/references/codex.md). Run `/yui-notify:setup` in Claude Code or
`$yui-notify:setup` in Codex to configure the endpoint, probe it, and send a test Thread.

YUI requires **Settings → Proactive → Watchers → External signals** on. The loopback
listener defaults to port `8770`; switch and port changes take effect after restart.

## What it sends

Every event sends `PUT <endpoint>/threads/<id>` with source, title, label, state, and
one entry when text is available. The title is `<project> (<branch>)`, or `<project>`.
The label joins the present host, tmux session/window, and project/branch parts.

Claude Code ids are `claude-code:<host>:<claude pid>`: `CLAUDE_PID`, or the hook's parent
PID when absent. They survive `/clear`. Codex ids are `codex:<host>:<session_id>`.
`host` is the hostname before its first dot, including on local sessions.

| Agent | Event | State | Entry | Ask |
|---|---|---|---|---|
| Both | `UserPromptSubmit` | `working` | `user`: prompt | Closes |
| Claude Code | `Stop` | `completed` | `agent`: last assistant message | Closes |
| Claude Code | `PermissionRequest` | `input-required` | `system`: tool name and command or input JSON | None added |
| Claude Code | `Notification` (elicitation) | `input-required` | `system`: message | None added |
| Codex | `Stop` | `input-required` | `agent`: last assistant message | “What next?” with text |
| Codex | `PermissionRequest` | `input-required` | `system`: tool name and command or input JSON | Allow, Deny, or text |

Each Codex ask has a fresh UUID suffix, including successive Stops in one turn.
Entry text keeps at most 16384 code points, shortening the head with `…` when needed.
The serialized body stays within 65536 bytes, including for Unicode text.

## Codex answers and fallback

`Stop` and `PermissionRequest` are synchronous, with a 660-second hook timeout.
After posting an ask, Codex's hook long-polls its answer route in intervals up to 25 seconds.
YUI never connects back to the agent. The turn stays open while the hook waits.

- Permission Allow returns an allow decision. Deny returns a deny decision with any text
  as its message. Text alone denies and gives Codex that instruction.
- Stop text returns `{"decision":"block","reason":"<text>"}` to continue the turn.
  The continuation's Stop posts another ask, so instructions can be chained.
- Release prints nothing and closes the ask: Stop becomes `completed`; permission stays
  `working` while Codex uses its terminal approval prompt.
- A wait cap, closed ask (410), or error prints nothing and closes the ask with a final
  PUT: `completed` for Stop, `working` for permission fallback to the terminal.

When Codex's host app is frontmost on macOS, permission posts without an ask and exits
immediately, letting the terminal prompt appear. Stop still asks. The check compares
inherited `__CFBundleIdentifier` with `lsappinfo`; it is per app, not tab or pane.
SSH, tmux, missing bundle identifiers, and hosts without `lsappinfo` skip the focus check.

## Suppressions

Claude Code Stop with a running background task or an SDK entrypoint sends nothing.
Claude Code SDK and non-interactive Codex sessions also suppress `UserPromptSubmit`.
Codex Stop sends nothing for non-interactive rollout sources (including exec and subagents).
`idle_prompt` and `permission_prompt` notifications are not hooked. Codex has no
`Notification` event, so its MCP elicitation sends nothing.

## Configuration

Read `$XDG_CONFIG_HOME/yui-notify/config.json`, or `~/.config/yui-notify/config.json`.
A missing, unreadable, or invalid file uses defaults; invalid values use their key's default.

| Key | Value | Default |
|---|---|---|
| `endpoint` | `http://127.0.0.1:<port>` with no path | `http://127.0.0.1:8770` |
| `wait.stop` | Seconds, 1–600 | `600` |
| `wait.permission` | Seconds, 1–600 | `120` |

```json
{
  "endpoint": "http://127.0.0.1:8770",
  "wait": { "stop": 600, "permission": 120 }
}
```

An endpoint with any path is invalid and uses the default. An explicit probe endpoint with a path reports the problem.
Values outside 1–600 use the default. Poll deadlines use a monotonic clock. Each poll's
`wait` is the smaller of 25 and the remaining whole seconds; its HTTP timeout adds five
seconds. Waiting ends when less than one second remains.

## Commands

```bash
yui-notify hook
yui-notify probe [--endpoint URL]
yui-notify test [--endpoint URL]
```

- `hook` reads stdin JSON and always exits 0. Stdout carries only a startup warning or a
  Codex decision. Failed hook requests write `last-error.json` under
  `$XDG_STATE_HOME/yui-notify/` (default `~/.local/state/yui-notify/`).
- `probe` sends `GET /threads/yui-notify-probe/answer?ask_id=probe&wait=0`.
  HTTP 404 proves the listener and route are up; HTTP 400 prints “update YUI”.
- `test` PUTs one completed Thread at `yui-notify:test:<host>` with a system entry,
  and prints `sent: HTTP <n>` on success.

`probe` and `test` exit 0 on success and 1 on failure. See
[troubleshooting](skills/setup/references/troubleshooting.md) for failure lines.

## Startup check

The synchronous `SessionStart` hook (startup matcher, five-second timeout) runs the probe.
Failure prints `{"systemMessage":"yui-notify: <failure line>"}`; success prints nothing.
Claude Code SDK entrypoints skip this check. Codex SessionStart has no interactive-source
field, so exec sessions run the check too.

## Requirements and development

The hook uses only the Python 3.9+ standard library. Claude Code or Codex needs plugin support.

```bash
cd integrations/yui-notify
uv run pytest
uv run ruff format --check .
uv run ruff check .
```
